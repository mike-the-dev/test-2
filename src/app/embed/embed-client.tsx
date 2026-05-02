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
import { readStoredSessionId, writeStoredSessionId } from "@/lib/session-id";
import { dedupeToolOutputsWithinTurn } from "@/lib/tool-renderers";
import type { ChatMessage, SessionInfo } from "@/types/chat";

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
  accountUlid: string;
}

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-30
 * @name EmbedClient
 * @description Client component that drives the 5-state embedded chat machine
 *   (loading → splash | hydrating → chat | error). Receives pre-validated
 *   props from the parent Server Component instead of reading search params
 *   directly, so no Suspense boundary is required.
 * @param agent - The agent name to use for the chat session.
 * @param accountUlid - The account ID for session creation.
 * @returns The appropriate UI for the current state.
 */
export const EmbedClient = ({
  agent,
  accountUlid,
}: EmbedClientProps): ReactElement => {
  const [state, setState] = useState<EmbedState>({ status: "loading" });
  const [attempt, setAttempt] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setState({ status: "loading" });

    console.debug("[instapaytient] session create", { agent });

    const storedSessionId = readStoredSessionId();

    const run = async (): Promise<void> => {
      try {
        const session = await createSession(
          { agentName: agent, accountUlid, ...(storedSessionId !== null ? { sessionId: storedSessionId } : {}) },
          { signal: controller.signal }
        );

        if (cancelled) return;

        writeStoredSessionId(session.sessionId);

        if (session.onboardingCompletedAt) {
          setState({ status: "hydrating", session });

          let hydratedMessages: ChatMessage[] = [];
          try {
            const { messages } = await fetchSessionMessages(
              session.sessionId,
              { signal: controller.signal }
            );
            if (cancelled || controller.signal.aborted) return;
            hydratedMessages = messages
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
              }));
          } catch (err) {
            if (cancelled || controller.signal.aborted) return;
            console.error("[instapaytient] history hydrate failed", {
              status: err instanceof ChatApiError ? err.status : "unknown",
            });
          }

          if (session.kickoffCompletedAt === null) {
            setState({ status: "kickoff", session });
            try {
              const response = await sendMessage(
                { sessionId: session.sessionId, message: SESSION_KICKOFF_CONTENT },
                { signal: controller.signal }
              );
              if (cancelled || controller.signal.aborted) return;
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
                session,
                initialMessages: [greeting, ...hydratedMessages],
              });
            } catch (err) {
              if (cancelled || controller.signal.aborted) return;
              console.error("[instapaytient] kickoff failed (returning visitor)", {
                status: err instanceof ChatApiError ? err.status : "unknown",
              });
              setState({ status: "chat", session, initialMessages: hydratedMessages });
            }
            return;
          }

          setState({ status: "chat", session, initialMessages: hydratedMessages });
          return;
        }

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
  }, [agent, accountUlid, attempt]);

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
        // `cancelled` (useEffect scope) is not reachable from this callback; abort relies on `controller.signal`.
        let updated: SessionInfo;
        try {
          updated = await completeOnboarding(
            session.sessionId,
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

        if (updated.kickoffCompletedAt !== null) {
          setState({ status: "chat", session: updated, initialMessages: [] });
          return;
        }

        setState({ status: "kickoff", session: updated });

        try {
          const response = await sendMessage(
            {
              sessionId: updated.sessionId,
              message: SESSION_KICKOFF_CONTENT,
            },
            { signal: controller.signal }
          );
          if (controller.signal.aborted) return;

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
          // Kickoff is a nice-to-have — fall through rather than erroring out.
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
