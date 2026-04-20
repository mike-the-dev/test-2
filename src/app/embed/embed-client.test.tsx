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

vi.mock("@/lib/affirm", () => ({
  loadAffirmSdk: vi.fn(),
  refreshAffirmUi: vi.fn(),
}));

const GUEST = "01HGUEST0000000000000000000";
const ACCOUNT = "A#01HACCOUNT0000000000000000";
const SESSION = "01HSESSION00000000000000000";

describe("EmbedClient", () => {
  let createSessionSpy: MockInstance<typeof api.createSession>;
  let completeOnboardingSpy: MockInstance<typeof api.completeOnboarding>;
  let fetchMessagesSpy: MockInstance<typeof api.fetchSessionMessages>;

  beforeEach(() => {
    createSessionSpy = vi.spyOn(api, "createSession");
    completeOnboardingSpy = vi.spyOn(api, "completeOnboarding");
    fetchMessagesSpy = vi.spyOn(api, "fetchSessionMessages");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the budget splash when the server returns a non-onboarded session", async () => {
    createSessionSpy.mockResolvedValue({
      sessionUlid: SESSION,
      displayName: "Shopping Assistant",
      onboardingCompletedAt: null,
      budgetCents: null,
    });

    render(
      <EmbedClient
        agent="shopping_assistant"
        guestId={GUEST}
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("budget-splash")).toBeInTheDocument();
    });
    expect(createSessionSpy).toHaveBeenCalledWith(
      {
        agentName: "shopping_assistant",
        guestUlid: GUEST,
        accountUlid: ACCOUNT,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    // Returning-visitor hydration must NOT fire for new sessions.
    expect(fetchMessagesSpy).not.toHaveBeenCalled();
  });

  it("submitting the splash calls completeOnboarding with budgetCents and flips to ChatPanel", async () => {
    createSessionSpy.mockResolvedValue({
      sessionUlid: SESSION,
      displayName: "Shopping Assistant",
      onboardingCompletedAt: null,
      budgetCents: null,
    });
    completeOnboardingSpy.mockResolvedValue({
      sessionUlid: SESSION,
      displayName: "Shopping Assistant",
      onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
      budgetCents: 100_000,
    });

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        guestId={GUEST}
        accountUlid={ACCOUNT}
      />
    );

    await screen.findByTestId("budget-splash");
    // Default budget is $1,000 → 100_000 cents; just click Start chat.
    await user.click(screen.getByRole("button", { name: /start chat/i }));

    await waitFor(() => {
      expect(completeOnboardingSpy).toHaveBeenCalledWith(
        SESSION,
        { budgetCents: 100_000 },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
    // Splash is gone, ChatPanel is visible.
    await waitFor(() => {
      expect(screen.queryByTestId("budget-splash")).toBeNull();
      expect(
        screen.getByLabelText(/type your message/i)
      ).toBeInTheDocument();
    });
  });

  it("hydrates prior messages and skips the splash for an already-onboarded session", async () => {
    createSessionSpy.mockResolvedValue({
      sessionUlid: SESSION,
      displayName: "Shopping Assistant",
      onboardingCompletedAt: "2026-04-19T10:00:00.000Z",
      budgetCents: 150_000,
    });
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
        guestId={GUEST}
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

  it("falls back to an empty chat when hydration fails for an onboarded session", async () => {
    createSessionSpy.mockResolvedValue({
      sessionUlid: SESSION,
      displayName: "Shopping Assistant",
      onboardingCompletedAt: "2026-04-19T10:00:00.000Z",
      budgetCents: 150_000,
    });
    fetchMessagesSpy.mockRejectedValue(
      new api.ChatApiError("history unavailable", 500, null)
    );

    render(
      <EmbedClient
        agent="shopping_assistant"
        guestId={GUEST}
        accountUlid={ACCOUNT}
      />
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText(/type your message/i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("budget-splash")).toBeNull();
    // History wasn't visible, but the visitor can still send new turns.
    expect(screen.queryByTestId("chat-message-user")).toBeNull();
  });

  it("renders an error card with a retry button on session-create failure and retries on click", async () => {
    createSessionSpy
      .mockRejectedValueOnce(new api.ChatApiError("nope", 500, null))
      .mockResolvedValueOnce({
        sessionUlid: SESSION,
        displayName: "Shopping Assistant",
        onboardingCompletedAt: null,
        budgetCents: null,
      });

    const user = userEvent.setup();
    render(
      <EmbedClient
        agent="shopping_assistant"
        guestId={GUEST}
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
