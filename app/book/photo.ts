/**
 * The keepsake photo on the book's last page ("This page is YOURS").
 *
 * The reader's picture is downscaled and kept in localStorage, so it is
 * still in the book the next time the page is opened on this device.
 */

const STORAGE_KEY = "story-book:keepsake-photo";

/** Longest side of the stored image, which keeps it far inside storage quotas. */
const MAX_SIDE = 1024;

export function loadPhoto(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Returns false when the browser refuses to store it (quota, private mode). */
export function savePhoto(dataUrl: string): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, dataUrl);
    return true;
  } catch {
    return false;
  }
}

export function clearPhoto() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
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
