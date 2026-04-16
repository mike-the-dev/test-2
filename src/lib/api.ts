import { chatApiUrl } from "@/lib/env";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
} from "@/types/chat";

/**
 * Error thrown by the chat API client on non-2xx responses or network failures.
 *
 * - `status === 0` signals a network / CORS failure where no HTTP response was
 *   received from the server.
 * - For non-2xx responses, `body` holds whatever the server returned (parsed
 *   JSON when possible, otherwise the raw text, or `null` if the body was
 *   empty).
 */
export class ChatApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ChatApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function postJson<TResponse>(
  path: string,
  body: unknown,
  init?: { signal?: AbortSignal }
): Promise<TResponse> {
  const url = `${chatApiUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: init?.signal,
    });
  } catch (err) {
    // Network-level failure (DNS, CORS, offline, abort, ...). No HTTP status.
    const reason =
      err instanceof Error ? err.message : "network request failed";
    throw new ChatApiError(`network error: ${reason}`, 0, null);
  }

  if (!response.ok) {
    const parsed = await parseBody(response);
    throw new ChatApiError(
      `chat api responded with ${response.status}`,
      response.status,
      parsed
    );
  }

  const parsed = await parseBody(response);
  return parsed as TResponse;
}

export function createSession(
  request: CreateSessionRequest,
  init?: { signal?: AbortSignal }
): Promise<CreateSessionResponse> {
  return postJson<CreateSessionResponse>("/chat/web/sessions", request, init);
}

export function sendMessage(
  request: SendMessageRequest,
  init?: { signal?: AbortSignal }
): Promise<SendMessageResponse> {
  return postJson<SendMessageResponse>("/chat/web/messages", request, init);
}
