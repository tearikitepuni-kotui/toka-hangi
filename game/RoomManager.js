'use strict';

const { generateRoomCode } = require('./utils');

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketToRoom = new Map();
  }

  createRoom(facilitatorSocketId, password) {
    let code;
    do { code = generateRoomCode(); } while (this.rooms.has(code));

    const room = {
      code,
      facilitatorId: facilitatorSocketId,
      password,
      players: new Map(),
      status: 'lobby',
      gameState: null,
    };

    this.rooms.set(code, room);
    this.socketToRoom.set(facilitatorSocketId, code);
    return room;
  }

  joinRoom(socketId, { code, name, password }) {
    const room = this.rooms.get(code?.toUpperCase());
    if (!room)                         return { ok: false, reason: 'Room not found.' };
    if (room.password !== password)    return { ok: false, reason: 'Wrong password.' };
    if (room.status !== 'lobby')       return { ok: false, reason: 'Game already in progress.' };
    if ([...room.players.values()].some(p => p.name === name))
                                       return { ok: false, reason: 'Name already taken.' };

    room.players.set(socketId, {
      name, score: 0, questionsHeld: 0, connected: true,
    });
    this.socketToRoom.set(socketId, code.toUpperCase());
    return { ok: true, room };
  }

  getRoomBySocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : null;
  }

  getRoomByCode(code) {
    return this.rooms.get(code?.toUpperCase()) ?? null;
  }

  getPlayerList(room) {
    return [...room.players.entries()].map(([id, p]) => ({
      id, name: p.name, score: p.score, questionsHeld: p.questionsHeld, connected: p.connected,
    }));
  }

  markDisconnected(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    const player = room.players.get(socketId);
    if (player) player.connected = false;
    return room;
  }

  deleteRoom(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const id of room.players.keys()) this.socketToRoom.delete(id);
    this.socketToRoom.delete(room.facilitatorId);
    this.rooms.delete(code);
  }
}

module.exports = RoomManager;
