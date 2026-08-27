import type { Diary } from "./types.ts";

export type BookDirection = "previous" | "next";
export type BookOrder = "newest" | "oldest";

export function bookPageTarget(current: number, direction: BookDirection, total: number): number | null {
  if (total <= 0) return null;
  const target = current + (direction === "next" ? 1 : -1);
  return target >= 0 && target < total ? target : null;
}

export function sortBookDiaries(diaries: Diary[], order: BookOrder): Diary[] {
  return [...diaries].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    const timeOrder = a.updatedAt - b.updatedAt;
    return order === "oldest" ? dateOrder || timeOrder : -dateOrder || -timeOrder;
  });
}
