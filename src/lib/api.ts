import { chatApiUrl } from "@/lib/env";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  EmbedAuthorizeRequest,
  EmbedAuthorizeResponse,
  GetSessionMessagesResponse,
  OnboardingRequest,
  OnboardingResponse,
  SendMessageRequest,
  SendMessageResponse,
  ToolOutput,
} from "@/types/chat";

/**
 * Shared wire contract — the user-message `content` string the backend
 * recognizes as a "session kickoff" trigger. On seeing this exact content, the
 * backend generates the opening assistant greeting and also filters the user
 * turn out of `GET /chat/web/sessions/:ulid/messages` hydration responses.
 *
 * Never change this without coordinating with the backend; must match their
 * constant byte-for-byte.
 */
export const SESSION_KICKOFF_CONTENT = "__SESSION_KICKOFF__";

/**
 * Raw wire shape for the send-message response. Internal only — never exported.
 * The public `SendMessageResponse` uses camelCase throughout.
 */
interface SendMessageWireResponse {
  reply: string;
  tool_outputs?: Array<{
    tool_name: string;
    content: string;
    is_error?: boolean;
  }>;
}

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

const parseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const sendJson = async <TResponse>(
  method: "GET" | "POST",
  path: string,
  body: unknown,
  init?: { signal?: AbortSignal; cache?: RequestCache }
): Promise<TResponse> => {
  const url = `${chatApiUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers:
        method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
      body: method === "POST" ? JSON.stringify(body) : undefined,
      signal: init?.signal,
      cache: init?.cache,
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
};

const postJson = <TResponse>(
  path: string,
  body: unknown,
  init?: { signal?: AbortSignal; cache?: RequestCache }
): Promise<TResponse> => sendJson<TResponse>("POST", path, body, init);

const getJson = <TResponse>(
  path: string,
  init?: { signal?: AbortSignal }
): Promise<TResponse> => sendJson<TResponse>("GET", path, undefined, init);

export const createSession = (
  request: CreateSessionRequest,
  init?: { signal?: AbortSignal }
): Promise<CreateSessionResponse> =>
  postJson<CreateSessionResponse>("/chat/web/sessions", request, init);

export const sendMessage = async (
  request: SendMessageRequest,
  init?: { signal?: AbortSignal }
): Promise<SendMessageResponse> => {
  const wire = await postJson<SendMessageWireResponse>(
    "/chat/web/messages",
    request,
    init
  );

  const toolOutputs: ToolOutput[] | undefined =
    wire.tool_outputs === undefined
      ? undefined
      : wire.tool_outputs.map((entry) => ({
          toolName: entry.tool_name,
          content: entry.content,
          isError: entry.is_error,
        }));

  return { reply: wire.reply, ...(toolOutputs !== undefined && { toolOutputs }) };
};

export const completeOnboarding = (
  sessionUlid: string,
  request: OnboardingRequest,
  init?: { signal?: AbortSignal }
): Promise<OnboardingResponse> =>
  postJson<OnboardingResponse>(
    `/chat/web/sessions/${encodeURIComponent(sessionUlid)}/onboarding`,
    request,
    init
  );

export const fetchSessionMessages = (
  sessionUlid: string,
  init?: { signal?: AbortSignal }
): Promise<GetSessionMessagesResponse> =>
  getJson<GetSessionMessagesResponse>(
    `/chat/web/sessions/${encodeURIComponent(sessionUlid)}/messages`,
    init
  );

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name authorizeEmbed
 * @description POSTs to the embed authorization endpoint to verify that the
 *   given account is permitted to embed the widget from the specified parent
 *   domain. Always uses `cache: "no-store"` to prevent Next.js fetch
 *   deduplication or stale caching of the authorization decision.
 *   Throws a `ChatApiError` on non-2xx responses or when the response body
 *   does not contain a boolean `authorized` field.
 * @param request - The account ULID and parent domain to authorize.
 * @param init - Optional AbortSignal and cache override (default: "no-store").
 * @returns A promise that resolves to `{ authorized: boolean }`.
 */
export const authorizeEmbed = async (
  request: EmbedAuthorizeRequest,
  init?: { signal?: AbortSignal; cache?: RequestCache }
): Promise<EmbedAuthorizeResponse> => {
  const result = await postJson<EmbedAuthorizeResponse>(
    "/chat/web/embed/authorize",
    request,
    { signal: init?.signal, cache: init?.cache ?? "no-store" }
  );

  if (typeof result.authorized !== "boolean")
    throw new ChatApiError("malformed authorize response", 200, result);

  return result;
};
