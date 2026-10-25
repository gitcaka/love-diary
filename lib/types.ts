export interface Mood {
  id: string;
  name: string;
  emoji: string;
}

export interface Weather {
  id: string;
  name: string;
  emoji: string;
}

export interface DiaryImage {
  id: string;
  url: string;
  name?: string;
}

export type DiaryAuthor = "person1" | "person2";

export interface DiaryTextMark {
  start: number;
  end: number;
  color: string;
}

export interface Diary {
  id: string;
  date: string;
  author: DiaryAuthor;
  /** Kept optional for backward-compatible imports; the product uses titleless entries. */
  title?: string;
  content: string;
  mood: Mood;
  weather: Weather;
  images: DiaryImage[];
  special: boolean;
  favorite?: boolean;
  tags?: string[];
  /** Optional color ranges over the plain-text content; old diaries remain unformatted. */
  textMarks?: DiaryTextMark[];
  createdAt: number;
  updatedAt: number;
}

export interface DiaryResponse {
  id: string;
  diaryId: string;
  author: DiaryAuthor;
  emoji: string;
  content: string;
  createdAt: number;
}

export interface DeletedDiary {
  id: string;
  diary: Diary;
  deletedAt: number;
}

export interface DiaryHistoryEntry {
  id: string;
  diaryId: string;
  diary: Diary;
  savedAt: number;
}

export interface Anniversary {
  id: string;
  title: string;
  date?: string;
  emoji: string;
  description?: string;
  calendar?: "solar" | "lunar";
  lunarMonth?: number;
  lunarDay?: number;
  /** False for a one-off relationship milestone; omitted legacy dates recur yearly. */
  recurring?: boolean;
  /** Generated in the browser from the relationship start date, never stored in cloud data. */
  automatic?: boolean;
  category?: "milestone" | "holiday";
}

export interface TimeCapsule {
  id: string;
  title: string;
  content: string;
  openDate: string;
  createdAt: number;
}

export type WishCategory = "travel" | "food" | "date" | "life" | "photo";

export interface WishItem {
  id: string;
  title: string;
  category: WishCategory;
  createdBy: DiaryAuthor;
  createdAt: number;
  completed: boolean;
  completedAt?: number;
  completionNote?: string;
  completionImage?: DiaryImage;
  /** The diary created from this completed wish. Optional for all existing version 6 data. */
  diaryId?: string;
}

export interface CoupleProfile {
  name1: string;
  name2: string;
  currentUser: DiaryAuthor;
  startDate: string;
  coverImage?: string;
  avatar1?: string;
  avatar2?: string;
  person1Accent: string;
  person2Accent: string;
  person1Marker: string;
  person2Marker: string;
  animations: boolean;
  lockEnabled: boolean;
  pinHash?: string;
  pinSalt?: string;
}

export interface AppData {
  version: 6;
  diaries: Diary[];
  responses: DiaryResponse[];
  /** Legacy archives retained for backup compatibility; the website no longer creates or exposes a recycle bin. */
  trash: DeletedDiary[];
  diaryHistory: DiaryHistoryEntry[];
  anniversaries: Anniversary[];
  capsules: TimeCapsule[];
  wishes: WishItem[];
  profile: CoupleProfile;
  seeded: boolean;
}

export type ViewName = "home" | "book" | "wishes" | "editor" | "gallery" | "us" | "detail";

export interface AppRoute {
  view: ViewName;
  id?: string;
  date?: string;
  wishId?: string;
}
