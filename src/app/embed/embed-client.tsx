"use client";

import { Spinner } from "@heroui/react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ulid } from "ulid";

import { BudgetSplash } from "@/components/budget-splash";
import { ChatErrorCard } from "@/components/chat-error-card";
import { ChatPanel } from "@/components/chat-panel";
import {
  ChatApiError,
  completeOnboarding,
  createSession,
  fetchSessionMessages,
  sendMessage,
  SESSION_KICKOFF_CONTENT,
} from "@/lib/api";
import { ensureGuestId } from "@/lib/guest-id";
import { dedupeToolOutputsWithinTurn } from "@/lib/tool-renderers";
import type { ChatMessage, SessionInfo } from "@/types/chat";

const kickoffStorageKey = (sessionUlid: string): string =>
  `instapaytient_kickoff_${sessionUlid}`;

const hasKickoffFired = (sessionUlid: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(kickoffStorageKey(sessionUlid)) === "1";
  } catch {
    return false;
  }
};

const markKickoffFired = (sessionUlid: string): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(kickoffStorageKey(sessionUlid), "1");
  } catch {
    // Safari private mode, storage disabled — swallow; guard is best-effort only.
  }
};

/**
 * Server-authoritative state machine for the embedded chat flow:
 *
 * - ``loading`` — waiting on the initial ``POST /chat/web/sessions`` round-trip.
 * - ``splash`` — session is created but ``onboardingCompletedAt`` is null;
 *   visitor needs to pick a budget before the agent has enough context.
 * - ``hydrating`` — onboarded session found; fetching prior turns before
 *   handing control to ``ChatPanel``.
 * - ``kickoff`` — post-onboarding; waiting on the ``__SESSION_KICKOFF__``
 *   response that seeds the chat with the agent's opening greeting.
 * - ``chat`` — everything resolved, ``ChatPanel`` renders with any hydrated
 *   history.
 * - ``error`` — network / server failure at any step. Retryable.
 */
type EmbedState =
  | { status: "loading" }
  | { status: "splash"; session: SessionInfo }
  | { status: "hydrating"; session: SessionInfo }
  | { status: "kickoff"; session: SessionInfo }
  | {
      status: "chat";
      session: SessionInfo;
      initialMessages: ChatMessage[];
    }
  | { status: "error"; message: string };

const messageFromApiError = (err: unknown): string => {
  if (err instanceof ChatApiError) {
    if (err.status === 0) return "We could not reach the chat service. Please try again.";
    if (err.status >= 500) return "The chat service is temporarily unavailable. Please try again.";
    return "We could not start a chat session. Please reload.";
  }
  return "Unexpected error starting chat.";
};

export interface EmbedClientProps {
  agent: string;
  guestId: string | null;
  accountUlid: string;
}

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name EmbedClient
 * @description Client component that drives the 5-state embedded chat machine
 *   (loading → splash | hydrating → chat | error). Receives pre-validated
 *   props from the parent Server Component instead of reading search params
 *   directly, so no Suspense boundary is required.
 * @param agent - The agent name to use for the chat session.
 * @param guestId - Optional pre-existing guest ULID; falls back to localStorage.
 * @param accountUlid - The account ULID for session creation.
 * @returns The appropriate UI for the current state.
 */
export const EmbedClient = ({
  agent,
  guestId,
  accountUlid,
}: EmbedClientProps): ReactElement => {
  const [state, setState] = useState<EmbedState>({ status: "loading" });
  const [attempt, setAttempt] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    let guestUlid: string;
    try {
      guestUlid =
        guestId && guestId.length > 0 ? guestId : ensureGuestId();
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

    const run = async (): Promise<void> => {
      try {
        const session = await createSession(
          { agentName: agent, guestUlid, accountUlid },
          { signal: controller.signal }
        );

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
              initialMessages: messages
                .filter(
                  (message) =>
                    !(
                      message.role === "user" &&
                      message.content === SESSION_KICKOFF_CONTENT
                    )
                )
                .map((message) => ({
                  id: message.id,
                  role: message.role,
                  content: message.content,
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
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.error("[instapaytient] session create failed", {
          status: err instanceof ChatApiError ? err.status : "unknown",
        });
        setState({ status: "error", message: messageFromApiError(err) });
      }
    };

    void run();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [agent, guestId, accountUlid, attempt]);

  const retry = useCallback(() => {
    setAttempt((previousAttempt) => previousAttempt + 1);
  }, []);

  const handleSplashSubmit = useCallback(
    (budgetCents: number): void => {
      if (state.status !== "splash") return;
      const { session } = state;
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      setState({ status: "hydrating", session });

      const submitOnboarding = async (): Promise<void> => {
        let updated: SessionInfo;
        try {
          updated = await completeOnboarding(
            session.sessionUlid,
            { budgetCents },
            { signal: controller.signal }
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("[instapaytient] onboarding failed", {
            status: err instanceof ChatApiError ? err.status : "unknown",
          });
          setState({ status: "error", message: messageFromApiError(err) });
          return;
        }
        if (controller.signal.aborted) return;

        // Frontend guard — if the kickoff has already fired for this session
        // ULID (double-click, state replay), skip and drop into empty chat.
        if (hasKickoffFired(updated.sessionUlid)) {
          setState({ status: "chat", session: updated, initialMessages: [] });
          return;
        }

        setState({ status: "kickoff", session: updated });

        try {
          const response = await sendMessage(
            {
              sessionUlid: updated.sessionUlid,
              message: SESSION_KICKOFF_CONTENT,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;

          // Set the guard AFTER success. A failed kickoff leaves no trace so a
          // retry (page reload) can try again instead of being stuck.
          markKickoffFired(updated.sessionUlid);

          const deduped =
            response.toolOutputs !== undefined
              ? dedupeToolOutputsWithinTurn(response.toolOutputs)
              : undefined;

          const greeting: ChatMessage = {
            id: ulid(),
            role: "assistant",
            content: response.reply,
            ...(deduped !== undefined && deduped.length > 0
              ? { toolOutputs: deduped }
              : {}),
          };

          setState({
            status: "chat",
            session: updated,
            initialMessages: [greeting],
          });
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("[instapaytient] kickoff failed", {
            status: err instanceof ChatApiError ? err.status : "unknown",
          });
          // Kickoff is a nice-to-have — if it fails, visitor still gets a
          // working (empty) chat instead of an error card.
          setState({ status: "chat", session: updated, initialMessages: [] });
        }
      };

      void submitOnboarding();
    },
    [state]
  );

  if (
    state.status === "loading" ||
    state.status === "hydrating" ||
    state.status === "kickoff"
  ) {
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
};
