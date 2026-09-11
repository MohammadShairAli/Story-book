"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  PartyPopper,
  RotateCcw,
  Ticket,
} from "lucide-react";
import BookScene from "./book/BookScene";
import { hintAt, nextLabel, previousLabel, type Hint } from "./book/guide";
import { clearPhoto, loadPhoto, savePhoto } from "./book/photo";
import { SOUNDS, decalUrl, playSound, type SoundId } from "./book/sounds";
import {
  FIRST_STOP,
  LAST_STOP,
  POCKET_STOP,
  SPREAD_COUNT,
  clampStop,
  labelAt,
} from "./book/timeline";

function Loader({ active }: { active: boolean }) {
  const { progress } = useProgress();
  const percent = Math.min(100, Math.round(progress));

  return (
    <div
      aria-hidden={!active}
      className={`absolute inset-0 z-30 flex items-center justify-center bg-[#f4ecdc] transition-opacity duration-700 ${
        active ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div className="w-60 text-center">
        <BookOpen aria-hidden size={28} strokeWidth={1.6} className="mx-auto mb-5 text-[#2c6350]" />
        <p className="text-sm font-medium tracking-wide text-[#3b3225]">Opening the book</p>
        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-[#ddd0b6]">
          <div
            className="h-full rounded-full bg-[#2c6350] transition-[width] duration-300 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-3 text-xs tabular-nums text-[#8a7a61]">{percent}%</p>
      </div>
    </div>
  );
}

function HintIcon({ hint }: { hint: Hint }) {
  if (hint.sound) {
    // The same decal as the button on the book, so it is easy to find.
    return (
      <span
        aria-hidden
        className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center shadow-[0_2px_6px_rgba(74,58,36,0.25)]"
        style={{ backgroundImage: `url(${decalUrl(hint.sound)})` }}
      />
    );
  }

  const Icon = hint.icon === "pocket" ? Ticket : hint.icon === "end" ? PartyPopper : BookOpen;
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e3efe9] text-[#2c6350]"
    >
      <Icon size={18} strokeWidth={2.2} />
    </span>
  );
}

export default function BookExperience() {
  const [stop, setStop] = useState(FIRST_STOP);
  const [isTurning, setIsTurning] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [toast, setToast] = useState<{ id: SoundId; key: number } | null>(null);
  // The keepsake photo lives in localStorage; nothing about it is prerendered.
  const [photo, setPhoto] = useState<string | null>(() => loadPhoto());

  const changePhoto = useCallback((next: string | null) => {
    if (next) {
      if (!savePhoto(next)) return false;
    } else {
      clearPhoto();
    }
    setPhoto(next);
    return true;
  }, []);

  const { active, progress } = useProgress();
  useEffect(() => {
    if (active || progress < 100) return;
    const timer = window.setTimeout(() => setIsReady(true), 400);
    return () => window.clearTimeout(timer);
  }, [active, progress]);

  /** Sound to play again once the book lands on the page it is flipping to. */
  const arrivalSound = useRef<SoundId | null>(null);
  const toastCount = useRef(0);

  /** Returns whether the book has to move. Any new trip cancels a pending arrival sound. */
  const goTo = useCallback(
    (next: number) => {
      const target = clampStop(next);
      if (target === stop) return false;
      arrivalSound.current = null;
      setIsTurning(true);
      setStop(target);
      return true;
    },
    [stop],
  );

  const turn = useCallback((delta: number) => goTo(stop + delta), [goTo, stop]);

  const announce = useCallback((id: SoundId) => {
    playSound(id);
    toastCount.current += 1;
    setToast({ id, key: toastCount.current });
  }, []);

  const onSettled = useCallback(() => {
    setIsTurning(false);
    const id = arrivalSound.current;
    arrivalSound.current = null;
    if (id) announce(id);
  }, [announce]);

  const onButton = useCallback(
    (id: SoundId) => {
      announce(id);
      // The button's icon is printed on one spread: flip through to it, and
      // play the sound again on arrival. Pressing it while the book is
      // already heading to that page keeps the arrival sound queued.
      const { page } = SOUNDS[id];
      if (goTo(page) || (isTurning && page === stop)) arrivalSound.current = id;
    },
    [announce, goTo, isTurning, stop],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") turn(1);
      if (event.key === "ArrowLeft") turn(-1);
      if (event.key === "Home") goTo(FIRST_STOP);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, turn]);

  const label = labelAt(stop);
  const hint = hintAt(stop);
  const canGoBack = stop > FIRST_STOP;
  const canGoForward = stop < LAST_STOP;

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#f4ecdc] text-[#26201a]">
      <BookScene
        stop={stop}
        onSettled={onSettled}
        onButton={onButton}
        photo={photo}
        onPhotoChange={changePhoto}
        photoControls={stop === POCKET_STOP && !isTurning}
      />

      {/* Warm vignette, so the book sits in the page rather than on top of it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(130%_95%_at_50%_20%,transparent_58%,rgba(74,58,36,0.1)_100%)]"
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-5 sm:p-7">
        <div>
          <p className="text-[0.66rem] font-semibold uppercase tracking-[0.28em] text-[#8a6a45]">
            My First Football Match
          </p>
          <h1 className="mt-1.5 text-xl font-semibold leading-tight text-[#241d15] sm:text-2xl">
            Turn the page
          </h1>
        </div>

        <div className="rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/80 px-4 py-2 text-right shadow-[0_6px_20px_rgba(74,58,36,0.1)] backdrop-blur-sm">
          <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-[#2c6350]">
            {label.kind === "spread" ? (
              <>
                {label.spread}
                <span className="font-medium text-[#9b8a70]"> / {SPREAD_COUNT}</span>
              </>
            ) : (
              label.title
            )}
          </p>
        </div>
      </header>

      {/* What to do on this page. Shown once the book has settled. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-[5.25rem] z-20 flex justify-center px-4 lg:top-7"
      >
        {isReady && !isTurning && (
          <p
            key={stop}
            className="flex max-w-md animate-[hint_0.45s_ease-out] items-center gap-3 rounded-2xl border border-[#ddcdb0] bg-[#fdf8ee]/92 py-2 pl-2 pr-4 text-sm font-medium leading-snug text-[#3b3225] shadow-[0_8px_26px_rgba(74,58,36,0.14)] backdrop-blur-sm sm:text-base"
          >
            <HintIcon hint={hint} />
            <span>{hint.text}</span>
          </p>
        )}
      </div>

      {/* Controls sit under the book, clear of the model itself. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 p-4 sm:p-6">
        <div className="relative flex flex-col items-center gap-3">
          <div
            aria-live="polite"
            className="pointer-events-none absolute bottom-full left-1/2 mb-3 -translate-x-1/2 whitespace-nowrap"
          >
            {toast && (
              <p
                key={toast.key}
                className="animate-[toast_1.6s_ease-out_forwards] rounded-full bg-[#2c6350] px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(44,99,80,0.35)]"
              >
                {SOUNDS[toast.id].label}
              </p>
            )}
          </div>

          <div className="pointer-events-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              {Array.from({ length: LAST_STOP + 1 }, (_, index) => {
                const pip = labelAt(index);
                return (
                  <button
                    key={index}
                    type="button"
                    aria-label={pip.title}
                    data-stop={index}
                    aria-current={index === stop}
                    onClick={() => goTo(index)}
                    disabled={isTurning}
                    className={`h-2 cursor-pointer rounded-full transition-all duration-300 disabled:pointer-events-none ${
                      index === stop ? "w-6 bg-[#2c6350]" : "w-2 bg-[#cbbb9d] hover:bg-[#9b8a70]"
                    }`}
                  />
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => goTo(FIRST_STOP)}
              disabled={isTurning || stop === FIRST_STOP}
              className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold text-[#8a6a45] transition hover:bg-[#eadfc8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
            >
              <RotateCcw aria-hidden size={13} strokeWidth={2.4} />
              Start again
            </button>
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/88 p-1.5 shadow-[0_10px_34px_rgba(74,58,36,0.18)] backdrop-blur-md sm:gap-2 sm:p-2">
            <button
              type="button"
              onClick={() => turn(-1)}
              disabled={isTurning || !canGoBack}
              className="cursor-pointer flex h-12 items-center gap-1 whitespace-nowrap rounded-full pl-2.5 pr-4 text-sm font-semibold text-[#2c6350] transition hover:bg-[#eadfc8] active:scale-95 disabled:pointer-events-none disabled:opacity-35 sm:pl-3.5 sm:pr-5 sm:text-base"
            >
              <ChevronLeft aria-hidden size={20} strokeWidth={2.4} />
              {previousLabel(stop)}
            </button>

            <button
              type="button"
              onClick={() => turn(1)}
              disabled={isTurning || !canGoForward}
              className="cursor-pointer flex h-12 items-center gap-1 whitespace-nowrap rounded-full bg-[#2c6350] pl-4 pr-2.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(44,99,80,0.3)] transition hover:bg-[#23513f] active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:pl-5 sm:pr-3.5 sm:text-base"
            >
              {nextLabel(stop)}
              <ChevronRight aria-hidden size={20} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        <p className="px-4 text-center text-[0.7rem] tracking-wide text-[#9b8a70]">
          Tap the sound buttons &middot; drag to look around &middot; arrow keys to turn
        </p>
      </div>

      <Loader active={!isReady} />
    </main>
  );
}
