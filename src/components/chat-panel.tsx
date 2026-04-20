"use client";

import { Avatar, Button, Input } from "@heroui/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { ulid } from "ulid";

import { ChatMessageView } from "@/components/chat-message";
import { ChatApiError, sendMessage } from "@/lib/api";
import type { ChatMessage, SessionInfo } from "@/types/chat";

const CLOSE_MESSAGE = { type: "instapaytient:close" } as const;

export interface ChatPanelProps {
  session: SessionInfo;
  /**
   * Optional prior conversation turns fetched from
   * `GET /chat/web/sessions/:ulid/messages`. Used to hydrate the message
   * log when a returning visitor reopens the widget. Empty or undefined
   * means render the brand-new empty state.
   */
  initialMessages?: ChatMessage[];
}

function postCloseToParent(): void {
  if (typeof window === "undefined") return;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(CLOSE_MESSAGE, "*");
  }
}

function SendIcon(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function CloseIcon(): ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function ChatPanel({
  session,
  initialMessages,
}: ChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? []
  );
  const [draft, setDraft] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Focus the input on mount AND whenever a send finishes. Running this in an
  // effect (rather than inline after ``setIsSending(false)``) guarantees the
  // focus call lands AFTER React has dropped the ``disabled`` attribute —
  // focusing a disabled input is a silent no-op.
  useEffect(() => {
    if (!isSending) {
      inputRef.current?.focus();
    }
  }, [isSending]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        postCloseToParent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages]);

  const submit = useCallback(
    async (raw: string): Promise<void> => {
      const text = raw.trim();
      if (text.length === 0 || isSending) return;

      const userMessage: ChatMessage = {
        id: ulid(),
        role: "user",
        content: text,
      };
      const pendingId = ulid();
      const pendingMessage: ChatMessage = {
        id: pendingId,
        role: "assistant",
        content: "",
        pending: true,
      };

      setMessages((prev) => [...prev, userMessage, pendingMessage]);
      setDraft("");
      setIsSending(true);

      console.debug("[instapaytient] send", {
        sessionUlid: session.sessionUlid,
        length: text.length,
      });

      try {
        const { reply } = await sendMessage({
          sessionUlid: session.sessionUlid,
          message: text,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: pendingId,
                  role: "assistant",
                  content: reply,
                }
              : m
          )
        );
      } catch (err) {
        const status = err instanceof ChatApiError ? err.status : "network";
        console.error("[instapaytient] send failed", {
          sessionUlid: session.sessionUlid,
          status,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? {
                  id: pendingId,
                  role: "assistant",
                  content:
                    "Something went wrong sending that message. Please try again in a moment.",
                  errored: true,
                }
              : m
          )
        );
      } finally {
        setIsSending(false);
      }
    },
    [isSending, session.sessionUlid]
  );

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void submit(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit(draft);
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setDraft(e.target.value);
  };

  const canSend = !isSending && draft.trim().length > 0;

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full bg-background overflow-hidden">
      <header className="flex items-center justify-between bg-accent px-3 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Avatar size="sm" className="shrink-0">
            <Avatar.Fallback className="bg-white text-accent">
              AI
            </Avatar.Fallback>
          </Avatar>
          <div className="leading-tight">
            <h3 className="text-sm font-medium text-accent-foreground">
              {session.displayName}
            </h3>
            <p className="text-xs text-accent-foreground/80">Online</p>
          </div>
        </div>
        <button
          type="button"
          aria-label="Close chat"
          onClick={postCloseToParent}
          className="inline-flex items-center justify-center rounded-full h-8 w-8 text-accent-foreground hover:bg-white/20 transition-colors"
        >
          <CloseIcon />
        </button>
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        data-testid="chat-log"
        className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4 bg-background"
      >
        {messages.length === 0 ? (
          <div className="flex items-start gap-2">
            <Avatar size="sm" className="mt-1 shrink-0">
              <Avatar.Fallback className="bg-accent text-accent-foreground">
                AI
              </Avatar.Fallback>
            </Avatar>
            <div className="rounded-2xl rounded-tl-none bg-surface-secondary px-3 py-2 text-sm text-foreground max-w-[80%]">
              What are you shopping for today?
            </div>
          </div>
        ) : null}
        {messages.map((m) => (
          <ChatMessageView key={m.id} message={m} />
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-default bg-surface-secondary px-3 py-3 shrink-0"
      >
        <Input
          ref={inputRef}
          aria-label="Type your message"
          placeholder="Type your message..."
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={isSending}
          fullWidth
          className="flex-1 rounded-lg border border-default bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <Button
          type="submit"
          variant="primary"
          isIconOnly
          isDisabled={!canSend}
          isPending={isSending}
          aria-label="Send message"
          className="rounded-full h-9 w-9 shrink-0"
        >
          <SendIcon />
        </Button>
      </form>
    </div>
  );
}
