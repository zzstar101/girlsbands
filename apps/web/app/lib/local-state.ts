// Reader state kept only in this browser, and the site's one guarded way to browser storage; nothing
// about a reader leaves it. Keep the keys and formats once readers have data under them. Storage
// failures degrade silently.
import { useEffect, useSyncExternalStore } from "react";
import { beijingDate } from "@girlsbands/contracts/time";
import { isFollowableEntity, SUBJECT_LIMIT } from "@girlsbands/contracts/taxonomy";

export const KEYS = {
  starred: "girlsbands-starred-items",
  read: "girlsbands-read-items",
  theme: "girlsbands-theme",
  changelogSeen: "girlsbands-changelog-seen-version",
  feedbackDraft: "girlsbands-feedback-draft-v1",
  recentSearches: "girlsbands-recent-searches",
  follows: "girlsbands-follows",
} as const;

const STARRED_LIMIT = 500;
const READ_LIMIT = 5000;
const RECENT_SEARCH_LIMIT = 10;
const RECENT_SEARCH_MAX_CHARS = 200;
const IMPORT_MAX_CHARS = 2_000_000;
const ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

export interface LocalStarredItem {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  savedAt: string;
  publishedAt: string | null;
  score: number | null;
  aiSelected: boolean;
}

type StorageKind = "local" | "session";

// Reading the storage property itself throws where the browser blocks storage.
function storage(kind: StorageKind): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/** A stored string; null when it is missing or storage is unavailable. */
function readRaw(key: string, kind: StorageKind = "local"): string | null {
  try {
    return storage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** A stored JSON value; null when it is missing, unreadable or not JSON. */
export function readJson(key: string, kind: StorageKind = "local"): unknown {
  const raw = readRaw(key, kind);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Stores a string, or removes the key for null; false when nothing was saved (storage full or unavailable). */
export function writeRaw(key: string, value: string | null, kind: StorageKind = "local"): boolean {
  try {
    const s = storage(kind);
    if (!s) return false;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** The keys in this browser's storage; none when it is unavailable. */
export function storedKeys(kind: StorageKind): string[] {
  const s = storage(kind);
  return s ? Array.from({ length: s.length }, (_, i) => s.key(i)!) : [];
}

// change notification (same tab via events, other tabs via the storage event)
const listeners = new Map<string, Set<() => void>>();
let subscribers = 0;
function emit(key?: string) {
  for (const [subscribedKey, callbacks] of listeners) {
    if (key === undefined || key === subscribedKey) for (const callback of callbacks) callback();
  }
}
function onStorage(event: StorageEvent) {
  if (event.storageArea && event.storageArea !== storage("local")) return;
  if (event.key === null) cache.clear();
  else cache.delete(event.key);
  // Clear the snapshot once, before notifying all cards. Each key is parsed at most once.
  emit(event.key ?? undefined);
}
function subscribeKey(key: string) {
  return (listener: () => void) => {
    let callbacks = listeners.get(key);
    if (!callbacks) listeners.set(key, callbacks = new Set());
    callbacks.add(listener);
    if (subscribers++ === 0) window.addEventListener("storage", onStorage);
    return () => {
      callbacks.delete(listener);
      if (callbacks.size === 0) listeners.delete(key);
      if (--subscribers === 0) window.removeEventListener("storage", onStorage);
    };
  };
}
const subscribeStarred = subscribeKey(KEYS.starred);
const subscribeRead = subscribeKey(KEYS.read);
const subscribeTheme = subscribeKey(KEYS.theme);
const subscribeChangelog = subscribeKey(KEYS.changelogSeen);
const subscribeRecentSearches = subscribeKey(KEYS.recentSearches);
const subscribeFollows = subscribeKey(KEYS.follows);

// Snapshot cache so useSyncExternalStore gets stable references between changes.
const cache = new Map<string, unknown>();
function cached<T>(key: string, compute: () => T): T {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as T;
}
function invalidate(key: string) {
  cache.delete(key);
  emit(key);
}

// Another tab may have written since this tab cached its snapshots (its storage event can still be on
// the way): every edit reads fresh values first.
function editLocalData<T>(change: () => T): T {
  cache.clear();
  return change();
}

// starred
function isStarredItem(v: unknown): v is LocalStarredItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" && ID_PATTERN.test(o.id) && typeof o.title === "string";
}

// A parseable instant can still overflow when shifted into the page's display timezone.
function isDisplayableDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    beijingDate(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeStarred(v: Record<string, unknown>): LocalStarredItem {
  return {
    id: String(v.id),
    title: String(v.title),
    summary: typeof v.summary === "string" ? v.summary : null,
    sourceName: typeof v.sourceName === "string" ? v.sourceName : "",
    savedAt: isDisplayableDate(v.savedAt) ? v.savedAt : new Date().toISOString(),
    publishedAt: isDisplayableDate(v.publishedAt) ? v.publishedAt : null,
    score: typeof v.score === "number" ? v.score : null,
    aiSelected: v.aiSelected === true,
  };
}

export function getStarred(): LocalStarredItem[] {
  return cached(KEYS.starred, () => {
    const parsed = readJson(KEYS.starred);
    return Array.isArray(parsed) ? parsed.filter(isStarredItem).map((v) => normalizeStarred(v as unknown as Record<string, unknown>)).slice(0, STARRED_LIMIT) : [];
  });
}

const starredSetCache = { items: null as LocalStarredItem[] | null, ids: new Set<string>() };
function isStarred(id: string): boolean {
  const items = getStarred();
  if (starredSetCache.items !== items) {
    starredSetCache.items = items;
    starredSetCache.ids = new Set(items.map((item) => item.id));
  }
  return starredSetCache.ids.has(id);
}

export function toggleStar(item: Omit<LocalStarredItem, "savedAt">): boolean {
  return editLocalData(() => {
    if (starredUnreadable()) return false;
    const list = getStarred();
    const exists = list.some((s) => s.id === item.id);
    const next = exists ? list.filter((s) => s.id !== item.id) : [{ ...item, savedAt: new Date().toISOString() }, ...list].slice(0, STARRED_LIMIT);
    const saved = writeRaw(KEYS.starred, JSON.stringify(next));
    invalidate(KEYS.starred);
    return saved && !exists;
  });
}

export function removeStar(id: string) {
  editLocalData(() => {
    if (starredUnreadable()) return;
    writeRaw(KEYS.starred, JSON.stringify(getStarred().filter((s) => s.id !== id)));
    invalidate(KEYS.starred);
  });
}

// follows: the bands and projects this reader follows. Kept in this browser alone (no account, no token);
// a project stands for its whole series, expanded by the api exactly as a topic page expands it.
const FOLLOW_LIMIT = SUBJECT_LIMIT;

export function getFollows(): string[] {
  return cached(KEYS.follows, () => {
    const parsed = readJson(KEYS.follows);
    if (!Array.isArray(parsed)) return [];
    const ids = new Set<string>();
    for (const v of parsed) {
      if (isFollowableEntity(v)) ids.add(v);
      if (ids.size >= FOLLOW_LIMIT) break;
    }
    return [...ids];
  });
}

const followsSetCache = { ids: null as string[] | null, set: new Set<string>() };
function isFollowed(id: string): boolean {
  const ids = getFollows();
  if (followsSetCache.ids !== ids) {
    followsSetCache.ids = ids;
    followsSetCache.set = new Set(ids);
  }
  return followsSetCache.set.has(id);
}

// Unlike the stars, a list that cannot be read is rebuilt on the next toggle instead of refusing the
// write: it holds nothing but ids the reader can pick again, and an empty list is what it already shows.
/** Follows a subject, or stops following it; returns whether it is followed now. */
export function toggleFollow(id: string): boolean {
  return editLocalData(() => {
    if (!isFollowableEntity(id)) return false;
    const list = getFollows();
    const exists = list.includes(id);
    const next = exists ? list.filter((v) => v !== id) : [id, ...list].slice(0, FOLLOW_LIMIT);
    const saved = writeRaw(KEYS.follows, JSON.stringify(next));
    invalidate(KEYS.follows);
    return saved && !exists;
  });
}

// read items (LRU, newest first)
export function getReadIds(): string[] {
  return cached(KEYS.read, () => {
    const parsed = readJson(KEYS.read);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && ID_PATTERN.test(v)).slice(0, READ_LIMIT) : [];
  });
}

const readSetCache = { ids: null as string[] | null, set: new Set<string>() };
function getReadSet(): Set<string> {
  const ids = getReadIds();
  if (readSetCache.ids !== ids) {
    readSetCache.ids = ids;
    readSetCache.set = new Set(ids);
  }
  return readSetCache.set;
}

export function markRead(id: string) {
  editLocalData(() => {
    if (!ID_PATTERN.test(id)) return;
    const ids = getReadIds();
    if (ids[0] === id) return;
    const next = [id, ...ids.filter((v) => v !== id)].slice(0, READ_LIMIT);
    writeRaw(KEYS.read, JSON.stringify(next));
    invalidate(KEYS.read);
  });
}

// theme
export type ThemePreference = "light" | "dark" | null;

export function getThemePreference(): ThemePreference {
  const v = readRaw(KEYS.theme);
  return v === "light" || v === "dark" ? v : null;
}

export function setThemePreference(pref: ThemePreference) {
  writeRaw(KEYS.theme, pref);
  invalidate(KEYS.theme);
}

const systemTheme = (): "light" | "dark" =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** No choice made means 跟随系统: the page takes the system's light or dark. */
export function resolvedTheme(pref: ThemePreference = getThemePreference()): "light" | "dark" {
  return pref ?? systemTheme();
}

/** The browser chrome colour per theme; the same values as the `--bg` design token in app.css. */
export const THEME_COLOR = { light: "#efebe2", dark: "#0b0a0d" } as const;

/** Puts a theme on the page: the document's data-theme, which choice it came from, and the browser's theme colour. */
export function applyTheme(theme: "light" | "dark", followsSystem: boolean) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-pref", followsSystem ? "auto" : theme);
  // The two theme-color tags answer the system scheme; a chosen theme sets both to its own colour.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes("dark") ? "dark" : "light";
    meta.content = followsSystem ? THEME_COLOR[scheme] : THEME_COLOR[theme];
  }
}

/**
 * Keeps the page on the reader's theme after the first paint: a choice made in another tab or by an
 * import, and the system switching between light and dark while the page follows it.
 */
export function useThemeSync() {
  const pref = useThemePreference();
  useEffect(() => {
    const current = getThemePreference();
    applyTheme(resolvedTheme(current), current === null);
    if (current !== null) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme(media.matches ? "dark" : "light", true);
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [pref]);
}

/** Inline script run before paint so the first frame already has the reader's theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var p='auto',t=localStorage.getItem('${KEYS.theme}');if(t==='light'||t==='dark'){var c=t==='dark'?'${THEME_COLOR.dark}':'${THEME_COLOR.light}';document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c});p=t}else{t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.setAttribute('data-theme',t);document.documentElement.setAttribute('data-theme-pref',p)}catch(e){document.documentElement.setAttribute('data-theme','light')}})();`;

// changelog red dot
function getChangelogSeen(): string | null {
  const v = readRaw(KEYS.changelogSeen);
  return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? v : null;
}

export function setChangelogSeen(version: string) {
  writeRaw(KEYS.changelogSeen, version);
  invalidate(KEYS.changelogSeen);
}

// recent searches (newest first, at most RECENT_SEARCH_LIMIT; this browser only)
function getRecentSearches(): string[] {
  return cached(KEYS.recentSearches, () => {
    const parsed = readJson(KEYS.recentSearches);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string" && v.trim() !== "").slice(0, RECENT_SEARCH_LIMIT) : [];
  });
}

/** Puts a search first (the same words in another case replace the older entry). */
export function addRecentSearch(query: string) {
  const q = query.trim().slice(0, RECENT_SEARCH_MAX_CHARS);
  if (!q) return;
  const rest = getRecentSearches().filter((v) => v.toLowerCase() !== q.toLowerCase());
  writeRaw(KEYS.recentSearches, JSON.stringify([q, ...rest].slice(0, RECENT_SEARCH_LIMIT)));
  invalidate(KEYS.recentSearches);
}

export function clearRecentSearches() {
  writeRaw(KEYS.recentSearches, null);
  invalidate(KEYS.recentSearches);
}

// the page the reader was on (feedback records where a problem was seen)
const LAST_PAGE_KEY = "girlsbands:last-page";
const NOT_A_PLACE = /^\/(feedback|more)(\/|$)|^\/admin(\/|$)/;

/** Called on every in-site navigation: remembers the latest real page, never feedback, "更多" or the admin. */
export function rememberPage(path: string) {
  if (!NOT_A_PLACE.test(path)) writeRaw(LAST_PAGE_KEY, path, "session");
}

export function lastPage(): string | null {
  const v = readRaw(LAST_PAGE_KEY, "session");
  return v && v.startsWith("/") && !v.startsWith("//") ? v : null;
}

// export / import (version 1)
export interface ExportBundle {
  version: 1;
  starred: LocalStarredItem[];
  read: string[];
  /** The subjects this browser follows, in the reader's own order. */
  follows: string[];
  theme: "light" | "dark" | "auto" | null;
}

export function exportBundle(): ExportBundle {
  const pref = getThemePreference();
  return { version: 1, starred: getStarred(), read: getReadIds(), follows: getFollows(), theme: pref ?? "auto" };
}

export interface ImportReport {
  starredAdded: number;
  starredSkipped: number;
  followsAdded: number;
  followsSkipped: number;
  readAdded: number;
  readSkipped: number;
  themeApplied: boolean;
  /** The stars were saved but the read marks could not be (storage full or unavailable). */
  readFailed: boolean;
  /** The stars were saved but the follows could not be. */
  followsFailed: boolean;
}

/** Merge: existing stars are not overwritten, read ids are unioned, follows are unioned, theme only if unset. */
export function importBundle(text: string): ImportReport {
  if (text.length > IMPORT_MAX_CHARS) throw new Error("文件过大（上限 2,000,000 字符）");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  const d = data as Partial<ExportBundle>;
  if (!d || typeof d !== "object" || d.version !== 1) throw new Error("文件格式不对（需要 version: 1）");
  return mergeLocalData({
    starred: Array.isArray(d.starred) ? d.starred : [],
    read: Array.isArray(d.read) ? d.read : [],
    follows: Array.isArray(d.follows) ? d.follows : [],
    theme: d.theme ?? null,
  });
}

/** Stored stars that cannot be read (not JSON, not a list): an import must not write over them. */
function starredUnreadable(): boolean {
  const raw = readRaw(KEYS.starred);
  if (!raw) return false;
  try {
    return !Array.isArray(JSON.parse(raw));
  } catch {
    return true;
  }
}

function mergeLocalData(incoming: { starred: unknown[]; read: unknown[]; follows: unknown[]; theme: unknown }): ImportReport {
  return editLocalData(() => {
    // The reader's own data stays recoverable (export it, or fix it) rather than replaced by the import.
    if (starredUnreadable()) throw new Error("这台设备上已有的收藏数据无法读取，为避免覆盖，这次没有导入。");
    const current = getStarred();
    const have = new Set(current.map((s) => s.id));
    const additions: LocalStarredItem[] = [];
    let starredSkipped = 0;
    for (const s of incoming.starred) {
      if (!isStarredItem(s)) { starredSkipped++; continue; }
      if (have.has(s.id)) continue;
      have.add(s.id);
      additions.push(normalizeStarred(s as unknown as Record<string, unknown>));
    }
    const room = Math.max(0, STARRED_LIMIT - current.length);
    const accepted = additions.slice(0, room);
    starredSkipped += additions.length - accepted.length;
    const mergedStarred = [...current, ...accepted].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    // An import is reported only after it was written; a failure here leaves the browser as it was.
    if (!writeRaw(KEYS.starred, JSON.stringify(mergedStarred))) throw new Error("浏览器存储已满或不可用，这次没有导入任何内容。");

    const follows = getFollows();
    const followsHave = new Set(follows);
    const followAdditions: string[] = [];
    let followsSkipped = 0;
    for (const id of incoming.follows) {
      if (!isFollowableEntity(id)) { followsSkipped++; continue; }
      if (followsHave.has(id)) continue;
      followsHave.add(id);
      followAdditions.push(id);
    }
    const followRoom = Math.max(0, FOLLOW_LIMIT - follows.length);
    followsSkipped += Math.max(0, followAdditions.length - followRoom);
    const followsAccepted = followAdditions.slice(0, followRoom);
    // The reader's own order stays in front; the imported subjects are appended.
    const followsFailed = followsAccepted.length > 0 && !writeRaw(KEYS.follows, JSON.stringify([...follows, ...followsAccepted]));

    const readIds = getReadIds();
    const readHave = new Set(readIds);
    const readAdditions: string[] = [];
    let readSkipped = 0;
    for (const id of incoming.read) {
      if (typeof id !== "string" || !ID_PATTERN.test(id)) { readSkipped++; continue; }
      if (readHave.has(id)) continue;
      readHave.add(id);
      readAdditions.push(id);
    }
    const readRoom = Math.max(0, READ_LIMIT - readIds.length);
    readSkipped += Math.max(0, readAdditions.length - readRoom);
    const readFailed = !writeRaw(KEYS.read, JSON.stringify([...readIds, ...readAdditions.slice(0, readRoom)]));

    let themeApplied = false;
    if (!getThemePreference() && (incoming.theme === "light" || incoming.theme === "dark")) {
      themeApplied = writeRaw(KEYS.theme, incoming.theme);
    }
    cache.clear();
    emit();
    return { starredAdded: accepted.length, starredSkipped, followsAdded: followsFailed ? 0 : followsAccepted.length, followsSkipped, readAdded: readFailed ? 0 : Math.min(readAdditions.length, readRoom), readSkipped, themeApplied, readFailed, followsFailed };
  });
}

// React hooks
const EMPTY_STARRED: LocalStarredItem[] = [];
const EMPTY_SET = new Set<string>();

export function useStarred(): LocalStarredItem[] {
  return useSyncExternalStore(subscribeStarred, getStarred, () => EMPTY_STARRED);
}

export function useIsStarred(id: string): boolean {
  return useSyncExternalStore(subscribeStarred, () => isStarred(id), () => false);
}

export function useReadSet(): Set<string> {
  return useSyncExternalStore(subscribeRead, getReadSet, () => EMPTY_SET);
}

const NO_FOLLOWS: string[] = [];

/** The subjects this browser follows; empty on the server (follows live in the browser alone). */
export function useFollows(): string[] {
  return useSyncExternalStore(subscribeFollows, getFollows, () => NO_FOLLOWS);
}

export function useIsFollowed(id: string): boolean {
  return useSyncExternalStore(subscribeFollows, () => isFollowed(id), () => false);
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(subscribeTheme, getThemePreference, () => null);
}

export function useChangelogSeen(): string | null {
  return useSyncExternalStore(subscribeChangelog, getChangelogSeen, () => null);
}

const NO_SEARCHES: string[] = [];
export function useRecentSearches(): string[] {
  return useSyncExternalStore(subscribeRecentSearches, getRecentSearches, () => NO_SEARCHES);
}
