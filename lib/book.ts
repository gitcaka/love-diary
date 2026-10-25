import type { Diary } from "./types.ts";

export type BookDirection = "previous" | "next";
export type BookOrder = "newest" | "oldest";

export interface BookTextPage { start: number; end: number }

/** Measured pagination, retaining exact UTF-16 offsets for existing color marks. */
export function paginateBookText(content: string, fits: (text: string) => boolean): BookTextPage[] {
  if (!content) return [{ start: 0, end: 0 }];
  const boundaries = [0];
  if (typeof Intl.Segmenter === "function") {
    for (const part of new Intl.Segmenter("zh", { granularity: "grapheme" }).segment(content)) {
      boundaries.push(part.index + part.segment.length);
    }
  } else {
    // Older mobile browsers still retain every character and surrogate pair.
    for (const character of Array.from(content)) boundaries.push(boundaries[boundaries.length - 1] + character.length);
  }
  const pages: BookTextPage[] = [];
  let start = 0;
  while (start < boundaries.length - 1) {
    let low = start + 1, high = boundaries.length - 1, end = low;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(content.slice(boundaries[start], boundaries[mid]))) { end = mid; low = mid + 1; }
      else high = mid - 1;
    }
    pages.push({ start: boundaries[start], end: boundaries[end] });
    start = end;
  }
  return pages;
}

export function bookTextSlice(diary: Pick<Diary, "content" | "textMarks">, page: BookTextPage) {
  return {
    content: diary.content.slice(page.start, page.end),
    textMarks: (diary.textMarks ?? []).filter((mark) => mark.end > page.start && mark.start < page.end)
      .map((mark) => ({ ...mark, start: Math.max(mark.start, page.start) - page.start, end: Math.min(mark.end, page.end) - page.start })),
  };
}

/** Reading scrolls vertically; only a clear horizontal gesture turns the page. */
export function bookSwipeDirection(deltaX: number, deltaY: number): BookDirection | null {
  if (Math.abs(deltaX) <= 45 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return null;
  return deltaX < 0 ? "next" : "previous";
}

export function bookPageTarget(current: number, direction: BookDirection, total: number): number | null {
  if (total <= 0) return null;
  const target = current + (direction === "next" ? 1 : -1);
  return target >= 0 && target < total ? target : null;
}

export function sortBookDiaries(diaries: Diary[], order: BookOrder): Diary[] {
  return [...diaries].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    const timeOrder = a.updatedAt - b.updatedAt;
    return order === "oldest" ? dateOrder || timeOrder : -dateOrder || -timeOrder;
  });
}
