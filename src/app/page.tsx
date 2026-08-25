"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { GAMES } from "@/games/catalog";
import { makeRoomCode } from "@/lib/code";

export default function Home() {
  const router = useRouter();
  const [joinCode, setJoinCode] = useState("");

  const THEME_KEY = 'party-games:theme';
  type Theme = 'dark' | 'light' | 'disco';
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved) applyTheme(saved);
  }, []);

  function applyTheme(t: Theme) {
    setTheme(t);
    localStorage.setItem(THEME_KEY, t);
    if (t === 'dark') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = t;
    }
  }

  function startGame(gameId: string) {
    const code = makeRoomCode();
    router.push(`/room/${code}?game=${gameId}`);
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code.length >= 3) router.push(`/room/${code}`);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-14">
      <div className="fixed top-4 right-4 z-50 flex gap-1 rounded-full border border-white/10 bg-black/30 p-1 backdrop-blur">
        {[
          { id: 'dark',  label: '🌑', title: 'Dark mode' },
          { id: 'light', label: '☀️', title: 'Light mode' },
          { id: 'disco', label: '🪩', title: 'Party disco!' },
        ].map(({ id, label, title }) => (
          <button
            key={id}
            title={title}
            onClick={() => applyTheme(id as Theme)}
            className={`rounded-full px-3 py-1.5 text-sm transition ${theme === id ? 'bg-white/20 shadow-inner' : 'hover:bg-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>
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
              onClick={() => live && startGame(game.id)}
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
