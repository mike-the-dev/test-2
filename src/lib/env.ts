/**
 * Typed access to required public environment variables.
 *
 * Throws a clear error at module load time if the variable is missing so that
 * build and dev failures fail loudly instead of producing cryptic fetch errors
 * at runtime.
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

export const chatApiUrl: string = readChatApiUrl();
