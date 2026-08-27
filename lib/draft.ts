import { normalizeTextMarks } from "./rich-text.ts";
import type { Diary, DiaryAuthor, DiaryTextMark, Mood, Weather } from "./types.ts";

export interface DiaryDraftSnapshot {
  date: string;
  author: DiaryAuthor;
  content: string;
  mood: Mood;
  weather: Weather;
  special: boolean;
  favorite?: boolean;
  tags?: string[];
  textMarks?: DiaryTextMark[];
  savedAt: number;
  sourceUpdatedAt?: number;
}

export function diaryDraftKey(diaryId: string | undefined, author: DiaryAuthor): string {
  return `love-diary:draft:${diaryId ?? `new-${author}`}`;
}

export function createDraftSnapshot(diary: Diary, sourceUpdatedAt?: number, savedAt = Date.now()): DiaryDraftSnapshot {
  return {
    date: diary.date,
    author: diary.author,
    content: diary.content,
    mood: diary.mood,
    weather: diary.weather,
    special: diary.special,
    favorite: diary.favorite === true,
    tags: [...(diary.tags ?? [])],
    textMarks: normalizeTextMarks(diary.textMarks, diary.content.length),
    savedAt,
    sourceUpdatedAt,
  };
}

function isDraftSnapshot(value: unknown): value is DiaryDraftSnapshot {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<DiaryDraftSnapshot>;
  return typeof draft.date === "string"
    && (draft.author === "person1" || draft.author === "person2")
    && typeof draft.content === "string"
    && Boolean(draft.mood && typeof draft.mood.id === "string" && typeof draft.mood.name === "string" && typeof draft.mood.emoji === "string")
    && Boolean(draft.weather && typeof draft.weather.id === "string" && typeof draft.weather.name === "string" && typeof draft.weather.emoji === "string")
    && typeof draft.special === "boolean"
    && (draft.favorite === undefined || typeof draft.favorite === "boolean")
    && (draft.tags === undefined || (Array.isArray(draft.tags) && draft.tags.every((tag) => typeof tag === "string")))
    && (draft.textMarks === undefined || Array.isArray(draft.textMarks))
    && typeof draft.savedAt === "number";
}

export function restoreDiaryDraft(base: Diary, value: unknown): Diary | null {
  if (!isDraftSnapshot(value)) return null;
  if (value.sourceUpdatedAt !== undefined && value.sourceUpdatedAt !== base.updatedAt) return null;
  if (value.sourceUpdatedAt !== undefined && value.savedAt <= base.updatedAt) return null;
  return {
    ...base,
    date: value.date,
    author: value.author,
    content: value.content,
    mood: value.mood,
    weather: value.weather,
    special: value.special,
    favorite: value.favorite ?? base.favorite,
    tags: value.tags ? [...value.tags] : base.tags,
    textMarks: normalizeTextMarks(value.textMarks, value.content.length),
  };
}
