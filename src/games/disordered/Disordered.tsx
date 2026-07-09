"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GameProps } from "../registry";
import type { Member } from "@/lib/socket";
import { playSwap, playFanfare } from "@/lib/sounds";

interface PlayerProgress {
  attempts: number;
  solved: boolean;
  solvedAt: number | null;
}

interface DisorderedState {
  mode?: string;
  phase?: "setup" | "playing" | "revealed";
  n?: number;
  palette?: string[];
  roundId?: number;
  hostId?: string | null;
  players?: Record<string, PlayerProgress>;
  answer?: string[] | null;
}

interface GuessRow {
  order: string[];
  correct: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const LENGTHS = [4, 5, 6, 7, 8];
const MEDALS = ["🥇", "🥈", "🥉"];

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      {open ? <path d="M8 11V7a4 4 0 0 1 7.6-1.8" /> : <path d="M8 11V7a4 4 0 0 1 8 0v4" />}
    </svg>
  );
}

export default function Disordered({ socket, me, members, game }: GameProps) {
  const g = game as DisorderedState;
  const phase = g.phase ?? "setup";
  const palette = g.palette ?? [];
  const n = g.n ?? 5;
  const roundId = g.roundId ?? 0;
  const players = g.players ?? {};
  const isHost = !!me && g.hostId === me.id;

  const [setupN, setSetupN] = useState(5);
  const [board, setBoard] = useState<string[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null); // slot being dragged
  const [dragOver, setDragOver] = useState<number | null>(null); // slot hovered as drop target
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<GuessRow[]>([]);
  const [solved, setSolved] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [shakingRowIdx, setShakingRowIdx] = useState<number | null>(null);
  const [shakeBtn, setShakeBtn] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the board + history whenever a new round begins.
  useEffect(() => {
    if (phase === "playing" && palette.length) {
      setBoard(shuffle(palette));
      setHistory([]);
      setSelected(null);
      setSolved(false);
      setLocked(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, phase]);

  // Private feedback for my own guesses.
  useEffect(() => {
    function onFeedback(p: {
      roundId: number;
      order: string[];
      correct: number;
      solved: boolean;
    }) {
      setHistory((h) => [{ order: p.order, correct: p.correct }, ...h]);
      if (p.solved) setSolved(true);
    }
    function onSolved(p: { id: string }) {
      const who = members.find((m) => m.id === p.id);
      if (who && who.id !== me?.id) {
        setToast(`${who.name} cracked it!`);
        setTimeout(() => setToast(null), 2500);
      }
    }
    socket.on("disordered:feedback", onFeedback);
    socket.on("disordered:solved", onSolved);
    return () => {
      socket.off("disordered:feedback", onFeedback);
      socket.off("disordered:solved", onSolved);
    };
  }, [socket, members, me?.id]);

  // Fanfare the moment YOU crack the order.
  useEffect(() => {
    if (solved) playFanfare();
  }, [solved]);

  const leaderboard = useMemo(() => {
    return members
      .map((m: Member) => ({
        member: m,
        ...(players[m.id] ?? { attempts: 0, solved: false, solvedAt: null }),
      }))
      .sort((a, b) => {
        if (a.solved && b.solved) return (a.solvedAt ?? 0) - (b.solvedAt ?? 0);
        if (a.solved) return -1;
        if (b.solved) return 1;
        return a.attempts - b.attempts;
      });
  }, [members, players]);

  const myPlace = useMemo(() => {
    const solvedOrder = leaderboard.filter((r) => r.solved);
    return solvedOrder.findIndex((r) => r.member.id === me?.id);
  }, [leaderboard, me?.id]);

  function swap(a: number, b: number) {
    playSwap();
    setBoard((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }

  function toggleLock(i: number) {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    if (selected === i) setSelected(null);
  }

  function clickSlot(i: number) {
    if (suppressClick.current || solved || locked.has(i)) return;
    if (selected === null) {
      setSelected(i);
    } else if (selected === i) {
      setSelected(null);
    } else {
      swap(i, selected);
      setSelected(null);
    }
  }

  // Drag-to-swap via Pointer Events (works for mouse AND touch). The order
  // never changes while dragging: the source slot grays out, the hovered slot
  // highlights as the drop target, a ghost of the emoji follows the pointer,
  // and the swap commits only on release over a valid slot.
  const dragSession = useRef<{
    from: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const [ghost, setGhost] = useState<{ x: number; y: number; emoji: string } | null>(null);

  function slotIndexAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y);
    const slotEl = el?.closest?.("[data-slot]");
    if (!slotEl) return null;
    const idx = Number(slotEl.getAttribute("data-slot"));
    return Number.isNaN(idx) ? null : idx;
  }

  function onSlotPointerDown(e: React.PointerEvent, i: number) {
    if (solved || locked.has(i)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragSession.current = { from: i, startX: e.clientX, startY: e.clientY, active: false };
    const emoji = board[i];

    const onMove = (ev: PointerEvent) => {
      const st = dragSession.current;
      if (!st) return;
      if (!st.active) {
        // Don't treat a plain tap as a drag — require a little movement.
        if (Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY) < 6) return;
        st.active = true;
        setDragIndex(st.from);
        setSelected(null);
      }
      setGhost({ x: ev.clientX, y: ev.clientY, emoji });
      const idx = slotIndexAt(ev.clientX, ev.clientY);
      setDragOver(idx !== null && idx !== st.from && !locked.has(idx) ? idx : null);
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      const st = dragSession.current;
      dragSession.current = null;
      setGhost(null);
      if (st?.active) {
        // A real drag happened — swallow the click that follows pointerup.
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        if (ev.type === "pointerup") {
          const idx = slotIndexAt(ev.clientX, ev.clientY);
          if (idx !== null && idx !== st.from && !locked.has(idx)) {
            swap(st.from, idx);
          }
        }
        setDragIndex(null);
        setDragOver(null);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function submit() {
    if (solved || board.length !== n) return;
    const dup = history.findIndex((r) => r.order.join(",") === board.join(","));
    if (dup >= 0) {
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
      setShakingRowIdx(null);
      setShakeBtn(false);
      requestAnimationFrame(() => {
        setShakingRowIdx(dup);
        setShakeBtn(true);
        shakeTimerRef.current = setTimeout(() => {
          setShakingRowIdx(null);
          setShakeBtn(false);
        }, 600);
      });
      return;
    }
    socket.emit("disordered:guess", { order: board });
  }

  // ---- Setup / waiting ---------------------------------------------------
  if (phase === "setup") {
    return (
      <div className="mx-auto max-w-md text-center">
        <div className="mb-4 text-5xl">🔀</div>
        {isHost ? (
          <>
            <h2 className="mb-2 text-2xl font-black">Set up the round</h2>
            <p className="mb-6 text-violet-100/60">
              Pick how many emojis go in the blind box. Everyone races the same
              hidden order.
            </p>
            <div className="mb-6 flex justify-center gap-2">
              {LENGTHS.map((len) => (
                <button
                  key={len}
                  onClick={() => setSetupN(len)}
                  className={`h-12 w-12 rounded-xl border text-lg font-bold transition ${
                    setupN === len
                      ? "border-sky-400 bg-sky-400/20 text-white"
                      : "border-white/10 bg-white/5 text-violet-100/60 hover:bg-white/10"
                  }`}
                >
                  {len}
                </button>
              ))}
            </div>
            <button
              onClick={() => socket.emit("disordered:start", { n: setupN })}
              className="rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 px-8 py-4 text-lg font-black uppercase tracking-wide shadow-lg transition hover:scale-105"
            >
              Start round
            </button>
          </>
        ) : (
          <>
            <h2 className="mb-2 text-2xl font-black">Waiting for the host…</h2>
            <p className="text-violet-100/60">
              The host is choosing a difficulty. Hang tight!
            </p>
          </>
        )}
      </div>
    );
  }

  // ---- Playing / revealed ------------------------------------------------
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_200px]">
      <div>
        {toast && (
          <div className="mb-4 animate-pop-in rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2 text-center text-sky-200">
            🎉 {toast}
          </div>
        )}

        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-100/40">
          {solved
            ? "Solved!"
            : selected !== null
              ? "Tap another slot to swap"
              : `Drag or tap to swap · guess #${(players[me?.id ?? ""]?.attempts ?? 0) + 1}`}
        </p>

        {/* Board */}
        <div
          className="mb-4 mt-8 grid gap-2"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {board.map((emoji, i) => {
            const isLocked = locked.has(i);
            const isSource = dragIndex === i; // tile being dragged — grayed out
            const isTarget = dragOver === i; // hovered drop slot — blue
            const highlighted = isTarget || selected === i;
            return (
              <div key={i} className="relative aspect-square w-full">
                <div
                  role="button"
                  data-slot={i}
                  onClick={() => clickSlot(i)}
                  onPointerDown={(e) => onSlotPointerDown(e, i)}
                  className={`flex h-full w-full touch-none select-none items-center justify-center rounded-xl border-2 text-2xl transition sm:text-3xl ${
                    isLocked
                      ? "border-amber-400/60 bg-amber-400/10 cursor-default"
                      : highlighted
                        ? "-translate-y-1 border-sky-400 bg-sky-400/20 cursor-grab active:cursor-grabbing"
                        : "border-white/10 bg-white/5 hover:border-white/30 cursor-grab active:cursor-grabbing"
                  } ${isSource ? "opacity-40 grayscale" : ""} ${solved ? "!cursor-default" : ""}`}
                >
                  {emoji}
                </div>
                {!solved && (
                  <button
                    type="button"
                    draggable={false}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLock(i);
                    }}
                    title={isLocked ? "Locked — click to unlock" : "Lock this position"}
                    className={`absolute bottom-full left-1/2 z-10 mb-2 grid h-6 w-6 -translate-x-1/2 touch-manipulation place-items-center rounded-md border transition sm:h-5 sm:w-5 ${
                      isLocked
                        ? "border-amber-400/60 bg-amber-400/25 text-amber-300"
                        : "border-white/10 bg-black/40 text-white/30 hover:text-white/80"
                    }`}
                  >
                    <LockIcon open={!isLocked} />
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Floating ghost of the emoji being dragged (mouse + touch) */}
        {ghost && (
          <div
            className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[80%] text-4xl drop-shadow-xl"
            style={{ left: ghost.x, top: ghost.y }}
          >
            {ghost.emoji}
          </div>
        )}

        {!solved && (
          <div>
            <button
              onClick={submit}
              className={`rounded-2xl bg-gradient-to-br from-sky-500 to-violet-500 px-8 py-3 text-lg font-black uppercase tracking-wide shadow-lg transition hover:scale-105 active:scale-95${shakeBtn ? " animate-shake" : ""}`}
            >
              Submit guess
            </button>
            {shakeBtn && (
              <p className="mt-2 text-sm font-semibold text-red-400">Already guessed!</p>
            )}
          </div>
        )}

        {solved && (
          <div className="animate-pop-in rounded-2xl border border-sky-400/30 bg-sky-400/10 p-5">
            <p className="text-2xl font-black text-sky-200">
              🎉 Cracked it in {players[me?.id ?? ""]?.attempts ?? "?"} guesses!
            </p>
            {myPlace >= 0 && (
              <p className="mt-1 text-violet-100/70">
                You finished {MEDALS[myPlace] ?? `#${myPlace + 1}`}
              </p>
            )}
          </div>
        )}

        {/* Revealed answer */}
        {phase === "revealed" && g.answer && (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="mb-2 text-sm uppercase tracking-wide text-violet-100/40">
              Answer
            </p>
            <div className="flex gap-2 text-3xl">
              {g.answer.map((e, i) => (
                <span key={i}>{e}</span>
              ))}
            </div>
          </div>
        )}

        {/* Guess history */}
        {history.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-violet-100/40">
              Your guesses
            </p>
            <ul className="flex flex-col gap-2">
              {history.map((row, idx) => (
                <li
                  key={idx}
                  className={`flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2${shakingRowIdx === idx ? " animate-shake" : ""}`}
                >
                  <span className="flex gap-1 text-2xl">
                    {row.order.map((e, i) => (
                      <span key={i}>{e}</span>
                    ))}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-bold ${
                      row.correct === n
                        ? "bg-emerald-400/20 text-emerald-200"
                        : "bg-white/10 text-violet-100/70"
                    }`}
                  >
                    {row.correct === n ? "✅ " : ""}
                    {row.correct}/{n}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Host controls */}
        {isHost && (phase === "playing" || phase === "revealed") && (
          <div className="mt-8 flex flex-wrap gap-2 border-t border-white/10 pt-4">
            <button
              onClick={() => socket.emit("disordered:newRound", { n })}
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/20"
            >
              New round
            </button>
            {phase === "playing" && (
              <button
                onClick={() => socket.emit("disordered:reveal")}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-violet-100/60 transition hover:bg-white/10"
              >
                Reveal answer
              </button>
            )}
          </div>
        )}
      </div>

      {/* Leaderboard */}
      <aside>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-violet-100/40">
          Race
        </h3>
        <ul className="flex flex-col gap-2">
          {leaderboard.map((row, idx) => (
            <li
              key={row.member.id}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              <span className="truncate">
                {row.solved ? (MEDALS[idx] ?? "✅") : "•"} {row.member.name}
                {row.member.id === me?.id && (
                  <span className="ml-1 text-xs text-sky-300/70">(you)</span>
                )}
              </span>
              <span className="shrink-0 text-violet-100/50">{row.attempts}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-violet-100/30">guesses so far</p>
      </aside>
    </div>
  );
}
