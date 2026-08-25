const { createServer } = require("http");
const { Server } = require("socket.io");
const { io: ioc } = require("socket.io-client");
const { getOrCreateRoom, getRoom, removeRoom, publicState } = require("../server/rooms");
const { getGame } = require("../server/games");

function createTestServer() {
  const httpServer = createServer();
  const io = new Server(httpServer, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    let joinedCode = null;

    socket.on("room:join", ({ code, name, gameId }) => {
      if (!code) return;
      code = String(code).toUpperCase();

      let room = getRoom(code);
      if (!room) {
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

  return { httpServer, io };
}

function connectClient(port) {
  return ioc(`http://localhost:${port}`, { forceNew: true });
}

function waitFor(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function listen(httpServer) {
  return new Promise((resolve) => httpServer.listen(0, () => resolve(httpServer.address().port)));
}

let httpServer;
let io;
let port;
const clients = [];

beforeEach(async () => {
  ({ httpServer, io } = createTestServer());
  port = await listen(httpServer);
});

afterEach(async () => {
  for (const c of clients.splice(0)) {
    c.disconnect();
  }
  await new Promise((resolve) => io.close(resolve));
  await new Promise((resolve) => httpServer.close(resolve));
});

test('room:join creates a room and emits room:state', async () => {
  const socket = connectClient(port);
  clients.push(socket);

  const statePromise = waitFor(socket, 'room:state');
  socket.emit('room:join', { code: 'TEST', name: 'Alice', gameId: 'wheel' });

  const state = await statePromise;
  expect(state.code).toBe('TEST');
  expect(state.members).toHaveLength(1);
  expect(state.members[0].name).toBe('Alice');
});

test('room:join on a non-existent room without gameId emits room:error', async () => {
  const socket = connectClient(port);
  clients.push(socket);

  const errorPromise = waitFor(socket, 'room:error');
  socket.emit('room:join', { code: 'NOPE', name: 'Bob' });

  const error = await errorPromise;
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
});

test('two players joining the same room both appear in room:state', async () => {
  const s1 = connectClient(port);
  const s2 = connectClient(port);
  clients.push(s1, s2);

  // s1 joins first; wait until it receives its own room:state
  await new Promise((resolve) => {
    s1.once('room:state', resolve);
    s1.emit('room:join', { code: 'DUAL', name: 'Alice', gameId: 'wheel' });
  });

  // s2 joins same code; the server broadcasts room:state to all members (including s1)
  const state = await new Promise((resolve) => {
    s1.once('room:state', resolve);
    s2.emit('room:join', { code: 'DUAL', name: 'Bob' });
  });

  expect(state.members).toHaveLength(2);
});

test('disconnecting a player removes them from room:state', async () => {
  const s1 = connectClient(port);
  const s2 = connectClient(port);
  clients.push(s1, s2);

  // Both join the room
  await new Promise((resolve) => {
    s1.emit('room:join', { code: 'DC', name: 'Alice', gameId: 'wheel' });
    s1.once('room:state', () => {
      s2.emit('room:join', { code: 'DC', name: 'Bob' });
    });
    s2.once('room:state', resolve);
  });

  // Disconnect s1 and wait for s2 to receive the updated state
  const updatePromise = waitFor(s2, 'room:state');
  s1.disconnect();

  const state = await updatePromise;
  expect(state.members).toHaveLength(1);
});
