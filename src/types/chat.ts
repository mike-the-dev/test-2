export type ChatRole = "user" | "assistant";

export interface ToolOutput {
  /** Normalized from wire field `tool_name`. */
  toolName: string;
  /** Raw JSON string produced by the tool. */
  content: string;
  /** Normalized from wire field `is_error`. */
  isError?: boolean;
}

export interface CartLineItem {
  lineId: string;
  serviceId: string;
  name: string;
  category: string;
  imageUrl: string;
  variant: string | null;
  variantLabel: string | null;
  quantity: number;
  price: number;
  total: number;
}

export interface CartPreviewPayload {
  cartId: string;
  itemCount: number;
  /** Always "usd" for v1. */
  currency: string;
  cartTotal: number;
  lines: CartLineItem[];
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** True while the assistant reply is still in flight. */
  pending?: boolean;
  /** True when the message represents a failed send that can be retried. */
  errored?: boolean;
  /** Tool outputs attached to this message, if any. */
  toolOutputs?: ToolOutput[];
}

export interface SessionInfo {
  sessionUlid: string;
  displayName: string;
  /**
   * ISO 8601 timestamp of when the visitor completed the budget splash, or
   * `null` if they haven't yet. Truthy-coerce with `!!session.onboardingCompletedAt`
   * when you want a boolean.
   */
  onboardingCompletedAt: string | null;
  /**
   * ISO 8601 timestamp of when the session's opening kickoff greeting was
   * dispatched, or `null` if the kickoff has not yet fired. Backend is
   * idempotent — re-dispatching `__SESSION_KICKOFF__` on a stamped session
   * returns the stored welcome without re-spending tokens.
   */
  kickoffCompletedAt: string | null;
  /**
   * Visitor's captured budget in integer cents (e.g. 100_000 for $1,000.00).
   * `null` before onboarding completes. Integer math end-to-end — no float
   * weirdness on the wire, in DynamoDB, or at display time.
   */
  budgetCents: number | null;
}

export interface CreateSessionRequest {
  agentName: string;
  guestUlid: string;
  /**
   * Public account ULID from the integrator's <script data-account-ulid>
   * attribute. Required — the backend binds the session to this account
   * after cross-validating it against the iframe-load Referer domain.
   */
  accountUlid: string;
}

export type CreateSessionResponse = SessionInfo;

export interface OnboardingRequest {
  /** Budget in integer cents (e.g. 100_000 for $1,000.00). */
  budgetCents: number;
}

export type OnboardingResponse = SessionInfo;

export interface SendMessageRequest {
  sessionUlid: string;
  message: string;
}

export interface SendMessageResponse {
  reply: string;
  toolOutputs?: ToolOutput[];
}

/**
 * A historical turn returned from GET /chat/web/sessions/:ulid/messages.
 * Filtered server-side to user + assistant text only; tool-use and
 * tool-result blocks never cross the wire.
 */
export interface ChatHistoryMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** ISO 8601 timestamp from the backend's _createdAt_ field. */
  timestamp: string;
}

export interface GetSessionMessagesResponse {
  messages: ChatHistoryMessage[];
}

export interface EmbedAuthorizeRequest {
  accountUlid: string;
  parentDomain: string;
}

export interface EmbedAuthorizeResponse {
  authorized: boolean;
}
