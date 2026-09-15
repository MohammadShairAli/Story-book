import { createBook, StorageConfigurationError } from "@/lib/books";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const title = form.get("title");
    const frontCover = form.get("frontCover");
    const backCover = form.get("backCover");
    const pages = form
      .getAll("pages")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (typeof title !== "string") {
      return Response.json({ error: "A title is required." }, { status: 400 });
    }
    if (!(frontCover instanceof File) || !(backCover instanceof File)) {
      return Response.json({ error: "Add both a front and back cover." }, { status: 400 });
    }

    const book = await createBook({ title, frontCover, backCover, pages });
    return Response.json({ id: book.id, url: `/books/${book.id}` }, { status: 201 });
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      return Response.json(
        { error: "Supabase is not configured yet. Add the variables from .env.example to .env." },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unable to create the book.";
    return Response.json({ error: message }, { status: 400 });
  }
}
