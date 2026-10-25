"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { anniversaryPresentation, displayAnniversaries, nextUpcomingAnniversary } from "@/lib/anniversaries";
import { bookPageTarget, bookSwipeDirection, sortBookDiaries, paginateBookText, bookTextSlice, type BookTextPage, type BookDirection, type BookOrder } from "@/lib/book";
import { anniversaryDateLabel, anniversaryDaysUntil, diffDays, formatDate, formatShortDate, toDateInput } from "@/lib/date";
import { filterDiaries, appendDiaryHistory, type DiaryFilters } from "@/lib/diary-memory";
import { DEMO_PASSWORDS } from "@/lib/demo";
import { diaryAppearance, WRITER_MARKERS } from "@/lib/diary-style";
import { removePublishedDiary } from "@/lib/diary-actions";
import { createId } from "@/lib/id";
import { privateImageVariant } from "@/lib/private-media";
import { textSegments, trimTextAndMarks } from "@/lib/rich-text";
import { nextTimelineCount } from "@/lib/timeline";
import type { Anniversary, AppData, AppRoute, CoupleProfile, Diary, DiaryAuthor, DiaryHistoryEntry, DiaryImage, DiaryResponse, Mood, Weather, WishItem } from "@/lib/types";
import { loveDiaryRepository } from "@/repositories/loveDiaryRepository";
import PrivateWelcome from "@/components/PrivateWelcome";
import ColorLetterEditor from "@/components/ColorLetterEditor";
import JournalHeader from "@/components/JournalHeader";

type Commit = (data: AppData, message?: string, expectedRevision?: number | null) => Promise<boolean>;
type LoginHandler = (password: string) => Promise<DiaryAuthor>;

const moods: Mood[] = [
  { id: "delighted", name: "超开心", emoji: "🤩" },
  { id: "happy", name: "开心", emoji: "🥰" },
  { id: "calm", name: "平静", emoji: "😌" },
  { id: "miss", name: "想你", emoji: "🥺" },
  { id: "sad", name: "难过", emoji: "😢" },
  { id: "angry", name: "生气", emoji: "😠" },
  { id: "heartbeat", name: "心动", emoji: "❤️" },
];

const weathers: Weather[] = [
  { id: "sunny", name: "晴天", emoji: "☀️" },
  { id: "cloudy", name: "多云", emoji: "🌤️" },
  { id: "overcast", name: "阴天", emoji: "☁️" },
  { id: "rain", name: "下雨", emoji: "🌧️" },
  { id: "storm", name: "雷雨", emoji: "⛈️" },
  { id: "snow", name: "下雪", emoji: "❄️" },
  { id: "fog", name: "雾", emoji: "🌫️" },
];

const APP_HISTORY_KEY = "love-diary:navigation";
const BOOK_ORDER_KEY = "love-diary:book-order";
const BOOK_PAGE_KEY = "love-diary:book-page";
const HOME_FILTER_KEY = "love-diary:home-filters";
const HOME_VISIBLE_KEY = "love-diary:home-visible";
const HOME_SCROLL_KEY = "love-diary:home-scroll";
const SPLASH_SEEN_KEY = "love-diary:splash-seen";
const DIARY_BATCH_SIZE = 8;
const GALLERY_BATCH_SIZE = 18;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function appHistoryDepth(): number {
  const state = window.history.state as Record<string, unknown> | null;
  const entry = state?.[APP_HISTORY_KEY];
  if (!entry || typeof entry !== "object") return 0;
  const depth = (entry as { depth?: unknown }).depth;
  return typeof depth === "number" && Number.isInteger(depth) && depth > 0 ? depth : 0;
}

const emptyDiary = (date = toDateInput(), author: DiaryAuthor = "person1"): Diary => ({
  id: createId(),
  date,
  author,
  content: "",
  mood: moods[1],
  weather: weathers[0],
  images: [],
  special: false,
  favorite: false,
  tags: [],
  textMarks: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

function diaryExcerpt(content: string, length = 30): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > length ? `${clean.slice(0, length)}…` : clean;
}

function timestampDateInput(value = Date.now()): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function diaryDirection(diary: Diary, profile: CoupleProfile): { author: string; recipient: string } {
  return diary.author === "person2"
    ? { author: profile.name2, recipient: profile.name1 }
    : { author: profile.name1, recipient: profile.name2 };
}

function ColoredDiaryText({ diary }: { diary: Pick<Diary, "content" | "textMarks"> }) {
  return <>{textSegments(diary.content, diary.textMarks).map((segment, index) => segment.color
    ? <span key={`${index}-${segment.color}`} style={{ color: segment.color }}>{segment.text}</span>
    : segment.text)}</>;
}

function parseRoute(): AppRoute {
  if (typeof window === "undefined") return { view: "home" };
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("view") || "home";
  if (candidate === "calendar") return { view: "book" };
  const valid = ["home", "book", "editor", "gallery", "us", "detail"];
  return { view: valid.includes(candidate) ? candidate as AppRoute["view"] : "home", id: params.get("id") || undefined, date: params.get("date") || undefined, wishId: params.get("wish") || undefined };
}

async function hashPin(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export default function LoveDiaryApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [route, setRoute] = useState<AppRoute>({ view: "home" });
  const [splash, setSplash] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [toast, setToast] = useState("");
  const [canWrite, setCanWrite] = useState(false);
  const [viewer, setViewer] = useState<{ images: DiaryImage[]; index: number; title: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(() => typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true));
  const [updateWorker, setUpdateWorker] = useState<ServiceWorker | null>(null);
  const [connectionError, setConnectionError] = useState(false);
  const navigationGuardRef = useRef<(() => boolean) | null>(null);
  const activeLocation = useRef<{ depth: number; url: string; state: unknown } | null>(null);
  const restoringHistory = useRef(false);

  const refreshCloud = useCallback(async () => {
    try {
      const next = await loveDiaryRepository.load();
      setData(next);
      setCanWrite(loveDiaryRepository.hasWriterAccess());
      setConnectionError(false);
    } catch (error) {
      if (error instanceof Error && error.message === "AUTH_STALE") return;
      const locked = error instanceof Error && error.message === "AUTH_REQUIRED";
      if (locked) { setData(null); setCanWrite(false); }
      setConnectionError(!locked);
    }
  }, []);

  useEffect(() => {
    loveDiaryRepository.initializeDevice();
    window.history.replaceState({ ...window.history.state, [APP_HISTORY_KEY]: { depth: appHistoryDepth() } }, "", window.location.href);
    activeLocation.current = { depth: appHistoryDepth(), url: window.location.href, state: window.history.state };
    const routeTimer = window.setTimeout(() => setRoute(parseRoute()), 0);
    void loveDiaryRepository.loadCached().then((cached) => cached && setData((current) => current ?? cached));
    const initialRefreshTimer = window.setTimeout(() => void refreshCloud(), 0);
    let splashDelay = 650;
    try { if (window.sessionStorage.getItem(SPLASH_SEEN_KEY) === "1") splashDelay = 0; } catch { /* Keep the short splash when session storage is unavailable. */ }
    const timer = window.setTimeout(() => {
      setSplash(false);
      try { window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1"); } catch { /* A session-only preference is optional. */ }
    }, splashDelay);
    const onPop = () => {
      if (restoringHistory.current) { restoringHistory.current = false; return; }
      if (navigationGuardRef.current && !navigationGuardRef.current()) {
        const previous = activeLocation.current;
        if (previous) {
          const delta = previous.depth - appHistoryDepth();
          if (delta) { restoringHistory.current = true; window.history.go(delta); }
          else window.history.replaceState(previous.state, "", previous.url);
        }
        return;
      }
      activeLocation.current = { depth: appHistoryDepth(), url: window.location.href, state: window.history.state };
      setRoute(parseRoute());
    };
    const onFocus = () => void refreshCloud();
    const onOnline = () => void refreshCloud();
    const onLocked = () => { setData(null); setCanWrite(false); setViewer(null); setUnlocked(false); document.title = "恋爱日记 · 私密空间"; };
    const onStorage = (event: StorageEvent) => { if (event.key === "love-diary:logged-out" && event.newValue === "1") loveDiaryRepository.lockDevice(); };
    const refreshTimer = window.setInterval(() => document.visibilityState === "visible" && void refreshCloud(), 30_000);
    window.addEventListener("popstate", onPop);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("love-diary:locked", onLocked);
    window.addEventListener("storage", onStorage);
    return () => { window.clearTimeout(timer); window.clearTimeout(routeTimer); window.clearTimeout(initialRefreshTimer); window.clearInterval(refreshTimer); window.removeEventListener("popstate", onPop); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onOnline); window.removeEventListener("love-diary:locked", onLocked); window.removeEventListener("storage", onStorage); };
  }, [refreshCloud]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (document.querySelector<HTMLMetaElement>('meta[name="love-diary-local-preview"]')?.content === "true") {
      // Local snapshot previews must never pick up an older cloud-connected cache.
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
      return;
    }
    let refreshing = false;
    const onControllerChange = () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    const serviceWorkerUrl = new URL("sw.js", document.baseURI).toString();
    void navigator.serviceWorker.register(serviceWorkerUrl).then((registration) => {
      if (registration.waiting && navigator.serviceWorker.controller) setUpdateWorker(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) setUpdateWorker(worker);
        });
      });
    }).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  useEffect(() => {
    const capture = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent); };
    const installed = () => { setStandalone(true); setInstallPrompt(null); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", installed);
    return () => { window.removeEventListener("beforeinstallprompt", capture); window.removeEventListener("appinstalled", installed); };
  }, []);

  useEffect(() => {
    if (!data) return;
    const owner = data.profile.currentUser === "person1" ? data.profile.name1 : data.profile.name2;
    document.title = `${owner}的恋爱日记`;
  }, [data]);

  const navigate = useCallback((next: AppRoute, replace = false) => {
    const params = new URLSearchParams();
    if (next.view !== "home") params.set("view", next.view);
    if (next.id) params.set("id", next.id);
    if (next.date) params.set("date", next.date);
    if (next.wishId) params.set("wish", next.wishId);
    const url = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (url !== currentUrl) {
      const depth = appHistoryDepth();
      const state = { ...window.history.state, [APP_HISTORY_KEY]: { depth: replace ? depth : depth + 1 } };
      window.history[replace ? "replaceState" : "pushState"](state, "", url);
    }
    activeLocation.current = { depth: appHistoryDepth(), url: window.location.href, state: window.history.state };
    setRoute(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const goBack = useCallback((fallback: AppRoute) => {
    if (appHistoryDepth() > 0) {
      window.history.back();
      return;
    }
    navigate(fallback, true);
  }, [navigate]);

  const commit = useCallback(async (next: AppData, message?: string, expectedRevision?: number | null): Promise<boolean> => {
    try {
      const saved = await loveDiaryRepository.save(next, expectedRevision);
      setData(saved);
      if (message) setToast(message);
      window.setTimeout(() => setToast(""), 2600);
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code !== "OFFLINE") {
        try {
          const latest = await loveDiaryRepository.load();
          setData(latest);
          setCanWrite(loveDiaryRepository.hasWriterAccess());
        } catch { /* Leave the draft intact; an expired session is locked centrally. */ }
      }
      setToast(code === "CLOUD_CONFLICT" ? "另一台设备刚刚更新过，请再操作一次" : code === "OFFLINE" ? "当前离线，操作尚未完成，请保持页面打开，联网后重试" : "这次操作没有成功，请检查网络后重试");
      window.setTimeout(() => setToast(""), 2600);
      return false;
    }
  }, []);

  const loginIdentity = useCallback(async (password: string): Promise<DiaryAuthor> => {
    const next = await loveDiaryRepository.login(password);
    setData(next);
    setCanWrite(true);
    const currentUser = next.profile.currentUser;
    setToast(`已登录为${currentUser === "person1" ? next.profile.name1 : next.profile.name2}，这台设备会自动记住`);
    window.setTimeout(() => setToast(""), 2200);
    return currentUser;
  }, []);

  const logoutIdentity = useCallback(async () => {
    try {
      const next = await loveDiaryRepository.logout();
      setData(loveDiaryRepository.isDemoMode() ? next : null);
    } catch {
      setData(null);
      window.alert("这台设备已锁定，但网络中断导致服务器退出未确认。请联网后重新登录并退出，完成会话撤销。");
    } finally {
      setCanWrite(false); setViewer(null); setUnlocked(false); setToast("");
      document.title = "恋爱日记 · 私密空间";
    }
  }, []);

  const installApp = useCallback(async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    window.alert("在 Safari 中点底部的分享按钮，再选择“添加到主屏幕”，就能像 App 一样打开。\n\n安卓浏览器可在菜单中选择“安装应用”或“添加到主屏幕”。");
  }, [installPrompt]);

  if (splash) return <Splash />;
  if (!data || (!canWrite && !loveDiaryRepository.isDemoMode() && !loveDiaryRepository.isLocalPreview())) return <PrivateWelcome onLogin={loginIdentity} connectionError={connectionError} onRetry={() => void refreshCloud()} />;
  if (data.profile.lockEnabled && !unlocked) return <LockScreen data={data} onUnlock={() => setUnlocked(true)} />;

  const page = (() => {
    if (route.view === "editor") return canWrite ? <DiaryEditor navigationGuardRef={navigationGuardRef} key={route.id || route.date || "new"} data={data} diary={route.id ? data.diaries.find((item) => item.id === route.id) : undefined} initialDate={route.date} onCancel={() => goBack(route.id ? { view: "detail", id: route.id } : { view: "home" })} onSave={async (diary, expectedRevision) => {
      const previous = data.diaries.find((item) => item.id === diary.id);
      const exists = Boolean(previous);
      const diaries = exists ? data.diaries.map((item) => item.id === diary.id ? diary : item) : [diary, ...data.diaries];
      const diaryHistory = previous ? appendDiaryHistory(data.diaryHistory, previous) : data.diaryHistory;
      const saved = await commit({ ...data, diaries, diaryHistory }, exists ? "修改已发布 ♡" : "日记已发布 ♡", expectedRevision);
      if (saved) {
        if (exists) goBack({ view: "detail", id: diary.id });
        else navigate({ view: "detail", id: diary.id }, true);
      }
      return saved;
    }} onViewImages={(images, index) => setViewer({ images, index, title: "正在编辑的照片" })} /> : <ReadOnlyPage onHome={() => navigate({ view: "home" }, true)} />;
    if (route.view === "detail") {
      const diary = data.diaries.find((item) => item.id === route.id);
      const ordered = [...data.diaries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
      const currentIndex = diary ? ordered.findIndex((item) => item.id === diary.id) : -1;
      const previousDiary = currentIndex > 0 ? ordered[currentIndex - 1] : undefined;
      const nextDiary = currentIndex >= 0 && currentIndex < ordered.length - 1 ? ordered[currentIndex + 1] : undefined;
      const responses = data.responses.filter((item) => item.diaryId === route.id).sort((a, b) => a.createdAt - b.createdAt);
      const history = data.diaryHistory.filter((item) => item.diaryId === route.id).sort((a, b) => b.savedAt - a.savedAt);
      return diary ? <DiaryDetail diary={diary} profile={data.profile} canWrite={canWrite} responses={responses} history={history} previousDiary={previousDiary} nextDiary={nextDiary} onNavigate={(id) => navigate({ view: "detail", id }, true)} onBack={() => goBack({ view: "home" })} onEdit={() => navigate({ view: "editor", id: diary.id })} onAddResponse={async (content, emoji) => {
        const response: DiaryResponse = { id: createId(), diaryId: diary.id, author: data.profile.currentUser, emoji, content, createdAt: Date.now() };
        return commit({ ...data, responses: [...data.responses, response] }, "回应已经写在这页下面 ♡");
      }} onDeleteResponse={async (id) => commit({ ...data, responses: data.responses.filter((item) => item.id !== id) })} onRestoreHistory={async (entry) => {
        if (!window.confirm("恢复这个版本吗？现在的内容也会保留在历史记录里。")) return false;
        const remaining = data.diaryHistory.filter((item) => item.id !== entry.id);
        const restored = { ...structuredClone(entry.diary), updatedAt: Date.now() };
        return commit({ ...data, diaries: data.diaries.map((item) => item.id === diary.id ? restored : item), diaryHistory: appendDiaryHistory(remaining, diary) }, "旧版本已经恢复，当前版本也已保留");
      }} onDelete={async () => {
        if (!window.confirm("确定删除这篇日记吗？相关回应和编辑历史也会移除，删除后不能直接撤销。")) return;
        if (await commit(removePublishedDiary(data, diary.id), "这篇日记已删除")) navigate({ view: "home" }, true);
      }} onViewImages={(images, index) => setViewer({ images, index, title: formatDate(diary.date) })} /> : <EmptyPage onHome={() => navigate({ view: "home" }, true)} />;
    }
    if (route.view === "book") return <DiaryBookPage data={data} canWrite={canWrite} onEdit={(id) => navigate({ view: "editor", id })} onViewImages={(images, index, title) => setViewer({ images, index, title })} />;
    if (route.view === "gallery") return <GalleryPage data={data} onHome={() => navigate({ view: "home" })} onOpen={(images, index, title) => setViewer({ images, index, title })} />;
    if (route.view === "us") return <UsPage data={data} canWrite={canWrite} commit={commit} onLogin={loginIdentity} onLogout={logoutIdentity} lockNow={() => setUnlocked(false)} installPrompt={installPrompt} standalone={standalone} onInstall={installApp} />;
    return <HomePage data={data} canWrite={canWrite} onOpen={(id) => navigate({ view: "detail", id })} onCreate={() => navigate({ view: "editor" })} onUs={() => navigate({ view: "us" })} />;
  })();

  const showNav = !["editor", "detail"].includes(route.view);
  const currentViewerImage = viewer?.images[viewer.index];
  const viewerSourceDiary = currentViewerImage ? data.diaries.find((diary) => diary.images.some((image) => image.id === currentViewerImage.id || image.url === currentViewerImage.url)) : undefined;
  return (
    <>
      <div className={`app-shell compact-ui ${data.profile.animations ? "motion-on" : "motion-off"}`}>
        <div className="desktop-orb orb-one" /><div className="desktop-orb orb-two" />
        <main className={`phone-frame page-${route.view}`}>{page}</main>
        {showNav && <BottomNav active={route.view} canWrite={canWrite} navigate={navigate} />}
        {viewer && <ImageViewer viewer={viewer} sourceDiary={viewerSourceDiary} setViewer={setViewer} onOpenDiary={(id) => { setViewer(null); navigate({ view: "detail", id }); }} />}
        {toast && <div className="toast" role="status"><span>♥</span>{toast}</div>}
        {updateWorker && <UpdatePrompt onUpdate={() => updateWorker.postMessage({ type: "SKIP_WAITING" })} onLater={() => setUpdateWorker(null)} />}
      </div>
    </>
  );
}

function UpdatePrompt({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  return <aside className="update-prompt" role="status"><span aria-hidden="true">✦</span><div><b>新版本已经准备好</b><small>更新后再继续记录，已写内容不会改变。</small></div><button type="button" onClick={onUpdate}>立即更新</button><button type="button" className="update-later" onClick={onLater} aria-label="稍后更新">×</button></aside>;
}

function Splash() {
  return <div className="splash"><div className="splash-glow" /><span className="float-heart heart-a">♡</span><span className="float-heart heart-b">♡</span><span className="float-heart heart-c">✦</span><div className="splash-mark">♡</div><h1>恋爱日记</h1><p>记录我们的小小世界</p><div className="splash-line" /></div>;
}

function LockScreen({ data, onUnlock }: { data: AppData; onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const verify = async () => {
    if (!data.profile.pinSalt || !data.profile.pinHash) return onUnlock();
    if (await hashPin(pin, data.profile.pinSalt) === data.profile.pinHash) onUnlock();
    else { setPin(""); setError("密码不对，再想想我们的小暗号吧"); }
  };
  return <div className="lock-screen"><div className="lock-card"><div className="lock-icon">♡</div><p className="eyebrow">PRIVATE DIARY</p><h1>{data.profile.name2}和{data.profile.name1}的小世界</h1><p>这本日记被好好锁住了</p><input inputMode="numeric" maxLength={4} value={pin} onChange={(event) => { setPin(event.target.value.replace(/\D/g, "")); setError(""); }} onKeyDown={(event) => event.key === "Enter" && void verify()} aria-label="四位隐私密码" placeholder="····" /><button className="primary-button" disabled={pin.length !== 4} onClick={() => void verify()}>打开日记</button>{error && <small className="form-error">{error}</small>}</div></div>;
}

function HomePage({ data, canWrite, onOpen, onCreate, onUs }: { data: AppData; canWrite: boolean; onOpen: (id: string) => void; onCreate: () => void; onUs: () => void }) {
  const diaries = useMemo(() => [...data.diaries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt), [data.diaries]);
  const anniversaries = useMemo(() => displayAnniversaries(data.anniversaries, data.profile.startDate), [data.anniversaries, data.profile.startDate]);
  const [filters, setFilters] = useState<DiaryFilters>(() => {
    const fallback: DiaryFilters = { query: "", author: "all", month: "all", tag: "all", hasPhotos: false, favoritesOnly: false };
    try {
      const value = JSON.parse(window.sessionStorage.getItem(HOME_FILTER_KEY) || "null") as Partial<DiaryFilters> | null;
      if (!value) return fallback;
      return { ...fallback, ...value, author: value.author === "person1" || value.author === "person2" ? value.author : "all", month: typeof value.month === "string" ? value.month : "all", tag: "all", favoritesOnly: false };
    } catch { return fallback; }
  });
  const filteredDiaries = useMemo(() => filterDiaries(diaries, filters, { includeTags: false, includeFavorites: false }), [diaries, filters]);
  const [visibleCount, setVisibleCount] = useState(() => {
    try { return Math.max(DIARY_BATCH_SIZE, Number(window.sessionStorage.getItem(HOME_VISIBLE_KEY)) || DIARY_BATCH_SIZE); } catch { return DIARY_BATCH_SIZE; }
  });
  const firstFilterRender = useRef(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleDiaries = filteredDiaries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredDiaries.length;
  const months = useMemo(() => Array.from(new Set(diaries.map((diary) => diary.date.slice(0, 7)))).sort().reverse(), [diaries]);
  const hasActiveFilters = Boolean(filters.query.trim() || filters.author !== "all" || filters.month !== "all" || filters.hasPhotos);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [filters.author !== "all", filters.month !== "all", filters.hasPhotos].filter(Boolean).length;
  const loveDays = diffDays(data.profile.startDate);
  const upcoming = useMemo(() => nextUpcomingAnniversary(anniversaries), [anniversaries]);
  const upcomingDays = upcoming ? anniversaryDaysUntil(upcoming) : null;
  const owner = data.profile.currentUser === "person1" ? data.profile.name1 : data.profile.name2;

  useEffect(() => {
    try { window.sessionStorage.setItem(HOME_FILTER_KEY, JSON.stringify(filters)); } catch { /* Private mode can disable storage. */ }
    if (firstFilterRender.current) { firstFilterRender.current = false; return; }
    setVisibleCount(DIARY_BATCH_SIZE);
  }, [filters]);

  useEffect(() => {
    try { window.sessionStorage.setItem(HOME_VISIBLE_KEY, String(visibleCount)); } catch { /* Keep loading without storage. */ }
  }, [visibleCount]);

  useEffect(() => {
    let top = 0;
    try {
      top = Number(window.sessionStorage.getItem(HOME_SCROLL_KEY)) || 0;
      window.sessionStorage.removeItem(HOME_SCROLL_KEY);
    } catch { /* No saved position. */ }
    if (!top) return;
    const timer = window.setTimeout(() => window.scrollTo({ top, behavior: "auto" }), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!hasMore || !target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((current) => nextTimelineCount(current, filteredDiaries.length, DIARY_BATCH_SIZE));
      }
    }, { rootMargin: "240px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [filteredDiaries.length, hasMore, visibleCount]);

  const loadMore = () => setVisibleCount((current) => nextTimelineCount(current, filteredDiaries.length, DIARY_BATCH_SIZE));
  const openDiary = (id: string) => {
    try {
      window.sessionStorage.setItem(HOME_VISIBLE_KEY, String(visibleCount));
      window.sessionStorage.setItem(HOME_SCROLL_KEY, String(window.scrollY));
    } catch { /* Navigation still works without storage. */ }
    onOpen(id);
  };
  const clearFilters = () => setFilters({ query: "", author: "all", month: "all", tag: "all", hasPhotos: false, favoritesOnly: false });

  return <div className="page-content home-page">
    <JournalHeader title={`${owner}的恋爱日记`} eyebrow="OUR LITTLE STORY" description={`当前是 ${owner} · 日记双方可见`} actions={<button type="button" className="heading-avatar-pair" onClick={onUs} aria-label="打开我们的页面"><span>{data.profile.avatar2 ? <img src={data.profile.avatar2} alt="" /> : data.profile.name2.slice(0, 1)}</span><span>{data.profile.avatar1 ? <img src={data.profile.avatar1} alt="" /> : data.profile.name1.slice(0, 1)}</span></button>} />
    <section className={`love-cover ${data.profile.coverImage ? "has-cover-photo" : ""}`} style={data.profile.coverImage ? { backgroundImage: `linear-gradient(145deg, rgba(69,41,66,.25), rgba(77,37,63,.66)), url(${data.profile.coverImage})` } : undefined} aria-label="我们的恋爱时光">
      <div className="home-cover-copy"><p className="home-cover-names">{data.profile.name2} <i>♡</i> {data.profile.name1}</p><h2><span>在一起的第</span><strong>{loveDays}</strong><small>天</small></h2><p className="home-cover-date">从 {formatShortDate(data.profile.startDate)}，一直到以后</p></div>
      <div className="home-cover-art" aria-hidden="true"><svg viewBox="0 0 156 126"><path d="M119 17v10m-5-5h10M25 93v8m-4-4h8" stroke="currentColor" strokeWidth="1.2" /><g transform="rotate(10 83 67)"><rect x="27" y="35" width="105" height="72" rx="4" fill="#c38b99" opacity=".15" transform="translate(2 4)" /><rect x="27" y="35" width="105" height="72" rx="4" fill="#fffaf0" stroke="#d5b6a8" /><path d="m29 40 45 32a10 10 0 0 0 11 0l45-32M29 103l33-28m68 28L97 75" fill="none" stroke="#e2c9b9" strokeWidth="1.1" /><path d="M80 63c-11-13-25 4 0 20 25-16 11-33 0-20Z" fill="#c88496" /><path d="M35 44h18m-18 5h12" stroke="#d2b69b" strokeWidth="1.1" /><rect x="110" y="42" width="13" height="17" rx="1" fill="#eee2d0" stroke="#cfb699" strokeDasharray="2 2" /><path d="M113 50c3-7 10-2 4 5-6-3-6-5-4-5Z" fill="#c6a07f" /></g><path d="M14 65c10-13 10-18 14-26" fill="none" stroke="#ac9c7a" strokeWidth="1.2" /><path d="M20 53c-13-3-13-10-6-10 0-10 9-12 12-5 10-3 14 4 6 10 5 8-3 14-9 7Z" fill="#d7a0aa" stroke="#c88e9d" strokeWidth=".8" /><circle cx="23" cy="46" r="3" fill="#fff4d8" /></svg><span>love, day by day</span></div>
      {upcoming && <button type="button" className="cover-upcoming" onClick={onUs} aria-label={`查看纪念日：${upcoming.title}，${upcomingDays === 0 ? "就是今天" : `还有 ${upcomingDays} 天`}`}>
        <span className="cover-date-copy"><span className="cover-date-label">纪念日<span aria-hidden="true"> / </span>下一份期待</span><b>{upcoming.title}</b><span className="cover-date-caption">{anniversaryDateLabel(upcoming)}<span className="cover-date-arrow" aria-hidden="true">↗</span></span></span>
        <span className={`cover-date-count ${upcomingDays === 0 ? "is-today" : ""}`}>{upcomingDays === 0 ? <strong>今天</strong> : <><span>还有</span><span><strong>{upcomingDays}</strong><small>天</small></span></>}</span>
      </button>}
    </section>
    <div className="section-heading home-diary-heading"><div><h2>最近的日记 <small>{hasActiveFilters ? filteredDiaries.length : diaries.length}</small></h2></div>{canWrite ? <button onClick={onCreate}>写今天 <span>＋</span></button> : <span className="home-reading-note">每一页，都是喜欢</span>}</div>
    <section className={`memory-search ${filtersOpen ? "filters-open" : ""}`} aria-label="搜索和筛选日记"><div className="memory-search-top"><label className="memory-search-box"><span aria-hidden="true">⌕</span><input type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="搜索文字、心情或日期" aria-label="搜索日记" />{filters.query && <button type="button" onClick={() => setFilters({ ...filters, query: "" })} aria-label="清除搜索">×</button>}</label><button type="button" className={`filter-disclosure ${activeFilterCount ? "selected" : ""}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><span>筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}</span><i>{filtersOpen ? "⌃" : "⌄"}</i></button></div>{filtersOpen && <div className="memory-search-advanced"><div className="memory-filter-row"><button type="button" className={filters.author === "all" ? "selected" : ""} onClick={() => setFilters({ ...filters, author: "all" })}>全部</button><button type="button" className={filters.author === "person1" ? "selected" : ""} style={{ "--filter-accent": data.profile.person1Accent } as CSSProperties} onClick={() => setFilters({ ...filters, author: "person1" })}>{data.profile.person1Marker} {data.profile.name1}</button><button type="button" className={filters.author === "person2" ? "selected" : ""} style={{ "--filter-accent": data.profile.person2Accent } as CSSProperties} onClick={() => setFilters({ ...filters, author: "person2" })}>{data.profile.person2Marker} {data.profile.name2}</button><select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} aria-label="按月份筛选"><option value="all">全部月份</option>{months.map((month) => <option value={month} key={month}>{month.replace("-", " 年 ")} 月</option>)}</select></div><div className="memory-filter-toggles"><button type="button" className={filters.hasPhotos ? "selected" : ""} onClick={() => setFilters({ ...filters, hasPhotos: !filters.hasPhotos })}>▧ 有照片</button>{hasActiveFilters && <button type="button" className="clear" onClick={clearFilters}>清除</button>}<span>{hasActiveFilters ? `找到 ${filteredDiaries.length} 篇` : `共 ${diaries.length} 篇`}</span></div></div>}</section>
    {filteredDiaries.length ? <><div className="diary-timeline">{visibleDiaries.map((diary, index) => <DiaryCard key={diary.id} diary={diary} profile={data.profile} index={index} onOpen={() => openDiary(diary.id)} />)}</div>{hasMore ? <div className="timeline-loader" ref={loadMoreRef}><button type="button" onClick={loadMore}>继续加载 · 还有 {filteredDiaries.length - visibleCount} 篇</button><small>向下滑会自动继续加载</small></div> : <p className="timeline-complete" aria-live="polite">已经看完全部 {filteredDiaries.length} 篇日记 ♡</p>}</> : diaries.length ? <SoftEmpty icon="⌕" title="没有找到符合条件的日记" text="换个关键词或清除筛选，再看看别的回忆吧。" action="清除筛选" onAction={clearFilters} /> : <SoftEmpty icon="♡" title="故事还没有开始记录呢" text="把第一个心动的瞬间，写进这里吧。" action={canWrite ? "写第一篇日记" : undefined} onAction={canWrite ? onCreate : undefined} />}
    <div className="home-signoff"><span>✦</span><p>to be continued</p><span>✦</span></div>
  </div>;
}

function HomeEntryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="home-entry-svg">
    <path d="M3.5 4.5h5.2c1.5 0 3.3.8 3.3 2.1 0-1.3 1.8-2.1 3.3-2.1h5.2v15h-5.2c-1.5 0-3.3.7-3.3 1.5 0-.8-1.8-1.5-3.3-1.5H3.5zM12 6.6V21M6 8h3M6 11h3M15 8h3" /><path d="m16.5 12.5-2 2.7h4z" />
  </svg>;
}

function JournalDecoration({ kind }: { kind: "gallery" }) {
  return <span className={`journal-decoration decoration-${kind}`} aria-hidden="true"><svg viewBox="0 0 64 64">
    <rect x="8" y="8" width="48" height="48" rx="5" fill="#fffaf0" stroke="#d8c1b0" strokeDasharray="2 2" />
    <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {kind === "gallery" && <><path d="m17 20 24-3 3 26-24 3Z" /><path d="M24 24h24v26H24z" fill="#fffaf0" /><path d="m27 41 5-6 5 4 5-8 3 10M28 45h16" /><circle cx="31" cy="29" r="2" /></>}
    </g><path d="M51 10v6m-3-3h6" fill="none" stroke="#d2a7ae" strokeWidth="1.1" />
  </svg></span>;
}

function DiaryCard({ diary, profile, index, onOpen }: { diary: Diary; profile: CoupleProfile; index: number; onOpen: () => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  return <button type="button" className={`diary-card author-${diary.author} tilt-${index % 3}`} style={{ "--diary-accent": appearance.accent } as CSSProperties} onClick={onOpen}>
    <div className="timeline-dot">{appearance.marker}</div><div className="diary-card-topline"><time className="date-sticker" dateTime={diary.date}>{formatShortDate(diary.date)}</time><span className="card-weekday">{formatDate(diary.date, true).split(" ").slice(-1)}</span></div>
    <div className="diary-card-body"><div className="writer-line"><b>{direction.author}</b><span>写给</span><b>{direction.recipient}</b><i>{appearance.marker}</i></div><div className="diary-meta"><span>{diary.mood.emoji} {diary.mood.name}</span><i>·</i><span>{diary.weather.emoji} {diary.weather.name}</span></div>
      {diary.images.length > 0 && <div className="mini-polaroids">{diary.images.slice(0, 2).map((image, imageIndex) => <div className={`mini-photo mini-${imageIndex}`} key={image.id}><img src={privateImageVariant(image.url, "thumb")} alt="日记照片" loading="lazy" decoding="async" /></div>)}</div>}
      <p className="writing-preview"><ColoredDiaryText diary={diary} /></p><span className="diary-card-foot"><span className="card-link">读这一天 <span>→</span></span>{diary.images.length > 0 && <small className="card-photo-count">▧ {diary.images.length} 张照片</small>}</span></div>
  </button>;
}

function DiaryEditor({ data, diary, initialDate, onSave, onCancel, onViewImages, navigationGuardRef }: { navigationGuardRef: { current: (() => boolean) | null }; data: AppData; diary?: Diary; initialDate?: string; onSave: (diary: Diary, expectedRevision: number | null) => Promise<boolean>; onCancel: () => void; onViewImages: (images: DiaryImage[], index: number) => void }) {
  const demoMode = loveDiaryRepository.isDemoMode();
  const [initialDraft] = useState<Diary>(() => diary ? structuredClone(diary) : {
      ...emptyDiary(initialDate, data.profile.currentUser),
      content: "",
  });
  const [draft, setDraft] = useState<Diary>(initialDraft);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [openTool, setOpenTool] = useState<EditorTool | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const originalImageIds = useRef(new Set(diary?.images.map((image) => image.id) ?? []));
  const uploadedImages = useRef(new Map<string, DiaryImage>());
  const editRevision = useRef(loveDiaryRepository.getRevision());
  const committed = useRef(false);
  const publishing = useRef(false);
  const changed = JSON.stringify(draft) !== JSON.stringify(initialDraft);
  useEffect(() => {
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      if ((committed.current && !publishing.current) || (!changed && !uploading && !publishing.current)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [changed, uploading]);
  useEffect(() => {
    navigationGuardRef.current = () => {
      if (committed.current && !publishing.current) return true;
      if (uploading || publishing.current) { setError("正在上传或发布，请稍等一下"); return false; }
      return !changed || window.confirm("内容尚未发布，离开后不会保留这次修改。确定离开吗？");
    };
    return () => { navigationGuardRef.current = null; };
  }, [changed, uploading, navigationGuardRef]);
  useEffect(() => () => {
    if (!committed.current) uploadedImages.current.forEach((image) => void loveDiaryRepository.deleteUploadedImage(image));
  }, []);
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    setUploading(files.length);
    setError("");
    try {
      const images: DiaryImage[] = [];
      let failed = 0;
      for (const file of files) {
        try {
          const image = await loveDiaryRepository.uploadImage(file);
          images.push(image);
          uploadedImages.current.set(image.id, image);
        } catch {
          failed += 1;
        } finally {
          setUploading((remaining) => Math.max(0, remaining - 1));
        }
      }
      if (images.length) setDraft((current) => ({ ...current, images: [...current.images, ...images] }));
      if (failed) setError(demoMode ? `${failed} 张照片没有保存成功，请换一张照片后重试` : `${failed} 张照片没有上传成功，请检查网络后重试`);
    } finally {
      setUploading(0);
    }
    event.target.value = "";
  };
  const moveImage = (index: number, direction: -1 | 1) => setDraft((current) => {
    const images = [...current.images]; const target = index + direction;
    if (target < 0 || target >= images.length) return current;
    [images[index], images[target]] = [images[target], images[index]];
    return { ...current, images };
  });
  const removeImage = (image: DiaryImage) => {
    setDraft((current) => ({ ...current, images: current.images.filter((item) => item.id !== image.id) }));
    if (!originalImageIds.current.has(image.id)) {
      uploadedImages.current.delete(image.id);
      void loveDiaryRepository.deleteUploadedImage(image);
    }
  };
  const cancel = () => {
    if (uploading || publishing.current) { setError("正在上传或发布，请稍等一下"); return; }
    if (changed && !window.confirm("内容尚未发布，离开后不会保留这次修改。确定离开吗？")) return;
    uploadedImages.current.forEach((image) => void loveDiaryRepository.deleteUploadedImage(image));
    uploadedImages.current.clear();
    committed.current = true;
    onCancel();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (uploading || publishing.current) { setError("正在上传或发布，请稍等一下"); return; }
    if (!draft.content.trim()) { setError("写下一点今天的故事再发布吧"); return; }
    publishing.current = true;
    setSaving(true);
    setError("");
    const formatted = trimTextAndMarks(draft.content, draft.textMarks);
    // Navigation can unmount this editor before the publication promise resolves.
    // Never let cleanup remove images while that request is in flight.
    committed.current = true;
    try {
      const saved = await onSave({ ...draft, ...formatted, title: undefined, updatedAt: Date.now() }, editRevision.current);
      if (saved) uploadedImages.current.clear();
      else {
        committed.current = false;
        editRevision.current = loveDiaryRepository.getRevision();
        setError("尚未发布成功，内容仍在当前页面，请检查网络后重试，暂时不要离开或刷新。");
      }
    } catch {
      committed.current = false;
      setError("尚未发布成功，内容仍在当前页面，请稍后重试。");
    } finally {
      publishing.current = false;
      setSaving(false);
    }
  };
  const direction = diaryDirection(draft, data.profile);
  return <form className="editor-page page-content" onSubmit={submit}>
    <JournalHeader title={diary ? "编辑日记" : "写日记"} eyebrow="NEW MEMORY" onBack={cancel} description={`${direction.author} 写给 ${direction.recipient}`} actions={<button type="submit" className="heading-action" disabled={Boolean(uploading) || saving}>{uploading ? "上传中" : saving ? "发布中" : diary ? "发布修改" : "发布"}</button>} />

    <section className="editor-paper titleless-paper">
      <div className="editor-paper-meta"><label className="date-field"><span>日期</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label></div>
      <p className="paper-opening">亲爱的{direction.recipient}：</p>
      <ColorLetterEditor content={draft.content} marks={draft.textMarks}
        onChange={(content, textMarks) => setDraft((current) => ({ ...current, content, textMarks }))} />
    </section>
    <div className="editor-tools" role="group" aria-label="日记附加选项">
      {([
        { id: "photos", label: "照片", value: uploading ? "上传中" : draft.images.length ? `${draft.images.length} 张` : "添加照片" },
        { id: "mood", label: "心情", value: draft.mood.name },
        { id: "weather", label: "天气", value: draft.weather.name },
      ] as const).map((tool) => <button type="button" key={tool.id} className={openTool === tool.id ? "selected" : ""} aria-expanded={openTool === tool.id} aria-controls={`editor-tool-${tool.id}`} onClick={() => setOpenTool((current) => current === tool.id ? null : tool.id)}><EditorToolIcon tool={tool.id} /><b>{tool.label}</b><small>{tool.value}</small></button>)}
    </div>
    <div id="editor-tool-mood" className="editor-tool-panel" hidden={openTool !== "mood"}>
    <Picker title="今天的心情" subtitle="选一个最像此刻的你"><div className="choice-grid mood-grid">{moods.map((mood) => <button type="button" key={mood.id} className={draft.mood.id === mood.id ? "selected" : ""} onClick={() => setDraft({ ...draft, mood })}><span>{mood.emoji}</span><small>{mood.name}</small></button>)}</div></Picker>
    </div>
    <div id="editor-tool-weather" className="editor-tool-panel" hidden={openTool !== "weather"}>
    <Picker title="窗外的天气" subtitle="天气也是故事的一部分"><div className="choice-grid weather-grid">{weathers.map((weather) => <button type="button" key={weather.id} className={draft.weather.id === weather.id ? "selected" : ""} onClick={() => setDraft({ ...draft, weather })}><span>{weather.emoji}</span><small>{weather.name}</small></button>)}</div></Picker>
    </div>
    <div id="editor-tool-photos" className="editor-tool-panel" hidden={openTool !== "photos"}>
    <section className="photo-editor"><div className="field-heading"><div><h2>今天的照片</h2><p>多选上传，自动压缩，保留清晰回忆。</p></div><button type="button" disabled={Boolean(uploading)} onClick={() => uploadRef.current?.click()}>{uploading ? `还有 ${uploading} 张…` : "＋ 添加"}</button></div><input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event)} />
      {draft.images.length ? <div className="photo-sort-list">{draft.images.map((image, index) => <div className={`sort-polaroid photo-tilt-${index % 3}`} key={image.id}><button type="button" className="photo-preview" onClick={() => onViewImages(draft.images, index)}><img src={privateImageVariant(image.url, "thumb")} alt={`上传照片 ${index + 1}`} /></button><div className="photo-controls"><button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label="向前移动">←</button><span>{index + 1}</span><button type="button" disabled={index === draft.images.length - 1} onClick={() => moveImage(index, 1)} aria-label="向后移动">→</button><button type="button" className="delete-mini" onClick={() => removeImage(image)} aria-label="删除照片">×</button></div></div>)}</div> : <button type="button" className="upload-drop" disabled={Boolean(uploading)} onClick={() => uploadRef.current?.click()}><span>▧</span><b>{uploading ? (demoMode ? "正在压缩并保存照片…" : "正在上传并优化照片…") : "放几张今天的照片进来"}</b><small>支持多选 · {demoMode ? "自动压缩后保存在当前浏览器" : "自动压缩后云端保存"}</small></button>}
    </section>
    </div>
    {openTool && <button type="button" className="editor-collapse" onClick={() => setOpenTool(null)}>收起选项 <span aria-hidden="true">⌃</span></button>}
    {error && <p className="form-error centered">{error}</p>}<button className="save-diary-button" type="submit" disabled={Boolean(uploading) || saving}>{saving ? "正在发布…" : <>{diary ? "发布修改" : "发布日记"} <span>♡</span></>}</button><p className="privacy-hint">⌁ {demoMode ? "演示内容只在当前浏览器可见" : "无论谁写，两个人都能看见全部内容"}</p>
  </form>;
}

type EditorTool = "photos" | "mood" | "weather" | "color";

function EditorToolIcon({ tool }: { tool: EditorTool }) {
  const strokes = {
    photos: <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="8" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 3-3 5 5" /></>,
    mood: <><circle cx="12" cy="12" r="9" /><path d="M8 14c1 4 7 4 8 0M8 9h.01M16 9h.01" /></>,
    weather: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    color: <><path d="m5 19 7-15 7 15M8 13h8" /><path d="M4 22h16" stroke="#b76582" strokeWidth="3" /></>,
  };
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{strokes[tool]}</svg>;
}

function Picker({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="picker-section"><div className="field-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>;
}

function DiaryDetail({ diary, profile, canWrite, responses, history, previousDiary, nextDiary, onNavigate, onBack, onEdit, onDelete, onAddResponse, onDeleteResponse, onRestoreHistory, onViewImages }: { diary: Diary; profile: CoupleProfile; canWrite: boolean; responses: DiaryResponse[]; history: DiaryHistoryEntry[]; previousDiary?: Diary; nextDiary?: Diary; onNavigate: (id: string) => void; onBack: () => void; onEdit: () => void; onDelete: () => void; onAddResponse: (content: string, emoji: string) => Promise<boolean>; onDeleteResponse: (id: string) => Promise<boolean>; onRestoreHistory: (entry: DiaryHistoryEntry) => Promise<boolean>; onViewImages: (images: DiaryImage[], index: number) => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  return <article className={`detail-page page-content author-${diary.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties}><JournalHeader title={formatShortDate(diary.date)} eyebrow="A PAGE OF US" onBack={onBack} description={`${appearance.marker} ${direction.author} 写给 ${direction.recipient}`} actions={canWrite ? <button type="button" className="heading-action" onClick={onEdit}>编辑</button> : <span>只读</span>} /><div className="detail-meta"><span>{formatDate(diary.date, true).split(" ").slice(-1)}</span><span>{diary.mood.emoji} {diary.mood.name}</span><span>{diary.weather.emoji} {diary.weather.name}</span></div>
    {diary.images.length > 0 && <div className={`detail-photos count-${Math.min(diary.images.length, 3)}`}>{diary.images.map((image, index) => <button key={image.id} className={`detail-photo photo-tilt-${index % 3}`} onClick={() => onViewImages(diary.images, index)}><img src={privateImageVariant(image.url, "thumb")} alt={`日记照片 ${index + 1}`} /><small>{String(index + 1).padStart(2, "0")}</small></button>)}</div>}
    <section className="detail-letter"><span className="letter-tape" /><p><ColoredDiaryText diary={diary} /></p><div className="letter-sign">{appearance.marker} &nbsp; {formatShortDate(diary.date)}</div></section>
    <nav className="detail-pagination" aria-label="日记上一篇和下一篇"><button type="button" disabled={!previousDiary} onClick={() => previousDiary && onNavigate(previousDiary.id)}><span>←</span><small>上一篇</small><b>{previousDiary ? formatShortDate(previousDiary.date) : "已经是最新"}</b></button><button type="button" disabled={!nextDiary} onClick={() => nextDiary && onNavigate(nextDiary.id)}><small>下一篇</small><b>{nextDiary ? formatShortDate(nextDiary.date) : "已经是最早"}</b><span>→</span></button></nav>
    <DiaryResponses responses={responses} profile={profile} canWrite={canWrite} onAdd={onAddResponse} onDelete={onDeleteResponse} />
    {canWrite && history.length > 0 && <DiaryHistory history={history} profile={profile} onRestore={onRestoreHistory} />}
    {canWrite && <div className="detail-actions"><button onClick={onEdit}>✎ 编辑这篇</button><button className="danger-button" onClick={onDelete}>⌫ 删除</button></div>}
  </article>;
}

function DiaryResponses({ responses, profile, canWrite, onAdd, onDelete }: { responses: DiaryResponse[]; profile: CoupleProfile; canWrite: boolean; onAdd: (content: string, emoji: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = content.trim();
    if (!clean || saving) return;
    setSaving(true);
    if (await onAdd(clean.slice(0, 160), "")) setContent("");
    setSaving(false);
  };
  return <section className="diary-responses"><div className="response-heading"><h2>评论</h2><span>{responses.length}</span></div>{responses.length > 0 ? <div className="response-list">{responses.map((response) => {
    const name = response.author === "person1" ? profile.name1 : profile.name2;
    const avatar = response.author === "person1" ? profile.avatar1 : profile.avatar2;
    const appearance = diaryAppearance(response.author, profile);
    return <article className={`response-bubble author-${response.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties} key={response.id}><span className="response-avatar">{avatar ? <img src={avatar} alt={name} /> : name.slice(0, 1)}</span><div><b>{name}</b><p>{response.content}</p><small>{new Date(response.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>{canWrite && <button type="button" aria-label="删除这条回应" onClick={() => window.confirm("删除这条回应吗？") && void onDelete(response.id)}>×</button>}</article>;
  })}</div> : <p className="response-empty">还没有评论</p>}{canWrite && <form className="response-form" onSubmit={submit}><label><input value={content} maxLength={160} onChange={(event) => setContent(event.target.value)} placeholder="说点什么……" aria-label="日记回应" /><button type="submit" disabled={!content.trim() || saving}>{saving ? "发送中" : "发送"}</button></label></form>}</section>;
}

function DiaryHistory({ history, profile, onRestore }: { history: DiaryHistoryEntry[]; profile: CoupleProfile; onRestore: (entry: DiaryHistoryEntry) => Promise<boolean> }) {
  return <details className="diary-history"><summary><span>↺ 历史版本</span><small>保留最近 {history.length} 个版本</small></summary><div>{history.map((entry) => { const direction = diaryDirection(entry.diary, profile); return <article key={entry.id}><div><b>{new Date(entry.savedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b><small>{direction.author} 写给 {direction.recipient}</small><p>{diaryExcerpt(entry.diary.content, 54)}</p></div><button type="button" onClick={() => void onRestore(entry)}>恢复</button></article>; })}</div></details>;
}




function DiaryBookPage({ data, canWrite, onEdit, onViewImages }: { data: AppData; canWrite: boolean; onEdit: (id: string) => void; onViewImages: (images: DiaryImage[], index: number, title: string) => void }) {
  const [order, setOrder] = useState<BookOrder>(() => {
    if (typeof window === "undefined") return "newest";
    try { return window.localStorage.getItem(BOOK_ORDER_KEY) === "oldest" ? "oldest" : "newest"; } catch { return "newest"; }
  });
  const diaries = useMemo(() => sortBookDiaries(data.diaries, order), [data.diaries, order]);
  const [pageIndex, setPageIndex] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      const savedId = window.localStorage.getItem(BOOK_PAGE_KEY);
      const savedIndex = savedId ? diaries.findIndex((diary) => diary.id === savedId) : -1;
      return savedIndex >= 0 ? savedIndex : 0;
    } catch { return 0; }
  });
  const [partIndex, setPartIndex] = useState(0);
  const [pagination, setPagination] = useState({ id: "", count: 1 });
  const [flip, setFlip] = useState<{ direction: BookDirection; target: number; part: number } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const safeIndex = diaries.length ? Math.min(pageIndex, diaries.length - 1) : 0;
  const current = diaries[safeIndex];
  const partCount = pagination.id === current?.id ? pagination.count : 1;
  const safePart = Math.min(partIndex, partCount - 1);
  const reportPagination = useCallback((id: string, count: number) => {
    setPagination((old) => old.id === id && old.count === count ? old : { id, count });
  }, []);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;
    window.scrollTo(0, 0);
    const update = () => {
      const top = screen.closest("main")!.getBoundingClientRect().top + window.scrollY;
      screen.style.setProperty("--book-viewport", `${Math.max(0, (window.visualViewport?.height ?? window.innerHeight) - top)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    // A local preview banner can sit above the app; production has no banner.
    if (screen.closest(".app-shell")?.previousElementSibling) observer.observe(screen.closest(".app-shell")!.previousElementSibling!);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.visualViewport?.removeEventListener("resize", update); };
  }, []);

  useEffect(() => {
    if (!current) return;
    try { window.localStorage.setItem(BOOK_PAGE_KEY, current.id); } catch { /* Device preference is optional. */ }
  }, [current]);

  useEffect(() => {
    if (!flip) return;
    const fallback = window.setTimeout(() => {
      setPageIndex(flip.target);
      setPartIndex(flip.part);
      setFlip(null);
    }, 900);
    return () => window.clearTimeout(fallback);
  }, [flip]);

  if (!current) return <div ref={screenRef} className="book-page-screen page-content"><JournalHeader className="book-header" title="我们的日记本" eyebrow="THE STORY OF US" /><SoftEmpty icon="▤" title="日记本还是空白的" text="写下第一篇日记后，它就会出现在这里。" /></div>;

  const startFlip = (direction: BookDirection) => {
    if (flip) return;
    const withinDiary = direction === "next" ? safePart < partCount - 1 : safePart > 0;
    const target = withinDiary ? safeIndex : bookPageTarget(safeIndex, direction, diaries.length);
    if (target === null) return;
    const part = withinDiary ? safePart + (direction === "next" ? 1 : -1) : direction === "next" ? 0 : Number.MAX_SAFE_INTEGER;
    if (!data.profile.animations || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setPageIndex(target); setPartIndex(part); }
    else setFlip({ direction, target, part });
  };
  const finishFlip = () => {
    if (!flip) return;
    setPageIndex(flip.target);
    setPartIndex(flip.part);
    setFlip(null);
  };
  const revealed = flip && diaries[flip.target] ? diaries[flip.target] : current;
  const changeOrder = (nextOrder: BookOrder) => {
    if (nextOrder === order || flip) return;
    const nextDiaries = sortBookDiaries(data.diaries, nextOrder);
    const nextIndex = nextDiaries.findIndex((diary) => diary.id === current.id);
    setOrder(nextOrder);
    setPageIndex(nextIndex >= 0 ? nextIndex : 0);
    try { window.localStorage.setItem(BOOK_ORDER_KEY, nextOrder); } catch { /* Device preference is optional. */ }
  };

  return <div ref={screenRef} className="book-page-screen page-content">
    <JournalHeader className="book-header" title="我们的日记本" eyebrow="THE STORY OF US" />
    <div className="book-reading-bar"><p>共 {diaries.length} 篇日记</p><div className="book-order-controls" role="group" aria-label="日记本阅读顺序"><button type="button" className={order === "newest" ? "selected" : ""} aria-pressed={order === "newest"} disabled={Boolean(flip)} onClick={() => changeOrder("newest")}>从新到旧</button><button type="button" className={order === "oldest" ? "selected" : ""} aria-pressed={order === "oldest"} disabled={Boolean(flip)} onClick={() => changeOrder("oldest")}>从旧到新</button></div></div>
    <div className="book-cover-shell">
      <div className="book-spine" aria-hidden="true"><span>LOVE / NOTES</span></div>
      <div className="book-ribbon" aria-hidden="true">♡</div>
      <div className="book-stage" aria-label="日记书页，左右滑动翻页" onTouchStart={(event) => { if (event.touches.length !== 1) { touchStart.current = null; return; } const point = event.touches[0]; touchStart.current = { x: point.clientX, y: point.clientY }; }} onTouchCancel={() => { touchStart.current = null; }} onTouchEnd={(event) => { const start = touchStart.current; touchStart.current = null; if (!start) return; const point = event.changedTouches[0]; const direction = bookSwipeDirection(point.clientX - start.x, point.clientY - start.y); if (direction) startFlip(direction); }}>
        <div className={`book-sheet book-sheet-under ${flip ? "is-revealed" : ""}`} aria-hidden="true" inert><BookPaper key={revealed.id} diary={revealed} profile={data.profile} partIndex={flip?.part ?? partIndex} pageNumber={flip?.target !== undefined ? flip.target + 1 : safeIndex + 1} interactive={false} onViewImages={onViewImages} /></div>
        <div className={`book-sheet book-sheet-top ${flip ? `is-flipping-${flip.direction}` : ""}`} onAnimationEnd={(event) => event.target === event.currentTarget && finishFlip()} inert={Boolean(flip)} aria-live="polite" aria-busy={Boolean(flip)}>
          <BookPaper key={current.id} diary={current} profile={data.profile} partIndex={partIndex} onPagination={reportPagination} pageNumber={safeIndex + 1} interactive onViewImages={onViewImages} />
        </div>
      </div>
    </div>
    <div className="book-page-tools"><span className="book-swipe-hint">第 {safeIndex + 1} / {diaries.length} 篇 · {safePart + 1} / {partCount} 页</span>{canWrite && <button type="button" className="book-edit-current" disabled={Boolean(flip)} onClick={() => onEdit(current.id)}>✎ 编辑</button>}</div>
    <div className="book-scrubber"><input type="range" min={0} max={Math.max(0, diaries.length - 1)} value={safeIndex} disabled={Boolean(flip)} style={{ "--book-progress": `${diaries.length > 1 ? safeIndex / (diaries.length - 1) * 100 : 0}%` } as CSSProperties} aria-label="快速选择日记页" aria-valuetext={`第 ${safeIndex + 1} 篇，共 ${diaries.length} 篇`} onChange={(event) => { setFlip(null); setPartIndex(0); setPageIndex(Number(event.target.value)); }} /></div>
    <div className="book-controls">
      <button type="button" disabled={(safeIndex === 0 && safePart === 0) || Boolean(flip)} onClick={() => startFlip("previous")}><span>‹</span><b>上一页</b></button>
      <button type="button" disabled={(safeIndex === diaries.length - 1 && safePart === partCount - 1) || Boolean(flip)} onClick={() => startFlip("next")}><b>下一页</b><span>›</span></button>
    </div>
  </div>;
}

function BookPaper({ diary, profile, pageNumber, partIndex, onPagination, interactive, onViewImages }: { diary: Diary; profile: CoupleProfile; pageNumber: number; partIndex: number; onPagination?: (id: string, count: number) => void; interactive: boolean; onViewImages: (images: DiaryImage[], index: number, title: string) => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  const [year, month, day] = diary.date.split("-");
  const bodyRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLParagraphElement>(null);
  const [pages, setPages] = useState<BookTextPage[]>([]);
  const photoPages = diary.images.length ? 1 : 0;
  const total = Math.max(1, pages.length + photoPages);
  const part = Math.min(partIndex, total - 1);
  const photoPage = photoPages > 0 && part === 0;
  useEffect(() => {
    const body = bodyRef.current;
    const probe = probeRef.current;
    if (!body || !probe) return;
    let disposed = false;
    const update = () => {
      if (disposed || body.clientHeight < 1) return;
      const measured = !diary.content && photoPages ? [] : paginateBookText(diary.content, (text) => {
        probe.textContent = text;
        return probe.getBoundingClientRect().height <= body.clientHeight - 2;
      });
      setPages((old) => JSON.stringify(old) === JSON.stringify(measured) ? old : measured);
      if (interactive) onPagination?.(diary.id, Math.max(1, measured.length + photoPages));
    };
    const observer = new ResizeObserver(update);
    observer.observe(body);
    const frame = window.requestAnimationFrame(update);
    void document.fonts.ready.then(update);
    return () => { disposed = true; window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [diary.content, diary.id, photoPages, interactive, onPagination]);
  const textPage = pages[part - photoPages];
  return <article className={`book-paper author-${diary.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties}>
    <div className="book-paper-head"><time dateTime={diary.date}><strong>{day}</strong><span>{year} / {month}<small>{formatDate(diary.date, true).split(" ").slice(-1)}</small></span></time><div className="book-day-feeling"><span>{diary.mood.emoji} {diary.mood.name}</span><small>{diary.weather.emoji} {diary.weather.name}</small></div></div>
    <div className="book-letter-direction"><span className="book-author-seal">{appearance.marker}</span><span><b>{direction.author}</b><i> 写给 </i><b>{direction.recipient}</b></span></div>
    <div ref={bodyRef} className="book-paper-body" role="region" aria-label={`日记正文，第 ${part + 1} 页，共 ${total} 页`}>
      <div className="book-writing book-measure" aria-hidden="true"><p ref={probeRef} /></div>
      {photoPage && <div className={`book-photo-row book-photos-${Math.min(diary.images.length, 3)}`}>{diary.images.slice(0, 3).map((image, index) => interactive ? <button type="button" key={image.id} onClick={() => onViewImages(diary.images, index, formatDate(diary.date))} aria-label={`查看日记照片 ${index + 1}，共 ${diary.images.length} 张`}><img src={privateImageVariant(image.url, "thumb")} alt={`日记照片 ${index + 1}`} loading="lazy" decoding="async" />{index === 2 && diary.images.length > 3 && <span className="book-photo-more">＋{diary.images.length - 3}</span>}</button> : <span key={image.id}><img src={privateImageVariant(image.url, "thumb")} alt="" /></span>)}<small className="book-photo-caption">这一天的 {diary.images.length} 张照片<i>轻点看清晰图</i></small></div>}
      {!photoPage && textPage && <div className="book-writing book-visible-text" data-start={textPage.start} data-end={textPage.end}><p><ColoredDiaryText diary={bookTextSlice(diary, textPage)} /></p></div>}
    </div>
    <footer><span>{part < total - 1 ? "轻翻下一页，故事还在继续" : `— ${direction.author} ${appearance.marker}`}</span><i>{String(pageNumber).padStart(2, "0")} · {part + 1}/{total}</i></footer>
  </article>;
}

function GalleryPage({ data, onHome, onOpen }: { data: AppData; onHome: () => void; onOpen: (images: DiaryImage[], index: number, title: string) => void }) {
  const [filter, setFilter] = useState("全部");
  const [visibleCount, setVisibleCount] = useState(GALLERY_BATCH_SIZE);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const diaryPhotos = [...data.diaries].flatMap((diary) => diary.images.map((image) => ({ image, date: diary.date, diary, wish: undefined as WishItem | undefined })));
  const wishPhotos = data.wishes.filter((wish) => wish.completionImage && !diaryPhotos.some(({ image }) => image.id === wish.completionImage!.id || image.url === wish.completionImage!.url)).map((wish) => ({ image: wish.completionImage!, date: timestampDateInput(wish.completedAt ?? wish.createdAt), diary: undefined as Diary | undefined, wish }));
  const all = [...diaryPhotos, ...wishPhotos].sort((a, b) => b.date.localeCompare(a.date));
  const months = Array.from(new Set(all.map((item) => item.date.slice(0, 7))));
  const visible = filter === "全部" ? all : all.filter((item) => item.date.startsWith(filter));
  const displayed = visible.slice(0, visibleCount);
  const images = displayed.map((item) => item.image);
  const chooseFilter = (value: string) => { setFilter(value); setVisibleCount(GALLERY_BATCH_SIZE); };
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !("IntersectionObserver" in window) || visibleCount >= visible.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => Math.min(visible.length, count + GALLERY_BATCH_SIZE));
    }, { rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [visible.length, visibleCount]);
  return <div className="gallery-page page-content"><JournalHeader title="我们的相册" eyebrow="OUR PHOTO ALBUM" description={`${all.length} 张照片，珍藏每一个心动瞬间`} actions={<span className="heading-decoration" aria-hidden="true">♡</span>} />{all.length ? <><div className="filter-pills"><button className={filter === "全部" ? "selected" : ""} onClick={() => chooseFilter("全部")}>全部</button>{months.map((month) => <button key={month} className={filter === month ? "selected" : ""} onClick={() => chooseFilter(month)}>{month.replace("-", "年")}月</button>)}</div><div className="masonry">{displayed.map(({ image, diary, wish, date }, index) => {
    const direction = diary ? diaryDirection(diary, data.profile) : undefined;
    const title = diary && direction ? `${direction.author} 写给 ${direction.recipient}` : `共同回忆 · ${wish?.title ?? "完成回忆"}`;
    return <button key={`${diary ? `diary-${diary.id}` : `wish-${wish?.id}`}-${image.id}`} className={`gallery-photo gallery-${index % 4}`} onClick={() => onOpen(images, index, title)}><img src={privateImageVariant(image.url, "thumb")} alt={`${formatDate(date)}的回忆照片`} loading="lazy" decoding="async" /><span><b>{formatShortDate(date)} · {diary && direction ? `${direction.author} → ${direction.recipient}` : "共同回忆"}</b><small>{diary ? `${diary.mood.emoji} ${diaryExcerpt(diary.content, 14)}` : `♡ ${diaryExcerpt(wish?.title ?? "一起完成的小事", 14)}`}</small></span></button>;
  })}</div>{displayed.length < visible.length && <button ref={loadMoreRef} type="button" className="gallery-load-more" onClick={() => setVisibleCount((count) => Math.min(visible.length, count + GALLERY_BATCH_SIZE))}>继续加载照片 · {displayed.length}/{visible.length}</button>}</> : <SoftEmpty icon="▧" title="这里还没有照片" text="下一次见面，记得多拍几张呀。日记里的照片都会来到这里。" action="去首页看看" onAction={onHome} />}</div>;
}

function UsPage({ data, canWrite, commit, onLogin, onLogout, lockNow, installPrompt, standalone, onInstall }: { data: AppData; canWrite: boolean; commit: Commit; onLogin: LoginHandler; onLogout: () => Promise<void>; lockNow: () => void; installPrompt: BeforeInstallPromptEvent | null; standalone: boolean; onInstall: () => Promise<void> }) {
  const [tab, setTab] = useState<"story" | "settings">("story");
  const photoCount = data.diaries.reduce((sum, diary) => sum + diary.images.length, 0);
  const anniversaryCount = useMemo(() => displayAnniversaries(data.anniversaries, data.profile.startDate).length, [data.anniversaries, data.profile.startDate]);
  const mostMood = useMemo(() => {
    const counts = new Map<string, { mood: Mood; count: number }>();
    data.diaries.forEach((diary) => counts.set(diary.mood.id, { mood: diary.mood, count: (counts.get(diary.mood.id)?.count || 0) + 1 }));
    return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.mood || moods[1];
  }, [data.diaries]);
  return <div className={`us-page page-content ${tab === "settings" ? "settings-view" : ""}`}>
    <JournalHeader title={tab === "settings" ? "日记设置" : "我们的故事"} eyebrow="THE TWO OF US" description={`${data.profile.name2} & ${data.profile.name1}`} actions={<div className="heading-avatar-pair"><span>{data.profile.avatar2 ? <img src={data.profile.avatar2} alt="" /> : data.profile.name2.slice(0, 1)}</span><span>{data.profile.avatar1 ? <img src={data.profile.avatar1} alt="" /> : data.profile.name1.slice(0, 1)}</span></div>} />
    <div className="segment"><button className={tab === "story" ? "selected" : ""} aria-pressed={tab === "story"} onClick={() => setTab("story")}>我们的故事</button><button className={tab === "settings" ? "selected" : ""} aria-pressed={tab === "settings"} onClick={() => setTab("settings")}>{canWrite ? "日记设置" : "身份登录"}</button></div>
    {tab === "story" ? <><section className="love-stats"><div className="big-stat"><span>我们已经在一起</span><strong>{diffDays(data.profile.startDate)}</strong><small>天</small></div><div className="stat-grid"><div><span className="stat-icon" aria-hidden="true"><NavIcon view="editor" /></span><strong>{data.diaries.length}</strong><small>篇日记</small></div><div><span className="stat-icon" aria-hidden="true"><NavIcon view="gallery" /></span><strong>{photoCount}</strong><small>张照片</small></div><div><span className="stat-icon" aria-hidden="true"><NavIcon view="anniversary" /></span><strong>{anniversaryCount}</strong><small>个纪念日</small></div><div><span aria-hidden="true">{mostMood.emoji}</span><strong>{mostMood.name}</strong><small>最常见心情</small></div></div></section><AnniversarySection data={data} canWrite={canWrite} commit={commit} /></> : <Settings data={data} canWrite={canWrite} commit={commit} onLogin={onLogin} onLogout={onLogout} lockNow={lockNow} installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} />}
  </div>;
}

function AnniversarySection({ data, canWrite, commit }: { data: AppData; canWrite: boolean; commit: Commit }) {
  const [adding, setAdding] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [draft, setDraft] = useState<Anniversary>({ id: createId(), title: "", date: toDateInput(), calendar: "solar", emoji: "💗", description: "" });
  const today = toDateInput();
  const { featured, remaining, past } = useMemo(() => anniversaryPresentation(displayAnniversaries(data.anniversaries, data.profile.startDate), today), [data.anniversaries, data.profile.startDate, today]);
  const add = async () => { if (!draft.title.trim()) return; if (await commit({ ...data, anniversaries: [...data.anniversaries, { ...draft, title: draft.title.trim() }] }, "重要的日子已经记住啦")) { setDraft({ id: createId(), title: "", date: toDateInput(), calendar: "solar", emoji: "💗", description: "" }); setAdding(false); } };
  const remove = (item: Anniversary) => {
    if (canWrite && !item.automatic && window.confirm(`删除“${item.title}”吗？`)) void commit({ ...data, anniversaries: data.anniversaries.filter((entry) => entry.id !== item.id) });
  };
  const dateRow = ({ item, days }: { item: Anniversary; days: number }) => <details key={item.id} className="anniversary-date-row">
    <summary><span className="anniversary-date-dot" aria-hidden="true" /><span className="anniversary-date-copy"><b>{item.title}</b><small>{anniversaryDateLabel(item)}</small></span><span className={`anniversary-date-count ${days < 0 ? "is-past" : ""}`}>{days < 0 ? "已走过" : days === 0 ? "就是今天" : <><strong>{days}</strong> 天后</>}</span><span className="anniversary-row-chevron" aria-hidden="true">⌄</span></summary>
    <div className="anniversary-date-detail"><p>{item.description || "把这一天，留在我们的故事里。"}</p>{canWrite && !item.automatic && <button type="button" onClick={() => remove(item)} aria-label={`删除纪念日：${item.title}`}>删除这项纪念日</button>}</div>
  </details>;
  return <section className="anniversary-section anniversary-journal" aria-labelledby="anniversary-title">
    <div className="anniversary-heading"><div><p className="eyebrow">OUR DATES</p><h2 id="anniversary-title">纪念日</h2></div>{canWrite && <button type="button" aria-expanded={adding} aria-controls="anniversary-add-form" onClick={() => setAdding(!adding)}>{adding ? "收起" : "＋ 添加"}</button>}</div>
    {canWrite && adding && <div className="inline-form" id="anniversary-add-form"><div className="emoji-row">{["💗", "🎂", "🎄", "✈️", "🏠", "🌷"].map((emoji) => <button key={emoji} type="button" aria-label={`使用图标 ${emoji}`} aria-pressed={draft.emoji === emoji} className={draft.emoji === emoji ? "selected" : ""} onClick={() => setDraft({ ...draft, emoji })}>{emoji}</button>)}</div><input aria-label="纪念日名称" placeholder="纪念日名称" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><label>公历日期<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><textarea aria-label="纪念日寄语" placeholder="写一句关于这天的话（可选）" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><button type="button" className="primary-button" onClick={() => void add()}>收进纪念册</button></div>}
    {featured ? <article className="anniversary-feature" aria-label={`最近的纪念日：${featured.item.title}`}>
      <div className="anniversary-feature-top"><span>{featured.days === 0 ? "今天，值得好好庆祝" : "下一次，一起庆祝"}</span><span className="anniversary-seal" aria-hidden="true">♡</span></div>
      <div className="anniversary-feature-body"><div><h3>{featured.item.title}</h3><p>{anniversaryDateLabel(featured.item)}</p></div><div className={`anniversary-countdown ${featured.days === 0 ? "is-today" : ""}`}>{featured.days === 0 ? <strong>今天</strong> : <><span>还有</span><strong>{featured.days}</strong><span>天</span></>}</div></div>
      <p className="anniversary-feature-note">{featured.item.description || "把平凡的日子，过成值得纪念的模样。"}</p>
      {canWrite && !featured.item.automatic && <details className="anniversary-manage"><summary>管理这项纪念日</summary><button type="button" onClick={() => remove(featured.item)}>删除这项纪念日</button></details>}
    </article> : <p className="anniversary-empty">把值得期待的日子，认真记住。</p>}
    {remaining.length > 0 && <div className="anniversary-dates" id="anniversary-upcoming" aria-label="接下来的纪念日">{(showAll ? remaining : remaining.slice(0, 3)).map(dateRow)}</div>}
    {remaining.length > 3 && <button className="anniversary-more" type="button" aria-expanded={showAll} aria-controls="anniversary-upcoming" onClick={() => setShowAll(!showAll)}>{showAll ? "收起日期" : `查看其余 ${remaining.length - 3} 个纪念日`}<span aria-hidden="true">{showAll ? "⌃" : "⌄"}</span></button>}
    {past.length > 0 && <details className="anniversary-past"><summary><span>过去的纪念日 <small>· {past.length}</small></span><span aria-hidden="true">⌄</span></summary><div className="anniversary-dates">{past.map(dateRow)}</div></details>}
  </section>;
}

type SettingsSection = "appearance" | "reading" | "device";

function Settings({ data, canWrite, commit, onLogin, onLogout, lockNow, installPrompt, standalone, onInstall }: { data: AppData; canWrite: boolean; commit: Commit; onLogin: LoginHandler; onLogout: () => Promise<void>; lockNow: () => void; installPrompt: BeforeInstallPromptEvent | null; standalone: boolean; onInstall: () => Promise<void> }) {
  const demoMode = loveDiaryRepository.isDemoMode();
  const [profile, setProfile] = useState(structuredClone(data.profile));
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [pin, setPin] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const settingsRevision = useRef(loveDiaryRepository.getRevision());
  const pendingProfileImages = useRef(new Map<"coverImage" | "avatar1" | "avatar2", DiaryImage>());
  useEffect(() => () => {
    pendingProfileImages.current.forEach((image) => void loveDiaryRepository.deleteUploadedImage(image));
  }, []);
  const imageInput = async (event: ChangeEvent<HTMLInputElement>, key: "coverImage" | "avatar1" | "avatar2") => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoUploading(true);
    try {
      const image = await loveDiaryRepository.uploadImage(file, `${key}-${createId()}`);
      const previousPending = pendingProfileImages.current.get(key);
      if (previousPending) void loveDiaryRepository.deleteUploadedImage(previousPending);
      pendingProfileImages.current.set(key, image);
      setProfile((current) => ({ ...current, [key]: image.url }));
    } catch {
      window.alert("照片没有上传成功，请检查网络后重试。");
    } finally {
      setPhotoUploading(false);
      event.target.value = "";
    }
  };
  const save = async () => {
    let nextProfile = { ...profile };
    if (profile.lockEnabled && pin.length === 4) { const salt = createId(); nextProfile = { ...nextProfile, pinSalt: salt, pinHash: await hashPin(pin, salt) }; }
    if (profile.lockEnabled && !nextProfile.pinHash) return window.alert("请先设置一个 4 位隐私密码");
    if (photoUploading) return window.alert("照片还在上传，请稍等一下。");
    const saved = await commit({ ...data, profile: nextProfile }, "设置已经保存", settingsRevision.current);
    if (saved) {
      pendingProfileImages.current.clear();
      settingsRevision.current = loveDiaryRepository.getRevision();
      setPin("");
    }
  };
  if (!canWrite && loveDiaryRepository.isLocalPreview()) return <section className="settings"><div className="settings-group"><p className="eyebrow">LOCAL BACKUP</p><h2>本机真实备份预览</h2><p>日记和照片从本机读取。本页只供查看，不写入备份，不连接线上服务器。</p></div></section>;
  if (!canWrite) return <section className="settings"><LoginSettingsCard profile={data.profile} onLogin={onLogin} demoMode={demoMode} /><div className="settings-group public-readonly"><p className="eyebrow">{demoMode ? "LOCAL DEMO" : "PUBLIC VIEW"}</p><h2>{demoMode ? "放心体验，不会上传云端" : "这里可以公开浏览"}</h2><p>{demoMode ? "你发布的日记和图片只保存在当前浏览器；其他访客看不到，也不会影响正式版数据。" : "日记和照片对访客开放阅读；输入任一位记录者的身份密码后，才会出现写入、修改和删除功能。"}</p></div><InstallSettingsCard installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} /></section>;
  return <section className="settings"><nav className="settings-sections" aria-label="设置分类">{([{ id: "appearance", icon: "♡", label: "身份外观" }, { id: "reading", icon: "Aa", label: "阅读体验" }, { id: "device", icon: "▣", label: "设备设置" }] as const).map((item) => <button type="button" key={item.id} className={section === item.id ? "selected" : ""} onClick={() => setSection(item.id)} aria-pressed={section === item.id}><span>{item.icon}</span><b>{item.label}</b></button>)}</nav>
    {section === "appearance" && <><WriterSessionCard profile={data.profile} onLogin={onLogin} onLogout={onLogout} demoMode={demoMode} /><div className="settings-group writer-style-settings"><p className="eyebrow">DIARY MARKS</p><h2>两个人的信笺标记</h2><p className="settings-copy">颜色和标记会同时出现在时间线、日记详情与翻页书中。</p><div className="writer-style-list"><WriterStyleCard author={profile.name1} recipient={profile.name2} accent={profile.person1Accent} marker={profile.person1Marker} onAccent={(accent) => setProfile({ ...profile, person1Accent: accent })} onMarker={(marker) => setProfile({ ...profile, person1Marker: marker })} /><WriterStyleCard author={profile.name2} recipient={profile.name1} accent={profile.person2Accent} marker={profile.person2Marker} onAccent={(accent) => setProfile({ ...profile, person2Accent: accent })} onMarker={(marker) => setProfile({ ...profile, person2Marker: marker })} /></div></div><div className="settings-group"><p className="eyebrow">COUPLE PROFILE</p><h2>关于我们</h2><div className="avatar-settings"><ImagePicker label="恋人B头像" image={profile.avatar2} fallback={profile.name2.slice(0, 1)} onChange={(event) => void imageInput(event, "avatar2")} /><span>♡</span><ImagePicker label="恋人A头像" image={profile.avatar1} fallback={profile.name1.slice(0, 1)} onChange={(event) => void imageInput(event, "avatar1")} /></div><label>恋人B昵称<input value={profile.name2} onChange={(event) => setProfile({ ...profile, name2: event.target.value })} /></label><label>恋人A昵称<input value={profile.name1} onChange={(event) => setProfile({ ...profile, name1: event.target.value })} /></label><label>恋爱开始日期<input type="date" value={profile.startDate} onChange={(event) => setProfile({ ...profile, startDate: event.target.value })} /></label><label className="cover-upload">首页封面<input type="file" accept="image/*" onChange={(event) => void imageInput(event, "coverImage")} /><span>{profile.coverImage ? "重新选择封面照片" : "选择一张封面照片"}</span></label></div></>}
    {section === "reading" && <><div className="settings-group"><p className="eyebrow">READING EXPERIENCE</p><h2>阅读与页面效果</h2><label className="switch-row"><span><b>柔和动画</b><small>爱心、星光和页面过渡</small></span><input aria-label="开关柔和动画" type="checkbox" checked={profile.animations} onChange={(event) => setProfile({ ...profile, animations: event.target.checked })} /></label></div><div className="settings-group reading-guide"><p className="eyebrow">READING TIPS</p><h2>沉浸阅读</h2><p>时间线适合快速回顾；翻页日记本适合慢慢读完整内容。</p></div></>}
    {section === "device" && <><InstallSettingsCard installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} /><div className="settings-group"><p className="eyebrow">PRIVACY</p><h2>隐私锁</h2><label className="switch-row"><span><b>开启本地 PIN 锁</b><small>每次重新打开网页时验证</small></span><input aria-label="开关本地 PIN 锁" type="checkbox" checked={profile.lockEnabled} onChange={(event) => setProfile({ ...profile, lockEnabled: event.target.checked, ...(!event.target.checked ? { pinHash: undefined, pinSalt: undefined } : {}) })} /></label>{profile.lockEnabled && <label>设置新的 4 位密码<input className="pin-setting" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder={profile.pinHash ? "留空则保持原密码" : "请输入 4 位数字"} /></label>}{data.profile.lockEnabled && <button className="secondary-button" onClick={lockNow}>现在锁上日记</button>}</div></>}
    <button className="save-settings" disabled={photoUploading} onClick={() => void save()}>{photoUploading ? "照片上传中…" : "保存这一页设置"}</button>
    {section === "device" && demoMode && <DemoResetCard />}
  </section>;
}

function PasswordLoginForm({ onLogin, onSuccess, onCancel, demoMode = false }: { onLogin: LoginHandler; onSuccess?: () => void; onCancel?: () => void; demoMode?: boolean }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError("");
    try {
      await onLogin(password);
      setPassword("");
      onSuccess?.();
    } catch (reason) {
      const code = reason instanceof Error ? reason.message : "";
      setError(code === "LOGIN_INVALID" ? "密码不正确，请确认后再试" : code === "LOGIN_RATE_LIMIT" ? "尝试次数较多，请 15 分钟后再试" : "暂时没有登录成功，请检查网络后再试");
    } finally {
      setBusy(false);
    }
  };
  return <form className="identity-login-form" onSubmit={(event) => void submit(event)}>{demoMode && <div className="demo-login-presets"><button type="button" onClick={() => setPassword(DEMO_PASSWORDS.person1)}>恋人A · {DEMO_PASSWORDS.person1}</button><button type="button" onClick={() => setPassword(DEMO_PASSWORDS.person2)}>恋人B · {DEMO_PASSWORDS.person2}</button></div>}<label><span>身份密码</span><input type="password" autoComplete={demoMode ? "off" : "current-password"} maxLength={64} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} placeholder="请输入身份密码" aria-invalid={Boolean(error)} /></label>{error && <p className="identity-login-error" role="alert">{error}</p>}<div>{onCancel && <button type="button" className="identity-login-cancel" onClick={onCancel}>取消</button>}<button type="submit" className="identity-login-submit" disabled={!password || busy}>{busy ? "正在验证…" : "登录并记住身份"}</button></div><small>{demoMode ? "演示身份只保存在当前浏览器，不会向服务器发送密码。" : "密码只会发送到云端验证，不会保存在这台手机里。"}</small></form>;
}

function LoginSettingsCard({ profile, onLogin, demoMode = false }: { profile: CoupleProfile; onLogin: LoginHandler; demoMode?: boolean }) {
  return <div className="settings-group identity-login-card"><div className="identity-login-heading"><span>♡</span><div><p className="eyebrow">{demoMode ? "DEMO LOGIN" : "WRITER LOGIN"}</p><h2>{demoMode ? "选择一个身份体验写日记" : "登录后一起写日记"}</h2></div></div><p>{demoMode ? "点选任一公开体验身份，再登录。发布内容只会留在当前浏览器。" : `输入${profile.name1}或${profile.name2}各自的身份密码；登录成功后，这台设备会自动记住对应身份。`}</p><PasswordLoginForm onLogin={onLogin} demoMode={demoMode} /></div>;
}

function WriterSessionCard({ profile, onLogin, onLogout, demoMode = false }: { profile: CoupleProfile; onLogin: LoginHandler; onLogout: () => Promise<void>; demoMode?: boolean }) {
  const [switching, setSwitching] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isPerson1 = profile.currentUser === "person1";
  const owner = isPerson1 ? profile.name1 : profile.name2;
  const recipient = isPerson1 ? profile.name2 : profile.name1;
  const avatar = isPerson1 ? profile.avatar1 : profile.avatar2;
  const logout = async () => {
    if (loggingOut || !window.confirm("退出后会回到介绍页，日记和照片将不再显示。继续吗？")) return;
    setLoggingOut(true);
    try { await onLogout(); }
    finally { setLoggingOut(false); }
  };
  return <div className="settings-group writer-session-card"><p className="eyebrow">{demoMode ? "DEMO WRITER" : "CURRENT WRITER"}</p><div className="writer-session-profile"><span>{avatar ? <img src={avatar} alt="" /> : owner.slice(0, 1)}</span><div><small>{demoMode ? "本地演示身份" : "这台设备已登录"}</small><h2>{owner}</h2><p>写给 {recipient} · {demoMode ? "内容仅存当前浏览器" : "身份由密码确定"}</p></div><b>✓</b></div><div className="writer-session-actions"><button type="button" onClick={() => setSwitching((value) => !value)}>{switching ? "收起" : "切换身份"}</button><button type="button" disabled={loggingOut} onClick={() => void logout()}>{loggingOut ? "正在退出…" : "退出登录"}</button></div>{switching && <PasswordLoginForm onLogin={onLogin} onSuccess={() => setSwitching(false)} onCancel={() => setSwitching(false)} demoMode={demoMode} />}</div>;
}

function DemoResetCard() {
  const [busy, setBusy] = useState(false);
  const reset = async () => {
    if (busy || !window.confirm("恢复后，本浏览器里体验发布的内容和图片会被示例数据替换。继续吗？")) return;
    setBusy(true);
    try {
      await loveDiaryRepository.resetDemo();
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };
  return <div className="settings-group demo-reset-card"><p className="eyebrow">LOCAL DEMO DATA</p><h2>恢复演示初始状态</h2><p>只清理当前浏览器的演示数据，不会连接或修改任何云端数据库。</p><button type="button" disabled={busy} onClick={() => void reset()}>{busy ? "正在恢复…" : "恢复示例数据"}</button></div>;
}

function InstallSettingsCard({ installPrompt, standalone, onInstall }: { installPrompt: BeforeInstallPromptEvent | null; standalone: boolean; onInstall: () => Promise<void> }) {
  if (standalone) return <div className="settings-group install-settings-card installed"><p className="eyebrow">APP ON THIS DEVICE</p><h2>已经装进手机桌面</h2><p>从桌面图标打开，就能全屏阅读这本恋爱日记。</p><span>✓ 已安装</span></div>;
  return <div className="settings-group install-settings-card"><p className="eyebrow">INSTALL APP</p><h2>把恋爱日记装进手机</h2><p>添加到主屏幕 · 全屏打开 · 弱网也能看最近内容</p><button type="button" onClick={() => void onInstall()}>{installPrompt ? "立即安装" : "查看安装方法"}</button></div>;
}

function WriterStyleCard({ author, recipient, accent, marker, onAccent, onMarker }: { author: string; recipient: string; accent: string; marker: string; onAccent: (accent: string) => void; onMarker: (marker: string) => void }) {
  return <article className="writer-style-card" style={{ "--preview-accent": accent } as CSSProperties}>
    <header><span className="writer-style-preview">{marker}</span><div><b>{author} 写给 {recipient}</b><small>选择专属颜色与页角标记</small></div><label className="writer-color-picker"><span>颜色</span><input type="color" value={accent} onChange={(event) => onAccent(event.target.value)} aria-label={`${author}写给${recipient}的颜色`} /></label></header>
    <div className="marker-options" role="group" aria-label={`${author}写给${recipient}的标记`}>{WRITER_MARKERS.map((option) => <button type="button" key={option} className={marker === option ? "selected" : ""} aria-pressed={marker === option} aria-label={`使用标记 ${option}`} onClick={() => onMarker(option)}>{option}</button>)}</div>
  </article>;
}

function ImagePicker({ label, image, fallback, onChange }: { label: string; image?: string; fallback: string; onChange: (event: ChangeEvent<HTMLInputElement>) => void }) {
  return <label className="avatar-picker"><span>{image ? <img src={image} alt="" /> : fallback}</span><small>{label}</small><input type="file" accept="image/*" hidden onChange={onChange} /></label>;
}

function BottomNav({ active, canWrite, navigate }: { active: AppRoute["view"]; canWrite: boolean; navigate: (route: AppRoute) => void }) {
  const items: Array<{ view: AppRoute["view"]; label: string }> = [{ view: "home", label: "首页" }, { view: "book", label: "日记本" }, ...(canWrite ? [{ view: "editor" as const, label: "记录" }] : []), { view: "gallery", label: "相册" }, { view: "us", label: "我们" }];
  return <nav className="bottom-nav" style={{ "--nav-count": items.length } as CSSProperties} aria-label="主导航">{items.map((item) => <button key={item.view} className={`${active === item.view ? "active" : ""} ${item.view === "editor" ? "add-nav" : ""}`} onClick={() => navigate({ view: item.view })}><span className="nav-icon-wrap"><NavIcon view={item.view} /></span><small>{item.label}</small></button>)}</nav>;
}

function NavIcon({ view }: { view: AppRoute["view"] | "anniversary" }) {
  if (view === "home") return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.7 12 3.8l8.5 6.9v8.5a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3z" /><path d="M9.2 20.5v-6h5.6v6M9.1 9.1c.7-1.2 2.3-1.1 2.9.1.6-1.2 2.2-1.3 2.9-.1.9 1.7-1 3.1-2.9 4.3-1.9-1.2-3.8-2.6-2.9-4.3Z" /></svg>;
  if (view === "book") return <HomeEntryIcon />;
  if (view === "anniversary") return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.2h17" /><path d="M9.2 13.4c.6-1 2-1 2.5 0 .6-1 2-1 2.6 0 .8 1.5-.9 2.7-2.6 3.8-1.7-1.1-3.3-2.3-2.5-3.8Z" /></svg>;
  if (view === "editor") return <svg className="nav-icon nav-icon-write" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 18.7 1.2-4.6L15.3 5a2 2 0 0 1 2.8 0l.9.9a2 2 0 0 1 0 2.8l-9.1 9.1z" /><path d="m14 6.3 3.7 3.7M6.2 14.1l3.7 3.7" /><path d="M5.2 8.8c-1.3-1.8.1-4 2-3.3.9.3 1.4 1.2 1.7 2 .3-.8.8-1.7 1.7-2 .5-.2 1-.2 1.5 0" /></svg>;
  if (view === "gallery") return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="3" /><circle cx="8.2" cy="9" r="1.5" /><path d="m5.5 17 4.2-4 3 2.7 2.5-2.3 3.3 3.6" /><path d="M15.3 8.3c.4-.8 1.5-.8 1.9 0 .4-.8 1.5-.8 1.9 0 .5 1.1-.7 2-1.9 2.8-1.2-.8-2.4-1.7-1.9-2.8Z" /></svg>;
  return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8.3" r="3" /><circle cx="16" cy="8.3" r="3" /><path d="M2.8 19.5c.4-3.4 2.2-5.3 5.2-5.3 1.8 0 3.2.7 4 2.1.8-1.4 2.2-2.1 4-2.1 3 0 4.8 1.9 5.2 5.3" /><path d="M10 13.4c.4-.8 1.5-.8 2 0 .4-.8 1.5-.8 2 0 .6 1.1-.7 2.1-2 2.9-1.3-.8-2.6-1.8-2-2.9Z" /></svg>;
}

function photoDownloadUrl(value: string): string {
  try {
    const url = new URL(value, typeof window === "undefined" ? "https://diary.invalid" : window.location.href);
    url.searchParams.set("download", "1");
    return url.toString();
  } catch {
    return value;
  }
}

function ImageViewer({ viewer, sourceDiary, setViewer, onOpenDiary }: { viewer: { images: DiaryImage[]; index: number; title: string }; sourceDiary?: Diary; setViewer: (value: { images: DiaryImage[]; index: number; title: string } | null) => void; onOpenDiary: (id: string) => void }) {
  const touch = useRef(0);
  const move = (direction: -1 | 1) => setViewer({ ...viewer, index: (viewer.index + direction + viewer.images.length) % viewer.images.length });
  const image = viewer.images[viewer.index];
  return <div className="image-viewer has-actions" role="dialog" aria-modal="true" aria-label="照片浏览"><header><div><b>{viewer.title}</b><small>{viewer.index + 1} / {viewer.images.length}</small></div><button onClick={() => setViewer(null)} aria-label="关闭大图">×</button></header><button className="viewer-side left" onClick={() => move(-1)} aria-label="上一张">‹</button><button type="button" className="viewer-canvas" aria-label="关闭大图" onTouchStart={(event) => { touch.current = event.touches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }} onClick={() => setViewer(null)}><img src={image.url} alt={`大图 ${viewer.index + 1}`} decoding="async" /></button><button className="viewer-side right" onClick={() => move(1)} aria-label="下一张">›</button><footer className="viewer-source-actions">{sourceDiary && <button type="button" onClick={() => onOpenDiary(sourceDiary.id)}>查看来源日记</button>}<a href={photoDownloadUrl(image.url)} download={image.name || "我们的照片"}>保存照片</a></footer></div>;
}

function SoftEmpty({ icon, title, text, action, onAction }: { icon: string; title: string; text: string; action?: string; onAction?: () => void }) {
  return <div className="soft-empty"><span>{icon}</span><h3>{title}</h3><p>{text}</p>{action && <button onClick={onAction}>{action}</button>}</div>;
}

function EmptyPage({ onHome }: { onHome: () => void }) {
  return <div className="page-content not-found"><SoftEmpty icon="♡" title="这一页回忆暂时找不到了" text="也许它已经被轻轻收起来。" action="回到首页" onAction={onHome} /></div>;
}

function ReadOnlyPage({ onHome }: { onHome: () => void }) {
  return <div className="page-content not-found"><SoftEmpty icon="♡" title="这里是公开阅读页" text="写日记的入口只会出现在已授权的设备上。" action="回到首页" onAction={onHome} /></div>;
}
