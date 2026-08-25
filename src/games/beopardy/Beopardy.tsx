"use client";

import { useEffect, useRef, useState } from "react";
import type { GameProps } from "../registry";
import { playBuzz, playCorrect, playWrong, playFanfare } from "@/lib/sounds";
import { track } from "@/lib/analytics";

interface BPlayer {
  name: string;
  score: number;
}
interface BCell {
  value: number;
  used: boolean;
}
interface BCat {
  name: string;
  clues: BCell[];
}
interface BReveal {
  key: string;
  name: string;
  answer: string;
  wager: number;
  correct: boolean;
}
interface BeopardyState {
  phase?: string;
  hostId?: string | null;
  packs?: { id: string; title: string }[];
  packTitle?: string;
  board?: BCat[] | null;
  players?: Record<string, BPlayer>;
  controlKey?: string | null;
  active?: { cat: number; row: number; value: number; clue: string; isDD: boolean } | null;
  buzzedKey?: string | null;
  verifierKey?: string | null;
  lockedKeys?: string[];
  wager?: number | null;
  revealedAnswer?: { clue: string; answer: string; value: number } | null;
  final?: {
    category?: string;
    clue?: string | null;
    answer?: string | null;
    wagered: string[];
    answered: string[];
    reveals: BReveal[] | null;
  } | null;
}

const MAX_CLUE_VALUE = 800;

function nameKey(name: string | undefined | null) {
  return String(name || "").trim().toLowerCase();
}

function fmtScore(n: number) {
  const abs = Math.abs(n).toLocaleString();
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export default function Beopardy({ socket, me, members, game }: GameProps) {
  const g = game as BeopardyState;
  const phase = g.phase ?? "setup";
  const players = g.players ?? {};
  const myKey = nameKey(me?.name);
  const isHost = !!me && g.hostId === me.id;
  const isController = myKey === g.controlKey;
  const isVerifier = myKey === g.verifierKey;
  const isBuzzer = myKey === g.buzzedKey;
  const lockedKeys = g.lockedKeys ?? [];

  const [answerInfo, setAnswerInfo] = useState<{ clue: string; answer: string } | null>(null);
  const [answerRevealed, setAnswerRevealed] = useState(false);
  const [toast, setToast] = useState<{ correct: boolean; text: string } | null>(null);
  const [wagerInput, setWagerInput] = useState("");
  const [finalWagerInput, setFinalWagerInput] = useState("");
  const [finalAnswerInput, setFinalAnswerInput] = useState("");
  const [remaining, setRemaining] = useState(60);
  const prevPhase = useRef(phase);

  // Private answer feed (only the verifier ever receives this).
  useEffect(() => {
    function onAnswerInfo(p: { clue: string; answer: string }) {
      setAnswerInfo(p);
      setAnswerRevealed(false); // every clue starts obscured
    }
    function onVerdict(p: { correct: boolean; name: string; delta: number }) {
      if (p.correct) playCorrect();
      else playWrong();
      setToast({
        correct: p.correct,
        text: p.correct
          ? `${p.name} +${fmtScore(p.delta)}`
          : `${p.name} −${fmtScore(p.delta)}`,
      });
      setTimeout(() => setToast(null), 2500);
    }
    socket.on("beopardy:answerinfo", onAnswerInfo);
    socket.on("beopardy:verdict", onVerdict);
    return () => {
      socket.off("beopardy:answerinfo", onAnswerInfo);
      socket.off("beopardy:verdict", onVerdict);
    };
  }, [socket]);

  // The answer card is only relevant while its clue is active.
  useEffect(() => {
    if (!g.active) setAnswerInfo(null);
  }, [g.active]);

  // Soft 60s countdown during Final answers (display only — host can force).
  useEffect(() => {
    if (phase !== "final_answer") return;
    setRemaining(60);
    const iv = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  useEffect(() => {
    if (phase === "gameover") playFanfare();
  }, [phase]);

  const playerList = Object.entries(players)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => b.score - a.score);

  function playerName(key: string | null | undefined) {
    if (!key) return "?";
    return players[key]?.name ?? key;
  }

  useEffect(() => {
    if (prevPhase.current !== phase) {
      if (phase === "board" && prevPhase.current === "setup") {
        track("beopardy_game_started", { pack_title: g.packTitle, player_count: playerList.length });
      }
      if (phase === "gameover") {
        track("beopardy_game_completed", {
          winner: playerList[0]?.name,
          top_score: playerList[0]?.score,
          player_count: playerList.length,
        });
      }
      prevPhase.current = phase;
    }
  }, [phase, g.packTitle, playerList]);

  // ---- Shared chrome -----------------------------------------------------

  const rail = (
    <div className="mb-6 flex flex-wrap gap-2">
      {playerList.map((p) => (
        <div
          key={p.key}
          className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm ${
            p.key === myKey ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-white/5"
          }`}
        >
          <span className="font-semibold">
            {p.key === g.controlKey && "👑 "}
            {p.key === g.verifierKey && g.active && "🕵️ "}
            {p.name}
          </span>
          <span className={`font-mono font-bold ${p.score < 0 ? "text-rose-400" : "text-amber-300"}`}>
            {fmtScore(p.score)}
          </span>
        </div>
      ))}
    </div>
  );

  const verdictToast = toast && (
    <div
      className={`mb-4 animate-pop-in rounded-xl border px-4 py-2 text-center font-bold ${
        toast.correct
          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
          : "border-rose-400/40 bg-rose-400/10 text-rose-200"
      }`}
    >
      {toast.correct ? "✅" : "❌"} {toast.text}
    </div>
  );

  // The verifier's private answer card (visible during any active clue).
  // The answer starts blurred — the verifier taps Reveal before judging, so
  // nothing is spoiled by a glance or a shared screen.
  const verifierCard = isVerifier && g.active && answerInfo && (
    <div className="mx-auto mt-6 max-w-md rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-center">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-300/80">
        🕵️ You're the verifier — answer is
      </p>
      {answerRevealed ? (
        <>
          <p className="animate-pop-in text-xl font-black text-amber-200">
            {answerInfo.answer}
          </p>
          {(phase === "judging" || phase === "dd_judging") && (
            <div className="mt-4 flex justify-center gap-3">
              <button
                onClick={() => {
                track("beopardy_answer_judged", { correct: true });
                socket.emit("beopardy:judge", { correct: true });
              }}
                className="rounded-xl bg-emerald-500/80 px-6 py-3 font-black uppercase transition hover:bg-emerald-500"
              >
                Correct
              </button>
              <button
                onClick={() => {
                track("beopardy_answer_judged", { correct: false });
                socket.emit("beopardy:judge", { correct: false });
              }}
                className="rounded-xl bg-rose-500/80 px-6 py-3 font-black uppercase transition hover:bg-rose-500"
              >
                Wrong
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p
            aria-hidden="true"
            className="select-none text-xl font-black text-amber-200 blur-md"
          >
            {answerInfo.answer}
          </p>
          <button
            onClick={() => setAnswerRevealed(true)}
            className="mt-3 rounded-xl border border-amber-400/40 bg-amber-400/15 px-5 py-2.5 font-bold text-amber-200 transition hover:bg-amber-400/25"
          >
            👁 Reveal answer
          </button>
        </>
      )}
    </div>
  );

  // ---- Phase views ---------------------------------------------------------

  if (phase === "setup") {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mb-4 text-5xl">🧠</div>
        {isHost ? (
          <>
            <h2 className="mb-2 text-2xl font-black">Pick a game pack</h2>
            <p className="mb-6 text-violet-100/60">
              Everyone plays from their own device. You'll pick first.
            </p>
            <div className="flex flex-col gap-3">
              {(g.packs ?? []).map((p) => (
                <button
                  key={p.id}
                  onClick={() => socket.emit("beopardy:start", { packId: p.id })}
                  className="rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-500/20 to-orange-500/10 px-6 py-4 text-lg font-bold transition hover:scale-[1.02] hover:border-amber-400/60"
                >
                  {p.title} →
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-2xl font-black">Waiting for the host…</h2>
            <p className="text-violet-100/60">They're choosing a game pack.</p>
          </>
        )}
      </div>
    );
  }

  if (phase === "board") {
    return (
      <div>
        {rail}
        {verdictToast}
        {g.revealedAnswer && (
          <div className="mb-4 animate-pop-in rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm">
            <span className="text-violet-100/50">{g.revealedAnswer.clue}</span>{" "}
            <span className="font-bold text-amber-300">→ {g.revealedAnswer.answer}</span>
          </div>
        )}
        <p className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-violet-100/40">
          {isController ? "👑 Your pick!" : `👑 ${playerName(g.controlKey)} picks`}
        </p>
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${g.board?.length ?? 4}, minmax(0, 1fr))` }}
        >
          {g.board?.map((cat, ci) => (
            <div key={ci} className="flex flex-col gap-1.5 sm:gap-2">
              <div className="flex min-h-12 items-center justify-center rounded-lg bg-violet-500/20 px-1 py-2 text-center text-[10px] font-bold uppercase leading-tight tracking-wide text-violet-200 sm:text-xs">
                {cat.name}
              </div>
              {cat.clues.map((cell, ri) => (
                <button
                  key={ri}
                  disabled={cell.used || !(isController || isHost)}
                  onClick={() => {
                    track("beopardy_clue_selected", { cat: ci, row: ri, value: cell.value });
                    socket.emit("beopardy:select", { cat: ci, row: ri });
                  }}
                  className={`min-h-12 rounded-lg border text-base font-black sm:min-h-14 sm:text-xl ${
                    cell.used
                      ? "border-white/5 bg-white/[0.02] text-transparent"
                      : "border-amber-400/20 bg-gradient-to-br from-amber-500/15 to-orange-500/5 text-amber-300 enabled:transition enabled:hover:scale-105 enabled:hover:border-amber-400/60 disabled:cursor-default"
                  }`}
                >
                  ${cell.value}
                </button>
              ))}
            </div>
          ))}
        </div>
        {isHost && (
          <div className="mt-6 text-center">
            <button
              onClick={() => socket.emit("beopardy:final_start")}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
            >
              Skip to Final Beopardy →
            </button>
          </div>
        )}
      </div>
    );
  }

  if (phase === "clue" || phase === "judging") {
    const amLocked = lockedKeys.includes(myKey);
    return (
      <div>
        {rail}
        <div className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-900/40 to-indigo-900/30 p-6 text-center sm:p-10">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-amber-300/80">
            {g.board?.[g.active?.cat ?? 0]?.name} · ${g.active?.value}
          </p>
          <p className="text-balance text-xl font-bold leading-snug sm:text-3xl">
            {g.active?.clue}
          </p>
        </div>

        {phase === "clue" && (
          <div className="mt-6 text-center">
            {!amLocked ? (
              <button
                onClick={() => {
                  playBuzz();
                  track("beopardy_buzzed_in");
                  socket.emit("beopardy:buzz");
                }}
                className="h-28 w-28 touch-manipulation rounded-full border-4 border-rose-300/60 bg-gradient-to-br from-rose-500 to-red-600 text-xl font-black uppercase tracking-wide shadow-2xl shadow-rose-900/50 transition active:scale-90 sm:h-32 sm:w-32"
              >
                Buzz
              </button>
            ) : (
              <p className="text-violet-100/50">
                {isVerifier ? "🕵️ You're the verifier for this clue" : "🔒 Locked out of this clue"}
              </p>
            )}
            {(isController || isHost) && (
              <div className="mt-5">
                <button
                  onClick={() => socket.emit("beopardy:skip")}
                  className="rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
                >
                  No takers — reveal answer
                </button>
              </div>
            )}
          </div>
        )}

        {phase === "judging" && (
          <div className="mt-6 text-center">
            <p className="animate-pop-in text-2xl font-black text-rose-300">
              🔔 {playerName(g.buzzedKey)} buzzed in!
            </p>
            <p className="mt-1 text-violet-100/60">
              {isBuzzer ? "Say your answer out loud!" : "Listen for their answer…"}
            </p>
          </div>
        )}

        {verifierCard}
      </div>
    );
  }

  if (phase === "dd_wager" || phase === "dd_judging") {
    const myScore = players[myKey]?.score ?? 0;
    const maxWager = Math.max(myScore, MAX_CLUE_VALUE);
    return (
      <div>
        {rail}
        <div className="rounded-2xl border border-amber-400/40 bg-gradient-to-br from-amber-600/30 to-orange-700/20 p-6 text-center sm:p-10">
          <p className="mb-2 animate-pop-in text-3xl font-black tracking-wide text-amber-300 sm:text-4xl">
            💥 DAILY DOUBLE!
          </p>
          {phase === "dd_wager" ? (
            isController ? (
              <div className="mx-auto mt-4 max-w-sm">
                <p className="mb-3 text-violet-100/70">
                  Wager between $100 and ${maxWager.toLocaleString()}
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={100}
                    max={maxWager}
                    value={wagerInput}
                    onChange={(e) => setWagerInput(e.target.value)}
                    placeholder="500"
                    className="w-full flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-xl font-bold outline-none focus:border-amber-400/60"
                  />
                  <button
                    onClick={() => {
                      track("beopardy_dd_wager_submitted", { amount: Number(wagerInput) });
                      socket.emit("beopardy:wager", { amount: Number(wagerInput) });
                    }}
                    className="rounded-xl bg-amber-500 px-5 py-3 font-black uppercase text-black transition hover:bg-amber-400"
                  >
                    Wager
                  </button>
                </div>
                <button
                  onClick={() => {
                    track("beopardy_dd_wager_submitted", { amount: maxWager });
                    socket.emit("beopardy:wager", { amount: maxWager });
                  }}
                  className="mt-2 text-sm text-amber-300/70 underline-offset-2 hover:underline"
                >
                  True Daily Double — all in (${maxWager.toLocaleString()})
                </button>
              </div>
            ) : (
              <p className="mt-3 text-violet-100/70">
                {playerName(g.controlKey)} is setting a wager…
              </p>
            )
          ) : (
            <>
              <p className="mt-2 text-lg text-violet-100/80">
                {playerName(g.buzzedKey)} wagered{" "}
                <span className="font-black text-amber-300">${g.wager?.toLocaleString()}</span>
              </p>
              <p className="mx-auto mt-4 max-w-xl text-balance text-xl font-bold leading-snug sm:text-2xl">
                {g.active?.clue}
              </p>
              <p className="mt-3 text-violet-100/60">
                {isBuzzer ? "Say your answer out loud!" : "Listen for their answer…"}
              </p>
            </>
          )}
        </div>
        {verdictToast}
        {verifierCard}
      </div>
    );
  }

  if (phase === "final_wager" || phase === "final_answer" || phase === "final_judging") {
    const f = g.final;
    const myScore = players[myKey]?.score ?? 0;
    const maxFinal = Math.max(myScore, 0);
    const hasWagered = !!f?.wagered.includes(myKey);
    const hasAnswered = !!f?.answered.includes(myKey);
    const presentCount = members.length;

    return (
      <div>
        {rail}
        <div className="rounded-2xl border border-indigo-400/30 bg-gradient-to-br from-indigo-900/50 to-violet-900/30 p-6 text-center sm:p-10">
          <p className="mb-2 text-2xl font-black tracking-wide text-indigo-200 sm:text-3xl">
            ✨ FINAL BEOPARDY
          </p>
          <p className="text-lg font-bold text-amber-300">{f?.category}</p>

          {phase === "final_wager" && (
            <div className="mx-auto mt-6 max-w-sm">
              {!hasWagered ? (
                <>
                  <p className="mb-3 text-violet-100/70">
                    Wager up to ${maxFinal.toLocaleString()} — answer comes after everyone locks in.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={maxFinal}
                      value={finalWagerInput}
                      onChange={(e) => setFinalWagerInput(e.target.value)}
                      placeholder="0"
                      className="w-full flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-center text-xl font-bold outline-none focus:border-indigo-400/60"
                    />
                    <button
                      onClick={() =>
                        socket.emit("beopardy:final_wager", { amount: Number(finalWagerInput) })
                      }
                      className="rounded-xl bg-indigo-500 px-5 py-3 font-black uppercase transition hover:bg-indigo-400"
                    >
                      Lock
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-violet-100/70">
                  ✅ Wager locked · waiting on {Math.max(0, presentCount - (f?.wagered.length ?? 0))} more…
                </p>
              )}
            </div>
          )}

          {phase === "final_answer" && (
            <div className="mx-auto mt-6 max-w-lg">
              <p className="text-balance text-xl font-bold leading-snug sm:text-2xl">{f?.clue}</p>
              <p className="mt-2 font-mono text-sm text-violet-100/40">⏱ {remaining}s</p>
              {!hasAnswered ? (
                <div className="mt-4 flex gap-2">
                  <input
                    value={finalAnswerInput}
                    onChange={(e) => setFinalAnswerInput(e.target.value)}
                    placeholder="Your answer…"
                    maxLength={120}
                    className="w-full flex-1 rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-indigo-400/60"
                  />
                  <button
                    onClick={() =>
                      socket.emit("beopardy:final_answer", { text: finalAnswerInput })
                    }
                    className="rounded-xl bg-indigo-500 px-5 py-3 font-black uppercase transition hover:bg-indigo-400"
                  >
                    Lock
                  </button>
                </div>
              ) : (
                <p className="mt-4 text-violet-100/70">
                  ✅ Answer locked · waiting on {Math.max(0, presentCount - (f?.answered.length ?? 0))} more…
                </p>
              )}
            </div>
          )}

          {phase === "final_judging" && f?.reveals && (
            <div className="mx-auto mt-6 max-w-lg text-left">
              <p className="mb-4 text-center">
                Correct answer:{" "}
                <span className="text-xl font-black text-amber-300">{f.answer}</span>
              </p>
              <ul className="flex flex-col gap-2">
                {f.reveals.map((r) => (
                  <li
                    key={r.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="font-bold">{r.name}</p>
                      <p className="truncate text-sm text-violet-100/70">
                        "{r.answer}" · wagered ${r.wager.toLocaleString()}
                      </p>
                    </div>
                    {isHost ? (
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() =>
                            socket.emit("beopardy:final_mark", { key: r.key, correct: true })
                          }
                          className={`rounded-lg px-3 py-2 font-black ${
                            r.correct ? "bg-emerald-500 text-black" : "bg-white/10 text-white/40"
                          }`}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() =>
                            socket.emit("beopardy:final_mark", { key: r.key, correct: false })
                          }
                          className={`rounded-lg px-3 py-2 font-black ${
                            !r.correct ? "bg-rose-500" : "bg-white/10 text-white/40"
                          }`}
                        >
                          ✗
                        </button>
                      </div>
                    ) : (
                      <span className="shrink-0 text-xl">{r.correct ? "✅" : "❌"}</span>
                    )}
                  </li>
                ))}
              </ul>
              {isHost && (
                <div className="mt-5 text-center">
                  <button
                    onClick={() => socket.emit("beopardy:final_apply")}
                    className="rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 px-8 py-3 font-black uppercase tracking-wide text-black transition hover:scale-105"
                  >
                    Apply scores & finish
                  </button>
                </div>
              )}
            </div>
          )}

          {(phase === "final_wager" || phase === "final_answer") && isHost && (
            <button
              onClick={() => socket.emit("beopardy:final_force")}
              className="mt-6 rounded-xl bg-white/5 px-4 py-2 text-sm text-violet-100/50 transition hover:bg-white/10"
            >
              Everyone's in — force continue
            </button>
          )}
        </div>
      </div>
    );
  }

  if (phase === "gameover") {
    const medals = ["🥇", "🥈", "🥉"];
    return (
      <div className="mx-auto max-w-md text-center">
        <p className="mb-2 text-4xl">🏆</p>
        <h2 className="mb-6 text-3xl font-black">Final standings</h2>
        <ul className="flex flex-col gap-2">
          {playerList.map((p, idx) => (
            <li
              key={p.key}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                idx === 0
                  ? "border-amber-400/60 bg-amber-400/15"
                  : "border-white/10 bg-white/5"
              }`}
            >
              <span className="font-bold">
                {medals[idx] ?? `${idx + 1}.`} {p.name}
                {p.key === myKey && <span className="ml-1.5 text-xs text-amber-300/70">(you)</span>}
              </span>
              <span className={`font-mono font-black ${p.score < 0 ? "text-rose-400" : "text-amber-300"}`}>
                {fmtScore(p.score)}
              </span>
            </li>
          ))}
        </ul>
        {isHost && (
          <button
            onClick={() => socket.emit("beopardy:newGame")}
            className="mt-8 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 px-8 py-3 font-black uppercase tracking-wide text-black transition hover:scale-105"
          >
            Play again
          </button>
        )}
      </div>
    );
  }

  return <p className="text-center text-violet-100/50">Loading game…</p>;
}
