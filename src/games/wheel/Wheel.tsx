"use client";

import { useEffect, useState } from "react";
import type { GameProps } from "../registry";
import type { Member } from "@/lib/socket";

const COLORS = [
  "#7c5cff",
  "#ff7a59",
  "#19c37d",
  "#ffb020",
  "#ff5c8a",
  "#3ba9ff",
  "#a06bff",
  "#2dd4bf",
];

export default function Wheel({ socket, me, members, game }: GameProps) {
  const [rotation, setRotation] = useState<number>(
    typeof game.rotation === "number" ? game.rotation : 0,
  );
  const [duration, setDuration] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<Member | null>(
    (game.winner as Member) || null,
  );
  const [newName, setNewName] = useState("");

  // Real-time spin events from the server. Every client receives the same final
  // rotation, so the animation and result are identical everywhere.
  useEffect(() => {
    function onSpin(payload: { rotation: number; duration: number }) {
      setWinner(null);
      setDuration(payload.duration);
      setSpinning(true);
      requestAnimationFrame(() => setRotation(payload.rotation));
    }
    function onResult(payload: { winner: Member }) {
      setSpinning(false);
      setWinner(payload.winner);
    }
    socket.on("wheel:spin", onSpin);
    socket.on("wheel:result", onResult);
    return () => {
      socket.off("wheel:spin", onSpin);
      socket.off("wheel:result", onResult);
    };
  }, [socket]);

  // Late joiners (and post-spin state) sync to the server's rotation instantly.
  useEffect(() => {
    if (spinning) return;
    if (typeof game.rotation === "number") {
      setDuration(0);
      setRotation(game.rotation);
    }
    setWinner((game.winner as Member) || null);
  }, [game.rotation, game.winner, spinning]);

  const customEntries = Array.isArray(game.customEntries)
    ? (game.customEntries as { id: string; name: string }[])
    : [];
  const entries: { id: string; name: string }[] = [...members, ...customEntries];

  const n = entries.length;
  const seg = n > 0 ? 360 / n : 360;
  const canSpin = n >= 2 && !spinning;

  const gradient =
    n === 0
      ? "#2a2640"
      : `conic-gradient(from 0deg, ${entries
          .map((_, i) => {
            const c = COLORS[i % COLORS.length];
            return `${c} ${i * seg}deg ${(i + 1) * seg}deg`;
          })
          .join(", ")})`;

  function handleAdd() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    socket.emit("wheel:add-entry", { name: trimmed });
    setNewName("");
  }

  return (
    <div className="flex flex-col items-center gap-8">
      <div className="relative h-[320px] w-[320px] sm:h-[400px] sm:w-[400px]">
        {/* Pointer */}
        <div className="absolute left-1/2 top-[-6px] z-20 -translate-x-1/2">
          <div className="h-0 w-0 border-l-[14px] border-r-[14px] border-t-[24px] border-l-transparent border-r-transparent border-t-white drop-shadow-lg" />
        </div>

        {/* Wheel disc */}
        <div
          className="absolute inset-0 rounded-full border-[6px] border-white/80 shadow-2xl"
          style={{
            background: gradient,
            transform: `rotate(${rotation}deg)`,
            transition: duration
              ? `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : "none",
          }}
        >
          {entries.map((m, i) => {
            const center = i * seg + seg / 2;
            return (
              <div
                key={m.id}
                className="absolute left-1/2 top-1/2 origin-left"
                style={{
                  transform: `rotate(${center}deg) translateX(8px)`,
                }}
              >
                <span className="block max-w-[150px] truncate text-sm font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
                  {m.name}
                </span>
              </div>
            );
          })}
        </div>

        {/* Hub */}
        <div className="absolute left-1/2 top-1/2 z-10 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white/80 bg-[#0d0b1a] shadow-lg" />
      </div>

      <button
        onClick={() => socket.emit("wheel:spin")}
        disabled={!canSpin}
        className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-10 py-4 text-lg font-black uppercase tracking-wide shadow-lg shadow-violet-900/40 transition enabled:hover:scale-105 enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {spinning ? "Spinning…" : "Spin"}
      </button>

      <div className="h-12 text-center">
        {n < 2 && (
          <p className="text-violet-100/50">
            Waiting for at least 2 entries…
          </p>
        )}
        {winner && !spinning && (
          <p className="animate-pop-in text-2xl font-black">
            {winner.id === me?.id ? (
              <span className="text-fuchsia-300">🎉 It&apos;s you, {winner.name}!</span>
            ) : (
              <span className="text-violet-200">👉 {winner.name} is up!</span>
            )}
          </p>
        )}
      </div>

      {/* Custom entry management */}
      <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/5 p-4">
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-100/50">
          Add names
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
          className="flex gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a name…"
            maxLength={40}
            className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-violet-400/50 focus:bg-white/10"
          />
          <button
            type="submit"
            disabled={!newName.trim()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold transition enabled:hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {customEntries.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {customEntries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-1.5 text-sm"
              >
                <span>{entry.name}</span>
                <button
                  onClick={() => socket.emit("wheel:remove-entry", { id: entry.id })}
                  className="ml-2 text-violet-100/40 transition hover:text-violet-100/80"
                  aria-label={`Remove ${entry.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
