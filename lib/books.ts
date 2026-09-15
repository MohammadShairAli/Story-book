import { MAX_STORY_PAGE_COUNT, MAX_TOTAL_BOOK_PAGES } from "@/lib/bookLimits";

export type BookPage = {
  id: string;
  imageUrl: string;
};

export type SharedBook = {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  frontCoverUrl: string;
  backCoverUrl: string;
  pages: BookPage[];
};

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

const MAX_FILE_SIZE = 6 * 1024 * 1024;

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export class StorageConfigurationError extends Error {
  constructor() {
    super("Supabase storage has not been configured.");
  }
}

function getConfig(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET;

  if (!url || !serviceRoleKey || !bucket) throw new StorageConfigurationError();
  return { url, serviceRoleKey, bucket };
}

function objectPath(config: SupabaseConfig, path: string, publicObject = false) {
  const bucket = encodeURIComponent(config.bucket);
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const prefix = publicObject ? "object/public" : "object";
  return `${config.url}/storage/v1/${prefix}/${bucket}/${encodedPath}`;
}

function imageExtension(file: File) {
  const extension = imageExtensions[file.type];
  if (!extension) throw new Error("Use a JPG, PNG, WebP, or AVIF image.");
  return extension;
}

function validateImage(file: File, label: string) {
  if (file.size === 0) throw new Error(`${label} is empty.`);
  if (file.size > MAX_FILE_SIZE) throw new Error(`${label} is larger than 6 MB.`);
  imageExtension(file);
}

async function uploadObject(
  config: SupabaseConfig,
  path: string,
  body: ArrayBuffer | string,
  contentType: string,
  cacheControl: string,
) {
  const response = await fetch(objectPath(config, path), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "x-upsert": "false",
    },
    body,
  });

  if (!response.ok) {
    throw new Error("Supabase could not save this book. Check the bucket name and credentials.");
  }
}

function publicUrl(config: SupabaseConfig, path: string) {
  return objectPath(config, path, true);
}

function createBookId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

export async function createBook({
  title,
  frontCover,
  backCover,
  pages,
}: {
  title: string;
  frontCover: File;
  backCover: File;
  pages: File[];
}): Promise<SharedBook> {
  const trimmedTitle = title.trim().replace(/\s+/g, " ");
  if (!trimmedTitle) throw new Error("Give your book a title.");
  if (trimmedTitle.length > 100) throw new Error("Keep the title under 100 characters.");
  if (!frontCover || !backCover) throw new Error("Add both a front and back cover.");
  if (pages.length === 0) throw new Error("Add at least one story page.");
  if (pages.length > MAX_STORY_PAGE_COUNT) {
    throw new Error(
      `A book can contain up to ${MAX_TOTAL_BOOK_PAGES} pages total, including the front/back cover sheet. Add no more than ${MAX_STORY_PAGE_COUNT} story pages.`,
    );
  }

  validateImage(frontCover, "Front cover");
  validateImage(backCover, "Back cover");
  pages.forEach((page, index) => validateImage(page, `Page ${index + 1}`));

  const config = getConfig();
  const id = createBookId();
  const basePath = `books/${id}`;

  const uploadImage = async (file: File, path: string) => {
    await uploadObject(config, path, await file.arrayBuffer(), file.type, "public, max-age=31536000, immutable");
    return publicUrl(config, path);
  };

  const frontCoverPath = `${basePath}/front.${imageExtension(frontCover)}`;
  const backCoverPath = `${basePath}/back.${imageExtension(backCover)}`;
  const frontCoverUrl = await uploadImage(frontCover, frontCoverPath);
  const backCoverUrl = await uploadImage(backCover, backCoverPath);

  const bookPages = await Promise.all(
    pages.map(async (page, index) => {
      const path = `${basePath}/pages/${String(index + 1).padStart(2, "0")}.${imageExtension(page)}`;
      return { id: String(index + 1), imageUrl: await uploadImage(page, path) };
    }),
  );

  const book: SharedBook = {
    version: 1,
    id,
    title: trimmedTitle,
    createdAt: new Date().toISOString(),
    frontCoverUrl,
    backCoverUrl,
    pages: bookPages,
  };

  await uploadObject(
    config,
    `${basePath}/book.json`,
    JSON.stringify(book),
    "application/json; charset=utf-8",
    "no-cache",
  );

  return book;
}

function isSharedBook(value: unknown): value is SharedBook {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<SharedBook>;
  return (
    book.version === 1 &&
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.createdAt === "string" &&
    typeof book.frontCoverUrl === "string" &&
    typeof book.backCoverUrl === "string" &&
    Array.isArray(book.pages) &&
    book.pages.every(
      (page) =>
        page &&
        typeof page === "object" &&
        typeof (page as BookPage).id === "string" &&
        typeof (page as BookPage).imageUrl === "string",
    )
  );
}

export async function getBook(id: string): Promise<SharedBook | null> {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;

  const config = getConfig();
  const response = await fetch(objectPath(config, `books/${id}/book.json`), {
    headers: {
      Authorization: `Bearer ${config.serviceRoleKey}`,
      apikey: config.serviceRoleKey,
    },
    cache: "no-store",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Supabase could not load this book.");

  const book: unknown = await response.json();
  return isSharedBook(book) ? book : null;
}
