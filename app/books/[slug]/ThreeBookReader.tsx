"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, LayoutDashboard, RotateCcw, Share2, Volume2 } from "lucide-react";
import BookScene, { type BookSceneTextures } from "@/app/book/BookScene";
import { buildWraparoundCover } from "@/app/book/coverTexture";
import { CLIP_STOPS, STOPS } from "@/app/book/timeline";
import { SOUND_BUTTON_ORDER, type SoundId } from "@/app/book/sounds";
import { STORY_PAGE_COUNT } from "@/lib/bookLimits";
import type { BookPage, SharedBook } from "@/lib/books";

type BookSlot = {
  id: string;
  title: string;
  imageUrl: string;
  iconUrl: string;
  iconName: string;
  audioUrl?: string;
  audioName?: string;
};

function pageTitle(page: BookPage, index: number) {
  return page.title?.trim() || `Page ${index + 1}`;
}

export default function ThreeBookReader({ book }: { book: SharedBook }) {
  /**
   * The story pages, in order. The covers are deliberately NOT in this list:
   * they are printed on the model's single wraparound cover sheet, not on a
   * leaf, so treating the back cover as one more page put it on the last
   * left-hand leaf instead of on the back of the book.
   */
  const slots = useMemo<BookSlot[]>(
    () =>
      book.pages.slice(0, STORY_PAGE_COUNT).map((page, index) => ({
        id: page.id,
        title: pageTitle(page, index),
        imageUrl: page.imageUrl,
        iconUrl: page.iconUrl ?? page.imageUrl,
        iconName: page.iconName?.trim() || pageTitle(page, index),
        audioUrl: page.audioUrl,
        audioName: page.audioName?.trim() || pageTitle(page, index),
      })),
    [book],
  );

  /*
   * Stops mirror the demo book: 0 is the shut front cover, 1..n are the
   * printed spreads, and one stop past the last spread turns the whole book
   * over to show its back cover.
   */
  const backStop = slots.length + 1;
  const maxStop = backStop;

  /**
   * Where each stop sits on the model's timeline. `CLIP_STOPS[i]` is the pose
   * with spread `i` open, so a book of n spreads uses the first n + 1 of them
   * and then the turn-over -- the last entry of `STOPS` -- which skips the
   * demo's keepsake-pocket stop that a custom book has no page for.
   */
  const stopTimes = useMemo(
    () => [...CLIP_STOPS.slice(0, slots.length + 1), STOPS[STOPS.length - 1]],
    [slots.length],
  );
  const [stop, setStop] = useState(0);
  const [isTurning, setIsTurning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  /*
   * The front and back covers share one wraparound texture on the model, so
   * they are composited into a single image before being handed to the scene.
   * Until that finishes, the cover is left as the model shipped it rather
   * than flashing a stretched front cover across both faces.
   */
  const [wraparoundCover, setWraparoundCover] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void buildWraparoundCover(book.frontCoverUrl, book.backCoverUrl).then((url) => {
      if (!cancelled) setWraparoundCover(url);
    });
    return () => {
      cancelled = true;
    };
  }, [book.backCoverUrl, book.frontCoverUrl]);

  const textures = useMemo<BookSceneTextures>(() => {
    const buttonIcons: Partial<Record<SoundId, string>> = {};
    SOUND_BUTTON_ORDER.forEach((id, index) => {
      const slot = slots[index];
      if (slot) buttonIcons[id] = slot.iconUrl;
    });

    return {
      // `pageUrls[i]` paints material "i+1", which is spread i+1 of the model.
      coverUrl: wraparoundCover ?? undefined,
      pageUrls: slots.map((slot) => slot.imageUrl),
      buttonIcons,
    };
  }, [slots, wraparoundCover]);

  const buttonStops = useMemo(() => {
    const next = new Map<SoundId, number>();
    SOUND_BUTTON_ORDER.forEach((id, index) => {
      if (slots[index]) next.set(id, index + 1);
    });
    return next;
  }, [slots]);

  /*
   * Labels for the control bar, mirroring the demo's wording. A custom book
   * has no keepsake pocket, so the turn-over is the step after the last
   * spread rather than after the pocket.
   */
  const stopTitle = useCallback(
    (index: number) => {
      if (index === 0) return "Front cover";
      if (index === backStop) return "Back cover";
      return slots[index - 1]?.title ?? `Page ${index}`;
    },
    [backStop, slots],
  );

  const nextLabel = (index: number) => {
    if (index === 0) return "Open the book";
    if (index === backStop - 1) return "Turn over";
    return "Next page";
  };

  const previousLabel = (index: number) => {
    if (index === 1) return "Close the book";
    if (index === backStop) return "Turn back";
    return "Previous page";
  };

  const current = stop === 0 || stop === backStop ? null : (slots[stop - 1] ?? null);
  const currentTitle = stopTitle(stop);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.max(0, Math.min(maxStop, target));
      setCopied(false);
      setIsTurning(true);
      setStop(next);
      if (next === stop) setIsTurning(false);
    },
    [maxStop, stop],
  );

  const playSlotAudio = useCallback((slot: BookSlot | null) => {
    if (!slot?.audioUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(slot.audioUrl);
    audioRef.current = audio;
    // Autoplay is refused until the reader has interacted with the page; the
    // play button under the book stays available for that case.
    void audio.play().catch(() => undefined);
    setToast(slot.audioName ?? slot.title);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  /**
   * Play the page's own recording as soon as the turn lands on it, so a book
   * with voice-overs reads itself. Tracked by stop rather than in `goTo`, so
   * the page buttons, the pips, the arrow keys and the sound buttons on the
   * model all trigger it.
   */
  const spokenStop = useRef<number | null>(null);

  useEffect(() => {
    if (isTurning || spokenStop.current === stop) return;
    spokenStop.current = stop;
    const slot = stop === 0 || stop === backStop ? null : (slots[stop - 1] ?? null);
    if (!slot?.audioUrl) return;

    // Started from a timer rather than straight from the effect body: playing
    // shows a toast, and setting that synchronously would re-render the reader
    // in the same commit that settled the page turn.
    const timer = window.setTimeout(() => playSlotAudio(slot), 0);
    return () => window.clearTimeout(timer);
  }, [backStop, isTurning, playSlotAudio, slots, stop]);

  const onButton = useCallback(
    (id: SoundId) => {
      const target = buttonStops.get(id);
      if (!target) return;
      // Arriving at the page plays its voice; pressing the button for the page
      // already open replays it.
      if (target === stop) playSlotAudio(slots[target - 1] ?? null);
      else goTo(target);
    },
    [buttonStops, goTo, playSlotAudio, slots, stop],
  );

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: book.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goTo(stop - 1);
      if (event.key === "ArrowRight") goTo(stop + 1);
      if (event.key === "Home") goTo(0);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, stop]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-[#f4ecdc] text-[#26201a]">
      <BookScene
        stop={stop}
        onSettled={() => setIsTurning(false)}
        onButton={onButton}
        textures={textures}
        stopTimes={stopTimes}
      />

      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(130%_95%_at_50%_20%,transparent_58%,rgba(74,58,36,0.1)_100%)]"
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-4 p-4 sm:p-6">
        <div className="min-w-0">
          <p className="truncate text-[0.66rem] font-semibold uppercase tracking-[0.22em] text-[#8a6a45]">{book.title}</p>
          <h1 className="mt-1 text-lg font-semibold leading-tight text-[#241d15] sm:text-2xl">{currentTitle}</h1>
        </div>

        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/86 px-3 py-2 text-sm font-semibold text-[#426b55] shadow-[0_6px_18px_rgba(74,58,36,0.1)] backdrop-blur-sm transition hover:bg-white"
          >
            <LayoutDashboard aria-hidden size={16} strokeWidth={2.5} />
            Dashboard
          </Link>
          <button
            type="button"
            onClick={share}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#2c6350] px-3 py-2 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(44,99,80,0.24)] transition hover:bg-[#23513f]"
          >
            {copied ? <Copy aria-hidden size={16} /> : <Share2 aria-hidden size={16} />}
            {copied ? "Copied" : "Share"}
          </button>
          <div className="hidden rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/80 px-4 py-2 text-right shadow-[0_6px_20px_rgba(74,58,36,0.1)] backdrop-blur-sm sm:block">
            <p className="whitespace-nowrap text-sm font-semibold tabular-nums text-[#2c6350]">
              {stop > 0 && stop < backStop ? (
                <>
                  {stop}
                  <span className="font-medium text-[#9b8a70]"> / {slots.length}</span>
                </>
              ) : (
                stopTitle(stop)
              )}
            </p>
          </div>
        </div>
      </header>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 p-4 sm:p-6">
        <div aria-live="polite" className="h-8">
          {toast && (
            <p className="rounded-full bg-[#2c6350] px-4 py-1.5 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(44,99,80,0.35)]">
              {toast}
            </p>
          )}
        </div>

        {current?.audioUrl && (
          <button
            type="button"
            onClick={() => playSlotAudio(current)}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/90 px-3 py-2 text-sm font-semibold text-[#426b55] shadow-[0_6px_18px_rgba(74,58,36,0.12)] backdrop-blur-sm transition hover:bg-white"
          >
            <Volume2 aria-hidden size={16} />
            {current.audioName ?? "Play voice"}
          </button>
        )}

        <div className="pointer-events-auto flex items-center gap-3">
          {/* One pip per stop, matching the demo: cover, each spread, back cover. */}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: maxStop + 1 }, (_, index) => (
              <button
                key={index}
                type="button"
                aria-label={stopTitle(index)}
                title={stopTitle(index)}
                aria-current={index === stop}
                onClick={() => goTo(index)}
                disabled={isTurning}
                className={`h-2 cursor-pointer rounded-full transition-all duration-300 disabled:pointer-events-none ${
                  index === stop ? "w-6 bg-[#2c6350]" : "w-2 bg-[#cbbb9d] hover:bg-[#9b8a70]"
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => goTo(0)}
            disabled={isTurning || stop === 0}
            className="flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold text-[#8a6a45] transition hover:bg-[#eadfc8] active:scale-95 disabled:pointer-events-none disabled:opacity-30"
          >
            <RotateCcw aria-hidden size={13} strokeWidth={2.4} />
            Start again
          </button>
        </div>

        <nav
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-[#ddcdb0] bg-[#fdf8ee]/88 p-1.5 shadow-[0_10px_34px_rgba(74,58,36,0.18)] backdrop-blur-md sm:gap-2 sm:p-2"
          aria-label="Book pages"
        >
          <button
            type="button"
            onClick={() => goTo(stop - 1)}
            disabled={isTurning || stop === 0}
            className="flex h-12 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full pl-2.5 pr-4 text-sm font-semibold text-[#2c6350] transition hover:bg-[#eadfc8] active:scale-95 disabled:pointer-events-none disabled:opacity-35 sm:pl-3.5 sm:pr-5 sm:text-base"
          >
            <ChevronLeft aria-hidden size={20} strokeWidth={2.4} />
            {previousLabel(stop)}
          </button>

          <button
            type="button"
            onClick={() => goTo(stop + 1)}
            disabled={isTurning || stop === maxStop}
            className="flex h-12 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-[#2c6350] pl-4 pr-2.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(44,99,80,0.3)] transition hover:bg-[#23513f] active:scale-95 disabled:pointer-events-none disabled:opacity-40 sm:pl-5 sm:pr-3.5 sm:text-base"
          >
            {nextLabel(stop)}
            <ChevronRight aria-hidden size={20} strokeWidth={2.4} />
          </button>
        </nav>
      </div>
    </main>
  );
}
