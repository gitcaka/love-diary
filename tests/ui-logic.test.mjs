import assert from "node:assert/strict";
import test from "node:test";
import { bookPageTarget, sortBookDiaries } from "../lib/book.ts";
import { createSeedData, normalizeBackup } from "../lib/data.ts";
import { appendDiaryHistory, filterDiaries } from "../lib/diary-memory.ts";
import { DEFAULT_WRITER_APPEARANCE, diaryAppearance, normalizeAccent, normalizeMarker } from "../lib/diary-style.ts";
import { createDraftSnapshot, diaryDraftKey, restoreDiaryDraft } from "../lib/draft.ts";
import { createCompleteBackup, readCompleteBackup } from "../lib/full-backup.ts";
import { compressedImageName, fitImageInside } from "../lib/image-compression.ts";
import { buildMemoryReview } from "../lib/review.ts";
import { availableReportMonths, buildMonthlyReport, reportMonthLabel } from "../lib/monthly-report.ts";
import { applyTextColor, remapTextMarks, textSegments, trimTextAndMarks } from "../lib/rich-text.ts";

const noFilters = { query: "", author: "all", month: "all", tag: "all", hasPhotos: false, favoritesOnly: false };

test("mobile uploads keep proportions and use a compact image filename", () => {
  assert.deepEqual(fitImageInside(4032, 3024), { width: 1920, height: 1440 });
  assert.deepEqual(fitImageInside(3024, 4032), { width: 1440, height: 1920 });
  assert.deepEqual(fitImageInside(1280, 720), { width: 1280, height: 720 });
  assert.equal(compressedImageName("七夕合照.JPG"), "七夕合照.webp");
  assert.equal(compressedImageName("photo", "image/jpeg"), "photo.jpg");
});

test("book pages stop at the first and last diary", () => {
  assert.equal(bookPageTarget(0, "previous", 0), null);
  assert.equal(bookPageTarget(0, "previous", 3), null);
  assert.equal(bookPageTarget(0, "next", 3), 1);
  assert.equal(bookPageTarget(1, "previous", 3), 0);
  assert.equal(bookPageTarget(2, "next", 3), null);
});

test("book order can switch without changing diary records", () => {
  const diaries = createSeedData().diaries;
  const originalIds = diaries.map((diary) => diary.id);
  assert.deepEqual(sortBookDiaries(diaries, "newest").map((diary) => diary.id), ["seed-walk", "seed-cake"]);
  assert.deepEqual(sortBookDiaries(diaries, "oldest").map((diary) => diary.id), ["seed-cake", "seed-walk"]);
  assert.deepEqual(diaries.map((diary) => diary.id), originalIds);
});

test("writer appearances stay different and invalid settings fall back safely", () => {
  const data = createSeedData();
  assert.deepEqual(diaryAppearance("person1", data.profile), DEFAULT_WRITER_APPEARANCE.person1);
  assert.deepEqual(diaryAppearance("person2", data.profile), DEFAULT_WRITER_APPEARANCE.person2);
  assert.equal(normalizeAccent("not-a-color", DEFAULT_WRITER_APPEARANCE.person1.accent), DEFAULT_WRITER_APPEARANCE.person1.accent);
  assert.equal(normalizeMarker("", DEFAULT_WRITER_APPEARANCE.person2.marker), DEFAULT_WRITER_APPEARANCE.person2.marker);
});

test("old version 6 data receives writer styles without losing a diary", () => {
  const legacy = createSeedData();
  const before = legacy.diaries.map(({ id, content, images }) => ({ id, content, images: structuredClone(images) }));
  delete legacy.profile.person1Accent;
  delete legacy.profile.person2Accent;
  delete legacy.profile.person1Marker;
  delete legacy.profile.person2Marker;
  delete legacy.responses;
  delete legacy.trash;
  delete legacy.diaryHistory;
  delete legacy.diaries[0].favorite;
  delete legacy.diaries[0].tags;

  const normalized = normalizeBackup(legacy);
  assert.ok(normalized);
  assert.equal(normalized.version, 6);
  assert.deepEqual(normalized.diaries.map(({ id, content, images }) => ({ id, content, images })), before);
  assert.equal(normalized.profile.person1Accent, DEFAULT_WRITER_APPEARANCE.person1.accent);
  assert.equal(normalized.profile.person2Accent, DEFAULT_WRITER_APPEARANCE.person2.accent);
  assert.equal(normalized.profile.person1Marker, DEFAULT_WRITER_APPEARANCE.person1.marker);
  assert.equal(normalized.profile.person2Marker, DEFAULT_WRITER_APPEARANCE.person2.marker);
  assert.deepEqual(normalized.responses, []);
  assert.deepEqual(normalized.trash, []);
  assert.deepEqual(normalized.diaryHistory, []);
  assert.equal(normalized.diaries[0].favorite, true);
  assert.deepEqual(normalized.diaries[0].tags, []);
});

test("old version 6 data receives an empty shared wish list without changing diaries", () => {
  const legacy = structuredClone(createSeedData());
  delete legacy.wishes;
  const normalized = normalizeBackup(legacy);
  assert.ok(normalized);
  assert.deepEqual(normalized.wishes, []);
  assert.deepEqual(normalized.diaries.map((diary) => diary.id), legacy.diaries.map((diary) => diary.id));
});

test("complete backup keeps wish completion notes and photos", async () => {
  const source = createSeedData();
  source.wishes = [{ id: "wish-1", title: "一起看海", category: "travel", createdBy: "person2", createdAt: 1, completed: true, completedAt: 2, completionNote: "风很大，但我们笑得很开心。", completionImage: { id: "wish-photo", name: "海边.png", url: "data:image/png;base64,iVBORw0KGgo=" } }];
  const blob = await createCompleteBackup(source);
  const restored = await readCompleteBackup(new File([blob], "backup.zip", { type: "application/zip" }));
  assert.equal(restored.data.wishes[0].title, "一起看海");
  assert.equal(restored.data.wishes[0].completionNote, "风很大，但我们笑得很开心。");
  assert.equal(restored.data.wishes[0].completionImage?.id, "wish-photo");
  assert.equal(restored.data.diaries.length, source.diaries.length);
  assert.equal(restored.media.length, 1);
});

test("wish and diary links survive normalization and a complete backup", async () => {
  const source = createSeedData();
  source.wishes = [{ id: "wish-linked", title: "一起看日落", category: "date", createdBy: "person1", createdAt: 1, completed: false, diaryId: source.diaries[0].id }];
  const normalized = normalizeBackup(structuredClone(source));
  assert.equal(normalized?.wishes[0].diaryId, source.diaries[0].id);

  const blob = await createCompleteBackup(source);
  const restored = await readCompleteBackup(new File([blob], "backup.zip", { type: "application/zip" }));
  assert.equal(restored.data.wishes[0].diaryId, source.diaries[0].id);
  assert.equal(restored.data.wishes[0].completed, false);
});

test("diary search combines words, writer, month, photos and special flags", () => {
  const diaries = createSeedData().diaries;
  assert.equal(filterDiaries(diaries, { ...noFilters, query: "散步" }).length, 1);
  assert.equal(filterDiaries(diaries, { ...noFilters, author: "person2", month: "2025-02" }).length, 1);
  assert.equal(filterDiaries(diaries, { ...noFilters, hasPhotos: true }).length, 0);
  assert.deepEqual(filterDiaries(diaries, { ...noFilters, favoritesOnly: true }).map((diary) => diary.id), ["seed-walk"]);
});

test("favorites and tags can be searched and filtered", () => {
  const diaries = createSeedData().diaries.map((diary, index) => index === 0 ? { ...diary, favorite: true, tags: ["约会", "散步"] } : diary);
  assert.deepEqual(filterDiaries(diaries, { ...noFilters, favoritesOnly: true }).map((diary) => diary.id), ["seed-walk"]);
  assert.deepEqual(filterDiaries(diaries, { ...noFilters, tag: "约会" }).map((diary) => diary.id), ["seed-walk"]);
  assert.deepEqual(filterDiaries(diaries, { ...noFilters, query: "散步" }).map((diary) => diary.id), ["seed-walk"]);
});

test("history keeps only eight immutable versions per diary", () => {
  const diary = createSeedData().diaries[0];
  let history = [];
  for (let index = 0; index < 10; index += 1) history = appendDiaryHistory(history, { ...diary, content: `version-${index}` }, index + 1);
  assert.equal(history.length, 8);
  assert.equal(history[0].diary.content, "version-9");
  diary.content = "changed later";
  assert.equal(history.at(-1).diary.content, "version-2");
});

test("local draft restores text choices but never replaces cloud photos", () => {
  const base = createSeedData().diaries[0];
  const draftSource = { ...base, content: "还没写完", images: [{ id: "local", url: "data:image/png;base64,AA" }] };
  const snapshot = createDraftSnapshot(draftSource, base.updatedAt, base.updatedAt + 1000);
  const restored = restoreDiaryDraft(base, snapshot);
  assert.ok(restored);
  assert.equal(restored.content, "还没写完");
  assert.deepEqual(restored.images, base.images);
  assert.equal(diaryDraftKey(undefined, "person2"), "love-diary:draft:new-person2");
});

test("selected diary words can be colored without changing plain text", () => {
  const content = "今天又是想你的一天";
  const marks = applyTextColor([], 4, 6, "#d96f92", content.length);
  assert.deepEqual(marks, [{ start: 4, end: 6, color: "#d96f92" }]);
  assert.deepEqual(textSegments(content, marks), [
    { text: "今天又是" },
    { text: "想你", color: "#d96f92" },
    { text: "的一天" },
  ]);
  assert.equal(textSegments(content, marks).map((segment) => segment.text).join(""), content);
});

test("text colors follow edits and trimming safely", () => {
  const oldContent = "今天又是想你的一天";
  const marks = [{ start: 4, end: 6, color: "#d96f92" }];
  const inserted = "今天又是很想你的一天";
  assert.deepEqual(remapTextMarks(oldContent, inserted, marks), [{ start: 5, end: 7, color: "#d96f92" }]);
  assert.deepEqual(trimTextAndMarks(`  ${oldContent}  `, [{ start: 6, end: 8, color: "#d96f92" }]), { content: oldContent, textMarks: marks });
});

test("old version 6 diaries remain valid without color ranges", () => {
  const legacy = createSeedData();
  legacy.diaries.forEach((diary) => delete diary.textMarks);
  const normalized = normalizeBackup(legacy);
  assert.ok(normalized);
  assert.deepEqual(normalized.diaries.map((diary) => diary.textMarks), [[], []]);
});

test("memory review is derived without changing diary order", () => {
  const diaries = createSeedData().diaries;
  const before = diaries.map((diary) => diary.id);
  const review = buildMemoryReview(diaries, "2025-03-14");
  assert.equal(review.monthAgo?.id, "seed-walk");
  assert.equal(review.first?.id, "seed-cake");
  assert.ok(review.random);
  assert.deepEqual(diaries.map((diary) => diary.id), before);
});

test("monthly report derives counts and highlights without changing diaries", () => {
  const diaries = createSeedData().diaries.map((diary, index) => ({
    ...diary,
    favorite: index === 0,
    tags: index === 0 ? ["日常", "散步"] : ["日常"],
    images: index === 0 ? [{ id: "photo", url: "/photo.jpg" }] : [],
  }));
  const before = structuredClone(diaries);
  const report = buildMonthlyReport(diaries, "2025-02");
  assert.equal(report.diaryCount, 2);
  assert.equal(report.photoCount, 1);
  assert.equal(report.favoriteCount, 1);
  assert.deepEqual(report.authorCounts, { person1: 1, person2: 1 });
  assert.equal(report.leadingAuthor, "tie");
  assert.deepEqual(report.topTags, [{ tag: "日常", count: 2 }, { tag: "散步", count: 1 }]);
  assert.equal(report.first?.id, "seed-cake");
  assert.equal(report.highlight?.id, "seed-walk");
  assert.equal(report.photos.length, 1);
  assert.ok(report.random);
  assert.deepEqual(diaries, before);
  assert.deepEqual(availableReportMonths(diaries), ["2025-02"]);
  assert.equal(reportMonthLabel("2025-02"), "2025年2月");
});
