import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetGuestIdForTests, ensureGuestId } from "@/lib/guest-id";

const STORAGE_KEY = "instapaytient_guest_id";

describe("ensureGuestId", () => {
  beforeEach(() => {
    window.localStorage.clear();
    __resetGuestIdForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    __resetGuestIdForTests();
  });

  it("generates and persists a new ULID when none exists", () => {
    const id = ensureGuestId();
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(id);
  });

  it("returns the existing ULID on subsequent calls", () => {
    window.localStorage.setItem(STORAGE_KEY, "EXISTINGULIDVALUE123456789");
    const id = ensureGuestId();
    expect(id).toBe("EXISTINGULIDVALUE123456789");
  });

  it("falls back to an in-memory ULID when localStorage throws", () => {
    const failingGet = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    const failingSet = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    const first = ensureGuestId();
    const second = ensureGuestId();
    expect(first).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(second).toBe(first);
    expect(failingGet).toHaveBeenCalled();
    expect(failingSet).not.toHaveBeenCalled();
  });

  it("throws a clear error when called on the server", async () => {
    vi.resetModules();
    const originalWindow = globalThis.window;
    // Simulate SSR by removing window on the global namespace.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
    try {
      const mod = await import("@/lib/guest-id");
      expect(() => mod.ensureGuestId()).toThrow(/browser/i);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });
});
