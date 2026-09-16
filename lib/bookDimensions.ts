export type BookImageKind = "cover" | "storyPage";

export type BookImageSpec = {
  kind: BookImageKind;
  label: string;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
};

const PIXELS_PER_MM = 5;

export const BOOK_IMAGE_SPECS: Record<BookImageKind, BookImageSpec> = {
  /*
   * One wraparound sheet. The model's `Cover` material maps a single texture
   * across the whole case -- back cover, spine, then front cover -- over the
   * full 0..1 UV range, so this is one image, not two.
   */
  cover: {
    kind: "cover",
    label: "Cover",
    widthMm: 400,
    heightMm: 200,
    widthPx: 400 * PIXELS_PER_MM,
    heightPx: 200 * PIXELS_PER_MM,
  },
  storyPage: {
    kind: "storyPage",
    label: "Story page",
    widthMm: 400,
    heightMm: 200,
    widthPx: 400 * PIXELS_PER_MM,
    heightPx: 200 * PIXELS_PER_MM,
  },
};

export function imageSpecLabel(spec: BookImageSpec) {
  return `${spec.widthMm} x ${spec.heightMm} mm`;
}
