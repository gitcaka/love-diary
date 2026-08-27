import type { AppData } from "@/lib/types";
import { DEFAULT_WRITER_APPEARANCE, normalizeAccent, normalizeMarker } from "./diary-style.ts";
import { normalizeTextMarks } from "./rich-text.ts";

const seed: AppData = {
  version: 6,
  seeded: true,
  profile: {
    name1: "恋人A",
    name2: "恋人B",
    currentUser: "person2",
    startDate: "2025-01-01",
    person1Accent: DEFAULT_WRITER_APPEARANCE.person1.accent,
    person2Accent: DEFAULT_WRITER_APPEARANCE.person2.accent,
    person1Marker: DEFAULT_WRITER_APPEARANCE.person1.marker,
    person2Marker: DEFAULT_WRITER_APPEARANCE.person2.marker,
    animations: true,
    lockEnabled: false,
  },
  diaries: [
    {
      id: "seed-walk",
      date: "2025-02-14",
      author: "person1",
      content: "傍晚一起去散步，风很舒服。你突然回头看我的时候，我还是会觉得好喜欢你。平凡的一天，因为是我们一起度过，就有了值得收藏的光。",
      mood: { id: "happy", name: "开心", emoji: "🥰" },
      weather: { id: "sunny", name: "晴天", emoji: "☀️" },
      images: [],
      special: true,
      createdAt: 1739491200000,
      updatedAt: 1739491200000,
    },
    {
      id: "seed-cake",
      date: "2025-02-01",
      author: "person2",
      content: "你本来说只吃一口，最后还是陪我一起把它吃完了。奶油甜甜的，你笑起来也是。",
      mood: { id: "heartbeat", name: "心动", emoji: "❤️" },
      weather: { id: "cloudy", name: "多云", emoji: "🌤️" },
      images: [],
      special: false,
      createdAt: 1738368000000,
      updatedAt: 1738368000000,
    },
  ],
  responses: [],
  trash: [],
  diaryHistory: [],
  anniversaries: [
    { id: "together", title: "我们在一起", date: "2025-01-01", calendar: "solar", emoji: "💗", description: "我们的故事，从这一天开始。" },
  ],
  capsules: [],
  wishes: [],
};

type StoredData = Omit<AppData, "version"> & { version: number };

export function createSeedData(): AppData {
  return structuredClone(seed);
}

function migrate(stored: StoredData): AppData {
  const normalized = {
    ...stored,
    version: 6 as const,
    seeded: typeof stored.seeded === "boolean" ? stored.seeded : false,
    profile: {
      ...stored.profile,
      name1: stored.profile.name1 || "恋人A",
      name2: stored.profile.name2 || "恋人B",
      currentUser: stored.profile.currentUser === "person1" ? "person1" as const : "person2" as const,
      startDate: stored.profile.startDate || "2025-01-01",
      person1Accent: normalizeAccent(stored.profile.person1Accent, DEFAULT_WRITER_APPEARANCE.person1.accent),
      person2Accent: normalizeAccent(stored.profile.person2Accent, DEFAULT_WRITER_APPEARANCE.person2.accent),
      person1Marker: normalizeMarker(stored.profile.person1Marker, DEFAULT_WRITER_APPEARANCE.person1.marker),
      person2Marker: normalizeMarker(stored.profile.person2Marker, DEFAULT_WRITER_APPEARANCE.person2.marker),
      animations: stored.profile.animations !== false,
      lockEnabled: Boolean(stored.profile.lockEnabled),
    },
    diaries: stored.diaries.map((diary) => ({
      ...diary,
      title: undefined,
      author: diary.author === "person2" ? "person2" as const : "person1" as const,
      images: Array.isArray(diary.images) ? diary.images : [],
      favorite: diary.favorite === true || diary.special === true,
      tags: Array.isArray(diary.tags) ? Array.from(new Set(diary.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))).slice(0, 8) : [],
      textMarks: normalizeTextMarks(diary.textMarks, diary.content.length),
    })),
    responses: Array.isArray(stored.responses) ? stored.responses.map((response) => ({
      ...response,
      author: response.author === "person1" ? "person1" as const : "person2" as const,
    })) : [],
    trash: Array.isArray(stored.trash) ? stored.trash.map((item) => ({
      ...item,
      diary: {
        ...item.diary,
        title: undefined,
        author: item.diary.author === "person2" ? "person2" as const : "person1" as const,
        images: Array.isArray(item.diary.images) ? item.diary.images : [],
        favorite: item.diary.favorite === true || item.diary.special === true,
        tags: Array.isArray(item.diary.tags) ? Array.from(new Set(item.diary.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))).slice(0, 8) : [],
        textMarks: normalizeTextMarks(item.diary.textMarks, item.diary.content.length),
      },
    })) : [],
    diaryHistory: Array.isArray(stored.diaryHistory) ? stored.diaryHistory.map((item) => ({
      ...item,
      diary: {
        ...item.diary,
        title: undefined,
        author: item.diary.author === "person2" ? "person2" as const : "person1" as const,
        images: Array.isArray(item.diary.images) ? item.diary.images : [],
        favorite: item.diary.favorite === true || item.diary.special === true,
        tags: Array.isArray(item.diary.tags) ? Array.from(new Set(item.diary.tags.filter((tag) => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))).slice(0, 8) : [],
        textMarks: normalizeTextMarks(item.diary.textMarks, item.diary.content.length),
      },
    })) : [],
    wishes: Array.isArray(stored.wishes) ? stored.wishes.map((wish) => ({
      ...wish,
      title: wish.title.trim().slice(0, 80),
      category: ["travel", "food", "date", "life", "photo"].includes(wish.category) ? wish.category : "date",
      createdBy: wish.createdBy === "person1" ? "person1" as const : "person2" as const,
      completed: wish.completed === true,
      completedAt: wish.completed === true && typeof wish.completedAt === "number" ? wish.completedAt : undefined,
      completionNote: wish.completed === true && typeof wish.completionNote === "string" ? wish.completionNote.trim().slice(0, 200) || undefined : undefined,
      completionImage: wish.completed === true && isImage(wish.completionImage) ? wish.completionImage : undefined,
      diaryId: typeof wish.diaryId === "string" && wish.diaryId.trim() ? wish.diaryId.trim() : undefined,
    })).filter((wish) => wish.title) : [],
  } satisfies AppData;

  if (stored.version >= 6) return normalized;

  const customAnniversaries = normalized.anniversaries.filter((item) => !["together", "birthday"].includes(item.id));
  return {
    ...normalized,
    profile: { ...normalized.profile, name1: "恋人A", name2: "恋人B", currentUser: "person2", startDate: "2025-01-01" },
    anniversaries: [...createSeedData().anniversaries, ...customAnniversaries],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMoodOrWeather(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.emoji === "string";
}

function isImage(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.url === "string"
    && isOptionalString(value.name);
}

function isDiary(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isDateString(value.date)
    && (value.author === undefined || value.author === "person1" || value.author === "person2")
    && isOptionalString(value.title)
    && typeof value.content === "string"
    && isMoodOrWeather(value.mood)
    && isMoodOrWeather(value.weather)
    && Array.isArray(value.images)
    && value.images.every(isImage)
    && typeof value.special === "boolean"
    && (value.favorite === undefined || typeof value.favorite === "boolean")
    && (value.tags === undefined || (Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === "string")))
    && (value.textMarks === undefined || (Array.isArray(value.textMarks) && value.textMarks.every((mark) => isRecord(mark)
      && Number.isInteger(mark.start)
      && Number.isInteger(mark.end)
      && typeof mark.color === "string")))
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt);
}

function isResponse(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.diaryId === "string"
    && (value.author === "person1" || value.author === "person2")
    && typeof value.emoji === "string"
    && typeof value.content === "string"
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt);
}

function isDeletedDiary(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && isDiary(value.diary)
    && typeof value.deletedAt === "number"
    && Number.isFinite(value.deletedAt);
}

function isHistoryEntry(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.diaryId === "string"
    && isDiary(value.diary)
    && typeof value.savedAt === "number"
    && Number.isFinite(value.savedAt);
}

function isAnniversary(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || typeof value.emoji !== "string"
    || !isOptionalString(value.description)
    || !isOptionalString(value.date)
    || (value.calendar !== undefined && value.calendar !== "solar" && value.calendar !== "lunar")) return false;
  if (value.date !== undefined && !isDateString(value.date)) return false;
  if (value.calendar === "lunar") {
    return Number.isInteger(value.lunarMonth)
      && Number(value.lunarMonth) >= 1
      && Number(value.lunarMonth) <= 12
      && Number.isInteger(value.lunarDay)
      && Number(value.lunarDay) >= 1
      && Number(value.lunarDay) <= 30;
  }
  return true;
}

function isCapsule(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.content === "string"
    && isDateString(value.openDate)
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt);
}

function isWish(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && ["travel", "food", "date", "life", "photo"].includes(String(value.category))
    && (value.createdBy === "person1" || value.createdBy === "person2")
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && typeof value.completed === "boolean"
    && (value.completedAt === undefined || (typeof value.completedAt === "number" && Number.isFinite(value.completedAt)))
    && isOptionalString(value.completionNote)
    && (value.completionImage === undefined || isImage(value.completionImage))
    && isOptionalString(value.diaryId);
}

function isProfile(value: unknown): boolean {
  return isRecord(value)
    && typeof value.name1 === "string"
    && typeof value.name2 === "string"
    && (value.currentUser === undefined || value.currentUser === "person1" || value.currentUser === "person2")
    && isDateString(value.startDate)
    && (value.animations === undefined || typeof value.animations === "boolean")
    && (value.lockEnabled === undefined || typeof value.lockEnabled === "boolean")
    && isOptionalString(value.coverImage)
    && isOptionalString(value.avatar1)
    && isOptionalString(value.avatar2)
    && isOptionalString(value.person1Accent)
    && isOptionalString(value.person2Accent)
    && isOptionalString(value.person1Marker)
    && isOptionalString(value.person2Marker)
    && isOptionalString(value.pinHash)
    && isOptionalString(value.pinSalt);
}

export function normalizeBackup(value: unknown): AppData | null {
  if (!isRecord(value)) return null;
  const data = value as Partial<StoredData>;
  const valid = typeof data.version === "number"
    && [1, 2, 3, 4, 5, 6].includes(data.version)
    && Array.isArray(data.diaries)
    && data.diaries.every(isDiary)
    && (data.responses === undefined || (Array.isArray(data.responses) && data.responses.every(isResponse)))
    && (data.trash === undefined || (Array.isArray(data.trash) && data.trash.every(isDeletedDiary)))
    && (data.diaryHistory === undefined || (Array.isArray(data.diaryHistory) && data.diaryHistory.every(isHistoryEntry)))
    && Array.isArray(data.anniversaries)
    && data.anniversaries.every(isAnniversary)
    && Array.isArray(data.capsules)
    && data.capsules.every(isCapsule)
    && (data.wishes === undefined || (Array.isArray(data.wishes) && data.wishes.every(isWish)))
    && isProfile(data.profile)
    && (data.seeded === undefined || typeof data.seeded === "boolean");
  return valid ? migrate(data as StoredData) : null;
}
