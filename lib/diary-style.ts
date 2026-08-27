import type { CoupleProfile, DiaryAuthor } from "./types.ts";

export const WRITER_MARKERS = ["♥", "✦", "🌷", "☾", "🍓", "🐰", "∞", "♡"] as const;

export const DEFAULT_WRITER_APPEARANCE = {
  person1: { accent: "#c87891", marker: "♥" },
  person2: { accent: "#8f7bb5", marker: "✦" },
} as const;

export function normalizeAccent(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeMarker(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const marker = Array.from(value.trim()).slice(0, 2).join("");
  return marker || fallback;
}

export function diaryAppearance(author: DiaryAuthor, profile: CoupleProfile): { accent: string; marker: string } {
  return author === "person2"
    ? { accent: profile.person2Accent, marker: profile.person2Marker }
    : { accent: profile.person1Accent, marker: profile.person1Marker };
}
