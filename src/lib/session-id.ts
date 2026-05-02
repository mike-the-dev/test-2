"use client";

/** localStorage key under which the session ID is persisted. */
export const SESSION_ID_KEY = "instapaytient_chat_session_id";

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-30
 * @name readStoredSessionId
 * @description Reads the persisted session ID from localStorage. Returns
 *   `null` when storage is blocked (private browsing, quota exceeded, etc.);
 *   caller is expected to treat this as "no stored session" and let the backend
 *   mint a fresh one.
 * @returns The stored session ID string, or `null` if absent or inaccessible.
 */
export const readStoredSessionId = (): string | null => {
  try {
    const value = window.localStorage.getItem(SESSION_ID_KEY);
    if (!value || value.length === 0) return null;
    return value;
  } catch {
    return null;
  }
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-30
 * @name writeStoredSessionId
 * @description Persists the given session ID to localStorage. Silently swallows
 *   any storage errors (private browsing, quota exceeded, etc.).
 * @param sessionId - The session ID string to persist.
 * @returns void
 */
export const writeStoredSessionId = (sessionId: string): void => {
  try {
    window.localStorage.setItem(SESSION_ID_KEY, sessionId);
  } catch {
    // private browsing or quota exceeded — do nothing
  }
};

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-30
 * @name clearStoredSessionId
 * @description Removes the session ID from localStorage. Silently swallows any
 *   storage errors.
 * @returns void
 */
export const clearStoredSessionId = (): void => {
  try {
    window.localStorage.removeItem(SESSION_ID_KEY);
  } catch {
    // private browsing or quota exceeded — do nothing
  }
};
