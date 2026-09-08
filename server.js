// Custom server: runs Next.js and attaches a Socket.IO real-time layer.
// Game-specific socket handlers live in ./server/games and are wired in per room.
//hello world.
const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");

const { getOrCreateRoom, getRoom, removeRoom, publicState } = require("./server/rooms");
const { getGame } = require("./server/games");

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => handle(req, res));
  const io = new Server(server, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    let joinedCode = null;

    socket.on("room:join", ({ code, name, gameId }) => {
      if (!code) return;
      code = String(code).toUpperCase();

      let room = getRoom(code);
      if (!room) {
        // A room can only be created by someone who picked a game.
        if (!gameId) {
          socket.emit("room:error", { message: "That room doesn't exist." });
          return;
        }
        room = getOrCreateRoom(code, gameId);
      }

      const game = getGame(room.gameId);
      if (game && game.init) game.init(room);

      room.members.set(socket.id, {
        id: socket.id,
        name: String(name || "Guest").slice(0, 24) || "Guest",
      });
      socket.join(code);
      joinedCode = code;

      const broadcastState = () => io.to(code).emit("room:state", publicState(room));
      if (game && game.register) game.register(io, socket, { room, broadcastState });

      broadcastState();
    });

    socket.on("room:rename", ({ name }) => {
      if (!joinedCode) return;
      const room = getRoom(joinedCode);
      if (!room) return;
      const member = room.members.get(socket.id);
      if (member) member.name = String(name || "Guest").slice(0, 24) || "Guest";
      io.to(joinedCode).emit("room:state", publicState(room));
    });

    socket.on("disconnect", () => {
      if (!joinedCode) return;
      const room = getRoom(joinedCode);
      if (!room) return;
      room.members.delete(socket.id);
      if (room.members.size === 0) {
        removeRoom(joinedCode);
        return;
      }
      const game = getGame(room.gameId);
      if (game && game.onLeave) game.onLeave(room, socket.id, io);
      io.to(joinedCode).emit("room:state", publicState(room));
    });
  });

  server.listen(port, hostname, () => {
    console.log(`> Party Games ready on http://${hostname}:${port}`);
  });
});
