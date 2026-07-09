// Punchline — a Quiplash-style writing game.
//
// One prompt per round: everyone writes a funny answer, the answers are shown
// ANONYMOUSLY (authorship lives in room.private), everyone votes for their
// favorite (the server rejects self-votes), and votes become points.
//
// PROMPTS are the AI-generation seam: ./prompts.json is a plain array of
// strings — future AI generation just appends more.
const PROMPTS = require("./prompts.json");

function nameKey(name) {
  return String(name || "").trim().toLowerCase();
}

function keyOf(room, socketId) {
  const m = room.members.get(socketId);
  return m ? nameKey(m.name) : null;
}

function presentKeys(room) {
  return new Set([...room.members.values()].map((m) => nameKey(m.name)));
}

function ensurePlayer(room, name) {
  const key = nameKey(name);
  if (!key) return null;
  if (!room.game.players[key]) room.game.players[key] = { name: String(name).trim(), score: 0 };
  return key;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function init(room) {
  const g = room.game;
  if (!g.phase) g.phase = "lobby";
  if (!g.players) g.players = {};
  if (typeof g.round !== "number") g.round = 0;
  if (!room.private.usedPrompts) room.private.usedPrompts = [];
}

function startRound(room) {
  const g = room.game;
  let available = PROMPTS.map((_, i) => i).filter(
    (i) => !room.private.usedPrompts.includes(i),
  );
  if (!available.length) {
    room.private.usedPrompts = [];
    available = PROMPTS.map((_, i) => i);
  }
  const pick = available[Math.floor(Math.random() * available.length)];
  room.private.usedPrompts.push(pick);
  g.round += 1;
  g.prompt = PROMPTS[pick];
  g.answered = [];
  g.skipped = [];
  g.voted = [];
  g.gallery = null;
  g.reveals = null;
  room.private.answers = {};
  room.private.authors = {};
  room.private.votes = {};
  g.phase = "write";
}

function buildVote(room) {
  const g = room.game;
  const entries = shuffle(Object.entries(room.private.answers));
  g.gallery = entries.map(([key, text], i) => {
    const aid = `a${i}`;
    room.private.authors[aid] = key;
    return { aid, text };
  });
  g.voted = [];
  room.private.votes = {};
  g.phase = "vote";
}

function buildResults(room) {
  const g = room.game;
  const counts = {};
  for (const aid of Object.values(room.private.votes)) {
    counts[aid] = (counts[aid] || 0) + 1;
  }
  g.reveals = g.gallery.map(({ aid, text }) => {
    const authorKey = room.private.authors[aid];
    const votes = counts[aid] || 0;
    const p = g.players[authorKey];
    if (p) p.score += 100 * votes;
    return { aid, text, name: p ? p.name : authorKey, votes };
  });
  g.phase = "results";
}

function maybeAdvanceWrite(room) {
  const g = room.game;
  if (g.phase !== "write") return;
  const present = [...presentKeys(room)];
  const answers = Object.keys(room.private.answers);
  if (answers.length >= 2 && present.every((k) => k in room.private.answers || (g.skipped ?? []).includes(k))) {
    buildVote(room);
  }
}

function maybeAdvanceVote(room) {
  const g = room.game;
  if (g.phase !== "vote") return;
  const present = [...presentKeys(room)];
  if (present.length > 0 && present.every((k) => g.voted.includes(k))) {
    buildResults(room);
  }
}

function register(io, socket, { room, broadcastState }) {
  const g = room.game;

  if (!g.hostId || !room.members.has(g.hostId)) g.hostId = socket.id;
  const myName = room.members.get(socket.id)?.name;
  if (myName) ensurePlayer(room, myName);

  const myKey = () => keyOf(room, socket.id);
  const isHost = () => socket.id === g.hostId;

  socket.on("pl:start", () => {
    if (!isHost()) return;
    if (g.phase !== "lobby" && g.phase !== "results") return;
    startRound(room);
    broadcastState();
  });

  socket.on("pl:answer", ({ text } = {}) => {
    if (g.phase !== "write") return;
    const key = myKey();
    if (!key || key in room.private.answers) return;
    const clean = String(text || "").trim().slice(0, 140);
    if (!clean) return;
    ensurePlayer(room, myName);
    room.private.answers[key] = clean;
    g.answered.push(key);
    maybeAdvanceWrite(room);
    broadcastState();
  });

  socket.on("pl:skip", () => {
    if (g.phase !== "write") return;
    const key = myKey();
    if (!key || key in room.private.answers || (g.skipped ?? []).includes(key)) return;
    if (!g.skipped) g.skipped = [];
    g.skipped.push(key);
    g.answered.push(key); // marks them as done in the "waiting on" list
    maybeAdvanceWrite(room);
    broadcastState();
  });

  socket.on("pl:vote", ({ aid } = {}) => {
    if (g.phase !== "vote") return;
    const key = myKey();
    if (!key || g.voted.includes(key)) return;
    if (!room.private.authors[aid]) return;
    if (room.private.authors[aid] === key) return; // no self-votes
    room.private.votes[key] = aid;
    g.voted.push(key);
    maybeAdvanceVote(room);
    broadcastState();
  });

  socket.on("pl:force", () => {
    if (!isHost()) return;
    if (g.phase === "write" && Object.keys(room.private.answers).length >= 2) {
      buildVote(room);
    } else if (g.phase === "vote") {
      buildResults(room);
    } else {
      return;
    }
    broadcastState();
  });

  socket.on("pl:end", () => {
    if (!isHost() || g.phase !== "results") return;
    g.phase = "gameover";
    broadcastState();
  });

  socket.on("pl:newGame", () => {
    if (!isHost()) return;
    g.phase = "lobby";
    g.players = {};
    g.round = 0;
    g.prompt = null;
    g.answered = [];
    g.skipped = [];
    g.voted = [];
    g.gallery = null;
    g.reveals = null;
    room.private.usedPrompts = [];
    room.private.answers = {};
    room.private.authors = {};
    room.private.votes = {};
    for (const m of room.members.values()) ensurePlayer(room, m.name);
    broadcastState();
  });
}

function onLeave(room, socketId) {
  const g = room.game;
  if (g.hostId === socketId) {
    const next = room.members.keys().next();
    g.hostId = next.done ? null : next.value;
  }
  // A leaver may have been the last holdout in either waiting phase.
  maybeAdvanceWrite(room);
  maybeAdvanceVote(room);
}

module.exports = { id: "punchline", init, register, onLeave };
