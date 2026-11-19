
const socket = io();

let currentRoom = null;
let myRole = null;
let currentPhase = "lobby";
let players = [];
let myId = null;
let roleVisible = true;

const $ = id => document.getElementById(id);

const roleInfo = {
  mafia: {
    name: "МАФІЯ",
    icon: "♠",
    description: "Ти член мафії. Вночі обирай жертву разом з іншими мафіозі."
  },
  detective: {
    name: "КОМІСАР",
    icon: "🔍",
    description: "Ти можеш перевірити одного гравця за ніч та дізнатися, чи він мафія."
  },
  doctor: {
    name: "ЛІКАР",
    icon: "✚",
    description: "Вночі обери гравця, якого хочеш урятувати."
  },
  citizen: {
    name: "МИРНИЙ ЖИТЕЛЬ",
    icon: "♟",
    description: "Знайди мафію вдень і допоможи місту перемогти."
  }
};

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");

  setTimeout(() => {
    $("toast").classList.remove("show");
  }, 2800);
}

function playSound(frequency = 440) {
  try {
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.connect(gain);
    gain.connect(audio.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = "sine";

    gain.gain.setValueAtTime(0.08, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + 0.35
    );

    oscillator.start();
    oscillator.stop(audio.currentTime + 0.35);

    oscillator.onended = () => audio.close();
  } catch (e) {}
}

function showRoom() {
  $("homeScreen").classList.add("hidden");
  $("roomScreen").classList.remove("hidden");
}

function addChat(name, message, time = "") {
  const container = $("chatMessages");
  const item = document.createElement("div");

  item.className = "chat-message";

  const author = document.createElement("strong");
  author.textContent = name;

  const content = document.createElement("div");
  content.textContent = message;

  const timestamp = document.createElement("small");
  timestamp.textContent = time
    ? new Date(time).toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit"
      })
    : new Date().toLocaleTimeString("uk-UA", {
        hour: "2-digit",
        minute: "2-digit"
      });

  item.append(author, content, timestamp);
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

function renderPlayers() {
  $("playerCount").textContent = `${players.length}/10`;

  const list = $("playersList");
  list.replaceChildren();

  players.forEach(player => {
    const card = document.createElement("div");
    card.className = "player-card";

    if (!player.alive) card.classList.add("dead");

    const avatar = document.createElement("div");
    avatar.className = "player-avatar";
    avatar.textContent = "♟";

    const info = document.createElement("div");

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent =
      player.name + (player.id === myId ? " (Ти)" : "");

    const status = document.createElement("div");
    status.className = "player-status";
    status.textContent = player.alive
      ? "● У грі"
      : "✕ Вибув";

    info.append(name, status);
    card.append(avatar, info);
    list.appendChild(card);
  });
}

function renderPhase() {
  const phases = {
    lobby: ["♟", "Очікування гравців"],
    night: ["🌙", "Ніч у місті"],
    day: ["☀️", "День у місті"],
    finished: ["🏆", "Гру завершено"]
  };

  const data = phases[currentPhase] || phases.lobby;

  $("phaseIcon").textContent = data[0];
  $("phaseTitle").textContent = data[1];

  if (currentPhase === "lobby") {
    $("phaseMessage").textContent = "Очікуємо на друзів...";
  }

  $("startBtn").classList.toggle(
    "hidden",
    !(currentPhase === "lobby" &&
      players.some(p => p.id === myId && currentRoom.host === myId))
  );

  $("gameActions").classList.add("hidden");
}

function showRole(role) {
  myRole = role;

  const data = roleInfo[role];
  if (!data) return;

  $("roleCard").classList.remove("hidden");
  $("roleIcon").textContent = data.icon;
  $("roleName").textContent = data.name;
  $("roleDescription").textContent = data.description;

  roleVisible = true;
  $("hideRoleBtn").textContent = "Сховати роль";

  playSound(600);
}

function renderActions() {
  const area = $("gameActions");
  const list = $("actionPlayers");

  area.classList.remove("hidden");
  list.replaceChildren();

  const isNight = currentPhase === "night";
  const isDay = currentPhase === "day";

  if (!isNight && !isDay) {
    area.classList.add("hidden");
    return;
  }

  if (isNight && !["mafia", "doctor", "detective"].includes(myRole)) {
    area.classList.add("hidden");
    return;
  }

  $("actionTitle").textContent = isNight
    ? "Нічна дія"
    : "Денне голосування";

  $("actionDescription").textContent = isNight
    ? "Обери гравця для своєї таємної дії."
    : "Хто, на твою думку, є мафією?";

  players.filter(p => p.alive && p.id !== myId).forEach(player => {
    const button = document.createElement("button");

    button.className = "action-player";
    button.textContent = "♟ " + player.name;

    button.addEventListener("click", () => {
      if (isNight) {
        socket.emit("nightAction", {
          targetId: player.id
        });
      } else {
        socket.emit("vote", {
          targetId: player.id
        });
      }
    });

    list.appendChild(button);
  });
}

function updateRoom(state) {
  currentRoom = state;
  currentPhase = state.phase;
  players = state.players;

  $("roomCodeText").textContent = state.code;
  $("phaseMessage").textContent = state.message;

  renderPlayers();
  renderPhase();

  if (currentPhase === "day" || currentPhase === "night") {
    renderActions();
  }

  if (currentPhase === "finished") {
    $("gameActions").classList.add("hidden");
  }

  if (state.timeLeft !== undefined) {
    updateTimer(state.timeLeft);
  }
}

function updateTimer(seconds) {
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;

  $("timer").textContent =
    `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

$("createBtn").addEventListener("click", () => {
  const name = $("playerName").value.trim();

  if (!name) return toast("Введи своє ім'я.");

  myId = socket.id;
  socket.emit("createRoom", { name });
});

$("joinBtn").addEventListener("click", () => {
  const name = $("playerName").value.trim();
  const code = $("roomCode").value.trim();

  if (!name) return toast("Введи своє ім'я.");
  if (!/^\d{6}$/.test(code)) return toast("Код має містити 6 цифр.");

  myId = socket.id;
  socket.emit("joinRoom", { code, name });
});

$("startBtn").addEventListener("click", () => {
  socket.emit("startGame");
});

$("copyCodeBtn").addEventListener("click", async () => {
  if (!currentRoom) return;

  try {
    await navigator.clipboard.writeText(currentRoom.code);
    toast("Код кімнати скопійовано!");
  } catch (e) {
    toast("Код кімнати: " + currentRoom.code);
  }
});

$("hideRoleBtn").addEventListener("click", () => {
  roleVisible = !roleVisible;

  if (roleVisible) {
    $("roleName").textContent = roleInfo[myRole].name;
    $("roleDescription").textContent = roleInfo[myRole].description;
    $("roleIcon").textContent = roleInfo[myRole].icon;
    $("hideRoleBtn").textContent = "Сховати роль";
  } else {
    $("roleName").textContent = "РОЛЬ ПРИХОВАНА";
    $("roleDescription").textContent = "Не показуй свою роль іншим.";
    $("roleIcon").textContent = "🔒";
    $("hideRoleBtn").textContent = "Показати роль";
  }
});

$("chatForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("chatInput");
  const message = input.value.trim();

  if (!message) return;

  socket.emit("chatMessage", { message });
  input.value = "";
});

$("leaveBtn").addEventListener("click", () => {
  location.reload();
});

socket.on("roomCreated", ({ code }) => {
  toast("Кімнату створено!");
  showRoom();
  $("roomCodeText").textContent = code;
  playSound(500);
});

socket.on("joinedRoom", ({ code }) => {
  toast("Ти приєднався до кімнати!");
  showRoom();
  $("roomCodeText").textContent = code;
  playSound(500);
});

socket.on("roomUpdate", state => {
  updateRoom(state);
});

socket.on("privateRole", data => {
  showRole(data.role);

  if (data.role === "mafia" && data.mafia) {
    const names = data.mafia.map(p => p.name).join(", ");
    toast("Твоя команда: " + names);
  }
});

socket.on("timer", seconds => {
  updateTimer(seconds);
});

socket.on("actionConfirmed", message => {
  toast(message);
});

socket.on("voteConfirmed", message => {
  toast(message);
});

socket.on("investigationResult", result => {
  const target = players.find(p => p.id === result.targetId);

  toast(
    (target ? target.name : "Гравець") +
    (result.isMafia ? " — МАФІЯ!" : " — не мафія.")
  );

  playSound(result.isMafia ? 300 : 550);
});

socket.on("chatMessage", data => {
  addChat(data.name, data.message, data.time);
});

socket.on("gameResult", result => {
  $("resultBox").classList.remove("hidden");

  const title = result.winner === "mafia"
    ? "♠ ПЕРЕМОГА МАФІЇ"
    : "✦ ПЕРЕМОГА МИРНИХ";

  $("resultBox").replaceChildren();

  const heading = document.createElement("h2");
  heading.textContent = title;
  $("resultBox").appendChild(heading);

  result.players.forEach(player => {
    const line = document.createElement("div");
    line.textContent =
      `${player.name} — ${roleInfo[player.role]?.name || player.role}`;
    $("resultBox").appendChild(line);
  });

  $("phaseMessage").textContent = "Дякуємо за гру!";
  $("gameActions").classList.add("hidden");

  playSound(700);
});

socket.on("errorMessage", message => {
  toast(message);
});


