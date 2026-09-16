import { COVER_SHEET_PAGE_COUNT, STORY_PAGE_COUNT } from "@/lib/bookLimits";
import { BOOK_IMAGE_SPECS, type BookImageSpec } from "@/lib/bookDimensions";

export type BookPage = {
  id: string;
  title: string;
  imageUrl: string;
  iconUrl?: string;
  iconName?: string;
  audioUrl?: string;
  audioName?: string;
};

export type SharedBook = {
  version: 1;
  id: string;
  title: string;
  createdAt: string;
  /** The single wraparound cover image: back, spine and front on one sheet. */
  coverUrl: string;
  dimensions?: {
    cover: BookImageSpec;
    storyPage: BookImageSpec;
  };
  pages: BookPage[];
};

type SupabaseConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

type StorageObject = {
  name: string;
  metadata?: unknown;
};

/**
 * One row of the `books` table: exactly the columns the dashboard renders.
 * Listing from here avoids downloading every book.json just to show a title.
 */
export type BookSummary = {
  id: string;
  title: string;
  createdAt: string;
  pageCount: number;
};

type BookRow = {
  id: unknown;
  title: unknown;
  page_count: unknown;
  created_at: unknown;
};

/** The table created by `supabase/books-table.sql`. */
const BOOKS_TABLE = "books";

const MAX_FILE_SIZE = 6 * 1024 * 1024;
const MAX_AUDIO_FILE_SIZE = 12 * 1024 * 1024;
const BOOK_ID_PATTERN = /^[a-f0-9]{16}$/;

const imageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/*
 * Browsers disagree on audio MIME types for the same file: an .mp3 arrives as
 * `audio/mpeg` or `audio/mp3`, a .wav as `audio/wav`, `audio/x-wav` or
 * `audio/wave`, and an .m4a as `audio/mp4`, `audio/x-m4a` or `audio/m4a`. All
 * the spellings are accepted so a valid recording is not refused over its label.
 */
const audioExtensions: Record<string, string> = {
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/oga": "ogg",
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/webm": "webm",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
};

/** Falls back to the file's extension when the browser sends no useful type. */
const audioExtensionsByName: Record<string, string> = {
  aac: "aac",
  m4a: "m4a",
  mp3: "mp3",
  oga: "ogg",
  ogg: "ogg",
  wav: "wav",
  webm: "webm",
};

export type CreateBookPageInput = {
  image: File;
  title?: string;
  icon?: File | null;
  iconName?: string;
  audio?: File | null;
  audioName?: string;
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

function bucketObjectPath(config: SupabaseConfig) {
  return `${config.url}/storage/v1/object/${encodeURIComponent(config.bucket)}`;
}

function objectListPath(config: SupabaseConfig) {
  return `${config.url}/storage/v1/object/list/${encodeURIComponent(config.bucket)}`;
}

function storageHeaders(config: SupabaseConfig, contentType?: string) {
  return {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    apikey: config.serviceRoleKey,
    ...(contentType ? { "Content-Type": contentType } : {}),
  };
}

function tablePath(config: SupabaseConfig, query = "") {
  return `${config.url}/rest/v1/${BOOKS_TABLE}${query}`;
}

function restHeaders(config: SupabaseConfig, extra?: Record<string, string>) {
  return {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    apikey: config.serviceRoleKey,
    "Content-Type": "application/json",
    ...extra,
  };
}

function isBookRow(value: unknown): value is BookRow {
  return !!value && typeof value === "object";
}

function toSummary(row: BookRow): BookSummary | null {
  if (typeof row.id !== "string" || typeof row.title !== "string") return null;
  const createdAt = typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString();
  const pageCount = typeof row.page_count === "number" ? row.page_count : Number(row.page_count) || 0;
  return { id: row.id, title: row.title, createdAt, pageCount };
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

function audioExtension(file: File) {
  const byType = audioExtensions[file.type.toLowerCase()];
  if (byType) return byType;

  const suffix = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byName = audioExtensionsByName[suffix];
  if (byName) return byName;

  throw new Error("Use an MP3, WAV, M4A, OGG, AAC, or WebM audio file.");
}

function validateAudio(file: File, label: string) {
  if (file.size === 0) throw new Error(`${label} is empty.`);
  if (file.size > MAX_AUDIO_FILE_SIZE) throw new Error(`${label} is larger than 12 MB.`);
  audioExtension(file);
}

function cleanLabel(value: string | undefined, fallback: string) {
  const cleaned = value?.trim().replace(/\s+/g, " ");
  return cleaned ? cleaned.slice(0, 60) : fallback;
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
      ...storageHeaders(config, contentType),
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

function privateObjectPathFromPublicUrl(config: SupabaseConfig, url: string) {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${encodeURIComponent(config.bucket)}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex === -1) return null;
    const encodedPath = parsed.pathname.slice(markerIndex + marker.length);
    return encodedPath.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function createBookId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

async function getBookWithConfig(config: SupabaseConfig, id: string): Promise<SharedBook | null> {
  const response = await fetch(objectPath(config, `books/${id}/book.json`), {
    headers: storageHeaders(config),
    cache: "no-store",
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Supabase could not load this book.");

  const raw: unknown = await response.json();
  const book = raw && typeof raw === "object" ? migrateBook(raw as Record<string, unknown>) : raw;
  return isSharedBook(book) ? book : null;
}

export async function createBook({
  title,
  cover,
  pages,
}: {
  title: string;
  cover: File;
  pages: CreateBookPageInput[];
}): Promise<SharedBook> {
  const trimmedTitle = title.trim().replace(/\s+/g, " ");
  if (!trimmedTitle) throw new Error("Give your book a title.");
  if (trimmedTitle.length > 100) throw new Error("Keep the title under 100 characters.");
  if (!cover) throw new Error("Add a cover image.");
  if (pages.length !== STORY_PAGE_COUNT) {
    throw new Error(`A book needs exactly ${STORY_PAGE_COUNT} story pages, plus a front and back cover.`);
  }

  validateImage(cover, "Cover");
  pages.forEach((page, index) => {
    validateImage(page.image, `Page ${index + 1}`);
    if (page.icon) validateImage(page.icon, `Page ${index + 1} icon`);
    if (page.audio) validateAudio(page.audio, `Page ${index + 1} voice`);
  });

  const config = getConfig();
  const id = createBookId();
  const basePath = `books/${id}`;

  const uploadImage = async (file: File, path: string) => {
    await uploadObject(config, path, await file.arrayBuffer(), file.type, "public, max-age=31536000, immutable");
    return publicUrl(config, path);
  };

  const coverPath = `${basePath}/cover.${imageExtension(cover)}`;
  const coverUrl = await uploadImage(cover, coverPath);

  const bookPages = await Promise.all(
    pages.map(async (page, index) => {
      const pageNumber = String(index + 1).padStart(2, "0");
      const path = `${basePath}/pages/${pageNumber}.${imageExtension(page.image)}`;
      const iconPath = page.icon ? `${basePath}/pages/${pageNumber}-icon.${imageExtension(page.icon)}` : null;
      const audioPath = page.audio ? `${basePath}/audio/${pageNumber}.${audioExtension(page.audio)}` : null;

      const [imageUrl, iconUrl, audioUrl] = await Promise.all([
        uploadImage(page.image, path),
        iconPath && page.icon ? uploadImage(page.icon, iconPath) : Promise.resolve(undefined),
        audioPath && page.audio
          ? uploadObject(config, audioPath, await page.audio.arrayBuffer(), page.audio.type, "public, max-age=31536000, immutable").then(() =>
              publicUrl(config, audioPath),
            )
          : Promise.resolve(undefined),
      ]);

      return {
        id: String(index + 1),
        title: cleanLabel(page.title, `Page ${index + 1}`),
        imageUrl,
        ...(iconUrl ? { iconUrl, iconName: cleanLabel(page.iconName, `Icon ${index + 1}`) } : {}),
        ...(audioUrl ? { audioUrl, audioName: cleanLabel(page.audioName, `Voice ${index + 1}`) } : {}),
      };
    }),
  );

  const book: SharedBook = {
    version: 1,
    id,
    title: trimmedTitle,
    createdAt: new Date().toISOString(),
    coverUrl,
    dimensions: BOOK_IMAGE_SPECS,
    pages: bookPages,
  };

  await uploadObject(
    config,
    `${basePath}/book.json`,
    JSON.stringify(book),
    "application/json; charset=utf-8",
    "no-cache",
  );

  await recordBook(config, book);

  return book;
}

/**
 * Index the finished book in the `books` table, so the dashboard can list it
 * without reading storage. The book.json written above stays the source of
 * truth for the reader; this row is a derived copy for listing only, so a
 * failure here must not fail an upload that already succeeded.
 */
async function recordBook(config: SupabaseConfig, book: SharedBook) {
  try {
    const response = await fetch(tablePath(config), {
      method: "POST",
      headers: restHeaders(config, { Prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        id: book.id,
        title: book.title,
        page_count: book.pages.length + COVER_SHEET_PAGE_COUNT,
        created_at: book.createdAt,
      }),
    });

    if (!response.ok) {
      console.warn(`[books] could not index ${book.id} in the "${BOOKS_TABLE}" table.`, await response.text());
    }
  } catch (error) {
    console.warn(`[books] could not index ${book.id} in the "${BOOKS_TABLE}" table.`, error);
  }
}

/**
 * Books written before the cover became a single wraparound image, which
 * carried a separate front and back cover instead of one `coverUrl`.
 */
type LegacyCoverBook = { frontCoverUrl?: unknown; backCoverUrl?: unknown };

/**
 * Brings an older manifest up to the current shape.
 *
 * The front cover is kept as the book's cover -- it is the face a reader sees
 * first, and the two images cannot be fused back into one sheet server-side.
 * Migrating on read rather than rejecting matters: `deleteBook` loads the
 * manifest to find what to remove, so a book that fails to parse can neither
 * be opened nor deleted.
 */
function migrateBook(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.coverUrl === "string") return value;

  const legacy = value as LegacyCoverBook;
  const cover = typeof legacy.frontCoverUrl === "string" ? legacy.frontCoverUrl : legacy.backCoverUrl;
  return typeof cover === "string" ? { ...value, coverUrl: cover } : value;
}

function isSharedBook(value: unknown): value is SharedBook {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<SharedBook>;
  return (
    book.version === 1 &&
    typeof book.id === "string" &&
    typeof book.title === "string" &&
    typeof book.createdAt === "string" &&
    typeof book.coverUrl === "string" &&
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
  if (!BOOK_ID_PATTERN.test(id)) return null;

  const config = getConfig();
  return getBookWithConfig(config, id);
}

function isStorageObject(value: unknown): value is StorageObject {
  return !!value && typeof value === "object" && typeof (value as StorageObject).name === "string";
}

async function listStorageObjects(config: SupabaseConfig, prefix: string) {
  const limit = 100;
  const objects: StorageObject[] = [];

  for (let offset = 0; ; offset += limit) {
    const response = await fetch(objectListPath(config), {
      method: "POST",
      headers: storageHeaders(config, "application/json"),
      body: JSON.stringify({
        prefix,
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
      cache: "no-store",
    });

    if (response.status === 404) return objects;
    if (!response.ok) throw new Error("Supabase could not list books.");

    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("Supabase returned an unexpected book list.");

    const page = data.filter(isStorageObject);
    objects.push(...page);
    if (page.length < limit) return objects;
  }
}

function bookIdFromObjectName(name: string) {
  const cleaned = name.replace(/^\/+|\/+$/g, "");
  const withoutRoot = cleaned.startsWith("books/") ? cleaned.slice("books/".length) : cleaned;
  const candidate = withoutRoot.split("/")[0];
  return BOOK_ID_PATTERN.test(candidate) ? candidate : null;
}

function pathFromListedObject(prefix: string, object: StorageObject) {
  const cleanedName = object.name.replace(/^\/+|\/+$/g, "");
  if (!cleanedName || object.metadata == null) return null;
  if (cleanedName.startsWith(`${prefix}/`) || cleanedName === prefix) return cleanedName;
  return `${prefix}/${cleanedName}`;
}

export async function listBooks(): Promise<SharedBook[]> {
  const config = getConfig();
  const objects = await listStorageObjects(config, "books");
  const ids = Array.from(new Set(objects.map((object) => bookIdFromObjectName(object.name)).filter((id): id is string => !!id)));

  const books = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getBookWithConfig(config, id);
      } catch {
        return null;
      }
    }),
  );

  return books
    .filter((book): book is SharedBook => !!book)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

/**
 * The dashboard's list, read from the `books` table in one request.
 *
 * Falls back to scanning storage when the table is missing or empty but the
 * bucket is not -- that covers both a project where the SQL has not been run
 * yet and books created before this table existed. Any book found that way is
 * back-filled into the table, so the slow path runs at most once per book.
 */
export async function listBookSummaries(): Promise<BookSummary[]> {
  const config = getConfig();

  try {
    const response = await fetch(
      tablePath(config, "?select=id,title,page_count,created_at&order=created_at.desc"),
      { headers: restHeaders(config), cache: "no-store" },
    );

    if (response.ok) {
      const data: unknown = await response.json();
      if (Array.isArray(data)) {
        const rows = data.filter(isBookRow).map(toSummary).filter((row): row is BookSummary => !!row);
        if (rows.length > 0) return rows;
      }
    }
  } catch {
    // Fall through to the storage scan below.
  }

  const books = await listBooks();
  await Promise.all(books.map((book) => recordBook(config, book)));
  return books.map((book) => ({
    id: book.id,
    title: book.title,
    createdAt: book.createdAt,
    pageCount: book.pages.length + COVER_SHEET_PAGE_COUNT,
  }));
}

/** Drops the dashboard row for a deleted book. */
async function forgetBook(config: SupabaseConfig, id: string) {
  try {
    await fetch(tablePath(config, `?id=eq.${encodeURIComponent(id)}`), {
      method: "DELETE",
      headers: restHeaders(config, { Prefer: "return=minimal" }),
    });
  } catch (error) {
    console.warn(`[books] could not remove ${id} from the "${BOOKS_TABLE}" table.`, error);
  }
}

async function deleteObjects(config: SupabaseConfig, paths: string[]) {
  const uniquePaths = Array.from(new Set(paths)).filter(Boolean);
  if (uniquePaths.length === 0) return;

  const response = await fetch(bucketObjectPath(config), {
    method: "DELETE",
    headers: storageHeaders(config, "application/json"),
    body: JSON.stringify({ prefixes: uniquePaths }),
  });

  if (!response.ok) throw new Error("Supabase could not delete this book.");
}

export async function deleteBook(id: string) {
  if (!BOOK_ID_PATTERN.test(id)) throw new Error("Invalid book id.");

  const config = getConfig();
  const basePath = `books/${id}`;

  /*
   * A missing or unreadable manifest is not a reason to refuse. Deleting is
   * driven by what is actually in storage; the manifest only adds the exact
   * object names, so a half-written or older book can still be cleared out
   * instead of being stuck on the dashboard forever.
   */
  const book = await getBookWithConfig(config, id).catch(() => null);

  const paths = (
    book
      ? [
          `${basePath}/book.json`,
          book.coverUrl,
          ...book.pages.map((page) => page.imageUrl),
          ...book.pages.map((page) => page.iconUrl).filter((url): url is string => !!url),
          ...book.pages.map((page) => page.audioUrl).filter((url): url is string => !!url),
        ]
      : [`${basePath}/book.json`]
  )
    .map((pathOrUrl) => (pathOrUrl.startsWith("http") ? privateObjectPathFromPublicUrl(config, pathOrUrl) : pathOrUrl))
    .filter((path): path is string => !!path);

  try {
    const [coverObjects, pageObjects, audioObjects] = await Promise.all([
      listStorageObjects(config, basePath),
      listStorageObjects(config, `${basePath}/pages`),
      listStorageObjects(config, `${basePath}/audio`),
    ]);
    for (const object of coverObjects) {
      const path = pathFromListedObject(basePath, object);
      if (path) paths.push(path);
    }
    for (const object of pageObjects) {
      const path = pathFromListedObject(`${basePath}/pages`, object);
      if (path) paths.push(path);
    }
    for (const object of audioObjects) {
      const path = pathFromListedObject(`${basePath}/audio`, object);
      if (path) paths.push(path);
    }
  } catch {
    // The manifest already includes every object this app creates. Listing is
    // only a cleanup backup for unknown extensions or interrupted uploads.
  }

  await deleteObjects(config, paths);
  await forgetBook(config, id);
}
