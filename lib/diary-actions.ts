import type { AppData } from "./types.ts";

/** Remove a live diary and its links, without purging legacy archives or media. */
export function removePublishedDiary(data: AppData, diaryId: string): AppData {
  if (!data.diaries.some((diary) => diary.id === diaryId)) return data;
  return {
    ...data,
    diaries: data.diaries.filter((diary) => diary.id !== diaryId),
    responses: data.responses.filter((response) => response.diaryId !== diaryId),
    diaryHistory: data.diaryHistory.filter((entry) => entry.diaryId !== diaryId),
    wishes: data.wishes.map((wish) => wish.diaryId === diaryId ? { ...wish, diaryId: undefined } : wish),
  };
}
