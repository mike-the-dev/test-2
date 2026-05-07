import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

import { EmbedClient } from "@/app/embed/embed-client";
import * as api from "@/lib/api";
import type { SessionInfo, SplashConfig } from "@/types/chat";

vi.mock("@/lib/affirm", () => ({
  loadAffirmSdk: vi.fn(),
  refreshAffirmUi: vi.fn(),
}));

const ACCOUNT = "A#01HACCOUNT0000000000000000";
const SESSION = "01HSESSION00000000000000000";

const validSplash: SplashConfig = {
  fields: [{ kind: "budget", key: "budgetCents", label: "What's your budget?", required: true }],
};

describe("EmbedClient", () => {
  let createSessionSpy: MockInstance<typeof api.createSession>;
  let completeOnboardingSpy: MockInstance<typeof api.completeOnboarding>;
  let fetchMessagesSpy: MockInstance<typeof api.fetchSessionMessages>;
  let sendMessageSpy: MockInstance<typeof api.sendMessage>;

  const makeSession = (overrides: Partial<SessionInfo> = {}): SessionInfo => ({
    sessionId: SESSION,
    displayName: "Shopping Assistant",
    onboardingCompletedAt: null,
    kickoffCompletedAt: null,
    splash: validSplash,
    onboardingData: null,
    ...overrides,
  });

  beforeEach(() => {
    localStorage.clear();
    createSessionSpy = vi.spyOn(api, "createSession");
    completeOnboardingSpy = vi.spyOn(api, "completeOnboarding");
    fetchMessagesSpy = vi.spyOn(api, "fetchSessionMessages");
    sendMessageSpy = vi.spyOn(api, "sendMessage");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders the budget splash when the server returns a non-onboarded session", async () => {
    createSessionSpy.mockResolvedValue(makeSession());

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("budget-splash")).toBeInTheDocument();
    });
    expect(createSessionSpy).toHaveBeenCalledWith(
      {
        agentName: "shopping_assistant",
        accountUlid: ACCOUNT,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // Returning-visitor hydration must NOT fire for new sessions.
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("skips the splash and goes straight to chat for an agent with splash: null (lead_capture path)", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ splash: null, onboardingData: null, onboardingCompletedAt: null, kickoffCompletedAt: "2026-04-20T12:00:05.000Z" })
    );
    fetchMessagesSpy.mockResolvedValue({ messages: [] });

    render(
      <EmbedClient
        agent="lead_capture"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/type your message/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
    expect(completeOnboardingSpy).not.toHaveBeenCalled();
  });

  it("renders the budget splash when splash is non-null and onboardingCompletedAt is null", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ splash: validSplash, onboardingData: null, onboardingCompletedAt: null })
    );

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("budget-splash")).toBeInTheDocument();
    });
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("transitions to the error state when splash has no budget field", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({
        splash: { fields: [{ kind: "industry", key: "industry", label: "Your industry", options: ["Retail"], required: true }] },
        onboardingData: null,
        onboardingCompletedAt: null,
      })
    );

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-error-card")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
  });

  it("surfaces a 400 Zod error inline on the splash without transitioning to the error state", async () => {
    createSessionSpy.mockResolvedValue(makeSession());
    completeOnboardingSpy.mockRejectedValue(
      new api.ChatApiError("onboarding failed", 400, {
        message: "Too small: expected number to be >0",
        error: "Bad Request",
        statusCode: 400,
      })
    );

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId("splash-submit-error")).toHaveTextContent(
        "Too small: expected number to be >0"
      );
    });
    // Splash must remain mounted — no transition to error state.
    expect(screen.getByTestId("budget-splash")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-error-card")).toBeNull();
  });

  it("transitions to the full-screen error state on a 400 'this agent has no onboarding' body", async () => {
    createSessionSpy.mockResolvedValue(makeSession());
    completeOnboardingSpy.mockRejectedValue(
      new api.ChatApiError("onboarding failed", 400, {
        message: "this agent has no onboarding",
        error: "Bad Request",
        statusCode: 400,
      })
    );

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-error-card")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
  });

  it("transitions to the error state on 404 from completeOnboarding", async () => {
    createSessionSpy.mockResolvedValue(makeSession());
    completeOnboardingSpy.mockRejectedValue(
      new api.ChatApiError("not found", 404, { error: "Not Found" })
    );

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-error-card")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
  });

  it("submitting the splash calls completeOnboarding, fires the kickoff, and seeds the chat with the greeting", async () => {
    createSessionSpy.mockResolvedValue(makeSession());
    completeOnboardingSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-20T12:00:00.000Z", kickoffCompletedAt: null, onboardingData: { budgetCents: 100_000 } })
    );
    sendMessageSpy.mockResolvedValue({
      reply: "Welcome! What can I help you find today?",
    });

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(completeOnboardingSpy).toHaveBeenCalledWith(
        SESSION,
        { onboardingData: { budgetCents: 100_000 } },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await waitFor(() => {
      expect(sendMessageSpy).toHaveBeenCalledWith(
        { sessionId: SESSION, message: "__SESSION_KICKOFF__" },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("budget-splash")).toBeNull();
      expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
        "Welcome! What can I help you find today?"
      );
      expect(screen.getByLabelText(/type your message/i)).toBeInTheDocument();
    });
  });

  it("falls back to an empty chat when the kickoff sendMessage fails", async () => {
    createSessionSpy.mockResolvedValue(makeSession());
    completeOnboardingSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-20T12:00:00.000Z", kickoffCompletedAt: null, onboardingData: { budgetCents: 100_000 } })
    );
    sendMessageSpy.mockRejectedValue(
      new api.ChatApiError("kickoff blew up", 500, null)
    );

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/type your message/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("chat-message-assistant")).toBeNull();
  });

  it("skips kickoff on first-time path when onboarding response already has kickoffCompletedAt stamped", async () => {
    createSessionSpy.mockResolvedValue(makeSession({ kickoffCompletedAt: null, onboardingCompletedAt: null }));
    completeOnboardingSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-20T12:00:00.000Z", kickoffCompletedAt: "2026-04-20T12:34:56.000Z", onboardingData: { budgetCents: 100_000 } })
    );

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/type your message/i)).toBeInTheDocument();
    });
    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("chat-message-assistant")).toBeNull();
  });

  it("skips kickoff on returning-visitor path when session-create response has kickoffCompletedAt stamped", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: "2026-04-19T10:00:05.000Z", onboardingData: { budgetCents: 100_000 } })
    );
    fetchMessagesSpy.mockResolvedValue({
      messages: [
        {
          id: "m1",
          role: "user",
          content: "from yesterday",
          timestamp: "2026-04-19T10:01:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "welcome back!",
          timestamp: "2026-04-19T10:01:02.000Z",
        },
      ],
    });

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-user")).toHaveTextContent(
        "from yesterday"
      );
    });
    expect(sendMessageSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
      "welcome back!"
    );
  });

  it("dispatches kickoff on returning-visitor path when kickoffCompletedAt is null", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: null, onboardingData: { budgetCents: 100_000 } })
    );
    fetchMessagesSpy.mockResolvedValue({
      messages: [
        {
          id: "m1",
          role: "user",
          content: "from yesterday",
          timestamp: "2026-04-19T10:01:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "old reply",
          timestamp: "2026-04-19T10:01:02.000Z",
        },
      ],
    });
    sendMessageSpy.mockResolvedValue({
      reply: "Welcome back!",
    });

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(sendMessageSpy).toHaveBeenCalledWith(
        { sessionId: SESSION, message: "__SESSION_KICKOFF__" },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    const messageEls = await screen.findAllByTestId("chat-message-assistant");
    expect(messageEls[0]).toHaveTextContent("Welcome back!");
    expect(messageEls[1]).toHaveTextContent("old reply");
  });

  it("falls back to hydrated history when returning-visitor kickoff fails", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: null, onboardingData: { budgetCents: 100_000 } })
    );
    fetchMessagesSpy.mockResolvedValue({
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "old reply",
          timestamp: "2026-04-19T10:01:02.000Z",
        },
      ],
    });
    sendMessageSpy.mockRejectedValue(
      new api.ChatApiError("kickoff blew up", 500, null)
    );

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/type your message/i)).toBeInTheDocument();
    });
    const assistantMessages = screen.getAllByTestId("chat-message-assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]).toHaveTextContent("old reply");
  });

  it("hydrates prior messages and skips the splash for an already-onboarded session", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: "2026-04-19T10:00:05.000Z", onboardingData: { budgetCents: 150_000 } })
    );
    fetchMessagesSpy.mockResolvedValue({
      messages: [
        {
          id: "m1",
          role: "user",
          content: "from yesterday",
          timestamp: "2026-04-19T10:01:00.000Z",
        },
        {
          id: "m2",
          role: "assistant",
          content: "welcome back!",
          timestamp: "2026-04-19T10:01:02.000Z",
        },
      ],
    });

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-user")).toHaveTextContent(
        "from yesterday"
      );
    });
    expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
      "welcome back!"
    );
    expect(screen.queryByTestId("budget-splash")).toBeNull();
    expect(fetchMessagesSpy).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // Splash submit must not fire for returning visitors.
    expect(completeOnboardingSpy).not.toHaveBeenCalled();
  });

  it("filters __SESSION_KICKOFF__ user turns out of hydrated history", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: "2026-04-19T10:00:05.000Z", onboardingData: { budgetCents: 150_000 } })
    );
    fetchMessagesSpy.mockResolvedValue({
      messages: [
        {
          id: "m0",
          role: "user",
          content: "__SESSION_KICKOFF__",
          timestamp: "2026-04-19T10:00:59.000Z",
        },
        {
          id: "m1",
          role: "assistant",
          content: "Welcome back!",
          timestamp: "2026-04-19T10:01:00.000Z",
        },
      ],
    });

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
        "Welcome back!"
      );
    });
    expect(screen.queryByTestId("chat-message-user")).toBeNull();
  });

  it("falls back to an empty chat when hydration fails for an onboarded session", async () => {
    createSessionSpy.mockResolvedValue(
      makeSession({ onboardingCompletedAt: "2026-04-19T10:00:00.000Z", kickoffCompletedAt: "2026-04-19T10:00:05.000Z", onboardingData: { budgetCents: 150_000 } })
    );
    fetchMessagesSpy.mockRejectedValue(
      new api.ChatApiError("history unavailable", 500, null)
    );

    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText(/type your message/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
    expect(screen.queryByTestId("chat-message-user")).toBeNull();
  });

  it("renders an error card with a retry button on session-create failure and retries on click", async () => {
    createSessionSpy
      .mockRejectedValueOnce(new api.ChatApiError("nope", 500, null))
      .mockResolvedValueOnce(makeSession());

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        accountUlid={ACCOUNT}
      />
    );

    const errorCard = await screen.findByTestId("chat-error-card");
    expect(errorCard).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByTestId("budget-splash")).toBeInTheDocument();
    });
    expect(createSessionSpy).toHaveBeenCalledTimes(2);
  });
});
