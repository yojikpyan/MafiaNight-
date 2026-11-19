
const crypto = require("crypto");

const ROLES = {
  MAFIA: "mafia",
  DETECTIVE: "detective",
  DOCTOR: "doctor",
  CITIZEN: "citizen"
};

function shuffle(array) {
  const result = [...array];

  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }

  return result;
}

function createPlayers(players) {
  const count = players.length;

  if (count < 5 || count > 10) {
    throw new Error("Потрібно від 5 до 10 гравців");
  }

  const roles = [];

  const mafiaCount = Math.max(1, Math.floor(count / 3));

  for (let i = 0; i < mafiaCount; i++) {
    roles.push(ROLES.MAFIA);
  }

  roles.push(ROLES.DETECTIVE);

  if (count >= 6) {
    roles.push(ROLES.DOCTOR);
  }

  while (roles.length < count) {
    roles.push(ROLES.CITIZEN);
  }

  const shuffledRoles = shuffle(roles);

  return players.map((player, index) => ({
    ...player,
    role: shuffledRoles[index],
    alive: true,
    votes: null
  }));
}

function checkWinner(players) {
  const alive = players.filter(p => p.alive);

  const mafia = alive.filter(p => p.role === ROLES.MAFIA);
  const citizens = alive.filter(p => p.role !== ROLES.MAFIA);

  if (mafia.length === 0) return "citizens";
  if (mafia.length >= citizens.length) return "mafia";

  return null;
}

function resolveNight(room) {
  const alive = room.players.filter(p => p.alive);

  const mafia = alive.filter(p => p.role === ROLES.MAFIA);

  const targets = mafia
    .map(p => room.actions[p.id])
    .filter(Boolean);

  let victim = null;

  if (targets.length) {
    const counts = {};

    targets.forEach(id => {
      counts[id] = (counts[id] || 0) + 1;
    });

    const highest = Math.max(...Object.values(counts));
    const winners = Object.keys(counts).filter(
      id => counts[id] === highest
    );

    if (winners.length === 1) {
      victim = winners[0];
    }
  }

  const doctor = alive.find(p => p.role === ROLES.DOCTOR);
  const saved = doctor ? room.actions[doctor.id] : null;

  if (victim && victim !== saved) {
    const player = room.players.find(p => p.id === victim);
    if (player) player.alive = false;
  }

  const detective = alive.find(p => p.role === ROLES.DETECTIVE);
  let investigation = null;

  if (detective && room.actions[detective.id]) {
    const target = room.players.find(
      p => p.id === room.actions[detective.id]
    );

    if (target) {
      investigation = {
        playerId: detective.id,
        targetId: target.id,
        isMafia: target.role === ROLES.MAFIA
      };
    }
  }

  return {
    victim: victim && victim !== saved ? victim : null,
    saved: victim && victim === saved,
    investigation,
    winner: checkWinner(room.players)
  };
}

function resolveVoting(room) {
  const alive = room.players.filter(p => p.alive);
  const counts = {};

  alive.forEach(player => {
    const target = room.votes[player.id];

    if (target && alive.some(p => p.id === target)) {
      counts[target] = (counts[target] || 0) + 1;
    }
  });

  const max = Math.max(0, ...Object.values(counts));

  const leaders = Object.keys(counts).filter(
    id => counts[id] === max && max > 0
  );

  let eliminated = null;

  if (leaders.length === 1) {
    eliminated = leaders[0];

    const player = room.players.find(p => p.id === eliminated);
    if (player) player.alive = false;
  }

  return {
    eliminated,
    winner: checkWinner(room.players)
  };
}

module.exports = {
  ROLES,
  shuffle,
  createPlayers,
  checkWinner,
  resolveNight,
  resolveVoting
};

