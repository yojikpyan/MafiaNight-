
const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const {
  createPlayers,
  resolveNight,
  resolveVoting,
  checkWinner
} = require("./game/engine");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();
const timers = new Map();

app.use(express.static("public"));

app.get("/health", (req, res) => {
  res.json({ status: "ok", game: "Mafia Night" });
});

function makeCode() {
  let code;
  do {
    code = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(code));
  return code;
}

function getRoom(socket) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.id === socket.id)) return room;
  }
  return null;
}

function clearTimer(room) {
  if (timers.has(room.code)) {
    clearInterval(timers.get(room.code));
    clearTimeout(timers.get(room.code));
    timers.delete(room.code);
  }
}

function publicState(room) {
  return {
    code: room.code,
    phase: room.phase,
    host: room.host,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: p.alive ? null : p.role
    })),
    message: room.message,
    winner: room.winner,
    timeLeft: room.timeLeft
  };
}

function updateRoom(room) {
  io.to(room.code).emit("roomUpdate", publicState(room));
}

function finishGame(room, winner) {
  clearTimer(room);
  room.phase = "finished";
  room.winner = winner;
  room.message = winner === "mafia"
    ? "Мафія перемогла!"
    : "Мирні жителі перемогли!";

  room.players.forEach(p => {
    io.to(p.id).emit("gameResult", {
      winner,
      players: room.players.map(x => ({
        name: x.name,
        role: x.role,
        alive: x.alive
      }))
    });
  });

  updateRoom(room);
}

function startTimer(room, seconds, callback) {
  clearTimer(room);

  room.timeLeft = seconds;
  let remaining = seconds;

  const timer = setInterval(() => {
    if (room.phase === "finished") {
      clearTimer(room);
      return;
    }

    remaining--;
    room.timeLeft = remaining;

    io.to(room.code).emit("timer", remaining);

    if (remaining <= 0) {
      clearTimer(room);
      callback();
    }
  }, 1000);

  timers.set(room.code, timer);
}

function startDay(room) {
  if (room.phase === "finished") return;

  room.phase = "day";
  room.actions = {};
  room.votes = {};
  room.message = "Настав день! Обговоріть підозри та голосуйте.";

  updateRoom(room);
  startTimer(room, 90, () => endDay(room));
}

function endDay(room) {
  if (room.phase !== "day") return;

  clearTimer(room);

  const result = resolveVoting(room);

  if (result.eliminated) {
    const player = room.players.find(p => p.id === result.eliminated);
    room.message = player
      ? `${player.name} вибув із гри. Його роль: ${player.role}.`
      : "Голосування завершено.";
  } else {
    room.message = "Нічия! Ніхто не вибув.";
  }

  if (result.winner) return finishGame(room, result.winner);

  updateRoom(room);

  setTimeout(() => {
    if (room.phase === "day") startNight(room);
  }, 3000);
}

function startNight(room) {
  if (room.phase === "finished") return;

  clearTimer(room);

  room.phase = "night";
  room.actions = {};
  room.votes = {};
  room.message = "Настала ніч. Місто засинає...";

  room.players.filter(p => p.alive).forEach(p => {
    io.to(p.id).emit("privateRole", {
      role: p.role,
      mafia: room.players
        .filter(x => x.role === "mafia")
        .map(x => ({ id: x.id, name: x.name }))
    });
  });

  updateRoom(room);
  startTimer(room, 45, () => endNight(room));
}

function endNight(room) {
  if (room.phase !== "night") return;

  clearTimer(room);

  const result = resolveNight(room);

  room.message = result.victim
    ? "Вранці місто знайшло загиблого..."
    : "Цієї ночі ніхто не загинув.";

  if (result.investigation) {
    io.to(result.investigation.playerId).emit(
      "investigationResult",
      {
        targetId: result.investigation.targetId,
        isMafia: result.investigation.isMafia
      }
    );
  }

  if (result.winner) return finishGame(room, result.winner);

  updateRoom(room);

  setTimeout(() => {
    if (room.phase === "night") startDay(room);
  }, 3000);
}

io.on("connection", socket => {
  socket.on("createRoom", ({ name } = {}) => {
    name = String(name || "").trim().slice(0, 20);

    if (!name) return socket.emit("errorMessage", "Введіть ім'я.");

    const code = makeCode();

    const room = {
      code,
      host: socket.id,
      phase: "lobby",
      players: [{
        id: socket.id,
        name,
        alive: true,
        role: null
      }],
      actions: {},
      votes: {},
      message: "Очікуємо на друзів...",
      winner: null,
      timeLeft: 0
    };

    rooms.set(code, room);
    socket.join(code);
    socket.emit("roomCreated", { code });
    updateRoom(room);
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    code = String(code || "").trim();
    name = String(name || "").trim().slice(0, 20);

    const room = rooms.get(code);

    if (!room) return socket.emit("errorMessage", "Кімнату не знайдено.");
    if (room.phase !== "lobby") return socket.emit("errorMessage", "Гра вже почалася.");
    if (room.players.length >= 10) return socket.emit("errorMessage", "Кімната заповнена.");
    if (!name) return socket.emit("errorMessage", "Введіть ім'я.");

    room.players.push({
      id: socket.id,
      name,
      alive: true,
      role: null
    });

    socket.join(code);
    socket.emit("joinedRoom", { code });
    updateRoom(room);
  });

  socket.on("startGame", () => {
    const room = getRoom(socket);

    if (!room || room.host !== socket.id) return;
    if (room.phase !== "lobby") return;

    if (room.players.length < 5) {
      return socket.emit("errorMessage", "Потрібно мінімум 5 гравців.");
    }

    room.players = createPlayers(room.players);
    startNight(room);
  });

  socket.on("nightAction", ({ targetId } = {}) => {
    const room = getRoom(socket);
    if (!room || room.phase !== "night") return;

    const player = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId && p.alive);

    if (!player || !player.alive || !target || target.id === player.id) return;

    if (!["mafia", "doctor", "detective"].includes(player.role)) return;

    room.actions[player.id] = target.id;
    socket.emit("actionConfirmed", "Дію прийнято.");

    const required = room.players.filter(p =>
      p.alive && ["mafia", "doctor", "detective"].includes(p.role)
    );

    if (required.every(p => room.actions[p.id])) endNight(room);
  });

  socket.on("vote", ({ targetId } = {}) => {
    const room = getRoom(socket);
    if (!room || room.phase !== "day") return;

    const player = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === targetId && p.alive);

    if (!player || !player.alive || !target || target.id === player.id) return;

    room.votes[player.id] = target.id;
    socket.emit("voteConfirmed", "Ваш голос зараховано.");

    const alive = room.players.filter(p => p.alive);
    if (alive.every(p => room.votes[p.id])) endDay(room);
  });

  socket.on("chatMessage", ({ message } = {}) => {
    const room = getRoom(socket);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);

    if (!player || !player.alive) return;
    if (!["day", "lobby"].includes(room.phase)) return;

    message = String(message || "").trim().slice(0, 300);
    if (!message) return;

    io.to(room.code).emit("chatMessage", {
      name: player.name,
      message,
      time: new Date().toISOString()
    });
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);

    if (room.phase === "lobby") {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (!room.players.length) {
        clearTimer(room);
        rooms.delete(room.code);
        return;
      }

      if (room.host === socket.id) {
        room.host = room.players[0].id;
      }
    } else if (player && player.alive) {
      player.alive = false;

      const winner = checkWinner(room.players);
      if (winner) return finishGame(room, winner);
    }

    updateRoom(room);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🎭 Mafia Night running on port ${PORT}`);
});

