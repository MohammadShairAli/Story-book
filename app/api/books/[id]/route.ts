import { revalidatePath } from "next/cache";
import { deleteBook, StorageConfigurationError } from "@/lib/books";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    await deleteBook(id);
    revalidatePath("/");
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof StorageConfigurationError) {
      return Response.json(
        { error: "Supabase is not configured yet. Add the variables from .env.example to .env." },
        { status: 503 },
      );
    }

    const message = error instanceof Error ? error.message : "Unable to delete the book.";
    return Response.json({ error: message }, { status: message === "Book not found." ? 404 : 400 });
  }
}
