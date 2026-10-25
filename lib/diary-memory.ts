import type { Diary, DiaryAuthor, DiaryHistoryEntry } from "./types.ts";
import { createId } from "./id.ts";

export interface DiaryFilters {
  query: string;
  author: "all" | DiaryAuthor;
  month: "all" | string;
  tag: "all" | string;
  hasPhotos: boolean;
  favoritesOnly: boolean;
}

export function isDiaryFavorite(diary: Pick<Diary, "favorite" | "special">): boolean {
  return diary.favorite === true || diary.special === true;
}

export function filterDiaries(diaries: Diary[], filters: DiaryFilters, options: { includeTags?: boolean; includeFavorites?: boolean } = {}): Diary[] {
  // Keep legacy callers compatible; the web no longer exposes or searches tags.
  const includeTags = options.includeTags !== false;
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return diaries.filter((diary) => {
    if (filters.author !== "all" && diary.author !== filters.author) return false;
    if (filters.month !== "all" && !diary.date.startsWith(filters.month)) return false;
    if (includeTags && filters.tag !== "all" && !(diary.tags ?? []).includes(filters.tag)) return false;
    if (filters.hasPhotos && diary.images.length === 0) return false;
    if (options.includeFavorites !== false && filters.favoritesOnly && !isDiaryFavorite(diary)) return false;
    if (!query) return true;
    return [diary.content, diary.mood.name, diary.weather.name, diary.date, ...(includeTags ? diary.tags ?? [] : [])]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
  });
}

export function appendDiaryHistory(history: DiaryHistoryEntry[], diary: Diary, savedAt = Date.now(), perDiaryLimit = 8): DiaryHistoryEntry[] {
  const entry: DiaryHistoryEntry = {
    id: createId(),
    diaryId: diary.id,
    diary: structuredClone(diary),
    savedAt,
  };
  let keptForDiary = 0;
  return [entry, ...history].filter((item) => {
    if (item.diaryId !== diary.id) return true;
    keptForDiary += 1;
    return keptForDiary <= perDiaryLimit;
  });
}
