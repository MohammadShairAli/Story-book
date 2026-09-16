import { createBook, type CreateBookPageInput, StorageConfigurationError } from "@/lib/books";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const title = form.get("title");
    const cover = form.get("cover");
    const pages = form
      .getAll("pages")
      .filter((value): value is File => value instanceof File && value.size > 0);

    if (typeof title !== "string") {
      return Response.json({ error: "A title is required." }, { status: 400 });
    }
    if (!(cover instanceof File)) {
      return Response.json({ error: "Add a cover image." }, { status: 400 });
    }

    const pageInputs: CreateBookPageInput[] = pages.map((page, index) => {
      const titleValue = form.get(`pageTitle-${index}`);
      const icon = form.get(`pageIcon-${index}`);
      const iconName = form.get(`pageIconName-${index}`);
      const audio = form.get(`pageAudio-${index}`);
      const audioName = form.get(`pageAudioName-${index}`);

      return {
        image: page,
        title: typeof titleValue === "string" ? titleValue : undefined,
        icon: icon instanceof File && icon.size > 0 ? icon : null,
        iconName: typeof iconName === "string" ? iconName : undefined,
        audio: audio instanceof File && audio.size > 0 ? audio : null,
        audioName: typeof audioName === "string" ? audioName : undefined,
      };
    });

    const book = await createBook({ title, cover, pages: pageInputs });
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
