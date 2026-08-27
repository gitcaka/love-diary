"use client";
/* eslint-disable @next/next/no-img-element */

import { ChangeEvent, CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { displayAnniversaries, nextUpcomingAnniversary, sortAnniversaries } from "@/lib/anniversaries";
import { bookPageTarget, sortBookDiaries, type BookDirection, type BookOrder } from "@/lib/book";
import { anniversaryDateLabel, anniversaryDaysUntil, calendarCells, daysSince, diffDays, formatDate, formatShortDate, monthTitle, toDateInput } from "@/lib/date";
import { filterDiaries, appendDiaryHistory, type DiaryFilters } from "@/lib/diary-memory";
import { DEMO_PASSWORDS } from "@/lib/demo";
import { diaryAppearance, WRITER_MARKERS } from "@/lib/diary-style";
import { createDraftSnapshot, diaryDraftKey, restoreDiaryDraft } from "@/lib/draft";
import { completeBackupMediaCount, createCompleteBackup, readCompleteBackup, replaceBackupMedia } from "@/lib/full-backup";
import { buildMemoryReview } from "@/lib/review";
import { applyTextColor, remapTextMarks, TEXT_COLOR_PALETTE, textSegments, trimTextAndMarks } from "@/lib/rich-text";
import { nextTimelineCount } from "@/lib/timeline";
import { availableReportMonths, buildMonthlyReport, reportMonthLabel } from "@/lib/monthly-report";
import type { Anniversary, AppData, AppRoute, CoupleProfile, Diary, DiaryAuthor, DiaryHistoryEntry, DiaryImage, DiaryResponse, Mood, TimeCapsule, Weather, WishCategory, WishItem } from "@/lib/types";
import { loveDiaryRepository, normalizeBackup, type CloudSnapshotSummary } from "@/repositories/loveDiaryRepository";

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

const MUSIC_PREFERENCE_KEY = "love-diary:background-music";
const APP_HISTORY_KEY = "love-diary:navigation";
const BOOK_ORDER_KEY = "love-diary:book-order";
const BOOK_PAGE_KEY = "love-diary:book-page";
const HOME_FILTER_KEY = "love-diary:home-filters";
const HOME_VISIBLE_KEY = "love-diary:home-visible";
const HOME_SCROLL_KEY = "love-diary:home-scroll";
const BACKUP_META_KEY = "love-diary:last-complete-backup";
const SPLASH_SEEN_KEY = "love-diary:splash-seen";
const DIARY_BATCH_SIZE = 8;
const GALLERY_BATCH_SIZE = 18;
const SUGGESTED_TAGS = ["约会", "旅行", "日常", "想念", "惊喜", "纪念日", "和好", "美食"];
const WISH_CATEGORIES: Array<{ id: WishCategory; emoji: string; label: string }> = [
  { id: "travel", emoji: "✈", label: "一起去" },
  { id: "food", emoji: "♨", label: "一起吃" },
  { id: "date", emoji: "♡", label: "一起做" },
  { id: "life", emoji: "⌂", label: "小日子" },
  { id: "photo", emoji: "▣", label: "一起拍" },
];

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
  id: crypto.randomUUID(),
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

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
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
  const valid = ["home", "calendar", "book", "review", "report", "wishes", "editor", "gallery", "us", "detail"];
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

  const refreshCloud = useCallback(async () => {
    const next = await loveDiaryRepository.load();
    setData(next);
    setCanWrite(loveDiaryRepository.hasWriterAccess());
  }, []);

  useEffect(() => {
    loveDiaryRepository.initializeDevice();
    window.history.replaceState({ ...window.history.state, [APP_HISTORY_KEY]: { depth: appHistoryDepth() } }, "", window.location.href);
    const routeTimer = window.setTimeout(() => setRoute(parseRoute()), 0);
    void loveDiaryRepository.loadCached().then((cached) => cached && setData((current) => current ?? cached));
    const initialRefreshTimer = window.setTimeout(() => void refreshCloud(), 0);
    let splashDelay = 650;
    try { if (window.sessionStorage.getItem(SPLASH_SEEN_KEY) === "1") splashDelay = 0; } catch { /* Keep the short splash when session storage is unavailable. */ }
    const timer = window.setTimeout(() => {
      setSplash(false);
      try { window.sessionStorage.setItem(SPLASH_SEEN_KEY, "1"); } catch { /* A session-only preference is optional. */ }
    }, splashDelay);
    const onPop = () => setRoute(parseRoute());
    const onFocus = () => void refreshCloud();
    const onOnline = () => void refreshCloud();
    const refreshTimer = window.setInterval(() => document.visibilityState === "visible" && void refreshCloud(), 30_000);
    window.addEventListener("popstate", onPop);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    return () => { window.clearTimeout(timer); window.clearTimeout(routeTimer); window.clearTimeout(initialRefreshTimer); window.clearInterval(refreshTimer); window.removeEventListener("popstate", onPop); window.removeEventListener("focus", onFocus); window.removeEventListener("online", onOnline); };
  }, [refreshCloud]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
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
    setData(next);
    try {
      const saved = await loveDiaryRepository.save(next, expectedRevision);
      setData(saved);
      if (message) setToast(message);
      window.setTimeout(() => setToast(""), 2600);
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code !== "OFFLINE") {
        const latest = await loveDiaryRepository.load();
        setData(latest);
        setCanWrite(loveDiaryRepository.hasWriterAccess());
      }
      setToast(code === "CLOUD_CONFLICT" ? "另一台设备刚刚更新过，请再操作一次" : code === "OFFLINE" ? "当前离线，草稿仍保存在这台手机，联网后再保存" : "这次没有保存成功，请检查网络后重试");
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
    const next = await loveDiaryRepository.logout();
    setData(next);
    setCanWrite(false);
    setToast("已退出身份登录，现在是公开浏览模式");
    window.setTimeout(() => setToast(""), 2200);
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

  if (splash || !data) return <Splash />;
  if (data.profile.lockEnabled && !unlocked) return <LockScreen data={data} onUnlock={() => setUnlocked(true)} />;

  const page = (() => {
    if (route.view === "editor") return canWrite ? <DiaryEditor key={route.id || route.wishId || route.date || "new"} data={data} diary={route.id ? data.diaries.find((item) => item.id === route.id) : undefined} wish={route.wishId ? data.wishes.find((item) => item.id === route.wishId) : undefined} initialDate={route.date} onCancel={() => goBack(route.id ? { view: "detail", id: route.id } : route.wishId ? { view: "wishes" } : { view: "home" })} onSave={async (diary, expectedRevision) => {
      const previous = data.diaries.find((item) => item.id === diary.id);
      const linkedWish = route.wishId ? data.wishes.find((item) => item.id === route.wishId) : undefined;
      const alreadyLinked = linkedWish?.diaryId ? data.diaries.find((item) => item.id === linkedWish.diaryId) : undefined;
      const linkedInTrash = linkedWish?.diaryId ? data.trash.some((item) => item.diary.id === linkedWish.diaryId) : false;
      if (!previous && alreadyLinked && alreadyLinked.id !== diary.id) {
        setToast("这件事已经写成日记，已为你打开原来的那一篇");
        window.setTimeout(() => setToast(""), 2600);
        navigate({ view: "detail", id: alreadyLinked.id }, true);
        return true;
      }
      if (!previous && linkedInTrash) {
        window.alert("这件事关联的日记还在回收站，请先到“我们 → 设置与备份 → 数据安全”恢复它。");
        return false;
      }
      const exists = Boolean(previous);
      const diaries = exists ? data.diaries.map((item) => item.id === diary.id ? diary : item) : [diary, ...data.diaries];
      const diaryHistory = previous ? appendDiaryHistory(data.diaryHistory, previous) : data.diaryHistory;
      const wishes = !exists && route.wishId
        ? data.wishes.map((item) => item.id === route.wishId ? { ...item, diaryId: diary.id } : item)
        : data.wishes;
      const saved = await commit({ ...data, diaries, diaryHistory, wishes }, exists ? "这一页回忆已经更新 ♡" : route.wishId ? "这件事和日记已经连在一起 ♡" : "今天的故事收好啦 ♡", expectedRevision);
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
      const sourceWish = diary ? data.wishes.find((item) => item.diaryId === diary.id) : undefined;
      return diary ? <DiaryDetail diary={diary} sourceWish={sourceWish} profile={data.profile} canWrite={canWrite} responses={responses} history={history} previousDiary={previousDiary} nextDiary={nextDiary} onOpenWish={(id) => navigate({ view: "wishes", wishId: id })} onNavigate={(id) => navigate({ view: "detail", id }, true)} onBack={() => goBack({ view: "home" })} onEdit={() => navigate({ view: "editor", id: diary.id })} onToggleFavorite={async () => commit({ ...data, diaries: data.diaries.map((item) => item.id === diary.id ? { ...item, favorite: !diary.favorite, special: false, updatedAt: Date.now() } : item) }, diary.favorite ? "已取消收藏" : "这篇回忆已经收藏 ♡")} onAddResponse={async (content, emoji) => {
        const response: DiaryResponse = { id: crypto.randomUUID(), diaryId: diary.id, author: data.profile.currentUser, emoji, content, createdAt: Date.now() };
        return commit({ ...data, responses: [...data.responses, response] }, "回应已经写在这页下面 ♡");
      }} onDeleteResponse={async (id) => commit({ ...data, responses: data.responses.filter((item) => item.id !== id) })} onRestoreHistory={async (entry) => {
        if (!window.confirm("恢复这个版本吗？现在的内容也会保留在历史记录里。")) return false;
        const remaining = data.diaryHistory.filter((item) => item.id !== entry.id);
        const restored = { ...structuredClone(entry.diary), updatedAt: Date.now() };
        return commit({ ...data, diaries: data.diaries.map((item) => item.id === diary.id ? restored : item), diaryHistory: appendDiaryHistory(remaining, diary) }, "旧版本已经恢复，当前版本也已保留");
      }} onDelete={async () => {
        if (!window.confirm("要把这篇日记移到回收站吗？之后还可以恢复。")) return;
        const deleted = { id: crypto.randomUUID(), diary: structuredClone(diary), deletedAt: Date.now() };
        if (await commit({ ...data, diaries: data.diaries.filter((item) => item.id !== diary.id), trash: [deleted, ...data.trash] }, "这篇日记已移到回收站")) navigate({ view: "home" }, true);
      }} onViewImages={(images, index) => setViewer({ images, index, title: formatDate(diary.date) })} /> : <EmptyPage onHome={() => navigate({ view: "home" }, true)} />;
    }
    if (route.view === "calendar") return <CalendarPage data={data} canWrite={canWrite} initialDate={route.date} onOpen={(id) => navigate({ view: "detail", id })} onCreate={(date) => navigate({ view: "editor", date })} />;
    if (route.view === "book") return <DiaryBookPage data={data} canWrite={canWrite} onBack={() => goBack({ view: "home" })} onEdit={(id) => navigate({ view: "editor", id })} onViewImages={(images, index, title) => setViewer({ images, index, title })} />;
    if (route.view === "review") return <MemoryReviewPage data={data} onBack={() => goBack({ view: "home" })} onOpen={(id) => navigate({ view: "detail", id })} />;
    if (route.view === "report") return <MonthlyReportPage data={data} onBack={() => goBack({ view: "home" })} onOpen={(id) => navigate({ view: "detail", id })} />;
    if (route.view === "wishes") return <WishListPageV2 key={route.wishId || "wish-list"} data={data} canWrite={canWrite} commit={commit} initialWishId={route.wishId} onBack={() => goBack({ view: "home" })} onOpenDiary={(id) => navigate({ view: "detail", id })} onWriteDiary={(wish) => navigate({ view: "editor", wishId: wish.id, date: timestampDateInput(wish.completedAt) })} />;
    if (route.view === "gallery") return <GalleryPage data={data} onHome={() => navigate({ view: "home" })} onOpen={(images, index, title) => setViewer({ images, index, title })} />;
    if (route.view === "us") return <UsPage data={data} canWrite={canWrite} commit={commit} onLogin={loginIdentity} onLogout={logoutIdentity} lockNow={() => setUnlocked(false)} installPrompt={installPrompt} standalone={standalone} onInstall={installApp} />;
    return <HomePage data={data} canWrite={canWrite} onOpen={(id) => navigate({ view: "detail", id })} onCreate={() => navigate({ view: "editor" })} onBook={() => navigate({ view: "book" })} onReview={() => navigate({ view: "review" })} onReport={() => navigate({ view: "report" })} onWishes={() => navigate({ view: "wishes" })} onUs={() => navigate({ view: "us" })} />;
  })();

  const showNav = !["editor", "detail", "book", "review", "report", "wishes"].includes(route.view);
  const currentViewerImage = viewer?.images[viewer.index];
  const viewerSourceDiary = currentViewerImage ? data.diaries.find((diary) => diary.images.some((image) => image.id === currentViewerImage.id || image.url === currentViewerImage.url)) : undefined;
  const viewerSourceWish = currentViewerImage ? data.wishes.find((wish) => wish.completionImage && (wish.completionImage.id === currentViewerImage.id || wish.completionImage.url === currentViewerImage.url)) : undefined;
  return (
    <>
      <BackgroundMusic key="background-music" visible={showNav && !viewer} />
      <div className={`app-shell ${data.profile.animations ? "motion-on" : "motion-off"}`}>
        <div className="desktop-orb orb-one" /><div className="desktop-orb orb-two" />
        <main className={`phone-frame page-${route.view}`}>{page}</main>
        {showNav && <BottomNav active={route.view} canWrite={canWrite} navigate={navigate} />}
        {viewer && <ImageViewer viewer={viewer} sourceDiary={viewerSourceDiary} sourceWish={viewerSourceWish} setViewer={setViewer} onOpenDiary={(id) => { setViewer(null); navigate({ view: "detail", id }); }} onOpenWish={(id) => { setViewer(null); navigate({ view: "wishes", wishId: id }); }} />}
        {toast && <div className="toast" role="status"><span>♥</span>{toast}</div>}
        {updateWorker && <UpdatePrompt onUpdate={() => updateWorker.postMessage({ type: "SKIP_WAITING" })} onLater={() => setUpdateWorker(null)} />}
      </div>
    </>
  );
}

function UpdatePrompt({ onUpdate, onLater }: { onUpdate: () => void; onLater: () => void }) {
  return <aside className="update-prompt" role="status"><span aria-hidden="true">✦</span><div><b>新版本已经准备好</b><small>更新后再继续记录，已写内容不会改变。</small></div><button type="button" onClick={onUpdate}>立即更新</button><button type="button" className="update-later" onClick={onLater} aria-label="稍后更新">×</button></aside>;
}

function BackgroundMusic({ visible }: { visible: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shouldPlayRef = useRef(true);
  const [isPlaying, setIsPlaying] = useState(false);

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current;
    const audio = new Audio(new URL("bg.wav", document.baseURI).toString());
    audio.loop = true;
    audio.preload = "none";
    audio.addEventListener("play", () => setIsPlaying(true));
    audio.addEventListener("pause", () => setIsPlaying(false));
    audioRef.current = audio;
    return audio;
  }, []);

  useEffect(() => {
    try {
      shouldPlayRef.current = window.localStorage.getItem(MUSIC_PREFERENCE_KEY) !== "paused";
    } catch {
      shouldPlayRef.current = true;
    }

    const resumeAfterInteraction = (event: PointerEvent | KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-music-toggle]")) return;
      if (!shouldPlayRef.current) return;
      const audio = ensureAudio();
      if (!audio.paused) return;
      void audio.play().catch(() => undefined);
    };

    document.addEventListener("pointerdown", resumeAfterInteraction);
    document.addEventListener("keydown", resumeAfterInteraction);

    return () => {
      document.removeEventListener("pointerdown", resumeAfterInteraction);
      document.removeEventListener("keydown", resumeAfterInteraction);
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, [ensureAudio]);

  const remember = (preference: "playing" | "paused") => {
    try {
      window.localStorage.setItem(MUSIC_PREFERENCE_KEY, preference);
    } catch {
      // Playback still works when storage is unavailable.
    }
  };

  const toggle = () => {
    const audio = ensureAudio();
    if (!audio.paused) {
      shouldPlayRef.current = false;
      remember("paused");
      audio.pause();
      return;
    }
    shouldPlayRef.current = true;
    remember("playing");
    void audio.play().catch(() => setIsPlaying(false));
  };

  if (!visible) return null;
  return (
    <button
      type="button"
      className={`music-toggle ${isPlaying ? "is-playing" : "is-paused"}`}
      data-music-toggle
      aria-label={isPlaying ? "暂停背景音乐" : "播放背景音乐"}
      aria-pressed={isPlaying}
      onClick={toggle}
    >
      <span className="music-toggle-icon" aria-hidden="true">♫</span>
      <span className="music-toggle-label">{isPlaying ? "小夜曲" : "听音乐"}</span>
    </button>
  );
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

function HomePage({ data, canWrite, onOpen, onCreate, onBook, onReview, onReport, onWishes, onUs }: { data: AppData; canWrite: boolean; onOpen: (id: string) => void; onCreate: () => void; onBook: () => void; onReview: () => void; onReport: () => void; onWishes: () => void; onUs: () => void }) {
  const diaries = useMemo(() => [...data.diaries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt), [data.diaries]);
  const anniversaries = useMemo(() => displayAnniversaries(data.anniversaries, data.profile.startDate), [data.anniversaries, data.profile.startDate]);
  const [filters, setFilters] = useState<DiaryFilters>(() => {
    const fallback: DiaryFilters = { query: "", author: "all", month: "all", tag: "all", hasPhotos: false, favoritesOnly: false };
    try {
      const value = JSON.parse(window.sessionStorage.getItem(HOME_FILTER_KEY) || "null") as Partial<DiaryFilters> | null;
      if (!value) return fallback;
      return { ...fallback, ...value, author: value.author === "person1" || value.author === "person2" ? value.author : "all", month: typeof value.month === "string" ? value.month : "all", tag: typeof value.tag === "string" ? value.tag : "all" };
    } catch { return fallback; }
  });
  const filteredDiaries = useMemo(() => filterDiaries(diaries, filters), [diaries, filters]);
  const [visibleCount, setVisibleCount] = useState(() => {
    try { return Math.max(DIARY_BATCH_SIZE, Number(window.sessionStorage.getItem(HOME_VISIBLE_KEY)) || DIARY_BATCH_SIZE); } catch { return DIARY_BATCH_SIZE; }
  });
  const firstFilterRender = useRef(true);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const visibleDiaries = filteredDiaries.slice(0, visibleCount);
  const hasMore = visibleCount < filteredDiaries.length;
  const months = useMemo(() => Array.from(new Set(diaries.map((diary) => diary.date.slice(0, 7)))).sort().reverse(), [diaries]);
  const tags = useMemo(() => Array.from(new Set(diaries.flatMap((diary) => diary.tags ?? []))).sort((a, b) => a.localeCompare(b, "zh-CN")), [diaries]);
  const hasActiveFilters = Boolean(filters.query.trim() || filters.author !== "all" || filters.month !== "all" || filters.tag !== "all" || filters.hasPhotos || filters.favoritesOnly);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [filters.author !== "all", filters.month !== "all", filters.tag !== "all", filters.hasPhotos, filters.favoritesOnly].filter(Boolean).length;
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
  const completedWishes = data.wishes.filter((wish) => wish.completed).length;

  return <div className="page-content home-page">
    <header className="topbar"><div><p className="eyebrow">OUR LITTLE STORY</p><h1>{owner}的恋爱日记</h1><small className="identity-note">{canWrite ? `当前是 ${owner} · 日记双方可见` : "公开浏览 · 日记双方可见"}</small></div><button className="avatar-pair" onClick={onUs} aria-label="打开我们的页面"><span>{data.profile.avatar2 ? <img src={data.profile.avatar2} alt="" /> : data.profile.name2.slice(0, 1)}</span><span>{data.profile.avatar1 ? <img src={data.profile.avatar1} alt="" /> : data.profile.name1.slice(0, 1)}</span></button></header>
    <section className="love-cover" style={data.profile.coverImage ? { backgroundImage: `linear-gradient(145deg, rgba(69,41,66,.15), rgba(77,37,63,.64)), url(${data.profile.coverImage})` } : undefined}>
      <span className="cover-star star-one">✦</span><span className="cover-star star-two">✦</span><span className="cover-heart">♡</span>
      <p>{data.profile.name2} <i>♡</i> {data.profile.name1}</p><h2>在一起的第 <strong>{loveDays}</strong> 天</h2><div className="cover-footer"><span>{formatShortDate(data.profile.startDate)} — 至今</span><span>写给彼此，也写给我们</span></div>
      {upcoming && <button type="button" className="cover-upcoming" onClick={onUs} aria-label={`查看纪念日：${upcoming.title}`}><span aria-hidden="true">{upcoming.emoji}</span><b>{upcoming.title}</b><small>{anniversaryDateLabel(upcoming)}</small><em>{upcomingDays === 0 ? "今天" : `${upcomingDays}天后`} ›</em></button>}
    </section>
    <div className="home-memory-entries" aria-label="回忆阅读入口"><button type="button" className="home-memory-entry review" onClick={onReview}><span aria-hidden="true">↺</span><small>MEMORY REVIEW</small><b>回忆回顾</b><em>随机翻开从前</em></button><button type="button" className="home-memory-entry book" onClick={onBook}><span className="mini-book-icon" aria-hidden="true">▤</span><small>DIARY BOOK</small><b>翻页日记本</b><em>共 {diaries.length} 页</em></button></div>
    <div className="home-project-entries"><button type="button" className="wish-list-entry" onClick={onWishes}><span aria-hidden="true">✓</span><span><small>OUR 100 THINGS</small><b>想和你做的100件事</b></span><em>{completedWishes}/100 ›</em></button>{months[0] && <button type="button" className="monthly-report-entry" onClick={onReport}><span aria-hidden="true">✦</span><span><small>{reportMonthLabel(months[0])}</small><b>恋爱月报</b></span><em>照片月报 ›</em></button>}</div>
    <section className={`memory-search ${filtersOpen ? "filters-open" : ""}`} aria-label="搜索和筛选日记"><div className="memory-search-top"><label className="memory-search-box"><span aria-hidden="true">⌕</span><input type="search" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="搜索文字、标签、心情或日期" aria-label="搜索日记" />{filters.query && <button type="button" onClick={() => setFilters({ ...filters, query: "" })} aria-label="清除搜索">×</button>}</label><button type="button" className={`filter-disclosure ${activeFilterCount ? "selected" : ""}`} onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen}><span>筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}</span><i>{filtersOpen ? "⌃" : "⌄"}</i></button></div>{filtersOpen && <div className="memory-search-advanced"><div className="memory-filter-row"><button type="button" className={filters.author === "all" ? "selected" : ""} onClick={() => setFilters({ ...filters, author: "all" })}>全部</button><button type="button" className={filters.author === "person1" ? "selected" : ""} style={{ "--filter-accent": data.profile.person1Accent } as CSSProperties} onClick={() => setFilters({ ...filters, author: "person1" })}>{data.profile.person1Marker} {data.profile.name1}</button><button type="button" className={filters.author === "person2" ? "selected" : ""} style={{ "--filter-accent": data.profile.person2Accent } as CSSProperties} onClick={() => setFilters({ ...filters, author: "person2" })}>{data.profile.person2Marker} {data.profile.name2}</button><select value={filters.month} onChange={(event) => setFilters({ ...filters, month: event.target.value })} aria-label="按月份筛选"><option value="all">全部月份</option>{months.map((month) => <option value={month} key={month}>{month.replace("-", " 年 ")} 月</option>)}</select><select value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} aria-label="按标签筛选"><option value="all">全部标签</option>{tags.map((tag) => <option value={tag} key={tag}>#{tag}</option>)}</select></div><div className="memory-filter-toggles"><button type="button" className={filters.favoritesOnly ? "selected" : ""} onClick={() => setFilters({ ...filters, favoritesOnly: !filters.favoritesOnly })}>★ 已收藏</button><button type="button" className={filters.hasPhotos ? "selected" : ""} onClick={() => setFilters({ ...filters, hasPhotos: !filters.hasPhotos })}>▧ 有照片</button>{hasActiveFilters && <button type="button" className="clear" onClick={clearFilters}>清除</button>}<span>{hasActiveFilters ? `找到 ${filteredDiaries.length} 篇` : `共 ${diaries.length} 篇`}</span></div></div>}</section>
    <div className="section-heading"><div><p className="eyebrow">MEMORIES</p><h2>最近的日记</h2></div>{canWrite && <button onClick={onCreate}>写今天 <span>＋</span></button>}</div>
    {filteredDiaries.length ? <><div className="diary-timeline">{visibleDiaries.map((diary, index) => <DiaryCard key={diary.id} diary={diary} profile={data.profile} index={index} onOpen={() => openDiary(diary.id)} />)}</div>{hasMore ? <div className="timeline-loader" ref={loadMoreRef}><button type="button" onClick={loadMore}>继续加载 · 还有 {filteredDiaries.length - visibleCount} 篇</button><small>向下滑会自动继续加载</small></div> : <p className="timeline-complete" aria-live="polite">已经看完全部 {filteredDiaries.length} 篇日记 ♡</p>}</> : diaries.length ? <SoftEmpty icon="⌕" title="没有找到符合条件的日记" text="换个关键词或清除筛选，再看看别的回忆吧。" action="清除筛选" onAction={clearFilters} /> : <SoftEmpty icon="♡" title="故事还没有开始记录呢" text="把第一个心动的瞬间，写进这里吧。" action={canWrite ? "写第一篇日记" : undefined} onAction={canWrite ? onCreate : undefined} />}
    <div className="home-signoff"><span>✦</span><p>to be continued</p><span>✦</span></div>
  </div>;
}

function DiaryCard({ diary, profile, index, onOpen }: { diary: Diary; profile: CoupleProfile; index: number; onOpen: () => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  return <button type="button" className={`diary-card author-${diary.author} tilt-${index % 3}`} style={{ "--diary-accent": appearance.accent } as CSSProperties} onClick={onOpen}>
    <div className="timeline-dot">{appearance.marker}</div><div className="date-sticker">{formatShortDate(diary.date)}</div>{diary.favorite && <span className="favorite-stamp" aria-label="已收藏">★</span>}
    <div className="diary-card-body"><div className="writer-line"><b>{direction.author}</b><span>写给</span><b>{direction.recipient}</b><i>{appearance.marker}</i></div><div className="diary-meta"><span>{diary.mood.emoji} {diary.mood.name}</span><i>·</i><span>{diary.weather.emoji} {diary.weather.name}</span></div>
      {diary.images.length > 0 && <div className="mini-polaroids">{diary.images.slice(0, 2).map((image, imageIndex) => <div className={`mini-photo mini-${imageIndex}`} key={image.id}><img src={image.url} alt="日记照片" loading="lazy" decoding="async" /></div>)}</div>}
      <p className="writing-preview"><ColoredDiaryText diary={diary} /></p>{Boolean(diary.tags?.length) && <span className="card-tags">{diary.tags?.slice(0, 3).map((tag) => <i key={tag}>#{tag}</i>)}</span>}<span className="card-link">读这一天 <span>→</span></span></div>
  </button>;
}

function DiaryEditor({ data, diary, wish, initialDate, onSave, onCancel, onViewImages }: { data: AppData; diary?: Diary; wish?: WishItem; initialDate?: string; onSave: (diary: Diary, expectedRevision: number | null) => Promise<boolean>; onCancel: () => void; onViewImages: (images: DiaryImage[], index: number) => void }) {
  const demoMode = loveDiaryRepository.isDemoMode();
  const storageKey = diaryDraftKey(diary?.id ?? (wish ? `wish-${wish.id}` : undefined), data.profile.currentUser);
  const [initialDraft] = useState(() => {
    const base = diary ? structuredClone(diary) : {
      ...emptyDiary(initialDate, data.profile.currentUser),
      content: wish ? `我们完成了「${wish.title}」。${wish.completionNote ? `\n\n${wish.completionNote}` : ""}` : "",
      favorite: Boolean(wish),
      tags: wish ? ["约定完成"] : [],
    };
    try {
      const value = JSON.parse(window.localStorage.getItem(storageKey) || "null") as { savedAt?: unknown } | null;
      const restored = restoreDiaryDraft(base, value);
      if (restored) return { diary: restored, restored: true, savedAt: typeof value?.savedAt === "number" ? value.savedAt : null };
    } catch { /* Ignore a damaged local draft. */ }
    return { diary: base, restored: false, savedAt: null as number | null };
  });
  const [draft, setDraft] = useState<Diary>(initialDraft.diary);
  const [error, setError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(initialDraft.savedAt);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const [colorNotice, setColorNotice] = useState("先选中正文里的文字，再点一种颜色");
  const originalImageIds = useRef(new Set(diary?.images.map((image) => image.id) ?? []));
  const uploadedImages = useRef(new Map<string, DiaryImage>());
  const editRevision = useRef(loveDiaryRepository.getRevision());
  const committed = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (!diary && !draft.content.trim()) window.localStorage.removeItem(storageKey);
        else {
          const savedAt = Date.now();
          window.localStorage.setItem(storageKey, JSON.stringify(createDraftSnapshot(draft, diary?.updatedAt, savedAt)));
          setDraftSavedAt(savedAt);
        }
      } catch { /* The editor still works if local storage is full. */ }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [diary, draft, storageKey]);
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
  const toggleTag = (tag: string) => setDraft((current) => {
    const tags = current.tags ?? [];
    return { ...current, tags: tags.includes(tag) ? tags.filter((item) => item !== tag) : tags.length < 8 ? [...tags, tag] : tags };
  });
  const addTag = () => {
    const clean = tagInput.trim().replace(/^#/, "").slice(0, 10);
    if (!clean) return;
    setDraft((current) => ({ ...current, tags: Array.from(new Set([...(current.tags ?? []), clean])).slice(0, 8) }));
    setTagInput("");
  };
  const updateContent = (content: string) => setDraft((current) => ({
    ...current,
    content,
    textMarks: remapTextMarks(current.content, content, current.textMarks),
  }));
  const captureSelection = () => {
    const textarea = textareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      selectionRef.current = null;
      return;
    }
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
    setColorNotice(`已选中 ${textarea.selectionEnd - textarea.selectionStart} 个字，点颜色即可应用`);
  };
  const colorSelection = (color: string | null) => {
    const selection = selectionRef.current;
    if (!selection) {
      setColorNotice("请先在上面的正文里选中想换颜色的文字");
      return;
    }
    setDraft((current) => ({ ...current, textMarks: applyTextColor(current.textMarks, selection.start, selection.end, color, current.content.length) }));
    setColorNotice(color ? "选中的文字已经换好颜色 ♡" : "选中的文字已恢复默认颜色");
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(selection.start, selection.end);
    });
  };
  const removeImage = (image: DiaryImage) => {
    setDraft((current) => ({ ...current, images: current.images.filter((item) => item.id !== image.id) }));
    if (!originalImageIds.current.has(image.id)) {
      uploadedImages.current.delete(image.id);
      void loveDiaryRepository.deleteUploadedImage(image);
    }
  };
  const cancel = () => {
    uploadedImages.current.forEach((image) => void loveDiaryRepository.deleteUploadedImage(image));
    uploadedImages.current.clear();
    committed.current = true;
    onCancel();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (uploading || saving) { setError("照片或日记还在保存，请稍等一下"); return; }
    if (!draft.content.trim()) { setError("写下一点今天的故事再保存吧"); return; }
    setSaving(true);
    const formatted = trimTextAndMarks(draft.content, draft.textMarks);
    const saved = await onSave({ ...draft, ...formatted, title: undefined, special: false, updatedAt: Date.now() }, editRevision.current);
    if (saved) {
      committed.current = true;
      uploadedImages.current.clear();
      try { window.localStorage.removeItem(storageKey); } catch { /* Saved cloud data is authoritative. */ }
    } else {
      editRevision.current = loveDiaryRepository.getRevision();
      setSaving(false);
    }
  };
  const direction = diaryDirection(draft, data.profile);
  return <form className="editor-page page-content" onSubmit={submit}>
    <header className="editor-header"><button type="button" className="icon-button" onClick={cancel} aria-label="返回">←</button><div><p className="eyebrow">NEW MEMORY</p><h1>{diary ? "继续写这一天" : "写给我们的今天"}</h1></div><button type="submit" className="text-button" disabled={Boolean(uploading) || saving}>{uploading ? "上传中" : saving ? "保存中" : "保存"}</button></header>
    <div className={`draft-notice ${initialDraft.restored ? "restored" : ""}`} role="status"><span>{initialDraft.restored ? "↺" : "✓"}</span><p><b>{initialDraft.restored ? "已恢复上次没写完的内容" : "文字草稿会自动保存在这台设备"}</b><small>{draftSavedAt ? `最近保存 ${new Date(draftSavedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "开始写后自动保存"} · {demoMode ? "照片也只保存在当前浏览器" : "照片仍以云端保存为准"}</small></p></div>
    <section className="editor-paper titleless-paper"><label className="date-field"><span>日期贴纸</span><input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><div className="saved-identity"><span>身份已记住</span><b>{direction.author}</b><i>→</i><b>{direction.recipient}</b></div><p className="paper-opening">From {direction.author} · To {direction.recipient} ♡</p><textarea ref={textareaRef} className="letter-textarea" value={draft.content} onChange={(event) => updateContent(event.target.value)} onSelect={captureSelection} placeholder={`不需要标题，直接写下${direction.author}想对${direction.recipient}说的话……`} aria-label="日记正文" /></section>
    <section className="text-color-editor" aria-label="日记文字颜色"><div className="text-color-heading"><div><h2>文字颜色</h2><p>{colorNotice}</p></div><span>局部着色</span></div><div className="text-color-palette">{TEXT_COLOR_PALETTE.map((color) => <button type="button" key={color.value} style={{ "--text-swatch": color.value } as CSSProperties} aria-label={`将选中文字设为${color.name}`} onPointerDown={(event) => event.preventDefault()} onClick={() => colorSelection(color.value)}><i /><small>{color.name}</small></button>)}<button type="button" className="reset-text-color" onPointerDown={(event) => event.preventDefault()} onClick={() => colorSelection(null)}><i>×</i><small>默认</small></button></div>{Boolean(draft.textMarks?.length) && <div className="text-color-preview"><small>颜色效果预览</small><p><ColoredDiaryText diary={draft} /></p></div>}</section>
    <Picker title="今天的心情" subtitle="选一个最像此刻的你"><div className="choice-grid mood-grid">{moods.map((mood) => <button type="button" key={mood.id} className={draft.mood.id === mood.id ? "selected" : ""} onClick={() => setDraft({ ...draft, mood })}><span>{mood.emoji}</span><small>{mood.name}</small></button>)}</div></Picker>
    <Picker title="窗外的天气" subtitle="天气也是故事的一部分"><div className="choice-grid weather-grid">{weathers.map((weather) => <button type="button" key={weather.id} className={draft.weather.id === weather.id ? "selected" : ""} onClick={() => setDraft({ ...draft, weather })}><span>{weather.emoji}</span><small>{weather.name}</small></button>)}</div></Picker>
    <section className="photo-editor"><div className="field-heading"><div><h2>今天的照片</h2><p>上传前会在手机本地缩小到清晰又省空间的尺寸，不限制选择数量。</p></div><button type="button" disabled={Boolean(uploading)} onClick={() => uploadRef.current?.click()}>{uploading ? `还有 ${uploading} 张…` : "＋ 添加"}</button></div><input ref={uploadRef} type="file" accept="image/*" multiple hidden onChange={(event) => void upload(event)} />
      {draft.images.length ? <div className="photo-sort-list">{draft.images.map((image, index) => <div className={`sort-polaroid photo-tilt-${index % 3}`} key={image.id}><button type="button" className="photo-preview" onClick={() => onViewImages(draft.images, index)}><img src={image.url} alt={`上传照片 ${index + 1}`} /></button><div className="photo-controls"><button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label="向前移动">←</button><span>{index + 1}</span><button type="button" disabled={index === draft.images.length - 1} onClick={() => moveImage(index, 1)} aria-label="向后移动">→</button><button type="button" className="delete-mini" onClick={() => removeImage(image)} aria-label="删除照片">×</button></div></div>)}</div> : <button type="button" className="upload-drop" disabled={Boolean(uploading)} onClick={() => uploadRef.current?.click()}><span>▧</span><b>{uploading ? (demoMode ? "正在压缩并保存照片…" : "正在压缩并上传照片…") : "放几张今天的照片进来"}</b><small>支持多选 · {demoMode ? "自动压缩后保存在当前浏览器" : "自动压缩后云端保存"}</small></button>}
    </section>
    <section className="diary-organize"><div className="field-heading"><div><h2>收藏与标签</h2><p>值得反复看的日子收藏一次就够了，也会在日历上留下高亮。</p></div><button type="button" className={draft.favorite ? "favorite-selected" : ""} onClick={() => setDraft({ ...draft, favorite: !draft.favorite, special: false })}>{draft.favorite ? "★ 已收藏" : "☆ 收藏"}</button></div><div className="tag-picker">{SUGGESTED_TAGS.map((tag) => <button type="button" key={tag} className={(draft.tags ?? []).includes(tag) ? "selected" : ""} aria-pressed={(draft.tags ?? []).includes(tag)} onClick={() => toggleTag(tag)}>#{tag}</button>)}</div><label className="custom-tag"><input value={tagInput} maxLength={11} onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} placeholder="自定义标签，最多 10 个字" aria-label="自定义日记标签" /><button type="button" onClick={addTag} disabled={!tagInput.trim() || (draft.tags ?? []).length >= 8}>添加</button></label>{Boolean(draft.tags?.length) && <p className="selected-tags">已选：{draft.tags?.map((tag) => <button type="button" key={tag} onClick={() => toggleTag(tag)}>#{tag} ×</button>)}</p>}</section>
    {error && <p className="form-error centered">{error}</p>}<button className="save-diary-button" type="submit" disabled={Boolean(uploading) || saving}>{saving ? (demoMode ? "正在保存到当前浏览器…" : "正在收进云端日记…") : <>把这一页收进日记 <span>♡</span></>}</button><p className="privacy-hint">⌁ {demoMode ? "演示内容只在当前浏览器可见" : "无论谁写，两个人都能看见全部内容"}</p>
  </form>;
}

function Picker({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return <section className="picker-section"><div className="field-heading"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</section>;
}

function DiaryDetail({ diary, sourceWish, profile, canWrite, responses, history, previousDiary, nextDiary, onOpenWish, onNavigate, onBack, onEdit, onToggleFavorite, onDelete, onAddResponse, onDeleteResponse, onRestoreHistory, onViewImages }: { diary: Diary; sourceWish?: WishItem; profile: CoupleProfile; canWrite: boolean; responses: DiaryResponse[]; history: DiaryHistoryEntry[]; previousDiary?: Diary; nextDiary?: Diary; onOpenWish: (id: string) => void; onNavigate: (id: string) => void; onBack: () => void; onEdit: () => void; onToggleFavorite: () => Promise<boolean>; onDelete: () => void; onAddResponse: (content: string, emoji: string) => Promise<boolean>; onDeleteResponse: (id: string) => Promise<boolean>; onRestoreHistory: (entry: DiaryHistoryEntry) => Promise<boolean>; onViewImages: (images: DiaryImage[], index: number) => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  return <article className={`detail-page page-content author-${diary.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties}><header className="detail-nav"><button className="icon-button" onClick={onBack} aria-label="返回">←</button><span><i className="detail-author-marker">{appearance.marker}</i> 这一页回忆</span>{canWrite ? <div className="detail-nav-actions"><button className={`icon-button detail-favorite ${diary.favorite ? "selected" : ""}`} onClick={() => void onToggleFavorite()} aria-label={diary.favorite ? "取消收藏" : "收藏日记"} aria-pressed={diary.favorite}>★</button><button className="icon-button" onClick={onEdit} aria-label="编辑">✎</button></div> : <span className="readonly-mark">只读</span>}</header><div className="detail-date"><span>{formatShortDate(diary.date)}</span><small>{formatDate(diary.date, true).split(" ").slice(-1)}</small></div><div className="detail-direction"><span>From</span><b>{direction.author}</b><i>→</i><span>To</span><b>{direction.recipient}</b><em>{appearance.marker} 双方可见</em></div><div className="detail-chips titleless-chips"><span>{diary.mood.emoji} {diary.mood.name}</span><span>{diary.weather.emoji} {diary.weather.name}</span>{diary.favorite && <span>★ 已收藏</span>}</div>{Boolean(diary.tags?.length) && <div className="detail-tags">{diary.tags?.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
    {sourceWish && <button type="button" className="detail-wish-source" onClick={() => onOpenWish(sourceWish.id)}><span>♡ 来自我们的100件事</span><b>{sourceWish.title} →</b></button>}
    {diary.images.length > 0 && <div className={`detail-photos count-${Math.min(diary.images.length, 3)}`}>{diary.images.map((image, index) => <button key={image.id} className={`detail-photo photo-tilt-${index % 3}`} onClick={() => onViewImages(diary.images, index)}><img src={image.url} alt={`日记照片 ${index + 1}`} /><small>{String(index + 1).padStart(2, "0")}</small></button>)}</div>}
    <section className="detail-letter"><span className="letter-tape" /><p><ColoredDiaryText diary={diary} /></p><div className="letter-sign">{appearance.marker} &nbsp; {formatShortDate(diary.date)}</div></section>
    <nav className="detail-pagination" aria-label="日记上一篇和下一篇"><button type="button" disabled={!previousDiary} onClick={() => previousDiary && onNavigate(previousDiary.id)}><span>←</span><small>上一篇</small><b>{previousDiary ? formatShortDate(previousDiary.date) : "已经是最新"}</b></button><button type="button" disabled={!nextDiary} onClick={() => nextDiary && onNavigate(nextDiary.id)}><small>下一篇</small><b>{nextDiary ? formatShortDate(nextDiary.date) : "已经是最早"}</b><span>→</span></button></nav>
    <DiaryResponses responses={responses} profile={profile} canWrite={canWrite} onAdd={onAddResponse} onDelete={onDeleteResponse} />
    {canWrite && history.length > 0 && <DiaryHistory history={history} profile={profile} onRestore={onRestoreHistory} />}
    {canWrite && <div className="detail-actions"><button onClick={onEdit}>✎ 编辑这篇</button><button className="danger-button" onClick={onDelete}>⌫ 删除</button></div>}
  </article>;
}

function DiaryResponses({ responses, profile, canWrite, onAdd, onDelete }: { responses: DiaryResponse[]; profile: CoupleProfile; canWrite: boolean; onAdd: (content: string, emoji: string) => Promise<boolean>; onDelete: (id: string) => Promise<boolean> }) {
  const emojis = ["♡", "🥰", "抱抱", "想你", "收到"];
  const [content, setContent] = useState("");
  const [emoji, setEmoji] = useState("♡");
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = content.trim();
    if (!clean || saving) return;
    setSaving(true);
    if (await onAdd(clean.slice(0, 160), emoji)) setContent("");
    setSaving(false);
  };
  return <section className="diary-responses"><div className="response-heading"><div><p className="eyebrow">OUR REPLIES</p><h2>这页下面的回应</h2></div><span>{responses.length} 条</span></div>{responses.length > 0 ? <div className="response-list">{responses.map((response) => { const name = response.author === "person1" ? profile.name1 : profile.name2; const appearance = diaryAppearance(response.author, profile); return <article className={`response-bubble author-${response.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties} key={response.id}><span className="response-emoji">{response.emoji}</span><div><b>{appearance.marker} {name}</b><p>{response.content}</p><small>{new Date(response.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>{canWrite && <button type="button" aria-label="删除这条回应" onClick={() => window.confirm("删除这条回应吗？") && void onDelete(response.id)}>×</button>}</article>; })}</div> : <p className="response-empty">还没有回应，留一句只属于你们的话吧。</p>}{canWrite && <form className="response-form" onSubmit={submit}><div className="response-emoji-options">{emojis.map((option) => <button type="button" key={option} className={emoji === option ? "selected" : ""} aria-pressed={emoji === option} onClick={() => setEmoji(option)}>{option}</button>)}</div><label><input value={content} maxLength={160} onChange={(event) => setContent(event.target.value)} placeholder="回应这一页……" aria-label="日记回应" /><button type="submit" disabled={!content.trim() || saving}>{saving ? "保存中" : "回应"}</button></label></form>}</section>;
}

function DiaryHistory({ history, profile, onRestore }: { history: DiaryHistoryEntry[]; profile: CoupleProfile; onRestore: (entry: DiaryHistoryEntry) => Promise<boolean> }) {
  return <details className="diary-history"><summary><span>↺ 历史版本</span><small>保留最近 {history.length} 个版本</small></summary><div>{history.map((entry) => { const direction = diaryDirection(entry.diary, profile); return <article key={entry.id}><div><b>{new Date(entry.savedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</b><small>{direction.author} 写给 {direction.recipient}</small><p>{diaryExcerpt(entry.diary.content, 54)}</p></div><button type="button" onClick={() => void onRestore(entry)}>恢复</button></article>; })}</div></details>;
}

function MemoryReviewPage({ data, onBack, onOpen }: { data: AppData; onBack: () => void; onOpen: (id: string) => void }) {
  const today = toDateInput();
  const review = useMemo(() => buildMemoryReview(data.diaries, today), [data.diaries, today]);
  const ordered = useMemo(() => [...data.diaries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt), [data.diaries]);
  const [shuffle, setShuffle] = useState(0);
  const baseRandomIndex = review.random ? Math.max(0, ordered.findIndex((diary) => diary.id === review.random?.id)) : 0;
  const randomDiary = ordered.length ? ordered[(baseRandomIndex + shuffle) % ordered.length] : undefined;
  return <div className="memory-review-page page-content"><header className="review-header"><button type="button" className="icon-button" onClick={onBack} aria-label="返回">←</button><div><p className="eyebrow">MEMORY REVIEW</p><h1>今天想起从前的我们</h1><p>有些日子，值得被重新翻开。</p></div><span>↺</span></header>{ordered.length ? <><section className="review-hero"><span>♡</span><p>我们已经写下</p><strong>{ordered.length}</strong><small>页共同回忆</small><div><i>{ordered.filter((diary) => diary.favorite).length} 篇收藏</i><i>{new Set(ordered.flatMap((diary) => diary.tags ?? [])).size} 个标签</i></div></section><div className="review-grid">{review.onThisDay ? <ReviewMemory title="往年的今天" subtitle="同一个日期，不同一年的我们" diary={review.onThisDay} profile={data.profile} onOpen={onOpen} /> : <section className="review-empty-card"><span>☁</span><div><small>ON THIS DAY</small><b>往年的今天还在等待</b><p>等日记陪我们走过一年，这里会自动翻出同一天的故事。</p></div></section>}{review.monthAgo && <ReviewMemory title="大约一个月前" subtitle="最近一个月前后七天的回忆" diary={review.monthAgo} profile={data.profile} onOpen={onOpen} />}{review.first && <ReviewMemory title="最初的一页" subtitle="从这里开始，慢慢写到今天" diary={review.first} profile={data.profile} onOpen={onOpen} />}{randomDiary && <ReviewMemory title="随机翻到" subtitle="今天命运替我们选中的一页" diary={randomDiary} profile={data.profile} onOpen={onOpen} action="换一篇" onAction={() => setShuffle((value) => value + 1)} />}</div><p className="review-signoff">明天再来，会翻到另一页故事 ♡</p></> : <SoftEmpty icon="♡" title="回忆页还在等第一篇日记" text="写下第一个今天，以后就能在这里不断重逢。" />}</div>;
}

function ReviewMemory({ title, subtitle, diary, profile, onOpen, action, onAction }: { title: string; subtitle: string; diary: Diary; profile: CoupleProfile; onOpen: (id: string) => void; action?: string; onAction?: () => void }) {
  const appearance = diaryAppearance(diary.author, profile);
  const direction = diaryDirection(diary, profile);
  return <section className="review-memory" style={{ "--diary-accent": appearance.accent } as CSSProperties}><header><span>{appearance.marker}</span><div><small>{subtitle}</small><h2>{title}</h2></div>{diary.favorite && <em>★</em>}</header>{diary.images[0] && <button type="button" className="review-photo" onClick={() => onOpen(diary.id)}><img src={diary.images[0].url} alt="回忆照片" loading="lazy" /></button>}<button type="button" className="review-story" onClick={() => onOpen(diary.id)}><span>{formatShortDate(diary.date)}</span><small>{direction.author} 写给 {direction.recipient}</small><p>{diaryExcerpt(diary.content, 92)}</p>{Boolean(diary.tags?.length) && <i>{diary.tags?.slice(0, 3).map((tag) => `#${tag}`).join("  ")}</i>}<b>重新读这一天 →</b></button>{action && <button type="button" className="review-shuffle" onClick={onAction}>↻ {action}</button>}</section>;
}

// Kept temporarily so older in-progress local bundles can finish rendering while the new wish page rolls out.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function LegacyWishListPage({ data, canWrite, commit, onBack }: { data: AppData; canWrite: boolean; commit: Commit; onBack: () => void }) {
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WishCategory>("date");
  const [saving, setSaving] = useState(false);
  const completed = data.wishes.filter((wish) => wish.completed).length;
  const progress = Math.min(100, completed);
  const ordered = useMemo(() => [...data.wishes].sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt), [data.wishes]);
  const visible = ordered.filter((wish) => filter === "all" || (filter === "done" ? wish.completed : !wish.completed));
  const addWish = async (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim().slice(0, 60);
    if (!clean || saving || data.wishes.length >= 100) return;
    setSaving(true);
    const wish: WishItem = { id: crypto.randomUUID(), title: clean, category, createdBy: data.profile.currentUser, createdAt: Date.now(), completed: false };
    if (await commit({ ...data, wishes: [wish, ...data.wishes] }, "新的约定已经放进100件事 ♡")) {
      setTitle("");
      setCategory("date");
      setAdding(false);
    }
    setSaving(false);
  };
  const toggleWish = async (wish: WishItem) => {
    if (!canWrite) return;
    const completedNow = !wish.completed;
    await commit({ ...data, wishes: data.wishes.map((item) => item.id === wish.id ? { ...item, completed: completedNow, completedAt: completedNow ? Date.now() : undefined } : item) }, completedNow ? "又一起完成了一件事 ♡" : "已经放回想做清单");
  };
  const removeWish = async (wish: WishItem) => {
    if (!canWrite || !window.confirm(`删除“${wish.title}”吗？`)) return;
    await commit({ ...data, wishes: data.wishes.filter((item) => item.id !== wish.id) }, "这件事已经从清单移除");
  };
  const inspiration = ["一起去看海", "拍一组属于我们的照片", "去一座陌生城市散步"];
  return <div className="wish-page page-content"><header className="wish-header"><button type="button" className="icon-button" onClick={onBack} aria-label="返回首页">←</button><div><p className="eyebrow">OUR 100 THINGS</p><h1>想和你做的100件事</h1><p>不是一定要伟大，和你一起完成就很特别。</p></div><span>♡</span></header><section className="wish-progress-card"><div className="wish-progress-ring" style={{ "--wish-progress": `${progress}%` } as CSSProperties}><strong>{completed}</strong><small>/ 100</small></div><div><small>TOGETHER LIST</small><h2>我们已经一起完成 {completed} 件</h2><p>{completed ? `还有 ${100 - completed} 个约定，慢慢走，慢慢完成。` : "从第一件小事开始，把以后写成清单。"}</p></div></section><div className="wish-toolbar"><div role="group" aria-label="筛选100件事">{([ ["all", "全部"], ["todo", "想去完成"], ["done", "已经完成"] ] as const).map(([value, label]) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>{canWrite && data.wishes.length < 100 && <button type="button" className="wish-add-button" onClick={() => setAdding((value) => !value)}>{adding ? "收起" : "＋ 添加"}</button>}</div>{canWrite && adding && <form className="wish-form" onSubmit={addWish}><label><span>我们想一起……</span><input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="例如：一起去看一次海" /></label><div className="wish-category-picker">{WISH_CATEGORIES.map((item) => <button type="button" key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}><span>{item.emoji}</span><small>{item.label}</small></button>)}</div><div className="wish-inspirations">{inspiration.map((item) => <button type="button" key={item} onClick={() => setTitle(item)}>{item}</button>)}</div><button className="primary-button" type="submit" disabled={!title.trim() || saving}>{saving ? "正在放进清单…" : "收进我们的100件事"}</button></form>}<section className="wish-list" aria-live="polite">{visible.length ? visible.map((wish) => { const meta = WISH_CATEGORIES.find((item) => item.id === wish.category) ?? WISH_CATEGORIES[2]; const creator = wish.createdBy === "person1" ? data.profile.name1 : data.profile.name2; return <article className={wish.completed ? "completed" : ""} key={wish.id}><button type="button" className="wish-check" onClick={() => void toggleWish(wish)} disabled={!canWrite} aria-label={wish.completed ? "标记为未完成" : "标记为已完成"} aria-pressed={wish.completed}>{wish.completed ? "✓" : String(ordered.indexOf(wish) + 1).padStart(2, "0")}</button><span className="wish-category-icon">{meta.emoji}</span><div><b>{wish.title}</b><small>{meta.label} · {creator} 添加{wish.completedAt ? ` · ${formatShortDate(new Date(wish.completedAt).toISOString().slice(0, 10))} 完成` : ""}</small></div>{canWrite && <button type="button" className="wish-delete" onClick={() => void removeWish(wish)} aria-label={`删除${wish.title}`}>×</button>}</article>; }) : <SoftEmpty icon="♡" title={data.wishes.length ? "这里还没有符合条件的约定" : "我们的清单还在等第一件事"} text={data.wishes.length ? "换一个筛选，就能看到其他约定。" : "想去的地方、想吃的东西、想一起度过的小日子，都可以写进来。"} />}</section>{data.wishes.length >= 100 && <p className="wish-full-note">100 个约定已经写满啦，接下来就一起慢慢完成 ♡</p>}</div>;
}

interface WishCompletionDraft {
  wishId: string;
  date: string;
  note: string;
  image?: DiaryImage;
}

function WishListPageV2({ data, canWrite, commit, initialWishId, onBack, onOpenDiary, onWriteDiary }: { data: AppData; canWrite: boolean; commit: Commit; initialWishId?: string; onBack: () => void; onOpenDiary: (id: string) => void; onWriteDiary: (wish: WishItem) => void }) {
  const [filter, setFilter] = useState<"all" | "todo" | "done">("all");
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<WishCategory>("date");
  const [saving, setSaving] = useState(false);
  const [completion, setCompletion] = useState<WishCompletionDraft | null>(null);
  const [completionUploading, setCompletionUploading] = useState(false);
  const [highlightedWishId, setHighlightedWishId] = useState(initialWishId);
  const pendingImage = useRef<DiaryImage | null>(null);
  const completed = data.wishes.filter((wish) => wish.completed).length;
  const ordered = useMemo(() => [...data.wishes].sort((a, b) => Number(a.completed) - Number(b.completed) || b.createdAt - a.createdAt), [data.wishes]);
  const visible = ordered.filter((wish) => filter === "all" || (filter === "done" ? wish.completed : !wish.completed));

  useEffect(() => () => {
    if (pendingImage.current) void loveDiaryRepository.deleteUploadedImage(pendingImage.current);
  }, []);

  useEffect(() => {
    if (!initialWishId) return;
    const scrollTimer = window.setTimeout(() => document.getElementById(`wish-${initialWishId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    const clearTimer = window.setTimeout(() => setHighlightedWishId((current) => current === initialWishId ? undefined : current), 5000);
    return () => { window.clearTimeout(scrollTimer); window.clearTimeout(clearTimer); };
  }, [initialWishId]);

  const addWish = async (event: FormEvent) => {
    event.preventDefault();
    const clean = title.trim().slice(0, 60);
    if (!clean || saving || data.wishes.length >= 100) return;
    setSaving(true);
    const wish: WishItem = { id: crypto.randomUUID(), title: clean, category, createdBy: data.profile.currentUser, createdAt: Date.now(), completed: false };
    if (await commit({ ...data, wishes: [wish, ...data.wishes] }, "新的约定已经放进100件事 ♡")) {
      setTitle("");
      setCategory("date");
      setAdding(false);
    }
    setSaving(false);
  };

  const beginCompletion = (wish: WishItem) => {
    if (!canWrite) return;
    if (pendingImage.current) void loveDiaryRepository.deleteUploadedImage(pendingImage.current);
    pendingImage.current = null;
    setCompletion({ wishId: wish.id, date: timestampDateInput(wish.completedAt), note: wish.completionNote ?? "", image: wish.completionImage });
  };

  const cancelCompletion = () => {
    if (pendingImage.current) void loveDiaryRepository.deleteUploadedImage(pendingImage.current);
    pendingImage.current = null;
    setCompletion(null);
  };

  const uploadCompletionImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !completion) return;
    setCompletionUploading(true);
    try {
      const image = await loveDiaryRepository.uploadImage(file);
      if (pendingImage.current) void loveDiaryRepository.deleteUploadedImage(pendingImage.current);
      pendingImage.current = image;
      setCompletion((current) => current ? { ...current, image } : current);
    } catch {
      window.alert("照片没有上传成功，请检查网络后重试。");
    } finally {
      setCompletionUploading(false);
      event.target.value = "";
    }
  };

  const saveCompletion = async (wish: WishItem) => {
    if (!completion || completionUploading || saving) return;
    setSaving(true);
    const completedAt = new Date(`${completion.date}T12:00:00`).getTime();
    const nextWish: WishItem = {
      ...wish,
      completed: true,
      completedAt: Number.isFinite(completedAt) ? completedAt : Date.now(),
      completionNote: completion.note.trim().slice(0, 200) || undefined,
      completionImage: completion.image,
    };
    const saved = await commit({ ...data, wishes: data.wishes.map((item) => item.id === wish.id ? nextWish : item) }, wish.completed ? "完成记录已经更新 ♡" : "又一起完成了一件事 ♡");
    if (saved) {
      const oldImage = wish.completionImage;
      const newImage = completion.image;
      pendingImage.current = null;
      setCompletion(null);
      if (oldImage && oldImage.url !== newImage?.url) void loveDiaryRepository.deleteUploadedImage(oldImage);
    }
    setSaving(false);
  };

  const undoWish = async (wish: WishItem) => {
    if (!canWrite || !window.confirm(`把“${wish.title}”放回想做清单吗？完成记录会一起移除。`)) return;
    const image = wish.completionImage;
    const saved = await commit({ ...data, wishes: data.wishes.map((item) => item.id === wish.id ? { ...item, completed: false, completedAt: undefined, completionNote: undefined, completionImage: undefined } : item) }, "已经放回想做清单");
    if (saved && image) void loveDiaryRepository.deleteUploadedImage(image);
  };

  const removeWish = async (wish: WishItem) => {
    const diaryNote = wish.diaryId ? "\n\n已经关联的日记会保留，不会一起删除。" : "";
    if (!canWrite || !window.confirm(`删除“${wish.title}”吗？${diaryNote}`)) return;
    const saved = await commit({ ...data, wishes: data.wishes.filter((item) => item.id !== wish.id) }, "这件事已经从清单移除");
    if (saved && wish.completionImage) void loveDiaryRepository.deleteUploadedImage(wish.completionImage);
  };

  return <div className="wish-page page-content">
    <header className="wish-header"><button type="button" className="icon-button" onClick={onBack} aria-label="返回首页">←</button><div><p className="eyebrow">OUR 100 THINGS</p><h1>想和你做的100件事</h1><p>把完成的那一天，也好好留在这里。</p></div><span>♡</span></header>
    <section className="wish-progress-card"><div className="wish-progress-ring" style={{ "--wish-progress": `${Math.min(100, completed)}%` } as CSSProperties}><strong>{completed}</strong><small>/ 100</small></div><div><small>TOGETHER LIST</small><h2>我们已经一起完成 {completed} 件</h2><p>{completed ? `还有 ${100 - completed} 个约定，慢慢走，慢慢完成。` : "从第一件小事开始，把以后写成清单。"}</p></div></section>
    <div className="wish-toolbar"><div role="group" aria-label="筛选100件事">{([ ["all", "全部"], ["todo", "想去完成"], ["done", "已经完成"] ] as const).map(([value, label]) => <button type="button" key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>{canWrite && data.wishes.length < 100 && <button type="button" className="wish-add-button" onClick={() => setAdding((value) => !value)}>{adding ? "收起" : "＋ 添加"}</button>}</div>
    {canWrite && adding && <form className="wish-form" onSubmit={addWish}><label><span>我们想一起……</span><input value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} placeholder="例如：一起去看一次海" /></label><div className="wish-category-picker">{WISH_CATEGORIES.map((item) => <button type="button" key={item.id} className={category === item.id ? "selected" : ""} aria-pressed={category === item.id} onClick={() => setCategory(item.id)}><span>{item.emoji}</span><small>{item.label}</small></button>)}</div><button className="primary-button" type="submit" disabled={!title.trim() || saving}>{saving ? "正在放进清单…" : "收进我们的100件事"}</button></form>}
    <section className="wish-list enhanced" aria-live="polite">{visible.length ? visible.map((wish) => {
      const meta = WISH_CATEGORIES.find((item) => item.id === wish.category) ?? WISH_CATEGORIES[2];
      const creator = wish.createdBy === "person1" ? data.profile.name1 : data.profile.name2;
      const editing = completion?.wishId === wish.id;
      const linkedDiary = wish.diaryId ? data.diaries.find((diary) => diary.id === wish.diaryId) : undefined;
      const linkedTrash = wish.diaryId ? data.trash.some((item) => item.diary.id === wish.diaryId) : false;
      const linkMissing = Boolean(wish.diaryId && !linkedDiary && !linkedTrash);
      return <article id={`wish-${wish.id}`} className={`${wish.completed ? "completed" : ""} ${wish.diaryId ? "has-diary" : ""} ${highlightedWishId === wish.id ? "is-highlighted" : ""}`} key={wish.id}>
        <div className="wish-summary"><button type="button" className="wish-check" onClick={() => wish.completed ? void undoWish(wish) : beginCompletion(wish)} disabled={!canWrite} aria-label={wish.completed ? "撤销完成" : "记录完成"} aria-pressed={wish.completed}>{wish.completed ? "✓" : String(ordered.indexOf(wish) + 1).padStart(2, "0")}</button><span className="wish-category-icon">{meta.emoji}</span><div><b>{wish.title}</b><small>{meta.label} · {creator} 添加{wish.completedAt ? ` · ${formatShortDate(timestampDateInput(wish.completedAt))} 完成` : ""}</small></div>{canWrite && <button type="button" className="wish-delete" onClick={() => void removeWish(wish)} aria-label={`删除${wish.title}`}>×</button>}</div>
        {wish.completed && !editing && <div className="wish-completion-memory">{wish.completionImage && <img src={wish.completionImage.url} alt={`${wish.title}的完成照片`} loading="lazy" decoding="async" />}{wish.completionNote && <p>{wish.completionNote}</p>}{canWrite && <div><button type="button" onClick={() => beginCompletion(wish)}>✎ 补充记录</button></div>}</div>}
        {!editing && (wish.completed || wish.diaryId) && <div className="wish-linked-diary">{linkedDiary ? <button type="button" onClick={() => onOpenDiary(linkedDiary.id)}><span>♡ 已写进恋爱日记</span><b>查看这篇日记 →</b></button> : linkedTrash ? <span><b>日记在回收站</b><small>恢复后会自动重新连上</small></span> : canWrite ? <button type="button" onClick={() => onWriteDiary(wish)}><span>{linkMissing ? "原关联日记已删除" : "把完成的故事继续写下来"}</span><b>{linkMissing ? "重新写成日记 →" : "♡ 写成日记 →"}</b></button> : linkMissing ? <span><b>关联日记暂不可查看</b></span> : null}</div>}
        {editing && completion && <div className="wish-completion-form"><label><span>完成日期</span><input type="date" value={completion.date} onChange={(event) => setCompletion({ ...completion, date: event.target.value })} /></label><label><span>这件事完成时，想记住什么</span><textarea maxLength={200} value={completion.note} onChange={(event) => setCompletion({ ...completion, note: event.target.value })} placeholder="写一句当时的心情……" /></label><label className="wish-photo-picker"><input type="file" accept="image/*" hidden onChange={(event) => void uploadCompletionImage(event)} />{completion.image ? <img src={completion.image.url} alt="完成照片预览" /> : <span>▧</span>}<b>{completionUploading ? "照片上传中…" : completion.image ? "更换完成照片" : "添加一张完成照片"}</b></label><div className="wish-completion-actions"><button type="button" onClick={cancelCompletion}>取消</button><button type="button" disabled={saving || completionUploading} onClick={() => void saveCompletion(wish)}>{saving ? "保存中…" : "保存完成记录"}</button></div></div>}
      </article>;
    }) : <SoftEmpty icon="♡" title={data.wishes.length ? "这里还没有符合条件的约定" : "我们的清单还在等第一件事"} text={data.wishes.length ? "换一个筛选，就能看到其他约定。" : "想去的地方、想吃的东西、想一起度过的小日子，都可以写进来。"} />}</section>
    {data.wishes.length >= 100 && <p className="wish-full-note">100 个约定已经写满啦，接下来就一起慢慢完成 ♡</p>}
  </div>;
}

function MonthlyReportPage({ data, onBack, onOpen }: { data: AppData; onBack: () => void; onOpen: (id: string) => void }) {
  const months = useMemo(() => availableReportMonths(data.diaries), [data.diaries]);
  const [month, setMonth] = useState(months[0] ?? toDateInput().slice(0, 7));
  const report = useMemo(() => buildMonthlyReport(data.diaries, month), [data.diaries, month]);
  const leader = report.leadingAuthor === "tie" ? "这个月写得一样多" : `${report.leadingAuthor === "person1" ? data.profile.name1 : data.profile.name2}写得更多`;

  return (
    <div className="monthly-report-page page-content">
      <header className="report-header">
        <button type="button" className="icon-button" onClick={onBack} aria-label="返回">←</button>
        <div><p className="eyebrow">LOVE MONTHLY REPORT</p><h1>我们的恋爱月报</h1><p>把这个月写过的日子，轻轻收进这一页。</p></div>
        <span>♡</span>
      </header>
      {months.length ? (
        <>
          <label className="report-month-picker">
            <span>选择月份</span>
            <select value={month} onChange={(event) => setMonth(event.target.value)}>
              {months.map((value) => <option key={value} value={value}>{reportMonthLabel(value)}</option>)}
            </select>
          </label>
          <section className="report-cover">
            <small>{reportMonthLabel(month)}</small>
            <h2>恋爱月报</h2>
            <p>{data.profile.name2} <i>♡</i> {data.profile.name1}</p>
            <div>
              <span><strong>{report.diaryCount}</strong><small>篇日记</small></span>
              <span><strong>{report.photoCount}</strong><small>张照片</small></span>
              <span><strong>{report.favoriteCount}</strong><small>篇收藏</small></span>
            </div>
          </section>
          {report.photos.length > 0 && (
            <section className="report-photo-story">
              <header><div><p className="eyebrow">PHOTO MEMORIES</p><h2>这个月留下的照片</h2></div><span>{report.photos.length} 张</span></header>
              <div className={"report-photo-collage count-" + Math.min(4, report.photos.length)}>
                {report.photos.slice(0, 4).map((photo, index) => <img key={photo.id} src={photo.url} alt={`本月回忆照片 ${index + 1}`} loading="lazy" />)}
              </div>
            </section>
          )}
          <section className="report-writers">
            <header><div><p className="eyebrow">WRITERS</p><h2>这个月，是谁写得更多</h2></div><span>{leader}</span></header>
            <div className="writer-counts">
              <span style={{ "--writer-color": data.profile.person1Accent, flexGrow: report.authorCounts.person1 + 1 } as CSSProperties}><b>{data.profile.person1Marker} {data.profile.name1}</b><strong>{report.authorCounts.person1}</strong></span>
              <span style={{ "--writer-color": data.profile.person2Accent, flexGrow: report.authorCounts.person2 + 1 } as CSSProperties}><b>{data.profile.person2Marker} {data.profile.name2}</b><strong>{report.authorCounts.person2}</strong></span>
            </div>
          </section>
          <section className="report-common">
            <article><span>{report.topMood?.value.emoji ?? "♡"}</span><small>最常见心情</small><b>{report.topMood?.value.name ?? "等待记录"}</b><em>{report.topMood ? `${report.topMood.count} 次` : ""}</em></article>
            <article><span>{report.topWeather?.value.emoji ?? "☁"}</span><small>最常见天气</small><b>{report.topWeather?.value.name ?? "等待记录"}</b><em>{report.topWeather ? `${report.topWeather.count} 次` : ""}</em></article>
            <article><span>#</span><small>本月标签</small><b>{report.topTags[0]?.tag ?? "还没有标签"}</b><em>{report.topTags.length ? report.topTags.map((item) => item.tag).join(" · ") : ""}</em></article>
          </section>
          <section className="report-highlight-list">
            <div className="field-heading"><div><p className="eyebrow">THREE MEMORIES</p><h2>这个月想收藏的三页</h2><p>第一篇、代表回忆，再随机翻开一段故事。</p></div></div>
            <ReportMemory title="本月第一篇" diary={report.first} profile={data.profile} onOpen={onOpen} />
            <ReportMemory title="本月代表回忆" diary={report.highlight} profile={data.profile} onOpen={onOpen} />
            <ReportMemory title="随机回忆" diary={report.random} profile={data.profile} onOpen={onOpen} />
          </section>
        </>
      ) : <SoftEmpty icon="♡" title="月报还在等第一篇日记" text="写下这个月的第一段回忆后，这里会自动生成本月统计与回忆。" />}
    </div>
  );
}

function ReportMemory({ title, diary, profile, onOpen }: { title: string; diary?: Diary; profile: CoupleProfile; onOpen: (id: string) => void }) {
  if (!diary) return null;
  const appearance = diaryAppearance(diary.author, profile);
  const direction = diaryDirection(diary, profile);
  return <button type="button" className="report-memory" style={{ "--diary-accent": appearance.accent } as CSSProperties} onClick={() => onOpen(diary.id)}><span>{appearance.marker}</span><div><small>{title} · {formatShortDate(diary.date)}</small><b>{direction.author} 写给 {direction.recipient}</b><p>{diaryExcerpt(diary.content, 70)}</p></div><i>›</i></button>;
}

function CalendarPage({ data, canWrite, initialDate, onOpen, onCreate }: { data: AppData; canWrite: boolean; initialDate?: string; onOpen: (id: string) => void; onCreate: (date: string) => void }) {
  const start = initialDate ? new Date(`${initialDate}T12:00:00`) : new Date();
  const [cursor, setCursor] = useState(new Date(start.getFullYear(), start.getMonth(), 1, 12));
  const [selected, setSelected] = useState(initialDate || toDateInput());
  const cells = calendarCells(cursor);
  const selectedDiaries = data.diaries.filter((diary) => diary.date === selected);
  const diaryDates = useMemo(() => {
    const dates = new Map<string, { authors: DiaryAuthor[]; special: boolean }>();
    data.diaries.forEach((diary) => {
      const current = dates.get(diary.date) ?? { authors: [], special: false };
      if (!current.authors.includes(diary.author)) current.authors.push(diary.author);
      current.special ||= Boolean(diary.favorite);
      dates.set(diary.date, current);
    });
    return dates;
  }, [data.diaries]);
  return <div className="calendar-page page-content"><header className="simple-header"><p className="eyebrow">OUR DAYS</p><h1>日历里的我们</h1><p>两种小标记，记录是谁把这一天写给了谁。</p></header><section className="calendar-card"><div className="calendar-title"><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1, 12))} aria-label="上个月">‹</button><h2>{monthTitle(cursor)}</h2><button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12))} aria-label="下个月">›</button></div><div className="week-row">{"日一二三四五六".split("").map((day) => <span key={day}>{day}</span>)}</div><div className="calendar-grid">{cells.map((cell) => { const entry = diaryDates.get(cell.date); return <button key={cell.date} className={`${cell.current ? "" : "muted"} ${selected === cell.date ? "selected" : ""} ${entry ? "has-diary" : ""} ${entry?.special ? "special" : ""}`} onClick={() => setSelected(cell.date)}><span>{cell.day}</span>{entry && <span className="calendar-marks">{entry.authors.map((author) => { const appearance = diaryAppearance(author, data.profile); return <i key={author} style={{ "--diary-accent": appearance.accent } as CSSProperties}>{appearance.marker}</i>; })}</span>}</button>; })}</div></section><section className="selected-day"><div className="section-heading compact"><div><p className="eyebrow">SELECTED DAY</p><h2>{formatDate(selected)}</h2></div></div>{selectedDiaries.length ? selectedDiaries.map((diary) => { const direction = diaryDirection(diary, data.profile); const appearance = diaryAppearance(diary.author, data.profile); return <button className="day-story" style={{ "--diary-accent": appearance.accent } as CSSProperties} key={diary.id} onClick={() => onOpen(diary.id)}><span>{appearance.marker}</span><div><b>{diaryExcerpt(diary.content)}</b><small>{direction.author} → {direction.recipient} · {diary.weather.emoji} {diary.weather.name}</small></div><i>→</i></button>; }) : <SoftEmpty icon="☁" title="今天还没有故事" text={canWrite ? "要不要把这一天写下来呀？♡" : "这一天还没有写下故事。"} action={canWrite ? "写这天的日记" : undefined} onAction={canWrite ? () => onCreate(selected) : undefined} />}</section></div>;
}

function DiaryBookPage({ data, canWrite, onBack, onEdit, onViewImages }: { data: AppData; canWrite: boolean; onBack: () => void; onEdit: (id: string) => void; onViewImages: (images: DiaryImage[], index: number, title: string) => void }) {
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
  const [flip, setFlip] = useState<{ direction: BookDirection; target: number } | null>(null);
  const touchStart = useRef(0);
  const safeIndex = diaries.length ? Math.min(pageIndex, diaries.length - 1) : 0;
  const current = diaries[safeIndex];

  useEffect(() => {
    if (!current) return;
    try { window.localStorage.setItem(BOOK_PAGE_KEY, current.id); } catch { /* Device preference is optional. */ }
  }, [current]);

  useEffect(() => {
    if (!flip) return;
    const fallback = window.setTimeout(() => {
      setPageIndex(flip.target);
      setFlip(null);
    }, 900);
    return () => window.clearTimeout(fallback);
  }, [flip]);

  if (!current) return <div className="book-page-screen page-content"><header className="book-header"><button type="button" className="book-back" onClick={onBack} aria-label="返回首页">←</button><div><p className="eyebrow">OUR DIARY BOOK</p><h1>我们的日记本</h1><p>一页一页，把相爱写成一本书。</p></div></header><SoftEmpty icon="▤" title="日记本还是空白的" text="写下第一篇日记后，它就会出现在这里。" /></div>;

  const startFlip = (direction: BookDirection) => {
    if (flip) return;
    const target = bookPageTarget(safeIndex, direction, diaries.length);
    if (target !== null) setFlip({ direction, target });
  };
  const finishFlip = () => {
    if (!flip) return;
    setPageIndex(flip.target);
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

  return <div className="book-page-screen page-content">
    <header className="book-header"><button type="button" className="book-back" onClick={onBack} aria-label="返回首页">←</button><div><p className="eyebrow">OUR DIARY BOOK</p><h1>我们的日记本</h1><p>左右滑动，像翻书一样读完每一页回忆。</p></div></header>
    <div className="book-order-controls" role="group" aria-label="日记本阅读顺序"><button type="button" className={order === "newest" ? "selected" : ""} aria-pressed={order === "newest"} onClick={() => changeOrder("newest")}>从新到旧</button><button type="button" className={order === "oldest" ? "selected" : ""} aria-pressed={order === "oldest"} onClick={() => changeOrder("oldest")}>从旧到新</button></div>
    <div className="book-cover-shell">
      <div className="book-spine" aria-hidden="true" />
      <div className="book-stage" onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(delta) > 45) startFlip(delta < 0 ? "next" : "previous"); }}>
        <div className="book-sheet book-sheet-under" aria-hidden="true"><BookPaper diary={revealed} profile={data.profile} interactive={false} onViewImages={onViewImages} /></div>
        <div className={`book-sheet book-sheet-top ${flip ? `is-flipping-${flip.direction}` : ""}`} onAnimationEnd={(event) => event.target === event.currentTarget && finishFlip()} aria-live="polite">
          <BookPaper diary={current} profile={data.profile} interactive onViewImages={onViewImages} />
        </div>
      </div>
    </div>
    <div className="book-scrubber"><div><span>快速翻页</span><b>{safeIndex + 1} / {diaries.length}</b></div><input type="range" min={0} max={Math.max(0, diaries.length - 1)} value={safeIndex} disabled={Boolean(flip)} aria-label="快速选择日记页" aria-valuetext={`第 ${safeIndex + 1} 页，共 ${diaries.length} 页`} onChange={(event) => { setFlip(null); setPageIndex(Number(event.target.value)); }} /><small><span>{order === "newest" ? "最新" : "最早"}</span><span>{order === "newest" ? "最早" : "最新"}</span></small></div>
    <div className="book-page-tools"><div className="book-progress"><span>{String(safeIndex + 1).padStart(2, "0")}</span><i /><span>{String(diaries.length).padStart(2, "0")}</span></div>{canWrite && <button type="button" className="book-edit-current" onClick={() => onEdit(current.id)}>✎ 编辑这一页</button>}</div>
    <div className="book-controls">
      <button type="button" disabled={safeIndex === 0 || Boolean(flip)} onClick={() => startFlip("previous")}><span>‹</span><b>上一页</b><small>{order === "newest" ? "更新的回忆" : "更早的回忆"}</small></button>
      <button type="button" disabled={safeIndex === diaries.length - 1 || Boolean(flip)} onClick={() => startFlip("next")}><b>下一页</b><small>{order === "newest" ? "更早的回忆" : "更新的回忆"}</small><span>›</span></button>
    </div>
  </div>;
}

function BookPaper({ diary, profile, interactive, onViewImages }: { diary: Diary; profile: CoupleProfile; interactive: boolean; onViewImages: (images: DiaryImage[], index: number, title: string) => void }) {
  const direction = diaryDirection(diary, profile);
  const appearance = diaryAppearance(diary.author, profile);
  return <article className={`book-paper author-${diary.author}`} style={{ "--diary-accent": appearance.accent } as CSSProperties}>
    <div className="book-paper-head"><span className="book-author-seal">{appearance.marker}</span><div><small>{formatShortDate(diary.date)}</small><b>{direction.author} 写给 {direction.recipient}</b></div><em>{diary.mood.emoji} {diary.weather.emoji}</em></div>
    {diary.favorite && <div className="book-special-note">★ 已收藏</div>}
    {diary.images.length > 0 && <div className="book-photo-row">{diary.images.slice(0, 3).map((image, index) => interactive ? <button type="button" key={image.id} onClick={() => onViewImages(diary.images, index, formatDate(diary.date))}><img src={image.url} alt={`日记照片 ${index + 1}`} loading="lazy" decoding="async" /></button> : <span key={image.id}><img src={image.url} alt="" /></span>)}</div>}
    <div className="book-writing"><p><ColoredDiaryText diary={diary} /></p></div>
    <footer><span>{appearance.marker}</span><i>{formatDate(diary.date)}</i></footer>
  </article>;
}

function GalleryPage({ data, onHome, onOpen }: { data: AppData; onHome: () => void; onOpen: (images: DiaryImage[], index: number, title: string) => void }) {
  const [filter, setFilter] = useState("全部");
  const [visibleCount, setVisibleCount] = useState(GALLERY_BATCH_SIZE);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const diaryPhotos = [...data.diaries].flatMap((diary) => diary.images.map((image) => ({ image, date: diary.date, diary, wish: undefined as WishItem | undefined })));
  const wishPhotos = data.wishes.filter((wish) => wish.completionImage).map((wish) => ({ image: wish.completionImage!, date: timestampDateInput(wish.completedAt ?? wish.createdAt), diary: undefined as Diary | undefined, wish }));
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
  return <div className="gallery-page page-content"><header className="gallery-header"><p className="eyebrow">PHOTO ALBUM</p><h1>我们的照片</h1><p>日记与100件事里，已经一起留下 <strong>{all.length}</strong> 张回忆</p></header>{all.length ? <><div className="filter-pills"><button className={filter === "全部" ? "selected" : ""} onClick={() => chooseFilter("全部")}>全部</button>{months.map((month) => <button key={month} className={filter === month ? "selected" : ""} onClick={() => chooseFilter(month)}>{month.replace("-", "年")}月</button>)}</div><div className="masonry">{displayed.map(({ image, diary, wish, date }, index) => {
    const direction = diary ? diaryDirection(diary, data.profile) : undefined;
    const title = diary && direction ? `${direction.author} 写给 ${direction.recipient}` : `100件事 · ${wish?.title ?? "完成回忆"}`;
    return <button key={`${diary ? `diary-${diary.id}` : `wish-${wish?.id}`}-${image.id}`} className={`gallery-photo gallery-${index % 4}`} onClick={() => onOpen(images, index, title)}><img src={image.url} alt={`${formatDate(date)}的回忆照片`} loading="lazy" decoding="async" /><span><b>{formatShortDate(date)} · {diary && direction ? `${direction.author} → ${direction.recipient}` : "我们的100件事"}</b><small>{diary ? `${diary.mood.emoji} ${diaryExcerpt(diary.content, 14)}` : `♡ ${diaryExcerpt(wish?.title ?? "一起完成的小事", 14)}`}</small></span></button>;
  })}</div>{displayed.length < visible.length && <button ref={loadMoreRef} type="button" className="gallery-load-more" onClick={() => setVisibleCount((count) => Math.min(visible.length, count + GALLERY_BATCH_SIZE))}>继续加载照片 · {displayed.length}/{visible.length}</button>}</> : <SoftEmpty icon="▧" title="这里还没有照片" text="下一次见面，记得多拍几张呀。日记与100件事里的照片都会来到这里。" action="去首页看看" onAction={onHome} />}</div>;
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
  return <div className="us-page page-content"><header className="us-hero"><div className="us-avatar one">{data.profile.avatar2 ? <img src={data.profile.avatar2} alt="" /> : data.profile.name2.slice(0, 1)}</div><span>♡</span><div className="us-avatar two">{data.profile.avatar1 ? <img src={data.profile.avatar1} alt="" /> : data.profile.name1.slice(0, 1)}</div><h1>{data.profile.name2} & {data.profile.name1}</h1><p>从 {formatShortDate(data.profile.startDate)} 开始，认真相爱。</p></header><div className="segment"><button className={tab === "story" ? "selected" : ""} onClick={() => setTab("story")}>我们的故事</button><button className={tab === "settings" ? "selected" : ""} onClick={() => setTab("settings")}>{canWrite ? "设置与备份" : "身份登录"}</button></div>{tab === "story" ? <><section className="love-stats"><div className="big-stat"><span>我们已经在一起</span><strong>{diffDays(data.profile.startDate)}</strong><small>天</small></div><div className="stat-grid"><div><span>✎</span><strong>{data.diaries.length}</strong><small>篇日记</small></div><div><span>▧</span><strong>{photoCount}</strong><small>张照片</small></div><div><span>♥</span><strong>{anniversaryCount}</strong><small>个特别日子</small></div><div><span>{mostMood.emoji}</span><strong>{mostMood.name}</strong><small>最常见心情</small></div></div></section><AnniversarySection data={data} canWrite={canWrite} commit={commit} /><CapsuleSection data={data} canWrite={canWrite} commit={commit} /></> : <Settings data={data} canWrite={canWrite} commit={commit} onLogin={onLogin} onLogout={onLogout} lockNow={lockNow} installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} />}</div>;
}

function AnniversarySection({ data, canWrite, commit }: { data: AppData; canWrite: boolean; commit: Commit }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Anniversary>({ id: crypto.randomUUID(), title: "", date: toDateInput(), calendar: "solar", emoji: "💗", description: "" });
  const rows = useMemo(() => sortAnniversaries(displayAnniversaries(data.anniversaries, data.profile.startDate)).map((item) => ({ item, days: anniversaryDaysUntil(item) })), [data.anniversaries, data.profile.startDate]);
  const nextDays = rows.find((row) => row.days >= 0)?.days;
  const add = async () => { if (!draft.title.trim()) return; if (await commit({ ...data, anniversaries: [...data.anniversaries, { ...draft, title: draft.title.trim() }] }, "重要的日子已经记住啦")) { setDraft({ id: crypto.randomUUID(), title: "", date: toDateInput(), calendar: "solar", emoji: "💗", description: "" }); setAdding(false); } };
  return <section className="anniversary-section"><div className="field-heading"><div><p className="eyebrow">MILESTONES</p><h2>我们的纪念日</h2><p>恋爱天数节点和节日会自动计算，不会改动日记数据。</p></div>{canWrite && <button onClick={() => setAdding(!adding)}>{adding ? "收起" : "＋ 添加"}</button>}</div>{canWrite && adding && <div className="inline-form"><div className="emoji-row">{["💗", "🎂", "🎄", "✈️", "🏠", "🌷"].map((emoji) => <button key={emoji} className={draft.emoji === emoji ? "selected" : ""} onClick={() => setDraft({ ...draft, emoji })}>{emoji}</button>)}</div><input placeholder="纪念日名称" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><label>公历日期<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></label><textarea placeholder="写一句关于这天的话（可选）" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /><button className="primary-button" onClick={() => void add()}>收进纪念册</button></div>}<div className="anniversary-list">{rows.map(({ item, days }) => <article key={item.id} className={item.automatic ? "automatic-anniversary" : undefined}><span>{item.emoji}</span><div><b>{item.title}{item.automatic && <span className="automatic-mark">{item.category === "holiday" ? "节日" : "节点"}</span>}</b><small>{anniversaryDateLabel(item)}{item.calendar === "lunar" ? " · 每年按农历提醒" : item.category === "milestone" ? " · 恋爱天数节点" : item.recurring ? " · 每年提醒" : item.date ? ` · 已珍藏 ${daysSince(item.date)} 天` : ""}</small>{item.description && <p>{item.description}</p>}</div><em className={days < 0 ? "completed" : undefined}>{days < 0 ? "已达成" : days === 0 ? "今天" : `${days}天后`}</em>{canWrite && !item.automatic && <button aria-label="删除纪念日" onClick={() => window.confirm(`删除“${item.title}”吗？`) && void commit({ ...data, anniversaries: data.anniversaries.filter((entry) => entry.id !== item.id) })}>×</button>}</article>)}</div>{typeof nextDays === "number" && <p className="next-note">最近的期待，还有 {nextDays} 天 ♡</p>}</section>;
}

function CapsuleSection({ data, canWrite, commit }: { data: AppData; canWrite: boolean; commit: Commit }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<TimeCapsule | null>(null);
  const begin = () => {
    if (adding) { setAdding(false); setDraft(null); return; }
    const now = Date.now();
    setDraft({ id: crypto.randomUUID(), title: "", content: "", openDate: toDateInput(new Date(now + 30 * 86_400_000)), createdAt: now });
    setAdding(true);
  };
  const add = async () => { if (!draft?.title.trim() || !draft.content.trim()) return; if (await commit({ ...data, capsules: [...data.capsules, draft] }, "写给未来的话已经封好")) { setAdding(false); setDraft(null); } };
  return <section className="capsule-section"><div className="field-heading"><div><p className="eyebrow">TIME CAPSULE</p><h2>写给未来的我们</h2><p>等约定的那天，再一起拆开。</p></div>{canWrite && <button onClick={begin}>{adding ? "收起" : "＋ 写一封"}</button>}</div>{canWrite && adding && draft && <div className="inline-form"><input placeholder="信的标题" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /><textarea placeholder="想对未来的我们说……" value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} /><label>开启日期<input type="date" value={draft.openDate} onChange={(event) => setDraft({ ...draft, openDate: event.target.value })} /></label><button className="primary-button" onClick={() => void add()}>封好这封信</button></div>}<div className="capsule-list">{data.capsules.length ? data.capsules.map((item) => { const locked = item.openDate > toDateInput(); return <article key={item.id} className={locked ? "locked" : "open"}><span>{locked ? "⌁" : "♡"}</span><div><b>{item.title}</b><small>{locked ? `${formatDate(item.openDate)} 开启` : "约定的日子到了"}</small><p>{locked ? "这封信还在替我们保守秘密……" : item.content}</p></div>{canWrite && <button onClick={() => window.confirm("要丢掉这封时间胶囊吗？") && void commit({ ...data, capsules: data.capsules.filter((capsule) => capsule.id !== item.id) })}>×</button>}</article>; }) : <p className="tiny-empty">还没有写给未来的信，慢慢来，我们还有很多以后。</p>}</div></section>;
}

type SettingsSection = "appearance" | "reading" | "security" | "device";

interface BackupMeta {
  at: number;
  diaries: number;
  photos: number;
  wishes: number;
  bytes: number;
}

function Settings({ data, canWrite, commit, onLogin, onLogout, lockNow, installPrompt, standalone, onInstall }: { data: AppData; canWrite: boolean; commit: Commit; onLogin: LoginHandler; onLogout: () => Promise<void>; lockNow: () => void; installPrompt: BeforeInstallPromptEvent | null; standalone: boolean; onInstall: () => Promise<void> }) {
  const demoMode = loveDiaryRepository.isDemoMode();
  const [profile, setProfile] = useState(structuredClone(data.profile));
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [pin, setPin] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupStatus, setBackupStatus] = useState("");
  const [settingsNow] = useState(() => Date.now());
  const [backupMeta, setBackupMeta] = useState<BackupMeta | null>(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(BACKUP_META_KEY) || "null") as BackupMeta | null;
      return parsed && typeof parsed.at === "number" ? parsed : null;
    } catch { return null; }
  });
  const restoreRef = useRef<HTMLInputElement>(null);
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
      const image = await loveDiaryRepository.uploadImage(file, `${key}-${crypto.randomUUID()}`);
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
    if (profile.lockEnabled && pin.length === 4) { const salt = crypto.randomUUID(); nextProfile = { ...nextProfile, pinSalt: salt, pinHash: await hashPin(pin, salt) }; }
    if (profile.lockEnabled && !nextProfile.pinHash) return window.alert("请先设置一个 4 位隐私密码");
    if (photoUploading) return window.alert("照片还在上传，请稍等一下。");
    const saved = await commit({ ...data, profile: nextProfile }, "设置已经保存", settingsRevision.current);
    if (saved) {
      pendingProfileImages.current.clear();
      settingsRevision.current = loveDiaryRepository.getRevision();
      setPin("");
    }
  };
  const exportData = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupStatus("正在整理数据和照片…");
    try {
      const blob = await createCompleteBackup(data, (done, total) => setBackupStatus(total ? `正在打包照片 ${done}/${total}` : "正在整理数据…"));
      const link = document.createElement("a");
      const owner = profile.currentUser === "person1" ? profile.name1 : profile.name2;
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = `${owner}的恋爱日记-完整备份-${toDateInput()}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      const nextMeta: BackupMeta = { at: Date.now(), diaries: data.diaries.length, photos: completeBackupMediaCount(data), wishes: data.wishes.length, bytes: blob.size };
      setBackupMeta(nextMeta);
      try { window.localStorage.setItem(BACKUP_META_KEY, JSON.stringify(nextMeta)); } catch { /* The download still succeeded. */ }
      setBackupStatus("完整备份已保存，里面包含数据和所有照片 ✓");
    } catch { setBackupStatus("备份没有完成，请检查网络后重试"); }
    finally { setBackupBusy(false); }
  };
  const restore = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || backupBusy) return;
    const uploaded: DiaryImage[] = [];
    setBackupBusy(true);
    setBackupStatus("正在检查备份文件…");
    try {
      if (file.name.toLowerCase().endsWith(".zip")) {
        const backup = await readCompleteBackup(file);
        if (!window.confirm(`完整备份中有 ${backup.data.diaries.length} 篇日记和 ${backup.media.length} 个照片文件。恢复会覆盖${demoMode ? "当前浏览器的演示数据" : "当前云端内容"}，确认继续吗？`)) { setBackupStatus(""); return; }
        const replacements = new Map<string, DiaryImage>();
        for (let index = 0; index < backup.media.length; index += 1) {
          setBackupStatus(`正在恢复照片 ${index + 1}/${backup.media.length}`);
          const media = backup.media[index];
          const image = await loveDiaryRepository.uploadImage(media.file);
          uploaded.push(image);
          replacements.set(media.url, image);
        }
        const restored = replaceBackupMedia(backup.data, replacements);
        setBackupStatus("照片恢复完成，正在恢复日记…");
        if (await commit(restored, "完整备份已经恢复 ♡")) {
          uploaded.length = 0;
          window.location.reload();
          return;
        }
        throw new Error("RESTORE_SAVE_FAILED");
      }
      const parsed: unknown = JSON.parse(await file.text());
      const normalized = normalizeBackup(parsed);
      if (!normalized) throw new Error("BACKUP_INVALID");
      if (!window.confirm(demoMode ? "恢复旧版 JSON 备份会覆盖当前浏览器的演示日记，确认继续吗？" : "恢复旧版 JSON 备份会覆盖现在的云端日记，照片仍使用原云端链接。确认继续吗？")) { setBackupStatus(""); return; }
      if (await commit(normalized, "回忆已经从备份里回来啦")) window.location.reload();
    } catch {
      await Promise.allSettled(uploaded.map((image) => loveDiaryRepository.deleteUploadedImage(image)));
      setBackupStatus(`恢复没有完成，当前${demoMode ? "演示数据" : "云端日记"}没有被覆盖`);
    } finally {
      setBackupBusy(false);
      event.target.value = "";
    }
  };
  if (!canWrite) return <section className="settings"><LoginSettingsCard profile={data.profile} onLogin={onLogin} demoMode={demoMode} /><div className="settings-group public-readonly"><p className="eyebrow">{demoMode ? "LOCAL DEMO" : "PUBLIC VIEW"}</p><h2>{demoMode ? "放心体验，不会上传云端" : "这里可以公开浏览"}</h2><p>{demoMode ? "你发布的日记和图片只保存在当前浏览器；其他访客看不到，也不会影响正式版数据。" : "日记和照片对访客开放阅读；输入任一位记录者的身份密码后，才会出现写入、修改和删除功能。"}</p></div><InstallSettingsCard installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} /></section>;
  return <section className="settings"><nav className="settings-sections" aria-label="设置分类">{([{ id: "appearance", icon: "♡", label: "身份外观" }, { id: "reading", icon: "Aa", label: "阅读体验" }, { id: "security", icon: "⌁", label: "数据安全" }, { id: "device", icon: "▣", label: "设备设置" }] as const).map((item) => <button type="button" key={item.id} className={section === item.id ? "selected" : ""} onClick={() => setSection(item.id)} aria-pressed={section === item.id}><span>{item.icon}</span><b>{item.label}</b></button>)}</nav>
    {section === "appearance" && <><WriterSessionCard profile={data.profile} onLogin={onLogin} onLogout={onLogout} demoMode={demoMode} /><div className="settings-group writer-style-settings"><p className="eyebrow">DIARY MARKS</p><h2>两个人的信笺标记</h2><p className="settings-copy">颜色和标记会同时出现在时间线、日历、日记详情与翻页书中。</p><div className="writer-style-list"><WriterStyleCard author={profile.name1} recipient={profile.name2} accent={profile.person1Accent} marker={profile.person1Marker} onAccent={(accent) => setProfile({ ...profile, person1Accent: accent })} onMarker={(marker) => setProfile({ ...profile, person1Marker: marker })} /><WriterStyleCard author={profile.name2} recipient={profile.name1} accent={profile.person2Accent} marker={profile.person2Marker} onAccent={(accent) => setProfile({ ...profile, person2Accent: accent })} onMarker={(marker) => setProfile({ ...profile, person2Marker: marker })} /></div></div><div className="settings-group"><p className="eyebrow">COUPLE PROFILE</p><h2>关于我们</h2><div className="avatar-settings"><ImagePicker label="恋人B头像" image={profile.avatar2} fallback={profile.name2.slice(0, 1)} onChange={(event) => void imageInput(event, "avatar2")} /><span>♡</span><ImagePicker label="恋人A头像" image={profile.avatar1} fallback={profile.name1.slice(0, 1)} onChange={(event) => void imageInput(event, "avatar1")} /></div><label>恋人B昵称<input value={profile.name2} onChange={(event) => setProfile({ ...profile, name2: event.target.value })} /></label><label>恋人A昵称<input value={profile.name1} onChange={(event) => setProfile({ ...profile, name1: event.target.value })} /></label><label>恋爱开始日期<input type="date" value={profile.startDate} onChange={(event) => setProfile({ ...profile, startDate: event.target.value })} /></label><label className="cover-upload">首页封面<input type="file" accept="image/*" onChange={(event) => void imageInput(event, "coverImage")} /><span>{profile.coverImage ? "重新选择封面照片" : "选择一张封面照片"}</span></label></div></>}
    {section === "reading" && <><div className="settings-group"><p className="eyebrow">READING EXPERIENCE</p><h2>阅读与页面效果</h2><label className="switch-row"><span><b>柔和动画</b><small>爱心、星光和页面过渡</small></span><input aria-label="开关柔和动画" type="checkbox" checked={profile.animations} onChange={(event) => setProfile({ ...profile, animations: event.target.checked })} /></label><div className="reading-setting-note"><span>♫</span><div><b>背景音乐</b><small>使用页面右下角的音乐按钮播放或暂停，选择会保存在这台设备。</small></div></div></div><div className="settings-group reading-guide"><p className="eyebrow">READING TIPS</p><h2>沉浸阅读</h2><p>时间线适合快速回顾；翻页日记本适合慢慢读完整内容；回忆回顾会每天翻出不同的一页。</p></div></>}
    {section === "security" && <>{demoMode ? <DemoResetCard /> : <CloudSnapshotsCard />}<RecycleBin data={data} commit={commit} demoMode={demoMode} /><div className="settings-group"><p className="eyebrow">COMPLETE BACKUP</p><h2>完整备份我们的回忆</h2><p className="settings-copy">生成一个 ZIP 备份包，包含全部日记、回应、纪念日、100件事、设置和照片；以后可以从这里完整恢复。</p><div className={`backup-health ${backupMeta && settingsNow - backupMeta.at <= 30 * 86_400_000 ? "healthy" : "needs-backup"}`}><span>{backupMeta ? "✓" : "!"}</span><div><b>{backupMeta ? `上次完整备份：${new Date(backupMeta.at).toLocaleString("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "这台设备还没有导出过完整备份"}</b><small>{backupMeta ? `${backupMeta.diaries} 篇日记 · ${backupMeta.photos} 个图片文件 · ${backupMeta.wishes} 件约定 · ${formatBytes(backupMeta.bytes)}` : "建议现在保存一份，以后换手机也能完整恢复。"}</small>{backupMeta && settingsNow - backupMeta.at > 30 * 86_400_000 && <em>已经超过 30 天，建议再备份一次。</em>}</div></div><div className="backup-actions"><button disabled={backupBusy} onClick={() => void exportData()}>{backupBusy ? "处理中…" : "⇩ 导出完整备份"}</button><button disabled={backupBusy} onClick={() => restoreRef.current?.click()}>⇧ 恢复备份</button></div>{backupStatus && <p className="backup-status" role="status">{backupStatus}</p>}<input ref={restoreRef} type="file" accept="application/zip,.zip,application/json,.json" hidden onChange={(event) => void restore(event)} />{data.seeded && <button className="clear-samples" onClick={async () => { if (!window.confirm("只会清除两篇示例日记，你自己的内容不会受影响。继续吗？")) return; setProfile(profile); const next = await loveDiaryRepository.clearSamples(data); await commit(next, "示例日记已经清除"); }}>清除示例数据</button>}</div></>}
    {section === "device" && <><InstallSettingsCard installPrompt={installPrompt} standalone={standalone} onInstall={onInstall} /><div className="settings-group"><p className="eyebrow">PRIVACY</p><h2>隐私锁</h2><label className="switch-row"><span><b>开启本地 PIN 锁</b><small>每次重新打开网页时验证</small></span><input aria-label="开关本地 PIN 锁" type="checkbox" checked={profile.lockEnabled} onChange={(event) => setProfile({ ...profile, lockEnabled: event.target.checked, ...(!event.target.checked ? { pinHash: undefined, pinSalt: undefined } : {}) })} /></label>{profile.lockEnabled && <label>设置新的 4 位密码<input className="pin-setting" inputMode="numeric" maxLength={4} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder={profile.pinHash ? "留空则保持原密码" : "请输入 4 位数字"} /></label>}{data.profile.lockEnabled && <button className="secondary-button" onClick={lockNow}>现在锁上日记</button>}</div></>}
    {section !== "security" && <button className="save-settings" disabled={photoUploading} onClick={() => void save()}>{photoUploading ? "照片上传中…" : "保存这一页设置"}</button>}
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
    if (loggingOut || !window.confirm("退出身份登录后会回到公开浏览模式，继续吗？")) return;
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

function CloudSnapshotsCard() {
  const [snapshots, setSnapshots] = useState<CloudSnapshotSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshots(await loveDiaryRepository.listSnapshots());
    } catch {
      setStatus("快照列表暂时没有读取成功");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const create = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("正在保存当前云端快照…");
    try {
      await loveDiaryRepository.createSnapshot();
      await load();
      setStatus("当前版本已经额外保存为快照 ✓");
    } catch {
      setStatus("这次快照没有保存成功，请检查网络后重试");
    } finally {
      setBusy(false);
    }
  };
  const restore = async (snapshot: CloudSnapshotSummary) => {
    if (busy || !window.confirm(`确定恢复到 ${new Date(snapshot.createdAt).toLocaleString("zh-CN")} 的版本吗？\n\n当时有 ${snapshot.diaries} 篇日记、${snapshot.photos} 张照片和 ${snapshot.wishes} 件约定。恢复前，当前版本也会先自动保存为快照。`)) return;
    setBusy(true);
    setStatus("正在恢复云端快照，请不要关闭页面…");
    try {
      await loveDiaryRepository.restoreSnapshot(snapshot.id);
      setStatus("快照已经恢复，正在刷新页面…");
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus(error instanceof Error && error.message === "CLOUD_CONFLICT" ? "云端刚有新修改，请刷新后再恢复" : "恢复没有完成，当前云端内容没有被覆盖");
      setBusy(false);
    }
  };
  return <div className="settings-group snapshot-panel"><header><div><p className="eyebrow">CLOUD SNAPSHOTS</p><h2>云端安全快照</h2></div><button type="button" disabled={busy} onClick={() => void create()}>{busy ? "处理中…" : "＋ 立即留一份"}</button></header><p className="settings-copy">每次保存日记前都会先保留旧版本，最多保存最近 50 版；误删或误改时可以一键回到从前。快照中的照片文件也会继续保留。</p>{loading ? <p className="snapshot-status">正在读取快照…</p> : snapshots.length ? <div className="snapshot-list">{snapshots.map((snapshot) => <article className="snapshot-card" key={snapshot.id}><div><b>{new Date(snapshot.createdAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · 第 {snapshot.revision} 版</b><small>{snapshot.diaries} 篇日记 · {snapshot.photos} 张照片 · {snapshot.wishes} 件约定</small></div><button type="button" disabled={busy} onClick={() => void restore(snapshot)}>恢复</button></article>)}</div> : <p className="snapshot-empty">还没有历史快照；点“立即留一份”即可保存当前版本。</p>}{status && <p className="snapshot-status" role="status">{status}</p>}</div>;
}

function InstallSettingsCard({ installPrompt, standalone, onInstall }: { installPrompt: BeforeInstallPromptEvent | null; standalone: boolean; onInstall: () => Promise<void> }) {
  if (standalone) return <div className="settings-group install-settings-card installed"><p className="eyebrow">APP ON THIS DEVICE</p><h2>已经装进手机桌面</h2><p>从桌面图标打开，就能全屏阅读这本恋爱日记。</p><span>✓ 已安装</span></div>;
  return <div className="settings-group install-settings-card"><p className="eyebrow">INSTALL APP</p><h2>把恋爱日记装进手机</h2><p>添加到主屏幕 · 全屏打开 · 弱网也能看最近内容</p><button type="button" onClick={() => void onInstall()}>{installPrompt ? "立即安装" : "查看安装方法"}</button></div>;
}

function RecycleBin({ data, commit, demoMode = false }: { data: AppData; commit: Commit; demoMode?: boolean }) {
  const restore = async (id: string) => {
    const item = data.trash.find((entry) => entry.id === id);
    if (!item) return;
    const diary = structuredClone(item.diary);
    await commit({ ...data, diaries: [diary, ...data.diaries.filter((entry) => entry.id !== diary.id)], trash: data.trash.filter((entry) => entry.id !== id) }, "日记已经从回收站恢复 ♡");
  };
  const removeForever = async (id: string) => {
    const item = data.trash.find((entry) => entry.id === id);
    if (!item || !window.confirm("永久删除后无法恢复，确定继续吗？")) return;
    const next: AppData = {
      ...data,
      trash: data.trash.filter((entry) => entry.id !== id),
      responses: data.responses.filter((entry) => entry.diaryId !== item.diary.id),
      diaryHistory: data.diaryHistory.filter((entry) => entry.diaryId !== item.diary.id),
      wishes: data.wishes.map((wish) => wish.diaryId === item.diary.id ? { ...wish, diaryId: undefined } : wish),
    };
    const referencedUrls = new Set([
      ...next.diaries.flatMap((entry) => entry.images.map((image) => image.url)),
      ...next.trash.flatMap((entry) => entry.diary.images.map((image) => image.url)),
      ...next.diaryHistory.flatMap((entry) => entry.diary.images.map((image) => image.url)),
      ...next.wishes.flatMap((wish) => wish.completionImage ? [wish.completionImage.url] : []),
      ...[next.profile.avatar1, next.profile.avatar2, next.profile.coverImage].filter((value): value is string => Boolean(value)),
    ]);
    const saved = await commit(next, "这篇日记已经永久删除");
    if (saved) void Promise.allSettled(item.diary.images.filter((image) => !referencedUrls.has(image.url)).map((image) => loveDiaryRepository.deleteUploadedImage(image)));
  };
  return <div className="settings-group recycle-bin"><p className="eyebrow">RECYCLE BIN</p><div className="recycle-title"><h2>日记回收站</h2><span>{data.trash.length}</span></div><p className="settings-copy">删除的日记先收在{demoMode ? "当前浏览器" : "云端"}这里，不会立刻消失；只有手动永久删除才会清理。</p>{data.trash.length ? <div className="recycle-list">{data.trash.map((item) => <article key={item.id}><div><b>{formatShortDate(item.diary.date)}</b><p>{diaryExcerpt(item.diary.content, 48)}</p><small>{new Date(item.deletedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 移入</small></div><div><button type="button" onClick={() => void restore(item.id)}>恢复</button><button type="button" className="danger-button" onClick={() => void removeForever(item.id)}>永久删除</button></div></article>)}</div> : <div className="recycle-empty">♡ 回收站是空的</div>}</div>;
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
  const items: Array<{ view: AppRoute["view"]; label: string }> = [{ view: "home", label: "首页" }, { view: "calendar", label: "日历" }, ...(canWrite ? [{ view: "editor" as const, label: "记录" }] : []), { view: "gallery", label: "相册" }, { view: "us", label: "我们" }];
  return <nav className="bottom-nav" style={{ "--nav-count": items.length } as CSSProperties} aria-label="主导航">{items.map((item) => <button key={item.view} className={`${active === item.view ? "active" : ""} ${item.view === "editor" ? "add-nav" : ""}`} onClick={() => navigate({ view: item.view })}><span className="nav-icon-wrap"><NavIcon view={item.view} /></span><small>{item.label}</small></button>)}</nav>;
}

function NavIcon({ view }: { view: AppRoute["view"] }) {
  if (view === "home") return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 10.7 12 3.8l8.5 6.9v8.5a1.3 1.3 0 0 1-1.3 1.3H4.8a1.3 1.3 0 0 1-1.3-1.3z" /><path d="M9.2 20.5v-6h5.6v6M9.1 9.1c.7-1.2 2.3-1.1 2.9.1.6-1.2 2.2-1.3 2.9-.1.9 1.7-1 3.1-2.9 4.3-1.9-1.2-3.8-2.6-2.9-4.3Z" /></svg>;
  if (view === "calendar") return <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M7.5 3.5v3M16.5 3.5v3M3.5 9.2h17" /><path d="M9.2 13.4c.6-1 2-1 2.5 0 .6-1 2-1 2.6 0 .8 1.5-.9 2.7-2.6 3.8-1.7-1.1-3.3-2.3-2.5-3.8Z" /></svg>;
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

function ImageViewer({ viewer, sourceDiary, sourceWish, setViewer, onOpenDiary, onOpenWish }: { viewer: { images: DiaryImage[]; index: number; title: string }; sourceDiary?: Diary; sourceWish?: WishItem; setViewer: (value: { images: DiaryImage[]; index: number; title: string } | null) => void; onOpenDiary: (id: string) => void; onOpenWish: (id: string) => void }) {
  const touch = useRef(0);
  const move = (direction: -1 | 1) => setViewer({ ...viewer, index: (viewer.index + direction + viewer.images.length) % viewer.images.length });
  const image = viewer.images[viewer.index];
  return <div className="image-viewer has-actions" role="dialog" aria-modal="true" aria-label="照片浏览"><header><div><b>{sourceWish ? `100件事 · ${sourceWish.title}` : viewer.title}</b><small>{viewer.index + 1} / {viewer.images.length}</small></div><button onClick={() => setViewer(null)} aria-label="关闭大图">×</button></header><button className="viewer-side left" onClick={() => move(-1)} aria-label="上一张">‹</button><button type="button" className="viewer-canvas" aria-label="关闭大图" onTouchStart={(event) => { touch.current = event.touches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }} onClick={() => setViewer(null)}><img src={image.url} alt={`大图 ${viewer.index + 1}`} decoding="async" /></button><button className="viewer-side right" onClick={() => move(1)} aria-label="下一张">›</button><footer className="viewer-source-actions">{sourceDiary && <button type="button" onClick={() => onOpenDiary(sourceDiary.id)}>查看来源日记</button>}{sourceWish && <button type="button" onClick={() => onOpenWish(sourceWish.id)}>查看100件事</button>}<a href={photoDownloadUrl(image.url)} download={image.name || "我们的照片"}>保存照片</a></footer></div>;
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
