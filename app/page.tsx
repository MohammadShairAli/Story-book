import { headers } from "next/headers";
import BookDashboard, { type DashboardBook } from "./BookDashboard";
import { listBookSummaries, StorageConfigurationError } from "@/lib/books";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Books Dashboard | Interactive Story Book",
  description: "Manage created books and open the main demo book.",
};

async function dashboardOrigin() {
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host") ?? "localhost:3000";
  const protocol = headersList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}

export default async function Home() {
  const origin = await dashboardOrigin();
  let books: DashboardBook[] = [];
  let storageError: string | null = null;

  try {
    const storedBooks = await listBookSummaries();
    books = storedBooks.map((book) => ({
      id: book.id,
      title: book.title,
      url: `${origin}/books/${book.id}`,
      createdAt: book.createdAt,
      pageCount: book.pageCount,
    }));
  } catch (error) {
    storageError =
      error instanceof StorageConfigurationError
        ? "Supabase is not configured yet. Add the values from .env.example to .env to list saved books."
        : "Saved books could not be loaded from Supabase.";
  }

  return <BookDashboard books={books} demoUrl={`${origin}/demo`} storageError={storageError} />;
}
