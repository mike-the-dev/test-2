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
import {
  ChatApiError,
  completeOnboarding,
  createSession,
  fetchSessionMessages,
} from "@/lib/api";
import { ensureGuestId } from "@/lib/guest-id";
import type { ChatMessage, SessionInfo } from "@/types/chat";

const DEFAULT_AGENT = "shopping_assistant";

/**
 * Server-authoritative state machine for the embedded chat flow:
 *
 * - ``loading`` — waiting on the initial ``POST /chat/web/sessions`` round-trip.
 * - ``splash`` — session is created but ``onboardingCompletedAt`` is null;
 *   visitor needs to pick a budget before the agent has enough context.
 * - ``hydrating`` — onboarded session found; fetching prior turns before
 *   handing control to ``ChatPanel``.
 * - ``chat`` — everything resolved, ``ChatPanel`` renders with any hydrated
 *   history.
 * - ``error`` — network / server failure at any step. Retryable.
 */
type EmbedState =
  | { status: "loading" }
  | { status: "splash"; session: SessionInfo }
  | { status: "hydrating"; session: SessionInfo }
  | {
      status: "chat";
      session: SessionInfo;
      initialMessages: ChatMessage[];
    }
  | { status: "error"; message: string };

function messageFromApiError(err: unknown): string {
  if (err instanceof ChatApiError) {
    if (err.status === 0) {
      return "We could not reach the chat service. Please try again.";
    }
    if (err.status >= 500) {
      return "The chat service is temporarily unavailable. Please try again.";
    }
    return "We could not start a chat session. Please reload.";
  }
  return "Unexpected error starting chat.";
}

function EmbedBody(): ReactElement {
  const searchParams = useSearchParams();
  const agent = searchParams.get("agent") ?? DEFAULT_AGENT;
  const queryGuestId = searchParams.get("guestId");
  const accountUlid = searchParams.get("accountUlid") ?? "";

  const [state, setState] = useState<EmbedState>({ status: "loading" });
  const [attempt, setAttempt] = useState<number>(0);
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
      { agentName: agent, guestUlid, accountUlid },
      { signal: controller.signal }
    )
      .then(async (session) => {
        if (cancelled) return;

        // Returning visitor — hydrate prior turns before rendering the chat.
        if (session.onboardingCompletedAt) {
          setState({ status: "hydrating", session });
          try {
            const { messages } = await fetchSessionMessages(
              session.sessionUlid,
              { signal: controller.signal }
            );
            if (cancelled || controller.signal.aborted) return;
            setState({
              status: "chat",
              session,
              initialMessages: messages.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
              })),
            });
          } catch (err) {
            if (cancelled || controller.signal.aborted) return;
            // Hydration failure is not fatal — let the visitor continue
            // with an empty log. Their backend context is still intact.
            console.error("[instapaytient] history hydrate failed", {
              status: err instanceof ChatApiError ? err.status : "unknown",
            });
            setState({ status: "chat", session, initialMessages: [] });
          }
          return;
        }

        // First-time visitor — splash for budget.
        setState({ status: "splash", session });
      })
      .catch((err: unknown) => {
        if (cancelled || controller.signal.aborted) return;
        console.error("[instapaytient] session create failed", {
          status: err instanceof ChatApiError ? err.status : "unknown",
        });
        setState({ status: "error", message: messageFromApiError(err) });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agent, queryGuestId, accountUlid, attempt]);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  const handleSplashSubmit = useCallback(
    (budgetCents: number): void => {
      if (state.status !== "splash") return;
      const { session } = state;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      setState({ status: "hydrating", session });

      completeOnboarding(
        session.sessionUlid,
        { budgetCents },
        { signal: controller.signal }
      )
        .then((updated) => {
          if (controller.signal.aborted) return;
          // Fresh onboarding — no prior turns to hydrate, go straight to chat.
          setState({
            status: "chat",
            session: updated,
            initialMessages: [],
          });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          console.error("[instapaytient] onboarding failed", {
            status: err instanceof ChatApiError ? err.status : "unknown",
          });
          setState({ status: "error", message: messageFromApiError(err) });
        });
    },
    [state]
  );

  if (state.status === "loading" || state.status === "hydrating") {
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

  if (state.status === "splash") {
    return <BudgetSplash onSubmit={handleSplashSubmit} />;
  }

  return (
    <ChatPanel
      session={state.session}
      initialMessages={state.initialMessages}
    />
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
