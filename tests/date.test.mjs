import assert from "node:assert/strict";
import test from "node:test";
import { createAutomaticAnniversaries, relationshipMilestoneDate } from "../lib/anniversaries.ts";
import { anniversaryDateLabel, anniversaryDaysUntil, daysSince, diffDays, nextAnniversary, nextLunarOccurrence } from "../lib/date.ts";
import { nextTimelineCount } from "../lib/timeline.ts";

test("counts relationship days inclusively", () => {
  assert.equal(diffDays("2025-01-01", "2025-02-20"), 51);
  assert.equal(daysSince("2025-01-01", "2025-02-20"), 50);
  assert.equal(anniversaryDaysUntil({ date: "2025-01-01", calendar: "solar" }, "2024-12-31"), 1);
});

test("keeps anniversaries on the lunar calendar", () => {
  const lunarNewYear = { calendar: "lunar", lunarMonth: 1, lunarDay: 1 };
  const midAutumn = { calendar: "lunar", lunarMonth: 8, lunarDay: 15 };
  assert.equal(anniversaryDateLabel(lunarNewYear), "农历正月初一");
  assert.equal(anniversaryDateLabel(midAutumn), "农历八月十五");
  assert.equal(nextLunarOccurrence(1, 1, "2025-01-01"), "2025-01-29");
  assert.equal(anniversaryDaysUntil(lunarNewYear, "2025-01-01"), 28);
});

test("derives relationship milestones without changing stored diary data", () => {
  assert.equal(relationshipMilestoneDate("2025-01-01", 100), "2025-04-10");
  assert.equal(relationshipMilestoneDate("2025-01-01", 200), "2025-07-19");
  assert.equal(relationshipMilestoneDate("2025-01-01", 365), "2025-12-31");
  const automatic = createAutomaticAnniversaries("2025-01-01");
  assert.deepEqual(automatic.filter((item) => item.category === "milestone").map((item) => item.id), ["auto-milestone-100", "auto-milestone-200", "auto-milestone-365"]);
  assert.equal(automatic.some((item) => item.id === "auto-milestone-500" || item.id === "auto-milestone-520" || item.id === "auto-milestone-777" || item.id === "auto-milestone-1000"), false);
  assert.ok(automatic.some((item) => item.id === "auto-milestone-100" && item.recurring === false));
  assert.ok(automatic.some((item) => item.id === "auto-holiday-qixi" && item.lunarMonth === 7 && item.lunarDay === 7));
});

test("does not recycle completed one-off milestones into next year", () => {
  const completed = { date: "2025-04-10", calendar: "solar", recurring: false };
  const future = { date: "2025-04-20", calendar: "solar", recurring: false };
  assert.equal(anniversaryDaysUntil(completed, "2025-04-11"), -1);
  assert.equal(nextAnniversary([completed, future], "2025-04-11"), 9);
  assert.equal(nextLunarOccurrence(7, 7, "2025-01-01"), "2025-08-29");
});

test("loads the complete timeline in stable batches", () => {
  assert.equal(nextTimelineCount(8, 21), 16);
  assert.equal(nextTimelineCount(16, 21), 21);
  assert.equal(nextTimelineCount(21, 21), 21);
});
