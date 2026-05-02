import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_ID_KEY,
  clearStoredSessionId,
  readStoredSessionId,
  writeStoredSessionId,
} from "@/lib/session-id";

describe("readStoredSessionId", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns null when key is absent", () => {
    localStorage.clear();
    expect(readStoredSessionId()).toBeNull();
  });

  it("returns the value when key is present", () => {
    localStorage.setItem(SESSION_ID_KEY, "01HFOO");
    expect(readStoredSessionId()).toBe("01HFOO");
  });

  it("returns null when localStorage throws", () => {
    vi.spyOn(localStorage.__proto__, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(readStoredSessionId()).toBeNull();
  });
});

describe("writeStoredSessionId", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists the value", () => {
    writeStoredSessionId("01HBAR");
    expect(localStorage.getItem(SESSION_ID_KEY)).toBe("01HBAR");
  });

  it("silently swallows localStorage errors", () => {
    vi.spyOn(localStorage.__proto__, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeStoredSessionId("01HBAR")).not.toThrow();
  });
});

describe("clearStoredSessionId", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("removes the key", () => {
    localStorage.setItem(SESSION_ID_KEY, "01HFOO");
    clearStoredSessionId();
    expect(localStorage.getItem(SESSION_ID_KEY)).toBeNull();
  });
});
