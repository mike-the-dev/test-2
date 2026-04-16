"use client";

import { Link, Spinner } from "@heroui/react";
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
      <div className="flex justify-end" data-testid="chat-message-user">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground break-words">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-start gap-2"
      data-testid="chat-message-assistant"
    >
      <div
        className={[
          "max-w-[80%] rounded-2xl rounded-bl-sm bg-default-100 px-3 py-2 text-foreground break-words",
          message.errored ? "border border-danger" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {message.pending ? (
          <span
            className="inline-flex items-center gap-2 text-default-500"
            aria-label="Assistant is thinking"
          >
            <Spinner size="sm" />
            <span>Thinking...</span>
          </span>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
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
          className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:opacity-90 no-underline"
        >
          Open checkout
        </Link>
      ) : null}
    </div>
  );
}
