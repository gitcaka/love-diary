/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("node:http");
const { Readable } = require("node:stream");
const crypto = require("node:crypto");
const cloudbase = require("@cloudbase/js-sdk");
const { createWriterToken, verifyLoginPassword, verifyWriterToken } = require("./auth");

const app = cloudbase.init({ env: process.env.TCB_ENV_ID });
const db = app.rdb();
const STATE_ID = "main";
const SNAPSHOT_PREFIX = "snapshot-";
const SNAPSHOT_LIMIT = 50;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

const DEFAULT_STATE = {
  version: 6,
  seeded: true,
  profile: {
    name1: "恋人A",
    name2: "恋人B",
    currentUser: "person2",
    startDate: "2025-01-01",
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
};

function corsHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    // CloudBase's HTTP gateway supplies the request-specific allow-origin header.
    // Adding another value here produces an invalid "origin,*" header in browsers.
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    ...extra,
  };
}

function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: corsHeaders({ "Cache-Control": "no-store" }),
  });
}

function bearerToken(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function writerSession(request) {
  return verifyWriterToken(bearerToken(request), process.env.DIARY_WRITE_KEY);
}

function canWrite(request) {
  return Boolean(writerSession(request));
}

function loginClientKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("cf-connecting-ip") || forwarded || request.headers.get("x-real-ip") || "unknown";
}

function activeLoginFailures(key, now = Date.now()) {
  const active = (loginFailures.get(key) || []).filter((value) => now - value < LOGIN_WINDOW_MS);
  if (active.length) loginFailures.set(key, active);
  else loginFailures.delete(key);
  return active;
}

function recordLoginFailure(key, now = Date.now()) {
  const active = activeLoginFailures(key, now);
  active.push(now);
  loginFailures.set(key, active);
}

async function handleLogin(request) {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const key = loginClientKey(request);
  if (activeLoginFailures(key).length >= LOGIN_MAX_FAILURES) return json({ error: "Too many login attempts" }, 429);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid login request" }, 400); }
  const identity = verifyLoginPassword(body?.password);
  if (!identity) {
    recordLoginFailure(key);
    await new Promise((resolve) => setTimeout(resolve, 450));
    return json({ error: "Password is incorrect" }, 401);
  }
  if (!process.env.DIARY_WRITE_KEY) return json({ error: "Writer login is unavailable" }, 503);
  loginFailures.delete(key);
  return json({ token: createWriterToken(identity, process.env.DIARY_WRITE_KEY), identity });
}

function publicState(data, writer) {
  const normalized = {
    ...data,
    responses: Array.isArray(data.responses) ? data.responses : [],
    trash: Array.isArray(data.trash) ? data.trash : [],
    diaryHistory: Array.isArray(data.diaryHistory) ? data.diaryHistory : [],
  };
  if (writer) return normalized;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return {
    ...normalized,
    capsules: normalized.capsules.map((capsule) => capsule.openDate > today ? { ...capsule, content: "" } : capsule),
    trash: [],
    diaryHistory: [],
    profile: { ...normalized.profile, pinHash: undefined, pinSalt: undefined, lockEnabled: false },
  };
}

function isValidState(value) {
  return Boolean(value)
    && typeof value === "object"
    && value.version === 6
    && Array.isArray(value.diaries)
    && Array.isArray(value.anniversaries)
    && Array.isArray(value.capsules)
    && value.profile
    && typeof value.profile === "object"
    && typeof value.profile.name1 === "string"
    && typeof value.profile.name2 === "string";
}

function hasEmbeddedImages(data) {
  const profileImages = [data.profile.avatar1, data.profile.avatar2, data.profile.coverImage];
  const nestedDiaries = [
    ...data.diaries,
    ...(Array.isArray(data.trash) ? data.trash.map((item) => item.diary) : []),
    ...(Array.isArray(data.diaryHistory) ? data.diaryHistory.map((item) => item.diary) : []),
  ];
  return profileImages.some((value) => typeof value === "string" && value.startsWith("data:"))
    || (Array.isArray(data.wishes) && data.wishes.some((wish) => typeof wish?.completionImage?.url === "string" && wish.completionImage.url.startsWith("data:")))
    || nestedDiaries.some((diary) => Array.isArray(diary?.images)
      && diary.images.some((image) => typeof image.url === "string" && image.url.startsWith("data:")));
}

async function run(query) {
  const result = await query;
  if (result.error) throw new Error(result.error.message || JSON.stringify(result.error));
  return result.data || [];
}

async function readState() {
  let rows = await run(db.from("love_diary_state").select("data,revision").eq("id", STATE_ID));
  if (!rows.length) {
    const inserted = await db.from("love_diary_state").insert({
      id: STATE_ID,
      data: DEFAULT_STATE,
      revision: 1,
      updated_at: new Date().toISOString(),
    });
    if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message || "Unable to create diary state");
    rows = await run(db.from("love_diary_state").select("data,revision").eq("id", STATE_ID));
  }
  if (!rows.length || !isValidState(rows[0].data)) throw new Error("Diary state is unavailable");
  return { data: rows[0].data, revision: Number(rows[0].revision) };
}

function snapshotSummary(row) {
  const data = row.data || {};
  const diaries = Array.isArray(data.diaries) ? data.diaries : [];
  const wishes = Array.isArray(data.wishes) ? data.wishes : [];
  return {
    id: row.id,
    revision: Number(row.revision),
    createdAt: row.updated_at,
    diaries: diaries.length,
    photos: diaries.reduce((sum, diary) => sum + (Array.isArray(diary.images) ? diary.images.length : 0), 0)
      + wishes.filter((wish) => wish?.completionImage?.url).length,
    wishes: wishes.length,
  };
}

async function createSnapshot(state) {
  const createdAt = new Date().toISOString();
  const id = `${SNAPSHOT_PREFIX}${state.revision}`;
  const existing = await run(db.from("love_diary_state").select("id,data,revision,updated_at").eq("id", id).limit(1));
  if (existing.length) return snapshotSummary(existing[0]);
  const inserted = await db.from("love_diary_state").insert({ id, data: state.data, revision: state.revision, updated_at: createdAt });
  if (inserted.error && inserted.error.code !== "23505") throw new Error(inserted.error.message || "Unable to create snapshot");
  const rows = await run(db.from("love_diary_state").select("id,data,revision,updated_at").eq("id", id).limit(1));
  if (!rows.length) throw new Error("Unable to read snapshot");
  return snapshotSummary(rows[0]);
}

async function listSnapshotRows(limit = SNAPSHOT_LIMIT) {
  return run(db.from("love_diary_state")
    .select("id,data,revision,updated_at")
    .like("id", `${SNAPSHOT_PREFIX}%`)
    .order("updated_at", { ascending: false })
    .limit(limit));
}

async function cleanupSnapshots() {
  try {
    const rows = await listSnapshotRows(200);
    for (const row of rows.slice(SNAPSHOT_LIMIT)) {
      await run(db.from("love_diary_state").delete().eq("id", row.id));
    }
  } catch {
    // A cleanup failure must never undo a successful diary save.
  }
}

function mediaIdFromUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const pathname = new URL(value, "https://diary.invalid").pathname;
    const id = pathname.startsWith("/media/") ? decodeURIComponent(pathname.slice(7)) : "";
    return /^[a-zA-Z0-9-]{1,100}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function collectReferencedMedia(data, found = new Set()) {
  const add = (value) => { const id = mediaIdFromUrl(value); if (id) found.add(id); };
  const addDiary = (diary) => Array.isArray(diary?.images) && diary.images.forEach((image) => add(image?.url));
  add(data?.profile?.avatar1);
  add(data?.profile?.avatar2);
  add(data?.profile?.coverImage);
  (Array.isArray(data?.diaries) ? data.diaries : []).forEach(addDiary);
  (Array.isArray(data?.trash) ? data.trash : []).forEach((item) => addDiary(item?.diary));
  (Array.isArray(data?.diaryHistory) ? data.diaryHistory : []).forEach((item) => addDiary(item?.diary));
  (Array.isArray(data?.wishes) ? data.wishes : []).forEach((wish) => add(wish?.completionImage?.url));
  return found;
}

async function referencedMediaIds() {
  const current = await readState();
  const found = collectReferencedMedia(current.data);
  const snapshots = await listSnapshotRows();
  snapshots.forEach((row) => collectReferencedMedia(row.data, found));
  return found;
}

async function deleteMediaRecord(id) {
  const rows = await run(db.from("love_diary_media").select("file_id").eq("id", id));
  if (rows[0]?.file_id) await app.deleteFile({ fileList: [rows[0].file_id] });
  await run(db.from("love_diary_media").delete().eq("id", id));
}

async function cleanupOrphanedMedia() {
  try {
    const referenced = await referencedMediaIds();
    const rows = await run(db.from("love_diary_media").select("id"));
    for (const row of rows) {
      if (!referenced.has(row.id)) await deleteMediaRecord(row.id);
    }
  } catch {
    // Media cleanup is best-effort; state and snapshots remain authoritative.
  }
}

async function handleState(request) {
  if (request.method === "GET") {
    const state = await readState();
    const session = writerSession(request);
    return json({ data: publicState(state.data, Boolean(session)), revision: state.revision, canWrite: Boolean(session), identity: session?.identity });
  }
  if (request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
  if (!canWrite(request)) return json({ error: "Writer authorization required" }, 401);

  const body = await request.json();
  if (!isValidState(body.data) || !Number.isInteger(body.revision)) return json({ error: "Invalid diary data" }, 400);
  if (hasEmbeddedImages(body.data)) return json({ error: "Embedded images must be uploaded first" }, 400);

  const current = await readState();
  if (current.revision !== body.revision) {
    return json({ error: "The diary changed on another device", data: current.data, revision: current.revision }, 409);
  }
  await createSnapshot(current);
  const saved = {
    ...body.data,
    profile: { ...body.data.profile, currentUser: "person2", lockEnabled: false, pinHash: undefined, pinSalt: undefined },
  };
  const rows = await run(db.from("love_diary_state")
    .update({ data: saved, revision: current.revision + 1, updated_at: new Date().toISOString() })
    .eq("id", STATE_ID)
    .eq("revision", current.revision)
    .select("revision"));
  if (!rows.length) return json({ error: "The diary changed on another device" }, 409);
  await cleanupSnapshots();
  await cleanupOrphanedMedia();
  return json({ data: saved, revision: Number(rows[0].revision) });
}

async function handleSnapshots(request, restore = false) {
  if (!canWrite(request)) return json({ error: "Writer authorization required" }, 401);
  if (restore) {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const body = await request.json();
    if (typeof body.id !== "string" || !body.id.startsWith(SNAPSHOT_PREFIX) || !Number.isInteger(body.revision)) return json({ error: "Invalid snapshot request" }, 400);
    const current = await readState();
    if (current.revision !== body.revision) return json({ error: "The diary changed on another device", revision: current.revision }, 409);
    const rows = await run(db.from("love_diary_state").select("data").eq("id", body.id).limit(1));
    const snapshot = rows[0]?.data;
    if (!isValidState(snapshot)) return json({ error: "Snapshot not found" }, 404);
    await createSnapshot(current);
    const saved = { ...snapshot, profile: { ...snapshot.profile, currentUser: "person2", lockEnabled: false, pinHash: undefined, pinSalt: undefined } };
    const updated = await run(db.from("love_diary_state")
      .update({ data: saved, revision: current.revision + 1, updated_at: new Date().toISOString() })
      .eq("id", STATE_ID)
      .eq("revision", current.revision)
      .select("revision"));
    if (!updated.length) return json({ error: "The diary changed on another device" }, 409);
    await cleanupSnapshots();
    await cleanupOrphanedMedia();
    return json({ data: saved, revision: Number(updated[0].revision) });
  }
  if (request.method === "GET") {
    const rows = await listSnapshotRows();
    return json({ snapshots: rows.map(snapshotSummary) });
  }
  if (request.method === "POST") {
    const state = await readState();
    const snapshot = await createSnapshot(state);
    await cleanupSnapshots();
    return json({ snapshot }, 201);
  }
  return json({ error: "Method not allowed" }, 405);
}

function imageType(bytes, mime) {
  const starts = (...values) => values.every((value, index) => bytes[index] === value);
  if (mime === "image/jpeg" && starts(0xff, 0xd8, 0xff)) return "jpg";
  if (mime === "image/png" && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (mime === "image/gif" && String.fromCharCode(...bytes.slice(0, 6)).startsWith("GIF8")) return "gif";
  if (mime === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  const brand = String.fromCharCode(...bytes.slice(8, 12));
  if ((mime === "image/heic" || mime === "image/heif") && ["heic", "heix", "hevc", "hevx", "mif1"].includes(brand)) return "heic";
  if (mime === "image/avif" && ["avif", "avis"].includes(brand)) return "avif";
  return null;
}

async function handleMediaApi(request) {
  if (!canWrite(request)) return json({ error: "Writer authorization required" }, 401);

  if (request.method === "POST") {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ error: "Please choose a supported photo" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = imageType(bytes, file.type);
    if (!extension) return json({ error: "Please choose a supported photo" }, 400);

    const requestedId = String(form.get("id") || "");
    const id = /^[a-zA-Z0-9-]{1,100}$/.test(requestedId) ? requestedId : crypto.randomUUID();
    const now = new Date();
    const cloudPath = `diary-media/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${extension}`;
    const uploaded = await app.uploadFile({ cloudPath, fileContent: Buffer.from(bytes) });
    const fileId = uploaded.fileID;
    try {
      await run(db.from("love_diary_media").insert({
        id,
        file_id: fileId,
        original_name: file.name.slice(0, 500),
        content_type: file.type,
        byte_size: file.size,
        created_at: new Date().toISOString(),
      }));
    } catch (error) {
      await app.deleteFile({ fileList: [fileId] }).catch(() => undefined);
      throw error;
    }
    const publicHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
    return json({ id, url: `https://${publicHost}/media/${encodeURIComponent(id)}`, name: file.name }, 201);
  }

  if (request.method === "DELETE") {
    const body = await request.json();
    const pathname = typeof body.url === "string" ? new URL(body.url, "https://diary.invalid").pathname : "";
    const id = pathname.startsWith("/media/") ? decodeURIComponent(pathname.slice(7)) : "";
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return json({ error: "Invalid media URL" }, 400);
    const referenced = await referencedMediaIds();
    if (referenced.has(id)) return json({ deleted: false, retainedForSnapshot: true });
    await deleteMediaRecord(id);
    return json({ deleted: true, retainedForSnapshot: false });
  }

  return json({ error: "Method not allowed" }, 405);
}

async function serveMedia(id, download = false) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return new Response("Not found", { status: 404, headers: corsHeaders() });
  const rows = await run(db.from("love_diary_media").select("file_id,content_type,byte_size,original_name").eq("id", id));
  if (!rows.length) return new Response("Not found", { status: 404, headers: corsHeaders() });
  const downloaded = await app.downloadFile({ fileID: rows[0].file_id });
  return new Response(downloaded.fileContent, {
    headers: corsHeaders({
      "Content-Type": rows[0].content_type || "application/octet-stream",
      "Content-Length": String(rows[0].byte_size || downloaded.fileContent.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rows[0].original_name || "photo")}` } : {}),
    }),
  });
}

async function route(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  const url = new URL(request.url);
  if (url.pathname === "/api/state") return handleState(request);
  if (url.pathname === "/api/auth/login") return handleLogin(request);
  if (url.pathname === "/api/media") return handleMediaApi(request);
  if (url.pathname === "/api/snapshots") return handleSnapshots(request);
  if (url.pathname === "/api/snapshots/restore") return handleSnapshots(request, true);
  if (url.pathname.startsWith("/media/")) return serveMedia(decodeURIComponent(url.pathname.slice(7)), url.searchParams.get("download") === "1");
  if (url.pathname === "/health") return json({ ok: true });
  return json({ error: "Not found" }, 404);
}

function toRequest(req) {
  const init = { method: req.method, headers: req.headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(`http://${req.headers.host || "localhost"}${req.url || "/"}`, init);
}

createServer(async (req, res) => {
  try {
    const response = await route(toRequest(req));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("Love diary request failed", error);
    const response = json({ error: "暂时没有保存成功，请稍后再试。" }, 500);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  }
}).listen(9000, "0.0.0.0");
