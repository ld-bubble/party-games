"use client";

import { useEffect, useRef, useState } from "react";
import type { GameProps } from "../registry";
import { playCorrect, playFanfare } from "@/lib/sounds";

interface PPlayer {
  name: string;
  score: number;
}
interface PunchlineState {
  phase?: string;
  hostId?: string | null;
  players?: Record<string, PPlayer>;
  round?: number;
  prompt?: string | null;
  answered?: string[];
  skipped?: string[];
  voted?: string[];
  gallery?: { aid: string; text: string }[] | null;
  reveals?: { aid: string; text: string; name: string; votes: number }[] | null;
}

function nameKey(name: string | undefined | null) {
  return String(name || "").trim().toLowerCase();
}

export default function Punchline({ socket, me, members, game }: GameProps) {
  const g = game as PunchlineState;
  const phase = g.phase ?? "lobby";
  const players = g.players ?? {};
  const myKey = nameKey(me?.name);
  const isHost = !!me && g.hostId === me.id;
  const hasAnswered = (g.answered ?? []).includes(myKey);
  const hasSkipped = (g.skipped ?? []).includes(myKey);
  const hasVoted = (g.voted ?? []).includes(myKey);

  const [answerInput, setAnswerInput] = useState("");
  const [myAnswer, setMyAnswer] = useState<string | null>(null); // to spot my own card
  const [myVote, setMyVote] = useState<string | null>(null);
  const prevPhase = useRef(phase);

  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (phase === "write") {
        setAnswerInput("");
        setMyAnswer(null);
        setMyVote(null);
      }
      if (phase === "results") {
        const mine = g.reveals?.find((r) => r.text === myAnswer);
        if (mine && mine.votes > 0) playCorrect();
      }
      if (phase === "gameover") playFanfare();
      prevPhase.current = phase;
    }
  }, [phase, g.reveals, myAnswer]);

  const playerList = Object.entries(players)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => b.score - a.score);

  function playerName(key: string) {
    return players[key]?.name ?? key;
  }

  const rail = (
    <div className="mb-6 flex flex-wrap gap-2">
      {playerList.map((p) => (
        <div
          key={p.key}
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${
            p.key === myKey ? "border-pink-400/50 bg-pink-400/10" : "border-white/10 bg-white/5"
          }`}
        >
          <span className="font-semibold">{p.name}</span>
          <span className="font-mono font-bold text-pink-300">{p.score}</span>
        </div>
      ))}
    </div>
  );

  const promptCard = g.prompt && (
    <div className="mb-6 rounded-2xl border border-pink-400/30 bg-gradient-to-br from-pink-900/40 to-fuchsia-900/30 p-6 text-center sm:p-8">
      <p className="mb-1 text-xs font-bold uppercase tracking-widest text-pink-300/70">
        Round {g.round} · 🎤
      </p>
      <p className="text-balance text-xl font-black leading-snug sm:text-2xl">{g.prompt}</p>
    </div>
  );

  // ---- Lobby ---------------------------------------------------------------
  if (phase === "lobby") {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mb-3 text-5xl">🎤</div>
        <h2 className="mb-2 text-2xl font-black">Punchline</h2>
        <p className="mb-6 text-violet-100/60">
          One prompt. Everyone writes their funniest answer. Answers show
          anonymously, the room votes, votes are points.
        </p>
        {isHost ? (
          <button
            onClick={() => socket.emit("pl:start")}
            disabled={members.length < 2}
            className="rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-500 px-8 py-4 text-lg font-black uppercase tracking-wide transition enabled:hover:scale-105 disabled:opacity-40"
          >
            Start round 1
          </button>
        ) : (
          <p className="text-violet-100/50">Waiting for the host to kick off…</p>
        )}
      </div>
    );
  }

  // ---- Write ----------------------------------------------------------------
  if (phase === "write") {
    const waitingOn = members
      .map((m) => nameKey(m.name))
      .filter((k) => !(g.answered ?? []).includes(k));
    return (
      <div className="mx-auto max-w-lg">
        {rail}
        {promptCard}
        {!hasAnswered ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answerInput.trim()) {
                  setMyAnswer(answerInput.trim());
                  socket.emit("pl:answer", { text: answerInput });
                }
              }}
              placeholder="Your funniest answer…"
              maxLength={140}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 outline-none focus:border-pink-400/50"
            />
            <button
              disabled={!answerInput.trim()}
              onClick={() => {
                setMyAnswer(answerInput.trim());
                socket.emit("pl:answer", { text: answerInput });
              }}
              className="rounded-xl bg-gradient-to-br from-pink-500 to-fuchsia-500 px-5 py-3 font-black uppercase transition enabled:hover:scale-105 disabled:opacity-40"
            >
              Lock
            </button>
            <button
              onClick={() => socket.emit("pl:skip")}
              className="rounded-xl bg-white/5 px-4 py-3 text-sm text-violet-100/40 transition hover:bg-white/10 hover:text-violet-100/60"
            >
              Skip
            </button>
          </div>
        ) : hasSkipped ? (
          <p className="text-center text-violet-100/40">⏭️ Skipped. Waiting for everyone else…</p>
        ) : (
          <p className="text-center text-violet-100/60">✅ Locked in. Waiting on the slow typers…</p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {waitingOn.map((k) => (
            <span key={k} className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-violet-100/50">
              ✍️ {playerName(k)}
            </span>
          ))}
        </div>
        {isHost && (g.answered?.length ?? 0) >= 2 && waitingOn.length > 0 && (
          <div className="mt-4 text-center">
            <button
              onClick={() => socket.emit("pl:force")}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
            >
              Close submissions — go to voting
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Vote -------------------------------------------------------------------
  if (phase === "vote") {
    return (
      <div className="mx-auto max-w-lg">
        {rail}
        {promptCard}
        <p className="mb-3 text-center text-sm text-violet-100/60">
          {hasVoted ? "Vote locked. Waiting for the rest…" : "Vote for your favorite (not your own!)"}
        </p>
        <div className="flex flex-col gap-3">
          {(g.gallery ?? []).map(({ aid, text }) => {
            const isMine = myAnswer !== null && text === myAnswer;
            const picked = myVote === aid;
            return (
              <button
                key={aid}
                disabled={hasVoted || isMine}
                onClick={() => {
                  setMyVote(aid);
                  socket.emit("pl:vote", { aid });
                }}
                className={`rounded-2xl border-2 p-4 text-left text-lg font-semibold leading-snug transition ${
                  picked
                    ? "border-pink-400/70 bg-pink-400/15"
                    : isMine
                      ? "border-white/5 bg-white/[0.03] opacity-50"
                      : "border-white/10 bg-white/5 enabled:hover:border-pink-400/40 enabled:hover:bg-white/10"
                } disabled:cursor-default`}
              >
                {text}
                {isMine && <span className="ml-2 text-xs text-violet-100/40">(yours)</span>}
                {picked && <span className="ml-2">👈</span>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {(g.voted ?? []).map((k) => (
            <span key={k} className="rounded-full bg-white/5 px-2.5 py-1 text-xs">
              ✅ {playerName(k)}
            </span>
          ))}
        </div>
        {isHost && (
          <div className="mt-4 text-center">
            <button
              onClick={() => socket.emit("pl:force")}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
            >
              Close voting — show results
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Results ------------------------------------------------------------------
  if (phase === "results") {
    const maxVotes = Math.max(0, ...(g.reveals ?? []).map((r) => r.votes));
    return (
      <div className="mx-auto max-w-lg">
        {rail}
        {promptCard}
        <div className="flex flex-col gap-3">
          {(g.reveals ?? [])
            .slice()
            .sort((a, b) => b.votes - a.votes)
            .map((r) => {
              const winner = r.votes === maxVotes && maxVotes > 0;
              return (
                <div
                  key={r.aid}
                  className={`animate-pop-in rounded-2xl border-2 p-4 ${
                    winner ? "border-pink-400/70 bg-pink-400/10" : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-lg font-semibold leading-snug">
                      {winner && "👑 "}
                      {r.text}
                    </p>
                    <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 font-mono text-sm font-bold">
                      {r.votes} 🗳
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-pink-300/80">
                    — {r.name} {r.votes > 0 && <span className="text-violet-100/50">(+{r.votes * 100})</span>}
                  </p>
                </div>
              );
            })}
        </div>
        {isHost && (
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={() => socket.emit("pl:start")}
              className="rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-500 px-6 py-3 font-black uppercase tracking-wide transition hover:scale-105"
            >
              Next round →
            </button>
            <button
              onClick={() => socket.emit("pl:end")}
              className="rounded-2xl bg-white/10 px-6 py-3 font-black uppercase tracking-wide transition hover:bg-white/20"
            >
              Finish
            </button>
          </div>
        )}
      </div>
    );
  }

  // ---- Game over -------------------------------------------------------------------
  if (phase === "gameover") {
    const medals = ["🥇", "🥈", "🥉"];
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="mb-2 text-4xl">🏆</p>
        <h2 className="mb-6 text-3xl font-black">Comedy standings</h2>
        <ul className="flex flex-col gap-2">
          {playerList.map((p, idx) => (
            <li
              key={p.key}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                idx === 0 ? "border-pink-400/60 bg-pink-400/15" : "border-white/10 bg-white/5"
              }`}
            >
              <span className="font-bold">
                {medals[idx] ?? `${idx + 1}.`} {p.name}
                {p.key === myKey && <span className="ml-1.5 text-xs text-pink-300/70">(you)</span>}
              </span>
              <span className="font-mono font-black text-pink-300">{p.score}</span>
            </li>
          ))}
        </ul>
        {isHost && (
          <button
            onClick={() => socket.emit("pl:newGame")}
            className="mt-8 rounded-2xl bg-gradient-to-br from-pink-500 to-fuchsia-500 px-8 py-3 font-black uppercase tracking-wide transition hover:scale-105"
          >
            Play again
          </button>
        )}
      </div>
    );
  }

  return <p className="text-center text-violet-100/50">Loading game…</p>;
}
