"use client";

import { Spinner } from "@heroui/react";
import { useSearchParams } from "next/navigation";
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { BudgetSplash } from "@/components/budget-splash";
import { ChatErrorCard } from "@/components/chat-error-card";
import { ChatPanel } from "@/components/chat-panel";
import { ChatApiError, createSession } from "@/lib/api";
import { ensureGuestId } from "@/lib/guest-id";
import type { SessionInfo } from "@/types/chat";

const DEFAULT_AGENT = "shopping_assistant";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; session: SessionInfo }
  | { status: "error"; message: string };

function EmbedBody(): ReactElement {
  const searchParams = useSearchParams();
  const agent = searchParams.get("agent") ?? DEFAULT_AGENT;
  const queryGuestId = searchParams.get("guestId");
  const hostDomain = searchParams.get("hostDomain") ?? undefined;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState<number>(0);
  const [budgetDollars, setBudgetDollars] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let guestUlid: string;
    try {
      guestUlid =
        queryGuestId && queryGuestId.length > 0
          ? queryGuestId
          : ensureGuestId();
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "guest id unavailable";
      setState({ status: "error", message: reason });
      return () => undefined;
    }

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setState({ status: "loading" });

    console.debug("[instapaytient] session create", { agent });

    createSession(
      { agentName: agent, guestUlid, hostDomain },
      { signal: controller.signal }
    )
      .then((session) => {
        if (cancelled) return;
        setState({ status: "ready", session });
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        const message =
          err instanceof ChatApiError
            ? err.status === 0
              ? "We could not reach the chat service. Please try again."
              : err.status >= 500
                ? "The chat service is temporarily unavailable. Please try again."
                : "We could not start a chat session. Please reload."
            : "Unexpected error starting chat.";
        console.error("[instapaytient] session create failed", {
          status: err instanceof ChatApiError ? err.status : "unknown",
        });
        setState({ status: "error", message });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agent, queryGuestId, hostDomain, attempt]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  if (state.status === "loading") {
    return (
      <div
        className="flex flex-1 w-full items-center justify-center"
        data-testid="embed-loading"
      >
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 w-full items-center justify-center p-6">
        <ChatErrorCard message={state.message} onRetry={retry} />
      </div>
    );
  }

  if (budgetDollars === null) {
    return <BudgetSplash onSubmit={setBudgetDollars} />;
  }

  const initialMessage = `Hi! My budget is about $${budgetDollars.toLocaleString(
    "en-US"
  )}. Can you help me find options that fit?`;

  return (
    <ChatPanel session={state.session} initialUserMessage={initialMessage} />
  );
}

export default function EmbedPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 w-full items-center justify-center">
          <Spinner size="lg" color="accent" />
        </div>
      }
    >
      <EmbedBody />
    </Suspense>
  );
}
