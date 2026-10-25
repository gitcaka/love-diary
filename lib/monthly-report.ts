import { isDiaryFavorite } from "./diary-memory.ts";
import type { Diary, DiaryAuthor, DiaryImage, Mood, Weather } from "./types.ts";

export interface MonthlyReport {
  month: string;
  diaries: Diary[];
  diaryCount: number;
  photoCount: number;
  photos: DiaryImage[];
  favoriteCount: number;
  authorCounts: Record<DiaryAuthor, number>;
  leadingAuthor: DiaryAuthor | "tie";
  topMood?: { value: Mood; count: number };
  topWeather?: { value: Weather; count: number };
  topTags: Array<{ tag: string; count: number }>;
  first?: Diary;
  highlight?: Diary;
  random?: Diary;
}

function mostCommon<T extends { id: string }>(values: T[]): { value: T; count: number } | undefined {
  const counts = new Map<string, { value: T; count: number }>();
  values.forEach((value) => counts.set(value.id, { value, count: (counts.get(value.id)?.count ?? 0) + 1 }));
  return [...counts.values()].sort((a, b) => b.count - a.count || a.value.id.localeCompare(b.value.id))[0];
}

function stableIndex(month: string, length: number): number {
  if (!length) return 0;
  const hash = [...month].reduce((total, char, index) => total + char.charCodeAt(0) * (index + 7), length * 17);
  return hash % length;
}

export function availableReportMonths(diaries: Diary[]): string[] {
  return Array.from(new Set(diaries.map((diary) => diary.date.slice(0, 7)))).sort().reverse();
}

export function buildMonthlyReport(diaries: Diary[], month: string, options: { prioritizeFavorites?: boolean } = {}): MonthlyReport {
  const monthly = diaries
    .filter((diary) => diary.date.startsWith(month))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const authorCounts = monthly.reduce<Record<DiaryAuthor, number>>((counts, diary) => {
    counts[diary.author] += 1;
    return counts;
  }, { person1: 0, person2: 0 });
  const leadingAuthor: MonthlyReport["leadingAuthor"] = authorCounts.person1 === authorCounts.person2
    ? "tie"
    : authorCounts.person1 > authorCounts.person2 ? "person1" : "person2";
  const tagCounts = new Map<string, number>();
  monthly.forEach((diary) => (diary.tags ?? []).forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)));
  const highlight = [...monthly].sort((a, b) => {
    const score = (diary: Diary) => (options.prioritizeFavorites !== false ? Number(isDiaryFavorite(diary)) * 100 : 0) + diary.images.length * 10 + diary.content.length / 100;
    return score(b) - score(a) || b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt;
  })[0];

  return {
    month,
    diaries: monthly,
    diaryCount: monthly.length,
    photoCount: monthly.reduce((total, diary) => total + diary.images.length, 0),
    photos: monthly.flatMap((diary) => diary.images),
    favoriteCount: monthly.filter(isDiaryFavorite).length,
    authorCounts,
    leadingAuthor,
    topMood: mostCommon(monthly.map((diary) => diary.mood)),
    topWeather: mostCommon(monthly.map((diary) => diary.weather)),
    topTags: [...tagCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN")).slice(0, 5),
    first: monthly[0],
    highlight,
    random: monthly[stableIndex(month, monthly.length)],
  };
}

export function reportMonthLabel(month: string): string {
  const [year, value] = month.split("-");
  return `${year}年${Number(value)}月`;
}
