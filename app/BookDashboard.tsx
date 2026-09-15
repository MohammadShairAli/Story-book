"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Copy, ExternalLink, LoaderCircle, LockKeyhole, Plus, Trash2 } from "lucide-react";

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

  const deleteBook = async (book: DashboardBook) => {
    const confirmed = window.confirm(`Delete "${book.title}" from the dashboard and Supabase bucket?`);
    if (!confirmed) return;

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
                    onClick={() => deleteBook(book)}
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
    </main>
  );
}
