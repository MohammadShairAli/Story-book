"use client";
/* eslint-disable @next/next/no-img-element -- Supabase URLs are dynamic and creator previews use blob URLs. */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, Share2 } from "lucide-react";
import type { SharedBook } from "@/lib/books";

type Sheet = {
  id: string;
  label: string;
  imageUrl: string;
  kind: "cover" | "page" | "back";
};

export default function BookReader({ book }: { book: SharedBook }) {
  const sheets = useMemo<Sheet[]>(
    () => [
      { id: "front", label: "Front cover", imageUrl: book.frontCoverUrl, kind: "cover" },
      ...book.pages.map((page, index) => ({
        id: page.id,
        label: `Page ${index + 1}`,
        imageUrl: page.imageUrl,
        kind: "page" as const,
      })),
      { id: "back", label: "Back cover", imageUrl: book.backCoverUrl, kind: "back" },
    ],
    [book],
  );
  const [current, setCurrent] = useState(0);
  const [copied, setCopied] = useState(false);
  const sheet = sheets[current];
  const isFirst = current === 0;
  const isLast = current === sheets.length - 1;

  const previous = () => setCurrent((index) => Math.max(0, index - 1));
  const next = () => setCurrent((index) => Math.min(sheets.length - 1, index + 1));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setCurrent((index) => Math.max(0, index - 1));
      if (event.key === "ArrowRight") setCurrent((index) => Math.min(sheets.length - 1, index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheets.length]);

  const share = async () => {
    const shareData = { title: book.title, url: window.location.href };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Dismissing the native share dialog is not an error the reader needs to see.
    }
  };

  return (
    <main className="h-[100dvh] overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,#fffaf0_0%,#f4ecdc_48%,#e8d9c1_100%)] px-4 py-5 text-[#33261c] sm:px-7 sm:py-7">
      <div className="mx-auto flex min-h-full max-w-6xl flex-col">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Link href="/create" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#426b55] transition hover:text-[#2f513f]">
              <ArrowLeft size={16} />
              Create your own
            </Link>
            <h1 className="mt-2 truncate text-xl font-semibold text-[#2d2117] sm:text-2xl">{book.title}</h1>
          </div>
          <button type="button" onClick={share} className="inline-flex shrink-0 items-center gap-2 rounded-full border border-[#cdbb9e] bg-[#fffaf0]/80 px-3.5 py-2 text-sm font-semibold text-[#426b55] shadow-[0_4px_14px_rgba(84,60,31,0.08)] backdrop-blur-sm transition hover:bg-white">
            {copied ? <Copy size={16} /> : <Share2 size={16} />}
            {copied ? "Copied" : "Share"}
          </button>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center py-7 sm:py-10" aria-label={`${book.title}, ${sheet.label}`}>
          <div className="relative w-full max-w-md [perspective:1600px] sm:max-w-lg">
            <div aria-hidden className="absolute inset-y-3 -left-3 -right-3 rounded-[2rem] bg-[#8e6949]/20 blur-xl" />
            <article key={sheet.id} className="relative aspect-[3/4] overflow-hidden rounded-r-[1.4rem] rounded-l-md border border-[#c7ad88] bg-[#fffaf0] shadow-[-6px_6px_0_#d6c09f,0_22px_50px_rgba(78,54,30,0.27)] animate-[book-page-in_320ms_ease-out]">
              <span aria-hidden className="absolute inset-y-0 left-0 z-10 w-5 bg-[linear-gradient(90deg,rgba(69,43,22,0.22),transparent)]" />
              <img src={sheet.imageUrl} alt={`${book.title} — ${sheet.label}`} className="h-full w-full object-contain bg-[#f7efdf]" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-[linear-gradient(transparent,rgba(30,23,16,0.72))] px-5 pb-4 pt-12 text-sm font-semibold text-white">
                <span>{sheet.kind === "cover" ? book.title : sheet.label}</span>
                <span>{current + 1} / {sheets.length}</span>
              </div>
            </article>
          </div>

          <nav className="mt-7 flex items-center gap-3" aria-label="Book pages">
            <button type="button" onClick={previous} disabled={isFirst} className="inline-flex h-12 items-center gap-1 rounded-full border border-[#cdbb9e] bg-[#fffaf0] px-4 text-sm font-semibold text-[#426b55] shadow-[0_4px_14px_rgba(84,60,31,0.08)] transition hover:bg-white disabled:pointer-events-none disabled:opacity-40">
              <ChevronLeft size={20} />
              Previous
            </button>
            <div className="flex max-w-32 items-center gap-1 overflow-hidden">
              {sheets.map((item, index) => (
                <button key={item.id} type="button" onClick={() => setCurrent(index)} aria-label={`Go to ${item.label}`} aria-current={index === current} className={`h-2 shrink-0 rounded-full transition-all ${index === current ? "w-5 bg-[#426b55]" : "w-2 bg-[#cdbb9e] hover:bg-[#a98962]"}`} />
              ))}
            </div>
            <button type="button" onClick={next} disabled={isLast} className="inline-flex h-12 items-center gap-1 rounded-full bg-[#426b55] px-4 text-sm font-semibold text-white shadow-[0_5px_16px_rgba(46,88,65,0.25)] transition hover:bg-[#2f513f] disabled:pointer-events-none disabled:opacity-40">
              Next
              <ChevronRight size={20} />
            </button>
          </nav>
          <p className="mt-4 text-center text-xs text-[#8c745b]">Use the arrows or your keyboard’s left and right keys to turn pages.</p>
        </section>
      </div>
    </main>
  );
}
