'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const RoomManager = require('./game/RoomManager');
const GameEngine  = require('./game/GameEngine');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const rooms  = new RoomManager();

app.use(express.static(path.join(__dirname, 'public')));

// Expose questions for solo mode
app.get('/questions.json', (_req, res) =>
  res.sendFile(path.join(__dirname, 'questions.json'))
);

app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
);

io.on('connection', (socket) => {
  console.log(`[+] ${socket.id}`);

  // ── Create room (facilitator) ───────────────────────────────────────────
  socket.on('create_room', ({ password } = {}, ack) => {
    if (!password) return ack?.({ error: 'Password required.' });
    const room = rooms.createRoom(socket.id, password);
    socket.join(room.code);
    console.log(`[room] created ${room.code}`);
    ack?.({ code: room.code, players: [] });
  });

  // ── Join room (player) ──────────────────────────────────────────────────
  socket.on('join_room', (payload, ack) => {
    const result = rooms.joinRoom(socket.id, payload ?? {});
    if (!result.ok) return ack?.({ ok: false, error: result.reason });

    const { room } = result;
    socket.join(room.code);
    const playerList = rooms.getPlayerList(room);

    // Broadcast to ALL in room including facilitator (late-joiner requirement)
    io.to(room.code).emit('player_joined', { players: playerList });
    console.log(`[join] ${payload.name} → ${room.code}`);
    ack?.({ ok: true, players: playerList });
  });

  // ── Start game (facilitator) ────────────────────────────────────────────
  socket.on('start_game', (_payload, ack) => {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room)                              return ack?.({ error: 'Not in a room.' });
    if (room.facilitatorId !== socket.id)  return ack?.({ error: 'Facilitators only.' });
    if (room.status !== 'lobby')           return ack?.({ error: 'Already started.' });
    if (room.players.size < 1)             return ack?.({ error: 'Need at least 1 player.' });

    room.status = 'playing';
    const playerList = rooms.getPlayerList(room);
    io.to(room.code).emit('game_starting', { players: playerList });

    // Boot game engine
    const engine = new GameEngine(room, io);
    room.gameState = engine;

    ack?.({ ok: true });
    setTimeout(() => engine.startRound(), 1000);
  });

  // ── Submit answer (player) ──────────────────────────────────────────────
  socket.on('submit_answer', ({ answer } = {}) => {
    const room = rooms.getRoomBySocket(socket.id);
    if (!room || !room.gameState) return;
    room.gameState.handleAnswer(socket.id, answer);
  });

  // ── Disconnect ──────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id}`);
    const room = rooms.markDisconnected(socket.id);
    if (!room) return;

    if (room.facilitatorId === socket.id) {
      if (room.gameState) room.gameState.destroy();
      io.to(room.code).emit('room_closed', { reason: 'Facilitator disconnected.' });
      rooms.deleteRoom(room.code);
    } else {
      io.to(room.code).emit('player_left', {
        players: rooms.getPlayerList(room),
        name: room.players.get(socket.id)?.name,
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`🪨  Toka Hāngi → http://localhost:${PORT}`)
);
