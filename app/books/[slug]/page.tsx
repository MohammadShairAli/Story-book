import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ThreeBookReader from "./ThreeBookReader";
import { getBook } from "@/lib/books";

type BookPageProps = {
  params: Promise<{ slug: string }>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const { slug } = await params;
  const book = await getBook(slug);
  return book
    ? { title: `${book.title} | Interactive Story Book`, description: `Read ${book.title}.` }
    : { title: "Book not found | Interactive Story Book" };
}

export default async function SharedBookPage({ params }: BookPageProps) {
  const { slug } = await params;
  const book = await getBook(slug);
  if (!book) notFound();
  return <ThreeBookReader book={book} />;
}
