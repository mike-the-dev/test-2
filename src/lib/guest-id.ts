"use client";

import { ulid } from "ulid";

const STORAGE_KEY = "instapaytient_guest_id";

/** Keeps a ULID alive in the tab when localStorage writes are not allowed. */
let inMemoryGuestId: string | null = null;

/**
 * Ensures the current browser tab has a stable guest ULID.
 *
 * - First call in a browser: generates a new ULID, persists to localStorage,
 *   and returns it.
 * - Subsequent calls: returns the stored ULID.
 * - When localStorage is disabled (private browsing, quota exceeded, ...):
 *   falls back to an in-memory ULID that lives for the lifetime of the tab.
 * - When called outside a browser (SSR): throws a clear error so callers are
 *   forced to gate the call behind a client-only effect.
 */
export function ensureGuestId(): string {
  if (typeof window === "undefined") {
    throw new Error("ensureGuestId must be called in the browser");
  }

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing && existing.length > 0) {
      inMemoryGuestId = existing;
      return existing;
    }
    const next = ulid();
    window.localStorage.setItem(STORAGE_KEY, next);
    inMemoryGuestId = next;
    return next;
  } catch {
    // localStorage access threw (private browsing, storage quota, cookies
    // blocked, etc.). Degrade to an in-memory ULID for this tab.
    if (inMemoryGuestId !== null) {
      return inMemoryGuestId;
    }
    const next = ulid();
    inMemoryGuestId = next;
    return next;
  }
}

/** Test-only: reset the in-memory fallback so specs do not bleed. */
export function __resetGuestIdForTests(): void {
  inMemoryGuestId = null;
}
