export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** True while the assistant reply is still in flight. */
  pending?: boolean;
  /** True when the message represents a failed send that can be retried. */
  errored?: boolean;
}

export interface SessionInfo {
  sessionUlid: string;
  displayName: string;
}

export interface CreateSessionRequest {
  agentName: string;
  guestUlid: string;
  /** Parent page hostname, forwarded so the backend can resolve CORS/account binding. */
  hostDomain?: string;
}

export type CreateSessionResponse = SessionInfo;

export interface SendMessageRequest {
  sessionUlid: string;
  message: string;
}

export interface SendMessageResponse {
  reply: string;
}
