import { describe, expect, it, vi } from "vitest";

import {
  PINNED_CIRCLES_KEY,
  SIDEBAR_ATTENTION_PINNED_KEY,
  UNIVERSAL_PINS_KEY,
  SIDEBAR_COLLAPSED_SECTIONS_KEY,
  SIDEBAR_COMFORTABLE_WIDTH,
  SIDEBAR_DENSITY_KEY,
  SIDEBAR_SECTION_ORDER_KEY,
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  loadPinnedCircles,
  loadUniversalPins,
  loadSidebarAttentionPinned,
  loadCollapsedSections,
  loadSectionOrder,
  loadSidebarDensity,
  loadSidebarWidth,
  parsePinnedCircles,
  parseUniversalPins,
  parseSidebarAttentionPinned,
  parseSidebarDensity,
  parseSidebarWidth,
  saveCollapsedSections,
  savePinnedCircles,
  saveUniversalPins,
  saveSectionOrder,
  saveSidebarAttentionPinned,
  saveSidebarDensity,
  saveSidebarWidth,
  toggleCollapsedSection,
} from "./sidebar-preferences";
import { userSectionId } from "./sidebar-layout";

describe("sidebar density preferences", () => {
  it("accepts the three supported layouts and rejects stale values", () => {
    expect(parseSidebarDensity("comfortable")).toBe("comfortable");
    expect(parseSidebarDensity("compact")).toBe("compact");
    expect(parseSidebarDensity("icons")).toBe("icons");
    expect(parseSidebarDensity("tiny")).toBe("comfortable");
    expect(parseSidebarDensity(null)).toBe("comfortable");
  });

  it("loads and saves without making storage availability a launch dependency", () => {
    const setItem = vi.fn();
    saveSidebarDensity("icons", { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_DENSITY_KEY, "icons");
    expect(loadSidebarDensity({ getItem: () => "compact" })).toBe("compact");
    expect(loadSidebarDensity({ getItem: () => { throw new Error("blocked"); } })).toBe("comfortable");
  });
});

describe("sidebar section preferences", () => {
  it("round-trips unique collapsed and ordered section ids", () => {
    const collapsedSet = vi.fn();
    saveCollapsedSections(["builtin:pinned", "builtin:pinned", "section:Work"], {
      setItem: collapsedSet,
    });
    expect(collapsedSet).toHaveBeenCalledWith(
      SIDEBAR_COLLAPSED_SECTIONS_KEY,
      JSON.stringify(["builtin:pinned", "section:Work"]),
    );
    expect(
      loadCollapsedSections({
        getItem: () => JSON.stringify(["builtin:pinned", "section:Work"]),
      }),
    ).toEqual(["builtin:pinned", "section:Work"]);

    const orderSet = vi.fn();
    saveSectionOrder(["section:Work", "builtin:bots"], { setItem: orderSet });
    expect(orderSet).toHaveBeenCalledWith(
      SIDEBAR_SECTION_ORDER_KEY,
      JSON.stringify(["section:Work", "builtin:bots"]),
    );
    expect(loadSectionOrder({ getItem: () => JSON.stringify(["section:Work", "builtin:bots"]) })).toEqual([
      "section:Work",
      "builtin:bots",
    ]);
  });

  it("ignores malformed storage and toggles ids without mutating the source", () => {
    expect(loadCollapsedSections({ getItem: () => "not-json" })).toEqual([]);
    expect(loadSectionOrder({ getItem: () => JSON.stringify({ nope: true }) })).toEqual([]);
    const current = ["section:Work"];
    expect(toggleCollapsedSection(current, "builtin:bots")).toEqual([
      "section:Work",
      "builtin:bots",
    ]);
    expect(toggleCollapsedSection(current, "section:Work")).toEqual([]);
    expect(current).toEqual(["section:Work"]);
  });

  it("supports newlines, caps untrusted arrays, and tolerates blocked storage", () => {
    const withNewline = "section:Line\nBreak";
    expect(loadSectionOrder({ getItem: () => JSON.stringify([withNewline]) })).toEqual([withNewline]);

    const oversized = Array.from({ length: 105 }, (_, index) => `section:${index}`);
    expect(loadSectionOrder({ getItem: () => JSON.stringify(oversized) })).toHaveLength(100);
    expect(loadSectionOrder({ getItem: () => { throw new Error("blocked"); } })).toEqual([]);
    expect(() => saveSectionOrder(["section:Work"], { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("persists raw section ids with lone surrogates and max-length emoji names", () => {
    const ids = [userSectionId("\ud800"), userSectionId("🧠".repeat(30))];
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    saveSectionOrder(ids, storage);
    expect(loadSectionOrder(storage)).toEqual(ids);
  });
});

describe("pinned circles preference", () => {
  it("defaults off, stores the exact flag, and survives blocked storage", () => {
    expect(parsePinnedCircles("true")).toBe(true);
    expect(parsePinnedCircles("false")).toBe(false);
    expect(parsePinnedCircles("yes")).toBe(false);
    expect(parsePinnedCircles("1")).toBe(false);
    expect(parsePinnedCircles(null)).toBe(false);

    const setItem = vi.fn();
    savePinnedCircles(true, { setItem });
    savePinnedCircles(false, { setItem });
    expect(setItem).toHaveBeenNthCalledWith(1, PINNED_CIRCLES_KEY, "true");
    expect(setItem).toHaveBeenNthCalledWith(2, PINNED_CIRCLES_KEY, "false");
    expect(loadPinnedCircles({ getItem: () => "true" })).toBe(true);
    expect(loadPinnedCircles({ getItem: () => "false" })).toBe(false);
    expect(loadPinnedCircles({ getItem: () => "untrusted" })).toBe(false);
    expect(loadPinnedCircles({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(loadPinnedCircles(null)).toBe(false);
    expect(() => savePinnedCircles(true, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => savePinnedCircles(true, null)).not.toThrow();
  });
});

describe("universal pins preference", () => {
  it("defaults off, stores the exact flag, and survives blocked storage", () => {
    expect(parseUniversalPins("true")).toBe(true);
    expect(parseUniversalPins("false")).toBe(false);
    expect(parseUniversalPins("yes")).toBe(false);
    expect(parseUniversalPins(null)).toBe(false);

    const setItem = vi.fn();
    saveUniversalPins(true, { setItem });
    saveUniversalPins(false, { setItem });
    expect(setItem).toHaveBeenNthCalledWith(1, UNIVERSAL_PINS_KEY, "true");
    expect(setItem).toHaveBeenNthCalledWith(2, UNIVERSAL_PINS_KEY, "false");
    expect(loadUniversalPins({ getItem: () => "true" })).toBe(true);
    expect(loadUniversalPins({ getItem: () => "false" })).toBe(false);
    expect(loadUniversalPins({ getItem: () => "untrusted" })).toBe(false);
    expect(loadUniversalPins({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
    expect(loadUniversalPins(null)).toBe(false);
    expect(() => saveUniversalPins(true, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => saveUniversalPins(true, null)).not.toThrow();
  });
});

describe("sidebar width preference", () => {
  it("clamps integer pixels and ignores invalid or blocked storage", () => {
    expect(parseSidebarWidth(null)).toBeNull();
    expect(parseSidebarWidth("")).toBeNull();
    expect(parseSidebarWidth("  ")).toBeNull();
    expect(parseSidebarWidth("wide")).toBeNull();
    expect(parseSidebarWidth("320.5")).toBeNull();
    expect(parseSidebarWidth("320px")).toBeNull();
    expect(parseSidebarWidth("400")).toBe(400);
    expect(parseSidebarWidth(" 400 ")).toBe(400);
    expect(parseSidebarWidth("100")).toBe(SIDEBAR_WIDTH_MIN);
    expect(parseSidebarWidth("900")).toBe(SIDEBAR_WIDTH_MAX);
    expect(parseSidebarWidth("-20")).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_COMFORTABLE_WIDTH);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_COMFORTABLE_WIDTH);
    expect(clampSidebarWidth(300.4)).toBe(300);
    expect(clampSidebarWidth(300.6)).toBe(301);

    const setItem = vi.fn();
    saveSidebarWidth(100, { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_WIDTH_KEY, "240");
    saveSidebarWidth(480.2, { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_WIDTH_KEY, "480");
    expect(loadSidebarWidth({ getItem: () => "500" })).toBe(500);
    expect(loadSidebarWidth({ getItem: () => "12" })).toBe(SIDEBAR_WIDTH_MIN);
    expect(loadSidebarWidth({ getItem: () => "nope" })).toBeNull();
    expect(loadSidebarWidth({ getItem: () => null })).toBeNull();
    expect(loadSidebarWidth({ getItem: () => { throw new Error("blocked"); } })).toBeNull();
    expect(loadSidebarWidth(null)).toBeNull();
    expect(() => saveSidebarWidth(400, { setItem: () => { throw new Error("blocked"); } })).not.toThrow();
    expect(() => saveSidebarWidth(400, null)).not.toThrow();
  });
});

describe("sidebar attention pin preference", () => {
  it("round-trips the pinned flag and defaults to the popover", () => {
    expect(parseSidebarAttentionPinned("true")).toBe(true);
    expect(parseSidebarAttentionPinned("false")).toBe(false);
    expect(parseSidebarAttentionPinned("yes")).toBe(false);
    expect(parseSidebarAttentionPinned(null)).toBe(false);

    const setItem = vi.fn();
    saveSidebarAttentionPinned(true, { setItem });
    expect(setItem).toHaveBeenCalledWith(SIDEBAR_ATTENTION_PINNED_KEY, "true");
    expect(loadSidebarAttentionPinned({ getItem: () => "true" })).toBe(true);
    expect(loadSidebarAttentionPinned({ getItem: () => "untrusted" })).toBe(false);
    expect(loadSidebarAttentionPinned({ getItem: () => { throw new Error("blocked"); } })).toBe(false);
  });
});
