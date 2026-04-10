'use strict';

const { getRockCount } = require('./utils');
const questions = require('../questions.json');

const ROUND_DURATION = 8000; // 8 seconds
const QUESTIONS_PER_PLAYER = 4;

class GameEngine {
  constructor(room, io) {
    this.room = room;
    this.io = io;
    this.timer = null;
    this.roundStartTime = null;

    // Build ordered player array (snapshot at game start)
    this.playerOrder = [...room.players.keys()];

    // Rock rotation state
    this.rockCount = getRockCount(this.playerOrder.length);
    this.currentRockIndex = 0; // index into playerOrder for "lead" rock holder
    this.roundNumber = 0;

    // Shuffle and deduplicate questions
    this.questionPool = [...questions].sort(() => Math.random() - 0.5);
    this.questionIndex = 0;

    // Track who has answered this round (prevent double submit)
    this.answeredThisRound = new Set();
    this.currentQuestion = null;
  }

  // ─── Rock holders ──────────────────────────────────────────────────────────

  /**
   * Returns array of socketIds currently holding the rock.
   * Wraps around the player list.
   */
  getRockHolders() {
    const holders = [];
    for (let i = 0; i < this.rockCount; i++) {
      const idx = (this.currentRockIndex + i) % this.playerOrder.length;
      holders.push(this.playerOrder[idx]);
    }
    return holders;
  }

  // ─── Round lifecycle ───────────────────────────────────────────────────────

  startRound() {
    if (this.questionIndex >= this.questionPool.length) {
      this.questionPool = [...questions].sort(() => Math.random() - 0.5);
      this.questionIndex = 0;
    }

    this.currentQuestion = this.questionPool[this.questionIndex++];
    this.answeredThisRound = new Set();
    this.roundNumber++;
    this.roundStartTime = Date.now();

    const holders = this.getRockHolders();
    const playerList = this.getPlayerList();

    this.io.to(this.room.code).emit('round_start', {
      question: this.currentQuestion.question,
      questionId: this.currentQuestion.id,
      rockHolders: holders,
      players: playerList,
      round: this.roundNumber,
      duration: ROUND_DURATION,
    });

    // Server-side countdown — emit tick every second
    let secondsLeft = ROUND_DURATION / 1000;
    this.timer = setInterval(() => {
      secondsLeft--;
      this.io.to(this.room.code).emit('timer_tick', { secondsLeft });

      if (secondsLeft <= 0) {
        clearInterval(this.timer);
        this.handleTimeout();
      }
    }, 1000);
  }

  handleTimeout() {
    const holders = this.getRockHolders();

    // Penalise holders who didn't answer
    const results = [];
    for (const holderId of holders) {
      if (!this.answeredThisRound.has(holderId)) {
        const player = this.room.players.get(holderId);
        if (player) {
          player.score -= 1;
          results.push({ socketId: holderId, name: player.name, result: 'timeout', scoreDelta: -1, score: player.score });
        }
      }
    }

    this.io.to(this.room.code).emit('round_result', {
      correct: this.currentQuestion.correct,
      question: this.currentQuestion.question,
      results,
      players: this.getPlayerList(),
    });

    this.advanceRock();
  }

  handleAnswer(socketId, answer) {
    if (this.answeredThisRound.has(socketId)) return;

    const holders = this.getRockHolders();
    if (!holders.includes(socketId)) return; // not a holder, ignore

    this.answeredThisRound.add(socketId);

    const player = this.room.players.get(socketId);
    if (!player) return;

    const isCorrect = answer === this.currentQuestion.correct;
    const scoreDelta = isCorrect ? 1 : -1;
    player.score += scoreDelta;

    const result = {
      socketId,
      name: player.name,
      result: isCorrect ? 'correct' : 'incorrect',
      scoreDelta,
      score: player.score,
    };

    this.io.to(this.room.code).emit('answer_received', result);

    // If all holders have answered, end round early
    const allAnswered = holders.every(id => this.answeredThisRound.has(id));
    if (allAnswered) {
      clearInterval(this.timer);
      setTimeout(() => {
        this.io.to(this.room.code).emit('round_result', {
          correct: this.currentQuestion.correct,
          question: this.currentQuestion.question,
          results: [result],
          players: this.getPlayerList(),
        });
        this.advanceRock();
      }, 800);
    }
  }

  advanceRock() {
    // Increment questionsHeld for current holders
    const holders = this.getRockHolders();
    for (const holderId of holders) {
      const p = this.room.players.get(holderId);
      if (p) p.questionsHeld++;
    }

    // Check end condition: every player has held for QUESTIONS_PER_PLAYER rounds
    const allDone = [...this.room.players.values()].every(
      p => p.questionsHeld >= QUESTIONS_PER_PLAYER
    );

    if (allDone) {
      return this.endGame();
    }

    // Move rock forward by 1
    this.currentRockIndex = (this.currentRockIndex + 1) % this.playerOrder.length;

    // Short pause before next round
    setTimeout(() => this.startRound(), 1500);
  }

  endGame() {
    this.room.status = 'finished';

    const finalScores = this.getPlayerList().sort((a, b) => b.score - a.score);

    // Build debrief: all questions used with correct answers
    const debrief = questions.map(q => ({
      question: q.question,
      correct: q.correct,
    }));

    this.io.to(this.room.code).emit('game_over', {
      players: finalScores,
      debrief,
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getPlayerList() {
    return [...this.room.players.entries()].map(([id, p]) => ({
      id,
      name: p.name,
      score: p.score,
      questionsHeld: p.questionsHeld,
      connected: p.connected,
    }));
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
  }
}

module.exports = GameEngine;
