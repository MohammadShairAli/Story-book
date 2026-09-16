"use client";
/* eslint-disable @next/next/no-img-element -- local object URLs cannot be rendered by next/image. */

import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  GripVertical,
  ImageIcon,
  ImagePlus,
  LoaderCircle,
  Music,
  Plus,
  Trash2,
} from "lucide-react";
import { BOOK_IMAGE_SPECS, imageSpecLabel, type BookImageSpec } from "@/lib/bookDimensions";
import { STORY_PAGE_COUNT } from "@/lib/bookLimits";

type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type SelectedAudio = {
  file: File;
  name: string;
};

type SelectedPage = {
  id: string;
  image: SelectedImage;
  title: string;
  icon: SelectedImage | null;
  iconName: string;
  audio: SelectedAudio | null;
};

/*
 * `accept` only filters what the file dialog shows first -- every browser lets
 * the reader switch to "All files" and pick anything -- so each of these lists
 * is paired with a check on the chosen file below. Without that, an audio file
 * picked in an image slot reached `createImageBitmap`, which rejects with the
 * browser's bare "Load failed", and the unconverted file was uploaded anyway.
 */
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
const AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/webm",
  "audio/x-m4a",
  "audio/m4a",
] as const;

const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
const AUDIO_ACCEPT = `${AUDIO_TYPES.join(",")},.mp3,.m4a,.wav,.ogg,.aac,.webm`;

const IMAGE_LABEL = "JPG, PNG, WebP, or AVIF";
const AUDIO_LABEL = "MP3, WAV, M4A, OGG, AAC, or WebM";

/**
 * Whether a picked file is the kind the slot wants.
 *
 * Browsers disagree on audio MIME types -- an .mp3 can arrive as `audio/mpeg`
 * or `audio/mp3`, and Windows sometimes reports an empty string -- so the file
 * extension is accepted as a fallback when the type is missing or generic.
 */
function isAllowedFile(file: File, kind: "image" | "audio") {
  const type = file.type.toLowerCase();
  const allowed: readonly string[] = kind === "image" ? IMAGE_TYPES : AUDIO_TYPES;
  if (allowed.includes(type)) return true;
  // An unknown or absent type: fall back to the extension.
  if (type && !type.startsWith(kind === "image" ? "image/" : "audio/")) return false;
  const extensions = kind === "image" ? /\.(jpe?g|png|webp|avif)$/i : /\.(mp3|m4a|wav|ogg|oga|aac|webm)$/i;
  return extensions.test(file.name);
}

function fileStem(file: File) {
  return file.name.replace(/\.[^.]+$/, "").trim() || "upload";
}

function makeImage(file: File): SelectedImage {
  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

async function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
}

async function normalizeImageFile(file: File, spec: BookImageSpec) {
  try {
    const bitmap = await createImageBitmap(file);
    const targetAspect = spec.widthPx / spec.heightPx;
    const sourceAspect = bitmap.width / bitmap.height;

    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;

    if (sourceAspect > targetAspect) {
      sw = bitmap.height * targetAspect;
      sx = (bitmap.width - sw) / 2;
    } else {
      sh = bitmap.width / targetAspect;
      sy = (bitmap.height - sh) / 2;
    }

    const canvas = document.createElement("canvas");
    canvas.width = spec.widthPx;
    canvas.height = spec.heightPx;
    const context = canvas.getContext("2d");
    if (!context) return file;

    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, spec.widthPx, spec.heightPx);
    bitmap.close();

    const blob = await canvasBlob(canvas);
    if (!blob) return file;
    return new File([blob], `${fileStem(file)}-${spec.widthMm}x${spec.heightMm}.webp`, { type: "image/webp" });
  } catch {
    // Decoding failed, so this is not an image the browser can read. Returning
    // the original file here would upload it unconverted; say so instead.
    throw new Error(`That file could not be read as an image. Use ${IMAGE_LABEL}.`);
  }
}

function CoverPicker({
  label,
  spec,
  image,
  onPick,
  onRemove,
}: {
  label: string;
  spec: BookImageSpec;
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
          <p className="text-[11px] text-[#8c745b]">{imageSpecLabel(spec)}</p>
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
        className="group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[#cbb38f] bg-[#f7efdf] text-center transition hover:border-[#426b55] hover:bg-[#edf4ed]"
        style={{ aspectRatio: `${spec.widthMm} / ${spec.heightMm}` }}
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
  const [cover, setCover] = useState<SelectedImage | null>(null);
  const [pages, setPages] = useState<SelectedPage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
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

  const replaceCover = async (file: File | null) => {
    if (!file) return;
    if (!isAllowedFile(file, "image")) {
      setError(`"${file.name}" is not an image. Use ${IMAGE_LABEL}.`);
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const image = selectImage(await normalizeImageFile(file, BOOK_IMAGE_SPECS.cover));
      if (!image) return;
      setShareUrl(null);
      discard(cover);
      setCover(image);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not read "${file.name}".`);
    } finally {
      setProcessing(false);
    }
  };

  const addPages = async (event: ChangeEvent<HTMLInputElement>) => {
    const capacity = Math.max(0, STORY_PAGE_COUNT - pages.length);
    const picked = Array.from(event.target.files ?? []);
    event.currentTarget.value = "";

    const files = picked.filter((file) => isAllowedFile(file, "image"));
    const rejected = picked.length - files.length;

    if (rejected > 0) {
      setError(
        `${rejected === 1 ? "One file was" : `${rejected} files were`} skipped -- story pages must be ${IMAGE_LABEL}.`,
      );
    } else if (files.length > capacity) {
      setError(`A book needs exactly ${STORY_PAGE_COUNT} story pages; the extra images were not added.`);
    }
    if (capacity === 0 || files.length === 0) return;

    setProcessing(true);
    try {
      const start = pages.length;
      const selected = await Promise.all(
        files.slice(0, capacity).map(async (file, index): Promise<SelectedPage | null> => {
          const image = selectImage(await normalizeImageFile(file, BOOK_IMAGE_SPECS.storyPage));
          if (!image) return null;
          const pageNumber = start + index + 1;
          return {
            id: image.id,
            image,
            title: `Page ${pageNumber}`,
            icon: null,
            iconName: "",
            audio: null,
          };
        }),
      );
      setPages((current) => [...current, ...selected.filter((page): page is SelectedPage => !!page)]);
      setShareUrl(null);
      if (rejected === 0 && files.length <= capacity) setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Those pages could not be read as images.");
    } finally {
      setProcessing(false);
    }
  };

  const updatePage = (id: string, update: Partial<SelectedPage>) => {
    setPages((current) => current.map((page) => (page.id === id ? { ...page, ...update } : page)));
    setShareUrl(null);
  };

  const updatePageIcon = async (page: SelectedPage, file: File | null) => {
    if (!file) {
      discard(page.icon);
      updatePage(page.id, { icon: null, iconName: "" });
      return;
    }
    if (!isAllowedFile(file, "image")) {
      setError(`"${file.name}" is not an image. Page icons must be ${IMAGE_LABEL}.`);
      return;
    }

    setProcessing(true);
    setError(null);
    try {
      const icon = selectImage(await normalizeImageFile(file, BOOK_IMAGE_SPECS.cover));
      if (!icon) return;
      discard(page.icon);
      updatePage(page.id, { icon, iconName: page.iconName || fileStem(file) });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : `Could not read "${file.name}".`);
    } finally {
      setProcessing(false);
    }
  };

  const updatePageAudio = (page: SelectedPage, file: File | null) => {
    if (file && !isAllowedFile(file, "audio")) {
      setError(`"${file.name}" is not an audio file. Use ${AUDIO_LABEL}.`);
      return;
    }
    setError(null);
    updatePage(page.id, { audio: file ? { file, name: page.audio?.name || fileStem(file) } : null });
  };

  const removePage = (id: string) => {
    const image = pages.find((page) => page.id === id) ?? null;
    if (image) {
      discard(image.image);
      discard(image.icon);
    }
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
    if (!cover) {
      setError("Add a cover image.");
      return;
    }
    if (pages.length !== STORY_PAGE_COUNT) {
      setError(
        pages.length < STORY_PAGE_COUNT
          ? `Add ${STORY_PAGE_COUNT - pages.length} more story ${STORY_PAGE_COUNT - pages.length === 1 ? "page" : "pages"} -- a book needs exactly ${STORY_PAGE_COUNT}.`
          : `Remove ${pages.length - STORY_PAGE_COUNT} story ${pages.length - STORY_PAGE_COUNT === 1 ? "page" : "pages"} -- a book needs exactly ${STORY_PAGE_COUNT}.`,
      );
      return;
    }

    setSaving(true);
    try {
      const form = new FormData();
      form.set("title", title);
      form.set("cover", cover.file);
      pages.forEach((page, index) => {
        form.append("pages", page.image.file);
        form.set(`pageTitle-${index}`, page.title);
        if (page.icon) {
          form.set(`pageIcon-${index}`, page.icon.file);
          form.set(`pageIconName-${index}`, page.iconName);
        }
        if (page.audio) {
          form.set(`pageAudio-${index}`, page.audio.file);
          form.set(`pageAudioName-${index}`, page.audio.name);
        }
      });

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

  /** Every slot filled: both covers and exactly the required story pages. */
  const isComplete = !!cover && pages.length === STORY_PAGE_COUNT;

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
    <main className="min-h-[100dvh] overflow-y-auto bg-[#f4ecdc] px-4 py-4 text-[#33261c] sm:px-6 sm:py-6">
      <div className="mx-auto max-w-6xl pb-8">
        <Link href="/demo" className="inline-flex items-center gap-2 text-xs font-semibold text-[#426b55] transition hover:text-[#2f513f]">
          <ArrowLeft size={15} />
          View the demo book
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-[#d8c6a8] pb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9a704a]">Book creator</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[#2d2117] sm:text-3xl">Create a 3D book</h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[#705f4c]">
            Cover {imageSpecLabel(BOOK_IMAGE_SPECS.cover)}, story pages {imageSpecLabel(BOOK_IMAGE_SPECS.storyPage)}.
          </p>
        </div>

        <form onSubmit={saveBook} className="mt-5 grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <section className="space-y-4">
            <div className="rounded-lg border border-[#dfd0b7] bg-[#fffaf0] p-4 shadow-[0_8px_22px_rgba(84,60,31,0.07)]">
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
            </div>

            <CoverPicker
              label="Cover"
              spec={BOOK_IMAGE_SPECS.cover}
              image={cover}
              onPick={(file) => void replaceCover(file)}
              onRemove={() => {
                discard(cover);
                setCover(null);
                setShareUrl(null);
              }}
            />
          </section>

          <section className="rounded-lg border border-[#dfd0b7] bg-[#fffaf0] p-4 shadow-[0_8px_22px_rgba(84,60,31,0.07)]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#35281d]">Story pages</h2>
                <p className="mt-0.5 text-xs text-[#806e58]">
                  Exactly {STORY_PAGE_COUNT} required &middot; {pages.length} of {STORY_PAGE_COUNT} added. Each page is optimized to{" "}
                  {imageSpecLabel(BOOK_IMAGE_SPECS.storyPage)}.
                </p>
              </div>
              <label
                className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(46,88,65,0.22)] transition ${
                  pages.length >= STORY_PAGE_COUNT || processing
                    ? "cursor-not-allowed bg-[#9aa79d] opacity-70"
                    : "cursor-pointer bg-[#426b55] hover:bg-[#2f513f]"
                }`}
                aria-disabled={pages.length >= STORY_PAGE_COUNT || processing}
              >
                {processing ? <LoaderCircle size={17} className="animate-spin" /> : <Plus size={17} />}
                Add pages
                <input
                  type="file"
                  multiple
                  accept={IMAGE_ACCEPT}
                  className="sr-only"
                  onChange={(event) => void addPages(event)}
                  disabled={pages.length >= STORY_PAGE_COUNT || processing}
                />
              </label>
            </div>

            {pages.length === 0 ? (
              <label className="mt-4 flex min-h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#cbb38f] bg-[#f7efdf] px-4 text-center transition hover:border-[#426b55] hover:bg-[#edf4ed]">
                <ImagePlus size={24} className="text-[#426b55]" />
                <span className="mt-2 text-sm font-semibold text-[#5c4b38]">Upload your first page</span>
                <span className="mt-1 text-sm text-[#8c745b]">{IMAGE_LABEL}</span>
                <input type="file" multiple accept={IMAGE_ACCEPT} className="sr-only" onChange={(event) => void addPages(event)} />
              </label>
            ) : (
              <ol className="mt-4 space-y-3">
                {pages.map((page, index) => (
                  <li key={page.id} className="grid gap-3 rounded-lg border border-[#dfd0b7] bg-white p-3 md:grid-cols-[11rem_minmax(0,1fr)_auto]">
                    <div>
                      <img src={page.image.previewUrl} alt={`Page ${index + 1} preview`} className="aspect-[2/1] w-full rounded-md object-cover" />
                      <div className="mt-2 flex items-center gap-2">
                        <span className="flex h-9 w-9 shrink-0 overflow-hidden rounded-full border border-[#d9c7aa] bg-[#f7efdf]">
                          <img src={page.icon?.previewUrl ?? page.image.previewUrl} alt="" className="h-full w-full object-cover" />
                        </span>
                        <p className="min-w-0 truncate text-xs font-medium text-[#8c745b]">{page.iconName || "Page image icon"}</p>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <label className="min-w-0 flex-1 text-xs font-semibold text-[#493a2c]">
                          Page title
                          <input
                            value={page.title}
                            onChange={(event) => updatePage(page.id, { title: event.target.value })}
                            className="mt-1 w-full rounded-md border border-[#d9c7aa] px-2.5 py-1.5 text-sm outline-none focus:border-[#426b55] focus:ring-2 focus:ring-[#d9eadc]"
                          />
                        </label>
                        <GripVertical size={16} className="mt-5 text-[#b29e83]" aria-hidden />
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#cbb38f] px-2.5 py-2 text-xs font-semibold text-[#426b55] transition hover:bg-[#edf4ed]">
                          <Music size={15} />
                          {page.audio ? "Replace voice" : "Add voice"}
                          <span className="sr-only"> ({AUDIO_LABEL})</span>
                          <input type="file" accept={AUDIO_ACCEPT} className="sr-only" onChange={(event) => updatePageAudio(page, event.target.files?.[0] ?? null)} />
                        </label>
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-[#cbb38f] px-2.5 py-2 text-xs font-semibold text-[#426b55] transition hover:bg-[#edf4ed]">
                          <ImageIcon size={15} />
                          {page.icon ? "Replace icon" : "Add icon"}
                          <input type="file" accept={IMAGE_ACCEPT} className="sr-only" onChange={(event) => void updatePageIcon(page, event.target.files?.[0] ?? null)} />
                        </label>
                      </div>

                      {page.audio && (
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="text-xs font-semibold text-[#493a2c]">
                            Voice name
                            <input
                              value={page.audio.name}
                              onChange={(event) => updatePage(page.id, { audio: page.audio ? { ...page.audio, name: event.target.value } : null })}
                              className="mt-1 w-full rounded-md border border-[#d9c7aa] px-2.5 py-1.5 text-sm outline-none focus:border-[#426b55] focus:ring-2 focus:ring-[#d9eadc]"
                            />
                          </label>
                          <button type="button" onClick={() => updatePageAudio(page, null)} className="self-end rounded-md px-2.5 py-1.5 text-xs font-bold text-[#a55d4b] hover:bg-[#f7e7dc]">
                            Remove voice
                          </button>
                        </div>
                      )}

                      {page.icon && (
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <label className="text-xs font-semibold text-[#493a2c]">
                            Icon name
                            <input
                              value={page.iconName}
                              onChange={(event) => updatePage(page.id, { iconName: event.target.value })}
                              className="mt-1 w-full rounded-md border border-[#d9c7aa] px-2.5 py-1.5 text-sm outline-none focus:border-[#426b55] focus:ring-2 focus:ring-[#d9eadc]"
                            />
                          </label>
                          <button type="button" onClick={() => void updatePageIcon(page, null)} className="self-end rounded-md px-2.5 py-1.5 text-xs font-bold text-[#a55d4b] hover:bg-[#f7e7dc]">
                            Remove icon
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1 md:flex-col">
                      <button type="button" onClick={() => movePage(index, -1)} disabled={index === 0} className="rounded-md px-2 py-1 text-xs font-bold text-[#426b55] hover:bg-[#edf4ed] disabled:opacity-30">
                        Up
                      </button>
                      <button type="button" onClick={() => movePage(index, 1)} disabled={index === pages.length - 1} className="rounded-md px-2 py-1 text-xs font-bold text-[#426b55] hover:bg-[#edf4ed] disabled:opacity-30">
                        Down
                      </button>
                      <button type="button" onClick={() => removePage(page.id)} className="rounded-md p-1.5 text-[#a55d4b] hover:bg-[#f7e7dc]" aria-label={`Remove page ${index + 1}`}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <div className="space-y-4 lg:col-start-2">
            {error && (
              <p role="alert" className="rounded-lg border border-[#edc6bc] bg-[#fff0ed] px-3 py-2 text-sm font-medium text-[#9a3f31]">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={saving || processing || !isComplete}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#2f513f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_7px_18px_rgba(46,88,65,0.24)] transition hover:bg-[#234231] disabled:cursor-not-allowed disabled:opacity-65 sm:w-auto"
            >
              {saving ? <LoaderCircle size={18} className="animate-spin" /> : <Check size={18} />}
              {saving ? "Saving your book..." : processing ? "Optimizing images..." : "Save & create share link"}
            </button>

            {!isComplete && !saving && !processing && (
              <p className="text-xs font-medium text-[#8c745b]">
                Needs a cover and exactly {STORY_PAGE_COUNT} story pages
                {" "}({pages.length} of {STORY_PAGE_COUNT} added).
              </p>
            )}

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
          </div>
        </form>
      </div>
    </main>
  );
}
