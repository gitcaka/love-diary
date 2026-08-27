const DAY = 86_400_000;

function calendarDayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY);
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function toDateInput(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDate(value: string, withWeek = false): string {
  const date = parseLocalDate(value);
  const core = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  return withWeek ? `${core} ${new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date)}` : core;
}

export function formatShortDate(value: string): string {
  return value.replaceAll("-", ".");
}

export function diffDays(from: string, to = toDateInput()): number {
  return Math.max(0, calendarDayNumber(to) - calendarDayNumber(from) + 1);
}

export function daysSince(value: string, from = toDateInput()): number {
  return Math.max(0, calendarDayNumber(from) - calendarDayNumber(value));
}

export function daysUntilNext(value: string, from = toDateInput()): number {
  const source = parseLocalDate(value);
  const today = parseLocalDate(from);
  let next = new Date(today.getFullYear(), source.getMonth(), source.getDate(), 12);
  if (next < today) next = new Date(today.getFullYear() + 1, source.getMonth(), source.getDate(), 12);
  return calendarDayNumber(toDateInput(next)) - calendarDayNumber(from);
}

interface AnniversaryDate {
  date?: string;
  calendar?: "solar" | "lunar";
  lunarMonth?: number;
  lunarDay?: number;
  recurring?: boolean;
}

const lunarFormatter = new Intl.DateTimeFormat("en-u-ca-chinese", {
  month: "numeric",
  day: "numeric",
});

function lunarParts(date: Date): { month: number; day: number; leap: boolean } {
  const parts = lunarFormatter.formatToParts(date);
  const monthText = parts.find((part) => part.type === "month")?.value ?? "0";
  const dayText = parts.find((part) => part.type === "day")?.value ?? "0";
  return { month: Number.parseInt(monthText, 10), day: Number.parseInt(dayText, 10), leap: /bis|leap/i.test(monthText) };
}

export function nextLunarOccurrence(month: number, day: number, from = toDateInput()): string {
  if (lunarFormatter.resolvedOptions().calendar !== "chinese") {
    throw new Error("This browser does not support the Chinese lunar calendar");
  }
  const start = parseLocalDate(from);
  for (let offset = 0; offset <= 800; offset += 1) {
    const candidate = new Date(start);
    candidate.setDate(start.getDate() + offset);
    const lunar = lunarParts(candidate);
    if (!lunar.leap && lunar.month === month && lunar.day === day) return toDateInput(candidate);
  }
  throw new Error(`No matching lunar date found for month ${month}, day ${day}`);
}

export function anniversaryDaysUntil(item: AnniversaryDate, from = toDateInput()): number {
  if (item.calendar === "lunar" && item.lunarMonth && item.lunarDay) {
    const occurrence = nextLunarOccurrence(item.lunarMonth, item.lunarDay, from);
    return Math.max(0, calendarDayNumber(occurrence) - calendarDayNumber(from));
  }
  if (item.recurring === false && item.date) {
    return calendarDayNumber(item.date) - calendarDayNumber(from);
  }
  return item.date ? daysUntilNext(item.date, from) : 0;
}

const lunarMonthNames = ["", "正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const lunarDigitNames = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

function lunarDayName(day: number): string {
  if (day <= 10) return `初${lunarDigitNames[day]}`;
  if (day < 20) return `十${lunarDigitNames[day - 10]}`;
  if (day === 20) return "二十";
  if (day < 30) return `廿${lunarDigitNames[day - 20]}`;
  return "三十";
}

export function anniversaryDateLabel(item: AnniversaryDate): string {
  if (item.calendar === "lunar" && item.lunarMonth && item.lunarDay) {
    return `农历${lunarMonthNames[item.lunarMonth]}月${lunarDayName(item.lunarDay)}`;
  }
  if (item.recurring === true && item.date) {
    const [, month, day] = item.date.split("-").map(Number);
    return `每年${month}月${day}日`;
  }
  return item.date ? formatShortDate(item.date) : "日期待定";
}

export function monthTitle(cursor: Date): string {
  return `${cursor.getFullYear()}年 ${cursor.getMonth() + 1}月`;
}

export function calendarCells(cursor: Date): Array<{ date: string; day: number; current: boolean }> {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date: toDateInput(date), day: date.getDate(), current: date.getMonth() === cursor.getMonth() };
  });
}

export function nextAnniversary(anniversaries: AnniversaryDate[], from = toDateInput()): number {
  if (!anniversaries.length) return 0;
  const upcoming = anniversaries.map((item) => anniversaryDaysUntil(item, from)).filter((days) => days >= 0);
  return upcoming.length ? Math.min(...upcoming) : 0;
}
