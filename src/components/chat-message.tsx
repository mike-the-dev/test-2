"use client";

import { Avatar, Link, Spinner } from "@heroui/react";
import type { ReactElement } from "react";

import { extractCheckoutUrl } from "@/lib/checkout-url";
import { SafeMarkdown } from "@/lib/markdown";
import type { ChatMessage } from "@/types/chat";

export interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageView({ message }: ChatMessageProps): ReactElement {
  const isUser = message.role === "user";
  const checkoutUrl =
    !isUser && !message.pending ? extractCheckoutUrl(message.content) : null;

  if (isUser) {
    return (
      <div
        data-testid="chat-message-user"
        className="flex flex-row-reverse items-start gap-2"
      >
        <Avatar size="sm" className="mt-1 shrink-0">
          <Avatar.Fallback className="bg-default-200 text-default-700">
            You
          </Avatar.Fallback>
        </Avatar>
        <div className="max-w-[80%] ml-auto">
          <div className="rounded-2xl rounded-tr-none bg-accent px-3 py-2 text-sm text-accent-foreground break-words">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="chat-message-assistant"
      className="flex items-start gap-2"
    >
      <Avatar size="sm" className="mt-1 shrink-0">
        <Avatar.Fallback className="bg-accent text-accent-foreground">
          AI
        </Avatar.Fallback>
      </Avatar>
      <div className="flex flex-col items-start gap-2 max-w-[80%]">
        <div
          className={[
            "rounded-2xl rounded-tl-none px-3 py-2 text-sm text-foreground break-words bg-surface-secondary",
            message.errored ? "border border-danger" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {message.pending ? (
            <span
              className="inline-flex items-center gap-2 text-default-foreground opacity-70"
              aria-label="Assistant is thinking"
            >
              <Spinner size="sm" />
              <span>Thinking...</span>
            </span>
          ) : (
            <div className="prose prose-sm max-w-none prose-headings:text-foreground prose-strong:text-foreground prose-a:text-accent">
              <SafeMarkdown content={message.content} />
            </div>
          )}
        </div>
        {checkoutUrl ? (
          <Link
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="open-checkout-button"
            className="inline-flex items-center justify-center rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground shadow-sm hover:opacity-90 no-underline"
          >
            Open checkout
          </Link>
        ) : null}
      </div>
    </div>
  );
}
