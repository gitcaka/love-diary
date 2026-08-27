import type { Diary } from "./types.ts";

function dayNumber(value: string): number {
  return Date.parse(`${value}T12:00:00`);
}

function dateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export interface MemoryReview {
  onThisDay?: Diary;
  monthAgo?: Diary;
  random?: Diary;
  first?: Diary;
}

export function buildMemoryReview(diaries: Diary[], today: string): MemoryReview {
  if (!diaries.length) return {};
  const ordered = [...diaries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const monthDay = today.slice(5);
  const currentYear = today.slice(0, 4);
  const onThisDay = [...ordered].reverse().find((diary) => diary.date.slice(5) === monthDay && diary.date.slice(0, 4) < currentYear);

  const todayDate = new Date(`${today}T12:00:00`);
  todayDate.setMonth(todayDate.getMonth() - 1);
  const monthTarget = dateInput(todayDate);
  const monthAgo = ordered
    .map((diary) => ({ diary, distance: Math.abs(dayNumber(diary.date) - dayNumber(monthTarget)) }))
    .filter((item) => item.distance <= 7 * 86_400_000)
    .sort((a, b) => a.distance - b.distance)[0]?.diary;

  const seed = Number(today.replaceAll("-", "")) || 0;
  const randomPool = ordered.filter((diary) => diary.id !== onThisDay?.id && diary.id !== monthAgo?.id);
  const random = randomPool.length ? randomPool[seed % randomPool.length] : ordered[seed % ordered.length];
  return { onThisDay, monthAgo, random, first: ordered[0] };
}
