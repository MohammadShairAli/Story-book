/**
 * A book is exactly one front cover, one back cover, and this many story
 * pages -- not a maximum. The creator blocks saving until exactly this many
 * story images have been added, so every book reads the same way.
 */
export const STORY_PAGE_COUNT = 5;

/** The front/back cover sheet, counted when showing a book's length. */
export const COVER_SHEET_PAGE_COUNT = 1;

/** What the dashboard reports as a book's length. */
export const TOTAL_BOOK_PAGES = STORY_PAGE_COUNT + COVER_SHEET_PAGE_COUNT;
