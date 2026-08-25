"use client";

import { useEffect, useRef, useState } from "react";
import type { GameProps } from "../registry";
import { playCorrect, playWrong, playFanfare } from "@/lib/sounds";
import { track } from "@/lib/analytics";

interface TPlayer {
  name: string;
  score: number;
}
interface TwoTruthsState {
  phase?: string;
  hostId?: string | null;
  players?: Record<string, TPlayer>;
  submitted?: string[];
  order?: string[] | null;
  roundIdx?: number;
  featuredKey?: string | null;
  statements?: string[] | null;
  voted?: string[];
  reveal?: {
    lieIndex: number;
    choices: Record<string, number>;
    counts: number[];
    fooled: number;
  } | null;
}

function nameKey(name: string | undefined | null) {
  return String(name || "").trim().toLowerCase();
}

export default function TwoTruths({ socket, me, members, game }: GameProps) {
  const g = game as TwoTruthsState;
  const phase = g.phase ?? "collect";
  const players = g.players ?? {};
  const myKey = nameKey(me?.name);
  const isHost = !!me && g.hostId === me.id;
  const isFeatured = myKey === g.featuredKey;
  const hasSubmitted = (g.submitted ?? []).includes(myKey);
  const hasVoted = (g.voted ?? []).includes(myKey);

  const [statements, setStatements] = useState(["", "", ""]);
  const [lieIndex, setLieIndex] = useState<number | null>(null);
  const [myChoice, setMyChoice] = useState<number | null>(null);
  const prevPhase = useRef(phase);

  // Reveal/gameover sounds on phase transitions.
  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (phase === "reveal" && myChoice !== null && g.reveal) {
        if (myChoice === g.reveal.lieIndex) playCorrect();
        else playWrong();
      }
      if (phase === "gameover") playFanfare();
      if (phase === "guess") setMyChoice(null);
      if (phase === "collect" && prevPhase.current === "gameover") {
        track("two_truths_game_started", { player_count: Object.keys(players).length });
      }
      if (phase === "reveal") {
        track("two_truths_round_reveal", { fooled: g.reveal?.fooled, round_idx: g.roundIdx });
      }
      if (phase === "gameover") {
        const winner = Object.entries(players).sort((a, b) => b[1].score - a[1].score)[0]?.[1]?.name;
        track("two_truths_game_completed", { winner });
      }
      prevPhase.current = phase;
    }
  }, [phase, myChoice, g.reveal, players, g.roundIdx]);

  const playerList = Object.entries(players)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => b.score - a.score);

  function playerName(key: string | null | undefined) {
    if (!key) return "?";
    return players[key]?.name ?? key;
  }

  const rail = (
    <div className="mb-6 flex flex-wrap gap-2">
      {playerList.map((p) => (
        <div
          key={p.key}
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${
            p.key === myKey ? "border-orange-400/50 bg-orange-400/10" : "border-white/10 bg-white/5"
          }`}
        >
          <span className="font-semibold">
            {p.key === g.featuredKey && phase !== "collect" && "🎙️ "}
            {p.name}
          </span>
          <span className="font-mono font-bold text-orange-300">{p.score}</span>
        </div>
      ))}
    </div>
  );

  // ---- Collect -----------------------------------------------------------
  if (phase === "collect") {
    const waitingOn = members
      .map((m) => nameKey(m.name))
      .filter((k) => !(g.submitted ?? []).includes(k));
    return (
      <div className="mx-auto max-w-lg">
        <div className="mb-6 text-center">
          <div className="mb-2 text-5xl">🕵️</div>
          <h2 className="text-2xl font-black">Two Truths & a Lie</h2>
          <p className="mt-1 text-violet-100/60">
            Write two truths and one lie about yourself. Mark the lie.
          </p>
        </div>
        {!hasSubmitted ? (
          <div className="flex flex-col gap-3">
            {statements.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={s}
                  onChange={(e) =>
                    setStatements((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                  }
                  placeholder={`Statement ${i + 1}`}
                  maxLength={140}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-orange-400/50"
                />
                <button
                  onClick={() => setLieIndex(i)}
                  title="Mark as the lie"
                  className={`shrink-0 rounded-xl border px-3 py-3 text-sm font-bold transition ${
                    lieIndex === i
                      ? "border-rose-400/60 bg-rose-400/20 text-rose-300"
                      : "border-white/10 bg-white/5 text-white/30 hover:text-white/60"
                  }`}
                >
                  {lieIndex === i ? "🤥 the lie" : "truth"}
                </button>
              </div>
            ))}
            <button
              disabled={statements.some((s) => !s.trim()) || lieIndex === null}
              onClick={() => {
                track("two_truths_statements_submitted");
                socket.emit("tt:submit", { statements, lieIndex });
              }}
              className="mt-2 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 px-8 py-3 font-black uppercase tracking-wide transition enabled:hover:scale-[1.02] disabled:opacity-40"
            >
              Lock it in
            </button>
            <p className="text-center text-xs text-violet-100/40">
              Tap "truth" next to a statement to mark it as your lie.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <p className="mb-3 text-lg">✅ Submitted! Waiting on:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {waitingOn.length ? (
                waitingOn.map((k) => (
                  <span key={k} className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-violet-100/60">
                    {playerName(k)}
                  </span>
                ))
              ) : (
                <span className="text-violet-100/60">everyone's in…</span>
              )}
            </div>
            {isHost && (g.submitted?.length ?? 0) >= 1 && members.length >= 2 && (
              <button
                onClick={() => socket.emit("tt:begin")}
                className="mt-6 rounded-xl bg-white/10 px-5 py-2.5 font-semibold transition hover:bg-white/20"
              >
                Start guessing with {g.submitted?.length} player
                {(g.submitted?.length ?? 0) !== 1 ? "s" : ""} →
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Guess / Reveal ------------------------------------------------------
  if (phase === "guess" || phase === "reveal") {
    const reveal = g.reveal;
    return (
      <div className="mx-auto max-w-lg">
        {rail}
        <p className="mb-1 text-center text-xs font-semibold uppercase tracking-wide text-violet-100/40">
          Round {(g.roundIdx ?? 0) + 1} / {g.order?.length ?? "?"}
        </p>
        <h2 className="mb-5 text-center text-2xl font-black">
          {isFeatured ? "Your statements — look innocent 😇" : `Which is ${playerName(g.featuredKey)}'s lie?`}
        </h2>
        <div className="flex flex-col gap-3">
          {(g.statements ?? []).map((s, i) => {
            const isLie = phase === "reveal" && reveal?.lieIndex === i;
            const isTruth = phase === "reveal" && reveal?.lieIndex !== i;
            const picked = myChoice === i;
            const count = reveal?.counts?.[i] ?? 0;
            return (
              <button
                key={i}
                disabled={phase !== "guess" || isFeatured || hasVoted}
                onClick={() => {
                  setMyChoice(i);
                  track("two_truths_vote_cast");
                  socket.emit("tt:vote", { choice: i });
                }}
                className={`rounded-2xl border-2 p-4 text-left transition ${
                  isLie
                    ? "border-rose-400/70 bg-rose-400/15"
                    : isTruth
                      ? "border-emerald-400/40 bg-emerald-400/5"
                      : picked
                        ? "border-orange-400/70 bg-orange-400/15"
                        : "border-white/10 bg-white/5 enabled:hover:border-orange-400/40 enabled:hover:bg-white/10"
                } disabled:cursor-default`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-lg font-semibold leading-snug">{s}</p>
                  {phase === "reveal" && (
                    <span className="shrink-0 text-sm font-bold">
                      {isLie ? "🤥 THE LIE" : "✓ truth"}
                      <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 font-mono">
                        {count}
                      </span>
                    </span>
                  )}
                  {phase === "guess" && picked && <span className="shrink-0">👈 your pick</span>}
                </div>
              </button>
            );
          })}
        </div>

        {phase === "guess" && (
          <div className="mt-5 text-center text-sm text-violet-100/50">
            {isFeatured
              ? "They're deciding… act natural."
              : hasVoted
                ? "Vote locked. Waiting for the others…"
                : "Tap the statement you think is the lie."}
            <div className="mt-2 flex flex-wrap justify-center gap-1.5">
              {(g.voted ?? []).map((k) => (
                <span key={k} className="rounded-full bg-white/5 px-2.5 py-1 text-xs">
                  ✅ {playerName(k)}
                </span>
              ))}
            </div>
            {isHost && (
              <button
                onClick={() => socket.emit("tt:force")}
                className="mt-4 rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
              >
                Everyone's in — reveal now
              </button>
            )}
          </div>
        )}

        {phase === "reveal" && (
          <div className="mt-5 text-center">
            <p className="animate-pop-in text-lg">
              {reveal?.fooled
                ? `🎭 ${playerName(g.featuredKey)} fooled ${reveal.fooled} ${reveal.fooled === 1 ? "person" : "people"} (+${reveal.fooled * 50})`
                : `😅 Nobody was fooled by ${playerName(g.featuredKey)}`}
            </p>
            {isHost && (
              <button
                onClick={() => socket.emit("tt:next")}
                className="mt-5 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 px-8 py-3 font-black uppercase tracking-wide transition hover:scale-105"
              >
                {(g.roundIdx ?? 0) + 1 < (g.order?.length ?? 0) ? "Next player →" : "Final standings →"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Game over -----------------------------------------------------------
  if (phase === "gameover") {
    const medals = ["🥇", "🥈", "🥉"];
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="mb-2 text-4xl">🏆</p>
        <h2 className="mb-6 text-3xl font-black">Best liars & lie detectors</h2>
        <ul className="flex flex-col gap-2">
          {playerList.map((p, idx) => (
            <li
              key={p.key}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                idx === 0 ? "border-orange-400/60 bg-orange-400/15" : "border-white/10 bg-white/5"
              }`}
            >
              <span className="font-bold">
                {medals[idx] ?? `${idx + 1}.`} {p.name}
                {p.key === myKey && <span className="ml-1.5 text-xs text-orange-300/70">(you)</span>}
              </span>
              <span className="font-mono font-black text-orange-300">{p.score}</span>
            </li>
          ))}
        </ul>
        {isHost && (
          <button
            onClick={() => socket.emit("tt:newGame")}
            className="mt-8 rounded-2xl bg-gradient-to-br from-orange-500 to-rose-500 px-8 py-3 font-black uppercase tracking-wide transition hover:scale-105"
          >
            Play again
          </button>
        )}
      </div>
    );
  }

  return <p className="text-center text-violet-100/50">Loading game…</p>;
}
