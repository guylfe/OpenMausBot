import { useSyncExternalStore } from "react";
import { z } from "zod";

export type SidebarDensity = "comfortable" | "compact" | "icons";

export const SIDEBAR_DENSITY_KEY = "openmausbot.sidebarDensity";
export const SIDEBAR_ATTENTION_PINNED_KEY = "openmausbot.sidebarAttentionPinned.v1";
export const SIDEBAR_COLLAPSED_SECTIONS_KEY = "openmausbot.sidebarCollapsedSections.v1";
export const SIDEBAR_SECTION_ORDER_KEY = "openmausbot.sidebarSectionOrder.v1";
export const PINNED_CIRCLES_KEY = "openmausbot.pinnedCircles";
export const UNIVERSAL_PINS_KEY = "openmausbot.universalPins";
export const SIDEBAR_WIDTH_KEY = "openmausbot.sidebarWidth";

/** Pixel width of the collapsed avatar rail. Not user-resizable. */
export const SIDEBAR_ICONS_WIDTH = 80;
/** Unset comfortable width — the historical fixed sidebar. */
export const SIDEBAR_COMFORTABLE_WIDTH = 320;
/** Unset compact width — padding changes, not a second saved width. */
export const SIDEBAR_COMPACT_WIDTH = 272;
export const SIDEBAR_WIDTH_MIN = 240;
export const SIDEBAR_WIDTH_MAX = 640;
export const SIDEBAR_WIDTH_STEP = 16;

export function parseSidebarDensity(value: string | null): SidebarDensity {
  switch (value) {
    case "comfortable":
    case "compact":
    case "icons":
      return value;
    default:
      return "comfortable";
  }
}

export function loadSidebarDensity(storage?: Pick<Storage, "getItem"> | null): SidebarDensity {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarDensity(target?.getItem(SIDEBAR_DENSITY_KEY) ?? null);
  } catch {
    return "comfortable";
  }
}

export function saveSidebarDensity(
  density: SidebarDensity,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_DENSITY_KEY, density);
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

export function parseSidebarAttentionPinned(value: string | null): boolean {
  return value === "true";
}

export function loadSidebarAttentionPinned(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarAttentionPinned(target?.getItem(SIDEBAR_ATTENTION_PINNED_KEY) ?? null);
  } catch {
    return false;
  }
}

export function saveSidebarAttentionPinned(
  pinned: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_ATTENTION_PINNED_KEY, String(pinned));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

export function parsePinnedCircles(value: string | null): boolean {
  return value === "true";
}

/** Session choice when storage rejects the write. Injected storage in tests
 * does not touch it, so a blocked localStorage cannot leak across cases. */
let sessionPinnedCircles: boolean | undefined;
const pinnedCircleListeners = new Set<() => void>();

function notifyPinnedCircles(): void {
  for (const listener of pinnedCircleListeners) listener();
}

function onPinnedCirclesStorage(event: StorageEvent): void {
  if (event.key !== PINNED_CIRCLES_KEY && event.key !== null) return;
  sessionPinnedCircles = undefined;
  notifyPinnedCircles();
}

export function subscribePinnedCircles(listener: () => void): () => void {
  pinnedCircleListeners.add(listener);
  if (
    pinnedCircleListeners.size === 1 &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", onPinnedCirclesStorage);
  }
  return () => {
    pinnedCircleListeners.delete(listener);
    if (
      pinnedCircleListeners.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("storage", onPinnedCirclesStorage);
    }
  };
}

export function loadPinnedCircles(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (storage === undefined && sessionPinnedCircles !== undefined) return sessionPinnedCircles;
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parsePinnedCircles(target?.getItem(PINNED_CIRCLES_KEY) ?? null);
  } catch {
    return false;
  }
}

export function savePinnedCircles(
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(PINNED_CIRCLES_KEY, enabled ? "true" : "false");
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

export function setPinnedCircles(enabled: boolean): void {
  sessionPinnedCircles = enabled;
  savePinnedCircles(enabled);
  notifyPinnedCircles();
}

export function usePinnedCircles(): boolean {
  return useSyncExternalStore(subscribePinnedCircles, loadPinnedCircles, () => false);
}

export function parseUniversalPins(value: string | null): boolean {
  return value === "true";
}

let sessionUniversalPins: boolean | undefined;
const universalPinListeners = new Set<() => void>();

function notifyUniversalPins(): void {
  for (const listener of universalPinListeners) listener();
}

function onUniversalPinsStorage(event: StorageEvent): void {
  if (event.key !== UNIVERSAL_PINS_KEY && event.key !== null) return;
  sessionUniversalPins = undefined;
  notifyUniversalPins();
}

export function subscribeUniversalPins(listener: () => void): () => void {
  universalPinListeners.add(listener);
  if (
    universalPinListeners.size === 1 &&
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("storage", onUniversalPinsStorage);
  }
  return () => {
    universalPinListeners.delete(listener);
    if (
      universalPinListeners.size === 0 &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("storage", onUniversalPinsStorage);
    }
  };
}

export function loadUniversalPins(storage?: Pick<Storage, "getItem"> | null): boolean {
  if (storage === undefined && sessionUniversalPins !== undefined) return sessionUniversalPins;
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseUniversalPins(target?.getItem(UNIVERSAL_PINS_KEY) ?? null);
  } catch {
    return false;
  }
}

export function saveUniversalPins(
  enabled: boolean,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(UNIVERSAL_PINS_KEY, enabled ? "true" : "false");
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
  }
}

export function setUniversalPins(enabled: boolean): void {
  sessionUniversalPins = enabled;
  saveUniversalPins(enabled);
  notifyUniversalPins();
}

export function useUniversalPins(): boolean {
  return useSyncExternalStore(subscribeUniversalPins, loadUniversalPins, () => false);
}

/** Integer pixels, or null when nothing usable is stored. Out of range
 * values clamp; junk does not invent a width. */
export function parseSidebarWidth(value: string | null): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return clampSidebarWidth(Number(trimmed));
}

export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_COMFORTABLE_WIDTH;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
}

export function loadSidebarWidth(storage?: Pick<Storage, "getItem"> | null): number | null {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseSidebarWidth(target?.getItem(SIDEBAR_WIDTH_KEY) ?? null);
  } catch {
    return null;
  }
}

export function saveSidebarWidth(
  px: number,
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    target?.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(px)));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // The in-memory React state still makes the control useful this session.
  }
}

const stringListSchema = z.array(z.string().min(1).max(240));

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = stringListSchema.safeParse(parsed);
    return result.success ? [...new Set(result.data)].slice(0, 100) : [];
  } catch {
    return [];
  }
}

function loadStringList(
  key: string,
  storage?: Pick<Storage, "getItem"> | null,
): string[] {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    return parseStringList(target?.getItem(key) ?? null);
  } catch {
    return [];
  }
}

function saveStringList(
  key: string,
  values: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  try {
    const target = storage === undefined ? (globalThis.localStorage ?? null) : storage;
    const safe = [
      ...new Set(values.filter((value) => value.length > 0 && value.length <= 240)),
    ].slice(0, 100);
    target?.setItem(key, JSON.stringify(safe));
  } catch {
    // Private browsing and locked-down webviews may reject localStorage.
    // In-memory React state still keeps the interaction useful this session.
  }
}

export function loadCollapsedSections(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, storage);
}

export function saveCollapsedSections(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_COLLAPSED_SECTIONS_KEY, ids, storage);
}

export function toggleCollapsedSection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function loadSectionOrder(storage?: Pick<Storage, "getItem"> | null): string[] {
  return loadStringList(SIDEBAR_SECTION_ORDER_KEY, storage);
}

export function saveSectionOrder(
  ids: string[],
  storage?: Pick<Storage, "setItem"> | null,
): void {
  saveStringList(SIDEBAR_SECTION_ORDER_KEY, ids, storage);
}
