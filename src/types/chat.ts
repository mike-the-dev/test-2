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

export interface SplashConfigOnboardingFieldBudget {
  kind: "budget";
  key: "budgetCents";
  label: string;
  required: boolean;
}

export interface SplashConfigOnboardingFieldIndustry {
  kind: "industry";
  key: "industry";
  label: string;
  options: string[];
  required: boolean;
}

export interface SplashConfigOnboardingFieldShortText {
  kind: "shortText";
  key: string;
  label: string;
  required: boolean;
  maxLength: number;
}

export type SplashConfigOnboardingField =
  | SplashConfigOnboardingFieldBudget
  | SplashConfigOnboardingFieldIndustry
  | SplashConfigOnboardingFieldShortText;

export interface SplashConfig {
  fields: SplashConfigOnboardingField[];
}

export interface SessionInfo {
  sessionId: string;
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
   * Server-driven splash configuration for this agent's onboarding step, or
   * `null` if the agent requires no onboarding. When `null`, the embed skips
   * the splash entirely and proceeds directly to hydrate/kickoff/chat.
   */
  splash: SplashConfig | null;
  /**
   * Arbitrary key→value map collected during onboarding, keyed by each field's
   * `key` from `SplashConfig.fields`. `null` before onboarding completes (or
   * when the agent has no splash).
   */
  onboardingData: Record<string, unknown> | null;
}

export interface CreateSessionRequest {
  agentName: string;
  /** Previously stored session ID, sent to allow the backend to resume an existing session. Omitted on first load. */
  sessionId?: string;
  /**
   * Public account ID from the integrator's <script data-account-ulid>
   * attribute. Required — the backend binds the session to this account
   * after cross-validating it against the iframe-load Referer domain.
   */
  accountUlid: string;
}

export type CreateSessionResponse = SessionInfo;

export interface OnboardingRequest {
  /** Arbitrary map of field keys to collected values, as defined by the agent's SplashConfig. */
  onboardingData: Record<string, unknown>;
}

export type OnboardingResponse = SessionInfo;

export interface SendMessageRequest {
  sessionId: string;
  message: string;
}

export interface SendMessageResponse {
  reply: string;
  toolOutputs?: ToolOutput[];
}

/**
 * A historical turn returned from GET /chat/web/sessions/:sessionId/messages.
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
