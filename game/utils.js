'use strict';

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function getRockCount(playerCount) {
  if (playerCount <= 3) return 1;
  if (playerCount <= 6) return 2;
  return 3;
}

module.exports = { generateRoomCode, getRockCount };
