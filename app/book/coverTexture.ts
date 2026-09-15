/**
 * The model's `Cover` material is a single wraparound sheet: one texture that
 * runs front cover -> spine -> back cover, printed on both faces of the case.
 *
 * Measured from the glTF UVs (see `public/model/book.gltf`, mesh `Plane.017`):
 * the sheet's top face -- the front cover, face up when the book is shut --
 * takes u 0.5..1.0, and its bottom face -- the back cover, underneath -- takes
 * u 0.0..0.5. The seam between them is the spine.
 *
 * So the two uploaded covers cannot be applied as two textures. They have to
 * be composited into one image, back on the left half and front on the right,
 * which is what `buildWraparoundCover` does.
 */

/** Half the atlas per cover, at the front cover's native resolution. */
const HALF_WIDTH = 1024;
const HALF_HEIGHT = 1024;

export const COVER_MATERIAL = "Cover";

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

/**
 * Draws `image` to fill the given box, cropping the overflow rather than
 * squashing it, so a cover keeps its proportions whatever it was uploaded at.
 */
function drawCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

/**
 * Composites the front and back covers into the one wraparound image the
 * `Cover` material expects. Returns a data URL, or null if the browser
 * cannot rasterise (in which case the caller leaves the printed cover alone).
 */
export async function buildWraparoundCover(frontUrl: string, backUrl: string): Promise<string | null> {
  try {
    const [front, back] = await Promise.all([loadImage(frontUrl), loadImage(backUrl)]);

    const canvas = document.createElement("canvas");
    canvas.width = HALF_WIDTH * 2;
    canvas.height = HALF_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return null;

    // Left half (u 0..0.5) is the underside: the back cover.
    drawCover(context, back, 0, 0, HALF_WIDTH, HALF_HEIGHT);
    // Right half (u 0.5..1) is the top face: the front cover.
    drawCover(context, front, HALF_WIDTH, 0, HALF_WIDTH, HALF_HEIGHT);

    return canvas.toDataURL("image/webp", 0.92);
  } catch {
    return null;
  }
}
