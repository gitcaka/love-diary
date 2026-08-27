import { createSeedData, normalizeBackup } from "@/lib/data";
import { compressImageForUpload } from "@/lib/image-compression";
import type { AppData, DiaryAuthor, DiaryImage } from "@/lib/types";

const DB_NAME = "love-diary";
const STORE = "app-data";
const KEY = "state";

const SESSION_KEY = "love-diary-session-token";
const LEGACY_WRITER_KEY = "love-diary-writer-key";
const IDENTITY_KEY = "love-diary-current-user";
let cloudRevision: number | null = null;
let writerAuthorized = false;

export interface CloudSnapshotSummary {
  id: string;
  revision: number;
  createdAt: string;
  diaries: number;
  photos: number;
  wishes: number;
}


async function cloudFetch(path: string, init: RequestInit = {}, timeout = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(apiUrl(path), { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

function apiUrl(path: string): string {
  if (typeof document === "undefined") return path;
  const base = document.querySelector<HTMLMetaElement>('meta[name="love-diary-api-base"]')?.content.trim();
  return base ? new URL(path, `${base.replace(/\/$/, "")}/`).toString() : path;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type StoredData = Omit<AppData, "version"> & { version: number };

async function readLocal(): Promise<AppData | null> {
  const db = await openDatabase();
  const value = await new Promise<StoredData | undefined>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve(request.result as StoredData | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value ? normalizeBackup(value) : null;
}

async function writeLocal(data: AppData): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(data, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function deviceIdentity(): DiaryAuthor {
  if (typeof localStorage === "undefined") return "person2";
  return localStorage.getItem(IDENTITY_KEY) === "person1" ? "person1" : "person2";
}

function writerKey(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(SESSION_KEY);
}

function clearWriterAuthorization(resetIdentity = true): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_WRITER_KEY);
    if (resetIdentity) localStorage.setItem(IDENTITY_KEY, "person2");
  }
  writerAuthorized = false;
}

function authHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {};
  const key = writerKey();
  if (key) headers.Authorization = `Bearer ${key}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function withDeviceSettings(cloud: AppData, local: AppData | null): AppData {
  return {
    ...cloud,
    profile: {
      ...cloud.profile,
      currentUser: deviceIdentity(),
      lockEnabled: local?.profile.lockEnabled ?? false,
      pinHash: local?.profile.pinHash,
      pinSalt: local?.profile.pinSalt,
    },
  };
}

function cloudPayload(data: AppData): AppData {
  return {
    ...data,
    profile: {
      ...data.profile,
      currentUser: "person2",
      lockEnabled: false,
      pinHash: undefined,
      pinSalt: undefined,
    },
  };
}

function publicLocalState(data: AppData): AppData {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return {
    ...data,
    capsules: data.capsules.map((capsule) => capsule.openDate > today ? { ...capsule, content: "" } : capsule),
    trash: [],
    diaryHistory: [],
    profile: {
      ...data.profile,
      currentUser: "person2",
      lockEnabled: false,
      pinHash: undefined,
      pinSalt: undefined,
    },
  };
}

function dataUrlToFile(value: string, name: string): File {
  const [header, encoded] = value.split(",", 2);
  const type = /data:([^;]+)/.exec(header)?.[1] || "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name, { type });
}

async function uploadEmbeddedAssets(data: AppData): Promise<AppData> {
  const next = structuredClone(data);
  const uploaded = new Map<string, DiaryImage>();
  const nestedDiaries = [
    ...next.diaries,
    ...next.trash.map((item) => item.diary),
    ...next.diaryHistory.map((item) => item.diary),
  ];
  for (const diary of nestedDiaries) {
    for (let index = 0; index < diary.images.length; index += 1) {
      const image = diary.images[index];
      if (!image.url.startsWith("data:")) continue;
      const cached = uploaded.get(image.id);
      if (cached) {
        diary.images[index] = cached;
        continue;
      }
      const uploadedImage = await loveDiaryRepository.uploadImage(dataUrlToFile(image.url, image.name || `${image.id}.jpg`), image.id);
      uploaded.set(image.id, uploadedImage);
      diary.images[index] = uploadedImage;
    }
  }
  for (const wish of next.wishes) {
    const image = wish.completionImage;
    if (!image?.url.startsWith("data:")) continue;
    const cached = uploaded.get(image.id);
    if (cached) {
      wish.completionImage = cached;
      continue;
    }
    const uploadedImage = await loveDiaryRepository.uploadImage(dataUrlToFile(image.url, image.name || `${image.id}.jpg`), image.id);
    uploaded.set(image.id, uploadedImage);
    wish.completionImage = uploadedImage;
  }
  for (const key of ["avatar1", "avatar2", "coverImage"] as const) {
    const value = next.profile[key];
    if (value?.startsWith("data:")) {
      next.profile[key] = (await loveDiaryRepository.uploadImage(dataUrlToFile(value, `${key}.jpg`), `${key}-${crypto.randomUUID()}`)).url;
    }
  }
  return next;
}

export const loveDiaryRepository = {
  initializeDevice(): boolean {
    if (typeof window === "undefined") return false;
    localStorage.removeItem(LEGACY_WRITER_KEY);
    const params = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const hadLegacyAuthorization = hashParams.has("writer") || params.has("writer") || hashParams.has("identity") || params.has("identity");
    if (hadLegacyAuthorization) {
      params.delete("writer");
      params.delete("identity");
      hashParams.delete("writer");
      hashParams.delete("identity");
      const query = params.toString();
      const hash = hashParams.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`);
    }
    if (!writerKey()) localStorage.setItem(IDENTITY_KEY, "person2");
    return Boolean(writerKey());
  },

  hasWriterAccess(): boolean {
    return writerAuthorized;
  },

  getRevision(): number | null {
    return cloudRevision;
  },

  async loadCached(): Promise<AppData | null> {
    const local = await readLocal();
    return local ? withDeviceSettings(writerAuthorized ? local : publicLocalState(local), local) : null;
  },

  async load(): Promise<AppData> {
    const local = await readLocal();
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const cached = local ?? createSeedData();
      return withDeviceSettings(writerAuthorized ? cached : publicLocalState(cached), local);
    }
    try {
      const response = await cloudFetch("/api/state", { cache: "no-store", headers: authHeaders() });
      if (!response.ok) throw new Error(`Cloud state returned ${response.status}`);
      const payload = await response.json() as { data?: unknown; revision?: number; canWrite?: boolean; identity?: DiaryAuthor };
      const cloud = normalizeBackup(payload.data);
      if (!cloud) throw new Error("Cloud state is invalid");
      cloudRevision = typeof payload.revision === "number" ? payload.revision : null;
      writerAuthorized = payload.canWrite === true && (payload.identity === "person1" || payload.identity === "person2");
      if (writerAuthorized && payload.identity) localStorage.setItem(IDENTITY_KEY, payload.identity);
      else if (writerKey()) clearWriterAuthorization();
      const merged = withDeviceSettings(cloud, local);
      await writeLocal(merged);
      return merged;
    } catch {
      const cached = local ?? createSeedData();
      return withDeviceSettings(writerAuthorized ? cached : publicLocalState(cached), local);
    }
  },

  async login(password: string): Promise<AppData> {
    const response = await cloudFetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (response.status === 401) throw new Error("LOGIN_INVALID");
    if (response.status === 429) throw new Error("LOGIN_RATE_LIMIT");
    if (!response.ok) throw new Error("LOGIN_FAILED");
    const payload = await response.json() as { token?: unknown; identity?: unknown };
    if (typeof payload.token !== "string" || (payload.identity !== "person1" && payload.identity !== "person2")) throw new Error("LOGIN_FAILED");
    localStorage.setItem(SESSION_KEY, payload.token);
    localStorage.setItem(IDENTITY_KEY, payload.identity);
    writerAuthorized = true;
    const data = await loveDiaryRepository.load();
    if (!writerAuthorized) throw new Error("LOGIN_FAILED");
    return data;
  },

  async logout(): Promise<AppData> {
    clearWriterAuthorization();
    const local = await readLocal();
    if (local) await writeLocal(withDeviceSettings(publicLocalState(local), local));
    return loveDiaryRepository.load();
  },

  async save(data: AppData, expectedRevision = cloudRevision): Promise<AppData> {
    if (!writerKey()) throw new Error("READ_ONLY");
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new Error("OFFLINE");
    }
    const prepared = await uploadEmbeddedAssets(data);
    const response = await cloudFetch("/api/state", {
      method: "PUT",
      headers: authHeaders(true),
      body: JSON.stringify({ data: cloudPayload(prepared), revision: expectedRevision }),
    });
    if (response.status === 409) throw new Error("CLOUD_CONFLICT");
    if (response.status === 401) {
      clearWriterAuthorization();
      throw new Error("WRITE_KEY_INVALID");
    }
    if (!response.ok) throw new Error(`Cloud save returned ${response.status}`);
    const payload = await response.json() as { data?: unknown; revision?: number };
    const saved = normalizeBackup(payload.data) ?? prepared;
    cloudRevision = typeof payload.revision === "number" ? payload.revision : cloudRevision;
    const merged = withDeviceSettings(saved, prepared);
    await writeLocal(merged);
    return merged;
  },

  async uploadImage(file: File, id = crypto.randomUUID()): Promise<DiaryImage> {
    if (!writerKey()) throw new Error("READ_ONLY");
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("OFFLINE");
    const uploadFile = await compressImageForUpload(file);
    const form = new FormData();
    form.set("file", uploadFile, uploadFile.name);
    form.set("id", id);
    const response = await cloudFetch("/api/media", { method: "POST", headers: authHeaders(), body: form }, 60_000);
    if (response.status === 401) {
      clearWriterAuthorization();
      throw new Error("WRITE_KEY_INVALID");
    }
    if (!response.ok) throw new Error(`Upload returned ${response.status}`);
    return response.json() as Promise<DiaryImage>;
  },

  async deleteUploadedImage(image: DiaryImage): Promise<void> {
    if (!writerKey() || !image.url.includes("/media/")) return;
    const response = await cloudFetch("/api/media", {
      method: "DELETE",
      headers: authHeaders(true),
      body: JSON.stringify({ url: image.url }),
    });
    if (response.status === 401) clearWriterAuthorization();
  },

  async clearSamples(data: AppData): Promise<AppData> {
    return { ...data, diaries: data.diaries.filter((diary) => !diary.id.startsWith("seed-")), seeded: false };
  },

  async listSnapshots(): Promise<CloudSnapshotSummary[]> {
    if (!writerKey()) return [];
    const response = await cloudFetch("/api/snapshots", { cache: "no-store", headers: authHeaders() });
    if (response.status === 401) {
      clearWriterAuthorization();
      throw new Error("WRITE_KEY_INVALID");
    }
    if (!response.ok) throw new Error("SNAPSHOT_LIST_FAILED");
    const payload = await response.json() as { snapshots?: CloudSnapshotSummary[] };
    return Array.isArray(payload.snapshots) ? payload.snapshots : [];
  },

  async createSnapshot(): Promise<CloudSnapshotSummary> {
    if (!writerKey()) throw new Error("READ_ONLY");
    const response = await cloudFetch("/api/snapshots", { method: "POST", headers: authHeaders(true), body: "{}" });
    if (response.status === 401) {
      clearWriterAuthorization();
      throw new Error("WRITE_KEY_INVALID");
    }
    if (!response.ok) throw new Error("SNAPSHOT_CREATE_FAILED");
    const payload = await response.json() as { snapshot?: CloudSnapshotSummary };
    if (!payload.snapshot) throw new Error("SNAPSHOT_CREATE_FAILED");
    return payload.snapshot;
  },

  async restoreSnapshot(id: string, expectedRevision = cloudRevision): Promise<AppData> {
    if (!writerKey()) throw new Error("READ_ONLY");
    const local = await readLocal();
    const response = await cloudFetch("/api/snapshots/restore", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ id, revision: expectedRevision }),
    });
    if (response.status === 409) throw new Error("CLOUD_CONFLICT");
    if (response.status === 401) {
      clearWriterAuthorization();
      throw new Error("WRITE_KEY_INVALID");
    }
    if (!response.ok) throw new Error("SNAPSHOT_RESTORE_FAILED");
    const payload = await response.json() as { data?: unknown; revision?: number };
    const restored = normalizeBackup(payload.data);
    if (!restored) throw new Error("SNAPSHOT_RESTORE_FAILED");
    cloudRevision = typeof payload.revision === "number" ? payload.revision : cloudRevision;
    const merged = withDeviceSettings(restored, local);
    await writeLocal(merged);
    return merged;
  },
};

export { normalizeBackup } from "@/lib/data";
