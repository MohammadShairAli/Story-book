"use client";
/* eslint-disable @next/next/no-img-element -- local object URLs cannot be rendered by next/image. */

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, GripVertical, ImagePlus, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { MAX_STORY_PAGE_COUNT, MAX_TOTAL_BOOK_PAGES } from "@/lib/bookLimits";

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

function makeImage(file: File): SelectedImage {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function CoverPicker({
  label,
  image,
  onPick,
  onRemove,
}: {
  label: string;
  image: SelectedImage | null;
  onPick: (file: File | null) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);

  return (
    <section className="rounded-lg border border-[#dfd0b7] bg-[#fffaf0] p-3 shadow-[0_6px_18px_rgba(84,60,31,0.07)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[#35281d]">{label}</h2>
          <p className="text-[11px] text-[#8c745b]">Required</p>
        </div>
        {image && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md p-1.5 text-[#9a644a] transition hover:bg-[#f7e7dc]"
            aria-label={`Remove ${label.toLowerCase()}`}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative flex aspect-[3/4] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#cbb38f] bg-[#f7efdf] text-center transition hover:border-[#426b55] hover:bg-[#edf4ed]"
      >
        {image ? (
          <img src={image.previewUrl} alt={`${label} preview`} className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 px-3 text-xs font-medium text-[#71604a]">
            <ImagePlus size={21} className="text-[#426b55]" />
            Upload image
          </span>
        )}
        {image && (
          <span className="absolute inset-x-2 bottom-2 rounded-md bg-[#2f513f]/90 px-2 py-1.5 text-[11px] font-semibold text-white opacity-0 transition group-hover:opacity-100">
            Replace image
          </span>
        )}
      </button>
      <input
        ref={input}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
    </section>
  );
}

export default function BookCreator() {
  const [title, setTitle] = useState("");
  const [frontCover, setFrontCover] = useState<SelectedImage | null>(null);
  const [backCover, setBackCover] = useState<SelectedImage | null>(null);
  const [pages, setPages] = useState<SelectedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const objectUrls = useRef(new Set<string>());

  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const selectImage = (file: File | null) => {
    if (!file) return null;
    const image = makeImage(file);
    objectUrls.current.add(image.previewUrl);
    return image;
  };

  const discard = (image: SelectedImage | null) => {
    if (!image) return;
    URL.revokeObjectURL(image.previewUrl);
    objectUrls.current.delete(image.previewUrl);
  };

  const replaceCover = (cover: "front" | "back", file: File | null) => {
    const image = selectImage(file);
    if (!image) return;
    setShareUrl(null);
    if (cover === "front") {
      discard(frontCover);
      setFrontCover(image);
    } else {
      discard(backCover);
      setBackCover(image);
    }
  };

  const addPages = (event: ChangeEvent<HTMLInputElement>) => {
    const capacity = Math.max(0, MAX_STORY_PAGE_COUNT - pages.length);
    const files = Array.from(event.target.files ?? []);
    const selected = files.slice(0, capacity).map(selectImage).filter((image): image is SelectedImage => !!image);
    if (files.length > capacity) {
      setError(`Only ${MAX_STORY_PAGE_COUNT} story pages are allowed because the front/back cover counts as one page.`);
    }
    if (selected.length) {
      setPages((current) => [...current, ...selected]);
      setShareUrl(null);
      if (files.length <= capacity) setError(null);
    }
    event.currentTarget.value = "";
  };

  const removePage = (id: string) => {
    const image = pages.find((page) => page.id === id) ?? null;
    discard(image);
    setPages((current) => current.filter((page) => page.id !== id));
    setShareUrl(null);
  };

  const movePage = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= pages.length) return;
    setPages((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setShareUrl(null);
  };

  const saveBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setCopied(false);
    if (!frontCover || !backCover || pages.length === 0) {
      setError("Add a front cover, at least one story page, and a back cover.");
      return;
    }
    if (pages.length > MAX_STORY_PAGE_COUNT) {
      setError(`Only ${MAX_TOTAL_BOOK_PAGES} pages are allowed in total, including the front/back cover sheet.`);
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.set("title", title);
      form.set("frontCover", frontCover.file);
      form.set("backCover", backCover.file);
      pages.forEach((page) => form.append("pages", page.file));

      const response = await fetch("/api/books", { method: "POST", body: form });
      const result: { error?: string; url?: string } = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error ?? "Unable to create the book.");
      setShareUrl(new URL(result.url, window.location.origin).toString());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the book.");
    } finally {
      setSaving(false);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Could not copy the link. Please copy it from the address shown below.");
    }
  };

  return (
    <main className="h-[100dvh] overflow-y-auto bg-[#f4ecdc] px-4 py-4 text-[#33261c] sm:px-6 sm:py-6">
      <div className="mx-auto max-w-4xl pb-8">
        <Link href="/" className="inline-flex items-center gap-2 text-xs font-semibold text-[#426b55] transition hover:text-[#2f513f]">
          <ArrowLeft size={15} />
          View the demo book
        </Link>

        <div className="mt-4 max-w-2xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9a704a]">Book creator</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#2d2117] sm:text-3xl">Make a book worth sharing.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#705f4c]">
            Add a front cover, arrange the image pages, and finish with a back cover. Saving creates one unlisted, shareable link.
          </p>
        </div>

        <form onSubmit={saveBook} className="mt-5 space-y-4">
          <section className="rounded-lg border border-[#dfd0b7] bg-[#fffaf0] p-4 shadow-[0_8px_22px_rgba(84,60,31,0.07)]">
            <label htmlFor="book-title" className="text-sm font-semibold text-[#493a2c]">
              Book title
            </label>
            <input
              id="book-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setShareUrl(null);
              }}
              maxLength={100}
              required
              placeholder="e.g. Our summer adventure"
              className="mt-2 w-full rounded-lg border border-[#d9c7aa] bg-white px-3 py-2 text-base outline-none transition placeholder:text-[#a79780] focus:border-[#426b55] focus:ring-3 focus:ring-[#d9eadc]"
            />
          </section>

          <section className="grid max-w-md grid-cols-2 gap-4">
            <CoverPicker
              label="Front cover"
              image={frontCover}
              onPick={(file) => replaceCover("front", file)}
              onRemove={() => {
                discard(frontCover);
                setFrontCover(null);
                setShareUrl(null);
              }}
            />
            <CoverPicker
              label="Back cover"
              image={backCover}
              onPick={(file) => replaceCover("back", file)}
              onRemove={() => {
                discard(backCover);
                setBackCover(null);
                setShareUrl(null);
              }}
            />
          </section>

          <section className="rounded-lg border border-[#dfd0b7] bg-[#fffaf0] p-4 shadow-[0_8px_22px_rgba(84,60,31,0.07)]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#35281d]">Story pages</h2>
                <p className="mt-0.5 text-xs text-[#806e58]">
                  Choose up to {MAX_STORY_PAGE_COUNT} story pages. The front and back cover count as one page; 6 pages total.
                </p>
              </div>
              <label
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(46,88,65,0.22)] transition ${
                  pages.length >= MAX_STORY_PAGE_COUNT ? "cursor-not-allowed bg-[#9aa79d] opacity-70" : "cursor-pointer bg-[#426b55] hover:bg-[#2f513f]"
                }`}
                aria-disabled={pages.length >= MAX_STORY_PAGE_COUNT}
              >
                <Plus size={17} />
                Add pages
                <input type="file" multiple accept={IMAGE_ACCEPT} className="sr-only" onChange={addPages} disabled={pages.length >= MAX_STORY_PAGE_COUNT} />
              </label>
            </div>

            {pages.length === 0 ? (
              <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#cbb38f] bg-[#f7efdf] px-4 text-center transition hover:border-[#426b55] hover:bg-[#edf4ed]">
                <ImagePlus size={24} className="text-[#426b55]" />
                <span className="mt-2 text-sm font-semibold text-[#5c4b38]">Upload your first page</span>
                <span className="mt-1 text-sm text-[#8c745b]">JPG, PNG, WebP, or AVIF</span>
                <input type="file" multiple accept={IMAGE_ACCEPT} className="sr-only" onChange={addPages} />
              </label>
            ) : (
              <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pages.map((page, index) => (
                  <li key={page.id} className="flex overflow-hidden rounded-lg border border-[#dfd0b7] bg-white">
                    <img src={page.previewUrl} alt={`Page ${index + 1} preview`} className="h-20 w-16 shrink-0 object-cover" />
                    <div className="flex min-w-0 flex-1 flex-col justify-between p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-[#493a2c]">Page {index + 1}</p>
                        <GripVertical size={15} className="text-[#b29e83]" aria-hidden />
                      </div>
                      <p className="truncate text-xs text-[#8c745b]">{page.file.name}</p>
                      <div className="mt-1.5 flex items-center gap-1">
                        <button type="button" onClick={() => movePage(index, -1)} disabled={index === 0} className="rounded-lg px-2 py-1 text-xs font-bold text-[#426b55] hover:bg-[#edf4ed] disabled:opacity-30">
                          Up
                        </button>
                        <button type="button" onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} className="rounded-lg px-2 py-1 text-xs font-bold text-[#426b55] hover:bg-[#edf4ed] disabled:opacity-30">
                          Down
                        </button>
                        <button type="button" onClick={() => removePage(page.id)} className="ml-auto rounded-lg p-1.5 text-[#a55d4b] hover:bg-[#f7e7dc]" aria-label={`Remove page ${index + 1}`}>
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {error && <p role="alert" className="rounded-lg border border-[#edc6bc] bg-[#fff0ed] px-3 py-2 text-sm font-medium text-[#9a3f31]">{error}</p>}

          <button type="submit" disabled={saving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f513f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_7px_18px_rgba(46,88,65,0.24)] transition hover:bg-[#234231] disabled:cursor-wait disabled:opacity-65 sm:w-auto">
            {saving ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
            {saving ? "Saving your book…" : "Save & create share link"}
          </button>

          {shareUrl && (
            <section className="rounded-lg border border-[#b9d7bf] bg-[#edf7ee] p-4 shadow-[0_8px_20px_rgba(46,88,65,0.09)]">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#3d7452]">Your book is ready</p>
              <h2 className="mt-1 text-xl font-semibold text-[#244331]">Share this link with anyone.</h2>
              <p className="mt-2 break-all rounded-lg border border-[#c8dfca] bg-white/70 px-3 py-2 text-sm text-[#40614b]">{shareUrl}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={copyShareUrl} className="inline-flex items-center gap-2 rounded-lg bg-[#426b55] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#2f513f]">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a href={shareUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#82ad8b] px-3 py-2 text-sm font-semibold text-[#426b55] transition hover:bg-white/70">
                  Open book
                  <ExternalLink size={16} />
                </a>
              </div>
            </section>
          )}
        </form>
      </div>
    </main>
  );
}
