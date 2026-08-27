import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { normalizeBackup } from "./data.ts";
import type { AppData, Diary, DiaryImage } from "./types.ts";

const BACKUP_FORMAT = "love-diary-complete-backup";

interface BackupMediaEntry {
  url: string;
  path: string;
  name: string;
  type: string;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  exportedAt: string;
  data: AppData;
  media: BackupMediaEntry[];
}

export interface RestorableBackup {
  data: AppData;
  media: Array<{ url: string; file: File }>;
}

function safeName(value: string): string {
  return [...value].filter((character) => character.charCodeAt(0) >= 32).join("").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "photo";
}

function extension(type: string, url: string): string {
  const known: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic", "image/heif": "heic", "image/avif": "avif" };
  if (known[type]) return known[type];
  const match = /\.([a-z0-9]{2,5})(?:$|[?#])/i.exec(url);
  return match?.[1].toLowerCase() || "jpg";
}

function collectMedia(data: AppData): Array<{ url: string; name: string }> {
  const found = new Map<string, string>();
  const add = (url?: string, name = "photo") => { if (url && !found.has(url)) found.set(url, name); };
  const addDiary = (diary: Diary) => diary.images.forEach((image, index) => add(image.url, image.name || `${diary.date}-${index + 1}`));
  data.diaries.forEach(addDiary);
  data.trash.forEach((item) => addDiary(item.diary));
  data.diaryHistory.forEach((item) => addDiary(item.diary));
  data.wishes.forEach((wish) => add(wish.completionImage?.url, wish.completionImage?.name || `${wish.title}-完成照片`));
  add(data.profile.avatar1, `${data.profile.name1}-头像`);
  add(data.profile.avatar2, `${data.profile.name2}-头像`);
  add(data.profile.coverImage, "首页封面");
  return [...found].map(([url, name]) => ({ url, name }));
}

export function completeBackupMediaCount(data: AppData): number {
  return collectMedia(data).length;
}

export async function createCompleteBackup(data: AppData, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const references = collectMedia(data);
  const files: Record<string, Uint8Array> = {};
  const media: BackupMediaEntry[] = [];
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const response = await fetch(reference.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`PHOTO_FETCH_FAILED:${reference.name}`);
    const blob = await response.blob();
    const type = blob.type || response.headers.get("content-type") || "image/jpeg";
    const path = `photos/${String(index + 1).padStart(3, "0")}-${safeName(reference.name)}.${extension(type, reference.url)}`;
    files[path] = new Uint8Array(await blob.arrayBuffer());
    media.push({ url: reference.url, path, name: safeName(reference.name), type });
    onProgress?.(index + 1, references.length);
  }
  const manifest: BackupManifest = { format: BACKUP_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), data, media };
  files["backup.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["请先读我.txt"] = strToU8("这是《恋爱日记》完整备份包，包含数据与全部照片。请保留整个 ZIP 文件，并在网页设置 → 数据安全中恢复。\n");
  return new Blob([Uint8Array.from(zipSync(files, { level: 0 })).buffer], { type: "application/zip" });
}

export async function readCompleteBackup(file: File): Promise<RestorableBackup> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = archive["backup.json"];
  if (!manifestBytes) throw new Error("BACKUP_MANIFEST_MISSING");
  const value = JSON.parse(strFromU8(manifestBytes)) as Partial<BackupManifest>;
  if (value.format !== BACKUP_FORMAT || value.formatVersion !== 1 || !Array.isArray(value.media)) throw new Error("BACKUP_FORMAT_INVALID");
  const data = normalizeBackup(value.data);
  if (!data) throw new Error("BACKUP_DATA_INVALID");
  const media = value.media.map((entry) => {
    const bytes = archive[entry.path];
    if (!bytes || typeof entry.url !== "string") throw new Error("BACKUP_PHOTO_MISSING");
    return { url: entry.url, file: new File([Uint8Array.from(bytes).buffer], entry.name, { type: entry.type || "image/jpeg" }) };
  });
  return { data, media };
}

function replaceDiaryImages(diary: Diary, replacements: Map<string, DiaryImage>): Diary {
  return { ...diary, images: diary.images.map((image) => replacements.get(image.url) ?? image) };
}

export function replaceBackupMedia(data: AppData, replacements: Map<string, DiaryImage>): AppData {
  const profile = { ...data.profile };
  for (const key of ["avatar1", "avatar2", "coverImage"] as const) {
    const url = profile[key];
    if (url && replacements.has(url)) profile[key] = replacements.get(url)?.url;
  }
  return {
    ...data,
    profile,
    diaries: data.diaries.map((diary) => replaceDiaryImages(diary, replacements)),
    trash: data.trash.map((item) => ({ ...item, diary: replaceDiaryImages(item.diary, replacements) })),
    diaryHistory: data.diaryHistory.map((item) => ({ ...item, diary: replaceDiaryImages(item.diary, replacements) })),
    wishes: data.wishes.map((wish) => ({
      ...wish,
      completionImage: wish.completionImage ? replacements.get(wish.completionImage.url) ?? wish.completionImage : undefined,
    })),
  };
}
