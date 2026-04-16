"use client";

import { Button, CloseButton, Input } from "@heroui/react";
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
}

function postCloseToParent(): void {
  if (typeof window === "undefined") return;
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(CLOSE_MESSAGE, "*");
  }
}

export function ChatPanel({ session }: ChatPanelProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Focus the input on mount so the visitor can start typing immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc anywhere inside the panel closes the widget.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        postCloseToParent();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Autoscroll the log to the bottom when new messages arrive.
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
        const status =
          err instanceof ChatApiError ? err.status : "network";
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
        // Return focus to the input so the visitor can keep typing.
        inputRef.current?.focus();
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

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="flex items-center justify-between border-b border-default-200 px-4 py-3">
        <h1 className="text-base font-semibold text-foreground">
          {session.displayName}
        </h1>
        <CloseButton aria-label="Close chat" onPress={postCloseToParent} />
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        data-testid="chat-log"
        className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3"
      >
        {messages.length === 0 ? (
          <p className="text-sm text-default-500">
            Ask me about products, pricing, or start a new cart.
          </p>
        ) : null}
        {messages.map((m) => (
          <ChatMessageView key={m.id} message={m} />
        ))}
      </div>

      <form
        onSubmit={onSubmit}
        className="flex items-center gap-2 border-t border-default-200 px-3 py-3"
      >
        <Input
          ref={inputRef}
          aria-label="Type your message"
          placeholder="Type a message..."
          value={draft}
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={isSending}
          fullWidth
          className="flex-1"
        />
        <Button
          type="submit"
          variant="primary"
          isDisabled={isSending || draft.trim().length === 0}
          isPending={isSending}
        >
          Send
        </Button>
      </form>
    </div>
  );
}
