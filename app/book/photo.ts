/**
 * The keepsake photo on the book's last page ("This page is YOURS").
 *
 * The reader's picture is downscaled and kept in localStorage, so it is
 * still in the book the next time the page is opened on this device.
 */

const STORAGE_KEY = "story-book:keepsake-photo";

/**
 * Where a given book's photo is kept. The demo book uses the bare key it has
 * always used, so a photo placed before this existed is still there; a custom
 * book is scoped by its id, so two books do not share one picture.
 */
function storageKey(bookId?: string) {
  return bookId ? `${STORAGE_KEY}:${bookId}` : STORAGE_KEY;
}

/** Longest side of the stored image, which keeps it far inside storage quotas. */
const MAX_SIDE = 1024;

export function loadPhoto(bookId?: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey(bookId));
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses to store it (quota, private mode). */
export function savePhoto(dataUrl: string, bookId?: string): boolean {
  try {
    window.localStorage.setItem(storageKey(bookId), dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function clearPhoto(bookId?: string) {
  try {
    window.localStorage.removeItem(storageKey(bookId));
  } catch {
    // Storage is unavailable, so there is nothing to remove.
  }
}

/** Decodes a picked file and re-encodes it as a JPEG no larger than `MAX_SIDE`. */
export async function preparePhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas is unavailable");

    // JPEG has no transparency; without a fill, clear pixels turn black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.86);
  } finally {
    bitmap.close();
  }
}
