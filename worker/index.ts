/** Cloudflare Worker entry point for the love diary. */
import handler from "vinext/server/app-router-entry";
import { createSeedData, normalizeBackup } from "../lib/data";
import type { AppData } from "../lib/types";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: KVNamespace;
  DIARY_WRITE_KEY?: string;
}

interface MediaMetadata {
  contentType: string;
  originalName: string;
  byteSize: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const STATE_ID = "main";

async function ensureSchema(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY NOT NULL,
      data TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`),
  ]);
}

async function readState(env: Env): Promise<{ data: AppData; revision: number }> {
  await ensureSchema(env);
  let row = await env.DB.prepare("SELECT data, revision FROM app_state WHERE id = ?1")
    .bind(STATE_ID)
    .first<{ data: string; revision: number }>();
  if (!row) {
    const initial = createSeedData();
    await env.DB.prepare("INSERT OR IGNORE INTO app_state (id, data, revision, updated_at) VALUES (?1, ?2, 1, ?3)")
      .bind(STATE_ID, JSON.stringify(initial), Date.now())
      .run();
    row = await env.DB.prepare("SELECT data, revision FROM app_state WHERE id = ?1")
      .bind(STATE_ID)
      .first<{ data: string; revision: number }>();
  }
  const normalized = row ? normalizeBackup(JSON.parse(row.data) as unknown) : null;
  if (!row || !normalized) throw new Error("Diary state is unavailable");
  return { data: normalized, revision: row.revision };
}

function bearerToken(request: Request): string {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function canWrite(request: Request, env: Env): boolean {
  return Boolean(env.DIARY_WRITE_KEY && bearerToken(request) === env.DIARY_WRITE_KEY);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

function publicState(data: AppData, writer: boolean): AppData {
  if (writer) return data;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...data,
    capsules: data.capsules.map((capsule) => capsule.openDate > today ? { ...capsule, content: "" } : capsule),
    profile: { ...data.profile, pinHash: undefined, pinSalt: undefined, lockEnabled: false },
  };
}

function mediaKeyFromUrl(value: string): string | null {
  try {
    const path = new URL(value, "https://diary.invalid").pathname;
    if (!path.startsWith("/media/")) return null;
    return path.slice(7).split("/").map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

function hasEmbeddedImages(data: AppData): boolean {
  const profileImages = [data.profile.avatar1, data.profile.avatar2, data.profile.coverImage];
  return profileImages.some((value) => value?.startsWith("data:"))
    || data.diaries.some((diary) => diary.images.some((image) => image.url.startsWith("data:")));
}

async function handleState(request: Request, env: Env): Promise<Response> {
  if (request.method === "GET") {
    const state = await readState(env);
    const writer = canWrite(request, env);
    return json({ data: publicState(state.data, writer), revision: state.revision, canWrite: writer });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  if (!canWrite(request, env)) return json({ error: "Writer authorization required" }, 401);

  const body = await request.json() as { data?: unknown; revision?: unknown };
  const next = normalizeBackup(body.data);
  if (!next || typeof body.revision !== "number") return json({ error: "Invalid diary data" }, 400);
  if (hasEmbeddedImages(next)) return json({ error: "Embedded images must be uploaded first" }, 400);

  const current = await readState(env);
  if (current.revision !== body.revision) {
    return json({ error: "The diary changed on another device", data: current.data, revision: current.revision }, 409);
  }
  const saved: AppData = {
    ...next,
    profile: { ...next.profile, currentUser: "person2", lockEnabled: false, pinHash: undefined, pinSalt: undefined },
  };
  const updated = await env.DB.prepare(`UPDATE app_state
    SET data = ?1, revision = revision + 1, updated_at = ?2
    WHERE id = ?3 AND revision = ?4
    RETURNING revision`)
    .bind(JSON.stringify(saved), Date.now(), STATE_ID, current.revision)
    .first<{ revision: number }>();
  if (!updated) return json({ error: "The diary changed on another device" }, 409);
  return json({ data: saved, revision: updated.revision });
}

function safeExtension(name: string): string {
  const value = name.split(".").pop()?.toLowerCase() || "image";
  return /^[a-z0-9]{1,10}$/.test(value) ? value : "image";
}

async function handleMediaApi(request: Request, env: Env): Promise<Response> {
  if (!canWrite(request, env)) return json({ error: "Writer authorization required" }, 401);
  await ensureSchema(env);

  if (request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/") || file.type === "image/svg+xml") {
      return json({ error: "Please choose a supported photo" }, 400);
    }
    const requestedId = String(form.get("id") || "");
    const id = /^[a-zA-Z0-9-]{1,100}$/.test(requestedId) ? requestedId : crypto.randomUUID();
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${safeExtension(file.name)}`;
    await env.MEDIA.put(key, await file.arrayBuffer(), {
      metadata: {
        contentType: file.type,
        originalName: file.name.slice(0, 500),
        byteSize: file.size,
      } satisfies MediaMetadata,
    });
    try {
      await env.DB.prepare(`INSERT INTO media_assets
        (id, object_key, original_name, content_type, byte_size, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
        .bind(id, key, file.name, file.type, file.size, Date.now())
        .run();
    } catch (error) {
      await env.MEDIA.delete(key);
      throw error;
    }
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    return json({ id, url: `${new URL(request.url).origin}/media/${encodedKey}`, name: file.name }, 201);
  }

  if (request.method === "DELETE") {
    const body = await request.json() as { url?: unknown };
    const key = typeof body.url === "string" ? mediaKeyFromUrl(body.url) : null;
    if (!key) return json({ error: "Invalid media URL" }, 400);
    await env.MEDIA.delete(key);
    await env.DB.prepare("DELETE FROM media_assets WHERE object_key = ?1").bind(key).run();
    return json({ deleted: true });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function serveMedia(request: Request, env: Env, key: string): Promise<Response> {
  const object = await env.MEDIA.getWithMetadata<MediaMetadata>(key, { type: "arrayBuffer" });
  if (!object.value) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  headers.set("Content-Type", object.metadata?.contentType || "application/octet-stream");
  headers.set("Content-Length", String(object.metadata?.byteSize ?? object.value.byteLength));
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.value, { headers });
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/state") return await handleState(request, env);
      if (url.pathname === "/api/media") return await handleMediaApi(request, env);
      if (url.pathname.startsWith("/media/")) {
        const key = url.pathname.slice(7).split("/").map(decodeURIComponent).join("/");
        return await serveMedia(request, env, key);
      }
      return handler.fetch(request, env, ctx);
    } catch (error) {
      console.error("Love diary request failed", error);
      return json({ error: "暂时没有保存成功，请稍后再试。" }, 500);
    }
  },
};

export default worker;
