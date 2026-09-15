export type BookImageKind = "frontCover" | "backCover" | "storyPage";

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
  frontCover: {
    kind: "frontCover",
    label: "Front cover",
    widthMm: 200,
    heightMm: 200,
    widthPx: 200 * PIXELS_PER_MM,
    heightPx: 200 * PIXELS_PER_MM,
  },
  backCover: {
    kind: "backCover",
    label: "Back cover",
    widthMm: 270,
    heightMm: 200,
    widthPx: 270 * PIXELS_PER_MM,
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
