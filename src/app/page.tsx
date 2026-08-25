"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GAMES } from "@/games/catalog";
import { makeRoomCode } from "@/lib/code";
import { track } from "@/lib/analytics";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    track("lobby_viewed");
  }, []);

  function startGame(gameId: string) {
    const code = makeRoomCode();
    const gameMeta = GAMES.find((g) => g.id === gameId);
    track("game_started", { game_id: gameId, game_name: gameMeta?.name, room_code: code });
    router.push(`/room/${code}?game=${gameId}`);
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 3) {
      track("room_join_attempted", { room_code: code });
      router.push(`/room/${code}`);
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <header className="mb-12 text-center">
        <div className="mb-3 inline-flex animate-float items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-violet-200">
          🎲 play together, instantly
        </div>
        <h1 className="bg-gradient-to-br from-white to-violet-300 bg-clip-text pb-1 text-5xl font-black leading-tight tracking-tight text-transparent sm:text-6xl">
          Party Games
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-balance text-lg text-violet-100/70">
          Quick, real-time multiplayer mini-games. Start a room, share the link,
          play in seconds.
        </p>
      </header>

      <form onSubmit={joinRoom} className="mx-auto mb-12 flex max-w-md gap-2">
        <input
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="Got a room code?"
          maxLength={6}
          className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center font-mono text-lg tracking-widest outline-none transition focus:border-violet-400/50 focus:bg-white/10"
        />
        <button
          type="submit"
          className="rounded-xl bg-white/10 px-5 py-3 font-semibold transition hover:bg-white/20"
        >
          Join
        </button>
      </form>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {GAMES.map((game) => {
          const live = game.status === "live";
          return (
            <button
              key={game.id}
              disabled={!live}
              onClick={() => {
                if (!live) return;
                track("game_card_clicked", { game_id: game.id, game_name: game.name });
                startGame(game.id);
              }}
              className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 text-left transition enabled:hover:-translate-y-1 enabled:hover:border-white/20 enabled:hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div
                className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-30 blur-2xl transition group-enabled:group-hover:opacity-60"
                style={{ background: game.accent }}
              />
              <div className="mb-4 text-4xl">{game.emoji}</div>
              <h2 className="mb-1 text-xl font-bold">{game.name}</h2>
              <p className="mb-4 text-sm text-violet-100/60">{game.blurb}</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-violet-100/40">
                  {game.minPlayers}+ players
                </span>
                {live ? (
                  <span className="font-semibold text-violet-300 transition group-hover:translate-x-0.5">
                    Start →
                  </span>
                ) : (
                  <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-violet-100/50">
                    Coming soon
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <footer className="mt-16 text-center text-sm text-violet-100/30">
        An open-source real-time multiplayer games starter
      </footer>
    </main>
  );
}
