import type { DiaryTextMark } from "./types.ts";

export const TEXT_COLOR_PALETTE = [
  { name: "樱花粉", value: "#d96f92" },
  { name: "莓果红", value: "#bf5f6a" },
  { name: "葡萄紫", value: "#8f72ad" },
  { name: "暮色蓝", value: "#6686ad" },
  { name: "奶茶棕", value: "#9a735f" },
  { name: "松叶绿", value: "#668879" },
] as const;

const ALLOWED_COLORS = new Set<string>(TEXT_COLOR_PALETTE.map((color) => color.value));

export function normalizeTextMarks(value: unknown, contentLength: number): DiaryTextMark[] {
  if (!Array.isArray(value) || contentLength <= 0) return [];
  const marks = value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const mark = entry as Partial<DiaryTextMark>;
    if (!Number.isInteger(mark.start) || !Number.isInteger(mark.end) || typeof mark.color !== "string") return [];
    const start = Math.max(0, Math.min(contentLength, Number(mark.start)));
    const end = Math.max(0, Math.min(contentLength, Number(mark.end)));
    const color = mark.color.toLowerCase();
    return start < end && ALLOWED_COLORS.has(color) ? [{ start, end, color }] : [];
  }).sort((a, b) => a.start - b.start || a.end - b.end);

  return marks.reduce<DiaryTextMark[]>((result, mark) => {
    const previous = result.at(-1);
    if (previous && previous.color === mark.color && mark.start <= previous.end) {
      previous.end = Math.max(previous.end, mark.end);
    } else if (!previous || mark.start >= previous.end) {
      result.push({ ...mark });
    } else if (mark.end > previous.end) {
      result.push({ ...mark, start: previous.end });
    }
    return result;
  }, []);
}

export function applyTextColor(marks: DiaryTextMark[] | undefined, start: number, end: number, color: string | null, contentLength: number): DiaryTextMark[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > contentLength || start >= end) return normalizeTextMarks(marks, contentLength);
  const next = normalizeTextMarks(marks, contentLength).flatMap((mark) => {
    if (mark.end <= start || mark.start >= end) return [mark];
    const pieces: DiaryTextMark[] = [];
    if (mark.start < start) pieces.push({ ...mark, end: start });
    if (mark.end > end) pieces.push({ ...mark, start: end });
    return pieces;
  });
  if (color && ALLOWED_COLORS.has(color.toLowerCase())) next.push({ start, end, color: color.toLowerCase() });
  return normalizeTextMarks(next, contentLength);
}

export function remapTextMarks(oldContent: string, newContent: string, marks: DiaryTextMark[] | undefined): DiaryTextMark[] {
  if (!marks?.length || oldContent === newContent) return normalizeTextMarks(marks, newContent.length);
  let prefix = 0;
  const shortest = Math.min(oldContent.length, newContent.length);
  while (prefix < shortest && oldContent[prefix] === newContent[prefix]) prefix += 1;

  let suffix = 0;
  while (suffix < shortest - prefix && oldContent[oldContent.length - 1 - suffix] === newContent[newContent.length - 1 - suffix]) suffix += 1;

  const oldEnd = oldContent.length - suffix;
  const newEnd = newContent.length - suffix;
  const delta = newContent.length - oldContent.length;
  const remapped = normalizeTextMarks(marks, oldContent.length).flatMap((mark) => {
    if (mark.end <= prefix) return [mark];
    if (mark.start >= oldEnd) return [{ ...mark, start: mark.start + delta, end: mark.end + delta }];

    const pieces: DiaryTextMark[] = [];
    const coversEdit = mark.start <= prefix && mark.end >= oldEnd;
    if (coversEdit) {
      pieces.push({ ...mark, end: mark.end + delta });
    } else {
      if (mark.start < prefix) pieces.push({ ...mark, end: prefix });
      if (mark.end > oldEnd) pieces.push({ ...mark, start: newEnd, end: mark.end + delta });
    }
    return pieces;
  });
  return normalizeTextMarks(remapped, newContent.length);
}

export function trimTextAndMarks(content: string, marks: DiaryTextMark[] | undefined): { content: string; textMarks: DiaryTextMark[] } {
  const leading = content.length - content.trimStart().length;
  const trimmed = content.trim();
  const shifted = normalizeTextMarks(marks, content.length).map((mark) => ({ ...mark, start: mark.start - leading, end: mark.end - leading }));
  return { content: trimmed, textMarks: normalizeTextMarks(shifted, trimmed.length) };
}

export function textSegments(content: string, marks: DiaryTextMark[] | undefined): Array<{ text: string; color?: string }> {
  const normalized = normalizeTextMarks(marks, content.length);
  const segments: Array<{ text: string; color?: string }> = [];
  let cursor = 0;
  normalized.forEach((mark) => {
    if (mark.start > cursor) segments.push({ text: content.slice(cursor, mark.start) });
    segments.push({ text: content.slice(mark.start, mark.end), color: mark.color });
    cursor = mark.end;
  });
  if (cursor < content.length) segments.push({ text: content.slice(cursor) });
  return segments;
}
