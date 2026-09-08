// Random Picker / Wheel.
// Every participant is a wheel segment. A spin is decided on the server so all
// clients animate to the exact same final rotation and see the same winner.
const SPIN_DURATION_MS = 4500;
const BASE_SPINS = 5;

function init(room) {
  if (typeof room.game.rotation !== "number") room.game.rotation = 0;
  if (typeof room.game.spinning !== "boolean") room.game.spinning = false;
  if (!("winner" in room.game)) room.game.winner = null;
  if (!Array.isArray(room.game.customEntries)) room.game.customEntries = [];
  if (!Array.isArray(room.game.selectionHistory)) room.game.selectionHistory = [];
}

function register(io, socket, { room, broadcastState }) {
  socket.on("wheel:spin", () => {
    const members = [
      ...[...room.members.values()],
      ...room.game.customEntries,
    ];
    if (members.length < 2 || room.game.spinning) return;

    const n = members.length;
    const seg = 360 / n;
    const winnerIndex = Math.floor(Math.random() * n);
    const center = winnerIndex * seg + seg / 2;

    // Land the winning segment's center under the pointer at the top (0deg),
    // adding whole extra turns so the motion always spins forward.
    const prev = room.game.rotation;
    const delta = ((360 - (((center + prev) % 360) + 360) % 360) % 360);
    const rotation = prev + 360 * BASE_SPINS + delta;

    const winner = members[winnerIndex];
    room.game.rotation = rotation;
    room.game.spinning = true;
    room.game.winner = null;

    io.to(room.code).emit("wheel:spin", {
      rotation,
      winnerIndex,
      winner,
      duration: SPIN_DURATION_MS,
    });

    setTimeout(() => {
      // Guard: the room may have been torn down mid-spin.
      if (!room.members) return;
      room.game.spinning = false;
      room.game.winner = winner;
      room.game.selectionHistory.unshift({ id: winner.id, name: winner.name });
      io.to(room.code).emit("wheel:result", { winner });
      io.to(room.code).emit("room:state", {
        code: room.code,
        gameId: room.gameId,
        members: [...room.members.values()].map((m) => ({ id: m.id, name: m.name })),
        game: room.game,
      });
    }, SPIN_DURATION_MS + 150);
  });

  socket.on("wheel:add-entry", ({ name } = {}) => {
    const trimmed = String(name || "").trim().slice(0, 40);
    if (!trimmed) return;
    const already = room.game.customEntries.some(
      (e) => e.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (already) return;
    room.game.customEntries.push({ id: `custom-${Date.now()}-${Math.random()}`, name: trimmed });
    broadcastState();
  });

  socket.on("wheel:remove-entry", ({ id } = {}) => {
    room.game.customEntries = room.game.customEntries.filter((e) => e.id !== id);
    broadcastState();
  });
}

module.exports = { id: "wheel", init, register };
