"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BookOpen, Copy, ExternalLink, LoaderCircle, LockKeyhole, Plus, Trash2, TriangleAlert } from "lucide-react";

export type DashboardBook = {
  id: string;
  title: string;
  url: string;
  createdAt: string;
  pageCount: number;
};

type BookDashboardProps = {
  books: DashboardBook[];
  demoUrl: string;
  storageError: string | null;
};

/**
 * One column template shared by the header and every row, so the columns line
 * up exactly. Defining it once is what keeps them aligned -- the header and
 * rows previously carried their own copies, which drifted apart.
 *
 * Title and URL both flex; `minmax(0,...)` lets them shrink so a long URL
 * truncates instead of pushing the Pages and Action columns out of line.
 * Pages and Action are fixed, so they sit in the same place on every row.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_5rem_8.5rem]";

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved book";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function BookDashboard({ books, demoUrl, storageError }: BookDashboardProps) {
  const [items, setItems] = useState(books);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(storageError);

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNotice("URL copied.");
    } catch {
      setNotice("Could not copy the URL.");
    }
  };

  /** The book awaiting confirmation, or null when the dialog is closed. */
  const [pendingDelete, setPendingDelete] = useState<DashboardBook | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog when it opens, and close it on Escape.
  useEffect(() => {
    if (!pendingDelete) return;
    cancelButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingDelete(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingDelete]);

  const confirmDelete = async () => {
    const book = pendingDelete;
    if (!book) return;
    setPendingDelete(null);

    setDeletingId(book.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      const result: { error?: string } = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to delete this book.");
      setItems((current) => current.filter((item) => item.id !== book.id));
      setNotice(`Deleted "${book.title}".`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to delete this book.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-[100dvh] bg-[#f4ecdc] px-4 py-5 text-[#33261c] sm:px-6 sm:py-7">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[#d8c6a8] pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#9a704a]">Story books</p>
            <h1 className="mt-1 text-2xl font-semibold text-[#2d2117] sm:text-3xl">Books dashboard</h1>
          </div>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 rounded-lg bg-[#2f513f] px-3.5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(46,88,65,0.24)] transition hover:bg-[#234231]"
          >
            <Plus size={17} />
            Create book
          </Link>
        </header>

        {notice && (
          <p role="status" className="mt-4 rounded-lg border border-[#d7c3a3] bg-[#fffaf0] px-3 py-2 text-sm font-medium text-[#6e593f]">
            {notice}
          </p>
        )}

        <section className="mt-5 overflow-hidden rounded-lg border border-[#d8c6a8] bg-[#fffaf0] shadow-[0_8px_24px_rgba(84,60,31,0.07)]">
          <div className={`${ROW_GRID} border-b border-[#eadcc4] py-3 text-xs font-bold uppercase tracking-[0.12em] text-[#8a6a45]`}>
            <span>Title</span>
            <span className="hidden sm:block">URL</span>
            <span className="hidden sm:block text-right tabular-nums">Pages</span>
            <span className="text-right sm:text-center">Action</span>
          </div>

          <article className={`${ROW_GRID} border-b border-[#eadcc4] py-3`}>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold text-[#2d2117]">
                <BookOpen size={17} className="shrink-0 text-[#426b55]" />
                <span className="truncate">My First Football Match</span>
              </p>
              <p className="mt-1 text-xs font-medium text-[#8a6a45]">Main demo book</p>
            </div>
            <Link href="/demo" className="hidden min-w-0 truncate text-sm font-semibold text-[#426b55] underline-offset-4 hover:underline sm:block">
              {demoUrl}
            </Link>
            <p className="hidden text-right text-sm tabular-nums text-[#725f48] sm:block">Demo</p>
            <div className="flex items-center justify-end gap-1 sm:justify-center">
              {/* Spacer keeps the open/lock icons under the same columns as the
                  three icons on a saved-book row. */}
              <span aria-hidden className="hidden h-9 w-9 sm:block" />
              <Link href="/demo" className="flex h-9 w-9 items-center justify-center rounded-md text-[#426b55] transition hover:bg-[#edf4ed]" aria-label="Open demo book">
                <ExternalLink size={17} />
              </Link>
              <button type="button" disabled className="flex h-9 w-9 items-center justify-center rounded-md text-[#9d907f] opacity-70" aria-label="Main demo book cannot be deleted">
                <LockKeyhole size={17} />
              </button>
            </div>
            <Link href="/demo" className="col-span-2 truncate text-sm font-semibold text-[#426b55] underline-offset-4 hover:underline sm:hidden">
              {demoUrl}
            </Link>
          </article>

          {items.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="font-semibold text-[#3d3023]">No saved books yet.</p>
              <p className="mt-1 text-sm text-[#806e58]">Created books will appear here after saving.</p>
            </div>
          ) : (
            items.map((book) => (
              <article key={book.id} className={`${ROW_GRID} border-b border-[#eadcc4] py-3 last:border-b-0`}>
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#2d2117]">{book.title}</p>
                  <p className="mt-1 text-xs text-[#8a6a45]">{formatDate(book.createdAt)}</p>
                </div>
                <Link href={`/books/${book.id}`} className="hidden min-w-0 truncate text-sm font-semibold text-[#426b55] underline-offset-4 hover:underline sm:block">
                  {book.url}
                </Link>
                <p className="hidden text-right text-sm tabular-nums text-[#725f48] sm:block">{book.pageCount}</p>
                <div className="flex items-center justify-end gap-1 sm:justify-center">
                  <button type="button" onClick={() => copyUrl(book.url)} className="flex h-9 w-9 items-center justify-center rounded-md text-[#426b55] transition hover:bg-[#edf4ed]" aria-label={`Copy ${book.title} URL`}>
                    <Copy size={17} />
                  </button>
                  <Link href={`/books/${book.id}`} className="flex h-9 w-9 items-center justify-center rounded-md text-[#426b55] transition hover:bg-[#edf4ed]" aria-label={`Open ${book.title}`}>
                    <ExternalLink size={17} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(book)}
                    disabled={deletingId === book.id}
                    className="flex h-9 w-9 items-center justify-center rounded-md text-[#a54f3f] transition hover:bg-[#f7e7dc] disabled:cursor-wait disabled:opacity-60"
                    aria-label={`Delete ${book.title}`}
                  >
                    {deletingId === book.id ? <LoaderCircle size={17} className="animate-spin" /> : <Trash2 size={17} />}
                  </button>
                </div>
                <Link href={`/books/${book.id}`} className="col-span-2 truncate text-sm font-semibold text-[#426b55] underline-offset-4 hover:underline sm:hidden">
                  {book.url}
                </Link>
              </article>
            ))
          )}
        </section>
      </div>

      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#2d2117]/45 p-4 backdrop-blur-[2px] sm:items-center"
          // A click that starts and ends on the backdrop dismisses; one that
          // began inside the card (a drag off a button) must not.
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingDelete(null);
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            aria-describedby="delete-body"
            className="w-full max-w-md rounded-xl border border-[#d8c6a8] bg-[#fffaf0] p-5 shadow-[0_24px_60px_rgba(45,33,23,0.32)]"
          >
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f7e7dc] text-[#a54f3f]">
                <TriangleAlert size={20} />
              </span>
              <div className="min-w-0">
                <h2 id="delete-title" className="text-base font-semibold text-[#2d2117]">
                  Delete this book?
                </h2>
                <p id="delete-body" className="mt-1.5 text-sm leading-6 text-[#705f4c]">
                  &ldquo;<span className="font-semibold text-[#3d3023]">{pendingDelete.title}</span>&rdquo; and its
                  images will be removed from the dashboard and the storage bucket. Anyone with the link will no longer
                  be able to open it. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelButton}
                type="button"
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-[#d9c7aa] bg-white px-4 py-2.5 text-sm font-semibold text-[#5c4b38] transition hover:bg-[#f7efdf]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                className="rounded-lg bg-[#a54f3f] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(165,79,63,0.28)] transition hover:bg-[#8c4133]"
              >
                Delete book
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
