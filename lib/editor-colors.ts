import { applyTextColor, normalizeTextMarks, remapTextMarks } from "./rich-text.ts";
import type { DiaryTextMark } from "./types.ts";

// Use the actual selection to disambiguate repeated characters in a sentence.
export function colorTypedText(before: string, after: string, marks: DiaryTextMark[] | undefined, color: string | null,
  caretAfter = after.length, selection?: { start: number; end: number }) {
  let start = selection?.start ?? -1;
  let oldEnd = selection?.end ?? -1;
  let newEnd = after.length - (before.length - oldEnd);
  const validSelection = start >= 0 && oldEnd >= start && oldEnd <= before.length && newEnd >= start
    && before.slice(0, start) + after.slice(start, newEnd) + before.slice(oldEnd) === after;
  if (!validSelection) {
    start = 0;
    while (start < Math.min(before.length, after.length, caretAfter) && before[start] === after[start]) start++;
    let suffix = 0;
    while (suffix < Math.min(before.length, after.length) - start &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    oldEnd = before.length - suffix;
    newEnd = after.length - suffix;
  }
  const delta = newEnd - oldEnd;
  const kept = normalizeTextMarks(marks, before.length).flatMap((mark) => {
    const pieces: DiaryTextMark[] = [];
    if (mark.start < start) pieces.push({ ...mark, end: Math.min(mark.end, start) });
    if (mark.end > oldEnd) pieces.push({ ...mark, start: Math.max(mark.start, oldEnd) + delta, end: mark.end + delta });
    return pieces;
  });
  return applyTextColor(kept, start, newEnd, color, after.length);
}

// Only inserted text after a newline loses its color. Existing colored text in
// the unchanged suffix retains its formatting, even when Enter splits a line.
export function remapEditorColors(before: string, after: string, marks: DiaryTextMark[] | undefined) {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < Math.min(before.length, after.length) - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  const end = after.length - suffix;
  const newline = after.slice(start, end).indexOf("\n");
  const mapped = remapTextMarks(before, after, marks);
  return newline < 0 ? mapped : applyTextColor(mapped, start + newline, end, null, after.length);
}

export function selectionColor(marks: DiaryTextMark[] | undefined, start: number, end: number, length: number): string | "mixed" | null {
  if (start >= end) return null;
  const colors = new Set<string | null>();
  let cursor = start;
  for (const mark of normalizeTextMarks(marks, length)) {
    if (mark.end <= start || mark.start >= end) continue;
    if (mark.start > cursor) colors.add(null);
    colors.add(mark.color);
    cursor = Math.max(cursor, Math.min(end, mark.end));
  }
  if (cursor < end) colors.add(null);
  return colors.size > 1 ? "mixed" : [...colors][0] ?? null;
}
