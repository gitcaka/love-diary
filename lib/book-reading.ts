import type { BookOrder, BookTextPage } from "./book.ts";
import type { DiaryAuthor } from "./types.ts";

export type BookReader = DiaryAuthor | "guest";
export type BookAnchor = { kind: "photo" | "text"; offset: number };
export type BookReading = BookAnchor & { diaryId: string; order: BookOrder };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const legacyOrder = "love-diary:book-order", legacyPage = "love-diary:book-page";
const key = (reader: BookReader) => "love-diary:book-reading:v1:" + reader;
const empty = (): BookReading => ({ diaryId: "", order: "newest", kind: "photo", offset: 0 });

// Non-demo data can only reach the book after the state endpoint verifies an identity;
// in particular a read-only local snapshot verifies the reader without enabling writes.
// Demo data can render from cache before the UI's canWrite state has refreshed.
export function bookReaderScope(identity: DiaryAuthor, isDemo: boolean, sessionAuthorized: boolean): BookReader {
  return isDemo && !sessionAuthorized ? "guest" : identity;
}

// A photo anchor doubles as "first page": if the photo no longer exists, read from the start.
export function readBookReading(store: Store | null, reader: BookReader) {
  try {
    const raw = store?.getItem(key(reader));
    if (raw) {
      const value: Partial<BookReading> | null = JSON.parse(raw);
      if (value && typeof value.diaryId === "string" && value.diaryId && (value.order === "newest" || value.order === "oldest") &&
        (value.kind === "photo" || value.kind === "text") && typeof value.offset === "number" && Number.isSafeInteger(value.offset) && value.offset >= 0) {
        return { reading: { diaryId: value.diaryId, order: value.order, kind: value.kind, offset: value.offset } as BookReading, legacy: false };
      }
    } else if (store && reader !== "guest") {
      const diaryId = store.getItem(legacyPage), order = store.getItem(legacyOrder);
      if (diaryId || order) return { reading: { ...empty(), diaryId: diaryId || "", order: order === "oldest" ? "oldest" as const : "newest" as const }, legacy: true };
    }
  } catch { /* Invalid local data or storage disabled: use a fresh opening page. */ }
  return { reading: empty(), legacy: false };
}

export function writeBookReading(store: Store | null, reader: BookReader, position: BookReading, migrateLegacy = false) {
  if (!store || !position.diaryId) return false;
  try {
    const { diaryId, order, kind, offset } = position;
    store.setItem(key(reader), JSON.stringify({ diaryId, order, kind, offset }));
    if (migrateLegacy && reader !== "guest") { store.removeItem(legacyPage); store.removeItem(legacyOrder); }
    return true;
  } catch { return false; }
}

export function bookPartForAnchor(anchor: BookAnchor, pages: BookTextPage[], hasPhoto: boolean): number {
  if ((anchor.kind === "photo" && hasPhoto) || !pages.length) return 0;
  const offset = anchor.kind === "text" ? anchor.offset : 0;
  const index = pages.findIndex(page => page.end > offset);
  return Number(hasPhoto) + (index < 0 ? pages.length - 1 : index);
}

export function bookAnchorForPart(part: number, pages: BookTextPage[], hasPhoto: boolean): BookAnchor {
  if (hasPhoto && part === 0) return { kind: "photo", offset: 0 };
  return { kind: "text", offset: pages[part - Number(hasPhoto)]?.start ?? 0 };
}
