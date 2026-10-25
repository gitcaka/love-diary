import { anniversaryDaysUntil, parseLocalDate, toDateInput } from "./date.ts";
import type { Anniversary } from "./types.ts";

const milestoneDays = [100, 200, 365] as const;

const holidays: Anniversary[] = [
  { id: "auto-holiday-new-year", title: "元旦", date: "2000-01-01", calendar: "solar", recurring: true, automatic: true, category: "holiday", emoji: "🎆", description: "新的一年，也继续一起写我们的故事。" },
  { id: "auto-holiday-spring-festival", title: "春节", calendar: "lunar", lunarMonth: 1, lunarDay: 1, recurring: true, automatic: true, category: "holiday", emoji: "🧧", description: "一起迎接热热闹闹的新年。" },
  { id: "auto-holiday-valentine", title: "情人节", date: "2000-02-14", calendar: "solar", recurring: true, automatic: true, category: "holiday", emoji: "💝", description: "把喜欢认真说给彼此听。" },
  { id: "auto-holiday-520", title: "520", date: "2000-05-20", calendar: "solar", recurring: true, automatic: true, category: "holiday", emoji: "💌", description: "普通的一天，也可以郑重地说爱你。" },
  { id: "auto-holiday-qixi", title: "七夕", calendar: "lunar", lunarMonth: 7, lunarDay: 7, recurring: true, automatic: true, category: "holiday", emoji: "🌌", description: "属于我们的中式浪漫。" },
  { id: "auto-holiday-mid-autumn", title: "中秋节", calendar: "lunar", lunarMonth: 8, lunarDay: 15, recurring: true, automatic: true, category: "holiday", emoji: "🥮", description: "月亮圆圆，也要和喜欢的人团圆。" },
  { id: "auto-holiday-national-day", title: "国庆节", date: "2000-10-01", calendar: "solar", recurring: true, automatic: true, category: "holiday", emoji: "🎈", description: "给相爱留一段可以一起出发的假期。" },
  { id: "auto-holiday-christmas", title: "圣诞节", date: "2000-12-25", calendar: "solar", recurring: true, automatic: true, category: "holiday", emoji: "🎄", description: "交换礼物，也交换一整年的温柔。" },
];

export function relationshipMilestoneDate(startDate: string, dayNumber: number): string {
  const date = parseLocalDate(startDate);
  date.setDate(date.getDate() + Math.max(1, dayNumber) - 1);
  return toDateInput(date);
}

export function createAutomaticAnniversaries(startDate: string): Anniversary[] {
  const milestones = milestoneDays.map((dayNumber) => ({
    id: `auto-milestone-${dayNumber}`,
    title: `在一起 ${dayNumber} 天`,
    date: relationshipMilestoneDate(startDate, dayNumber),
    calendar: "solar" as const,
    recurring: false,
    automatic: true,
    category: "milestone" as const,
    emoji: dayNumber === 365 ? "💎" : "💗",
    description: `我们的第 ${dayNumber} 天，值得好好纪念。`,
  }));
  return [...milestones, ...holidays.map((item) => ({ ...item }))];
}

export function displayAnniversaries(stored: Anniversary[], startDate: string): Anniversary[] {
  const storedIds = new Set(stored.map((item) => item.id));
  return [...stored, ...createAutomaticAnniversaries(startDate).filter((item) => !storedIds.has(item.id))];
}

export function sortAnniversaries(items: Anniversary[], from = toDateInput()): Anniversary[] {
  return items.map((item) => ({ item, days: anniversaryDaysUntil(item, from) })).sort((left, right) => {
    const leftDays = left.days;
    const rightDays = right.days;
    const leftPast = leftDays < 0;
    const rightPast = rightDays < 0;
    if (leftPast !== rightPast) return leftPast ? 1 : -1;
    return leftPast ? rightDays - leftDays : leftDays - rightDays;
  }).map(({ item }) => item);
}

export function nextUpcomingAnniversary(items: Anniversary[], from = toDateInput()): Anniversary | undefined {
  return sortAnniversaries(items, from).find((item) => anniversaryDaysUntil(item, from) >= 0);
}

// Presentation only: keep stored dates, descriptions and automatic rules intact.
export function anniversaryPresentation(items: Anniversary[], from = toDateInput()) {
  const rows = sortAnniversaries(items, from).map((item) => ({ item, days: anniversaryDaysUntil(item, from) }));
  const upcoming = rows.filter((row) => row.days >= 0);
  return { featured: upcoming[0], remaining: upcoming.slice(1), past: rows.filter((row) => row.days < 0) };
}
