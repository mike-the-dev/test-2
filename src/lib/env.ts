/**
 * Typed access to required public environment variables.
 *
 * Each reader uses a LITERAL `process.env.NEXT_PUBLIC_*` access — Next.js only
 * inlines env values into the client bundle when it can statically match that
 * exact pattern. Dynamic lookups via `process.env[name]` end up `undefined`
 * in the browser even when the variable is defined at build time.
 *
 * The readers throw at module load so missing env vars fail loudly instead
 * of producing cryptic downstream errors.
 */

function readChatApiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_CHAT_API_URL;
  if (!raw || raw.length === 0) {
    throw new Error(
      "NEXT_PUBLIC_CHAT_API_URL is not set. Add it to .env.local (dev) or the deployment environment (prod)."
    );
  }
  // Strip trailing slash so callers can always concatenate `/chat/web/...`.
  return raw.replace(/\/+$/, "");
}

function readAffirmPublicKey(): string {
  const raw = process.env.NEXT_PUBLIC_AFFIRM_PUBLIC_KEY;
  if (!raw || raw.length === 0) {
    throw new Error(
      "NEXT_PUBLIC_AFFIRM_PUBLIC_KEY is not set. Needed for the budget-splash Affirm promotional messaging. Use your sandbox key in dev."
    );
  }
  return raw;
}

export const chatApiUrl: string = readChatApiUrl();
export const affirmPublicKey: string = readAffirmPublicKey();
