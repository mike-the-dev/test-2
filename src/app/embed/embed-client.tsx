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
import type { ChatMessage, SessionInfo, SplashConfigOnboardingFieldBudget } from "@/types/chat";

/**
 * Server-authoritative state machine for the embedded chat flow:
 *
 * - ``loading`` — waiting on the initial ``POST /chat/web/sessions`` round-trip.
 * - ``splash`` — session is created, splash config is non-null, and
 *   ``onboardingCompletedAt`` is null; visitor needs to fill out the splash
 *   before the agent has enough context. Carries the budget field extracted
 *   from ``session.splash``.
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
  | { status: "splash"; session: SessionInfo; budgetField: SplashConfigOnboardingFieldBudget }
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
 * @lastUpdated 2026-05-07
 * @name EmbedClient
 * @description Client component that drives the 5-state embedded chat machine
 *   (loading → splash | hydrating → chat | error). Receives pre-validated
 *   props from the parent Server Component instead of reading search params
 *   directly, so no Suspense boundary is required. Splash rendering is
 *   server-driven: the session-create response carries a `splash` config
 *   (`null` for agents with no onboarding). The embed skips the splash when
 *   `splash === null` OR when `onboardingCompletedAt !== null` (resumed session).
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /**
   * Shared post-onboarding sequence: hydrate history, fire kickoff if needed,
   * then transition to chat. Used by both the initial-load resumed path and
   * the post-splash-submit path.
   *
   * @param session - The fully-onboarded session to hydrate.
   * @param signal - AbortSignal from the active controller.
   */
  const hydrateAndKickoff = useCallback(async (
    session: SessionInfo,
    signal: AbortSignal
  ): Promise<void> => {
    setState({ status: "hydrating", session });

    let hydratedMessages: ChatMessage[] = [];
    try {
      const { messages } = await fetchSessionMessages(
        session.sessionId,
        { signal }
      );
      if (signal.aborted) return;
      const visibleMessages = messages.filter(
        (message) =>
          !(message.role === "user" && message.content === SESSION_KICKOFF_CONTENT)
      );
      hydratedMessages = visibleMessages.map((message) => {
        return { id: message.id, role: message.role, content: message.content };
      });
    } catch (err) {
      if (signal.aborted) return;
      console.error("[instapaytient] history hydrate failed", {
        status: err instanceof ChatApiError ? err.status : "unknown",
      });
    }

    if (session.kickoffCompletedAt === null) {
      setState({ status: "kickoff", session });
      try {
        const response = await sendMessage(
          { sessionId: session.sessionId, message: SESSION_KICKOFF_CONTENT },
          { signal }
        );
        if (signal.aborted) return;
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
        if (signal.aborted) return;
        console.error("[instapaytient] kickoff failed", {
          status: err instanceof ChatApiError ? err.status : "unknown",
        });
        setState({ status: "chat", session, initialMessages: hydratedMessages });
      }
      return;
    }

    setState({ status: "chat", session, initialMessages: hydratedMessages });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    setState({ status: "loading" });
    setSubmitError(null);

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

        if (session.splash === null || session.onboardingCompletedAt !== null) {
          await hydrateAndKickoff(session, controller.signal);
          return;
        }

        const foundField = session.splash.fields.find((field) => field.kind === "budget");

        if (foundField === undefined || foundField.kind !== "budget") {
          console.error(
            "[instapaytient] splash config has no budget field — add a renderer for this agent",
            { splash: session.splash }
          );
          setState({ status: "error", message: "We couldn't load this experience." });
          return;
        }

        setState({ status: "splash", session, budgetField: foundField });
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
  }, [agent, accountUlid, attempt, hydrateAndKickoff]);

  const retry = useCallback(() => {
    setAttempt((previousAttempt) => previousAttempt + 1);
  }, []);

  /**
   * @author mike-the-dev (Michael Camacho)
   * @editor mike-the-dev (Michael Camacho)
   * @lastUpdated 2026-05-07
   * @name handleSplashSubmit
   * @description Submits the collected onboarding data to the backend, handles
   *   400 Zod validation errors inline (surfacing the message on the splash
   *   without transitioning away), and delegates all other errors to the
   *   full-screen error card. On success, calls `hydrateAndKickoff` to proceed
   *   to chat. The splash remains mounted throughout the request so a 400 can
   *   be corrected without rebuilding state.
   * @param onboardingData - Arbitrary key→value map collected by the splash component.
   * @returns void
   */
  const handleSplashSubmit = useCallback(
    (onboardingData: Record<string, unknown>): void => {
      if (state.status !== "splash") return;
      const { session } = state;

      setSubmitError(null);

      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;

      const submitOnboarding = async (): Promise<void> => {
        let updated: SessionInfo;
        try {
          updated = await completeOnboarding(
            session.sessionId,
            { onboardingData },
            { signal: controller.signal }
          );
        } catch (err) {
          if (controller.signal.aborted) return;
          if (err instanceof ChatApiError && err.status === 400) {
            const rawMessage = (err.body as { message?: unknown } | null)?.message;
            const messageText =
              typeof rawMessage === "string"
                ? rawMessage
                : "Invalid submission. Please check your input.";
            if (messageText === "this agent has no onboarding") {
              console.error(
                "[instapaytient] onboarding called for agent with no onboarding config",
                { sessionId: session.sessionId }
              );
              setState({ status: "error", message: "We couldn't complete setup. Please reload." });
              return;
            }
            setSubmitError(messageText);
            return;
          }
          console.error("[instapaytient] onboarding failed", {
            status: err instanceof ChatApiError ? err.status : "unknown",
          });
          setState({ status: "error", message: messageFromApiError(err) });
          return;
        }

        if (controller.signal.aborted) return;

        await hydrateAndKickoff(updated, controller.signal);
      };

      void submitOnboarding();
    },
    [state, hydrateAndKickoff]
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
    return (
      <BudgetSplash
        field={state.budgetField}
        onSubmit={handleSplashSubmit}
        submitError={submitError}
      />
    );
  }

  return (
    <ChatPanel
      session={state.session}
      initialMessages={state.initialMessages}
    />
  );
};
