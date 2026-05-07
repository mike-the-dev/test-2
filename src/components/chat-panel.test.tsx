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

import { ChatPanel } from "@/components/chat-panel";
import * as api from "@/lib/api";
import type { SendMessageResponse } from "@/types/chat";

const session = {
  sessionId: "01HSESSION00000000000000000",
  displayName: "Shopping Assistant",
  onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
  kickoffCompletedAt: "2026-04-20T12:00:05.000Z",
  splash: null,
  onboardingData: { budgetCents: 100_000 },
};

describe("ChatPanel", () => {
  let sendMessageSpy: MockInstance<typeof api.sendMessage>;

  beforeEach(() => {
    sendMessageSpy = vi.spyOn(api, "sendMessage");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends the user message immediately and replaces the pending bubble with the reply", async () => {
    let resolveSend: (value: { reply: string }) => void = () => undefined;
    sendMessageSpy.mockImplementation(
      () =>
        new Promise<{ reply: string }>((resolve) => {
          resolveSend = resolve;
        })
    );

    const user = userEvent.setup();
    render(<ChatPanel session={session} />);

    const input = screen.getByLabelText(/type your message/i);
    await user.type(input, "hello world");
    await user.keyboard("{Enter}");

    // User bubble shows up right away.
    expect(screen.getByTestId("chat-message-user")).toHaveTextContent(
      "hello world"
    );
    // Pending assistant bubble is rendered while the request is in flight.
    expect(
      screen.getByLabelText(/assistant is thinking/i)
    ).toBeInTheDocument();

    resolveSend({ reply: "Hi! How can I help?" });

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
        "Hi! How can I help?"
      );
    });
    expect(sendMessageSpy).toHaveBeenCalledWith({
      sessionId: session.sessionId,
      message: "hello world",
    });
  });

  it("shows an error bubble when sendMessage rejects", async () => {
    sendMessageSpy.mockRejectedValue(
      new api.ChatApiError("boom", 500, null)
    );

    const user = userEvent.setup();
    render(<ChatPanel session={session} />);

    await user.type(screen.getByLabelText(/type your message/i), "ping");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
        /something went wrong/i
      );
    });
  });

  it("hydrates initialMessages into the log on mount and does not auto-send", async () => {
    render(
      <ChatPanel
        session={session}
        initialMessages={[
          { id: "m1", role: "user", content: "hi from last time" },
          { id: "m2", role: "assistant", content: "welcome back!" },
        ]}
      />
    );

    // Prior turns should be visible immediately.
    expect(screen.getByTestId("chat-message-user")).toHaveTextContent(
      "hi from last time"
    );
    expect(screen.getByTestId("chat-message-assistant")).toHaveTextContent(
      "welcome back!"
    );
    // No outbound request should fire on mount — hydration is render-only.
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("posts a close message to window.parent when Escape is pressed", async () => {
    const postMessageSpy = vi.fn();
    // `window.parent === window` in jsdom, so replace it with a harness.
    const parentProxy = { postMessage: postMessageSpy } as unknown as Window;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentProxy,
    });

    const user = userEvent.setup();
    render(<ChatPanel session={session} />);
    await user.keyboard("{Escape}");

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: "instapaytient:close" },
      "*"
    );
  });

  it("applies within-turn dedupe before attaching toolOutputs — keeps only the last preview_cart", async () => {
    expect.assertions(1);

    const twoPreviewCarts: SendMessageResponse = {
      reply: "here you go",
      toolOutputs: [
        { toolName: "preview_cart", content: '{"cart_id":"C1","lines":[]}' },
        { toolName: "preview_cart", content: '{"cart_id":"C2","lines":[]}' },
      ],
    };
    sendMessageSpy.mockResolvedValue(twoPreviewCarts);

    // We verify by checking the data-testid attributes on rendered cart cards.
    // Only one cart-preview-card should appear (deduplicated to the last entry).
    const user = userEvent.setup();
    render(<ChatPanel session={session} />);

    await user.type(screen.getByLabelText(/type your message/i), "show cart");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      const cards = screen.queryAllByTestId("cart-preview-card");
      expect(cards).toHaveLength(1);
    });
  });

  it("attaches toolOutputs to the resolved assistant message when sendMessage returns them", async () => {
    expect.assertions(1);

    sendMessageSpy.mockResolvedValue({
      reply: "Here is your cart",
      toolOutputs: [
        {
          toolName: "preview_cart",
          content: JSON.stringify({
            cart_id: "C1",
            item_count: 0,
            currency: "usd",
            cart_total: 0,
            lines: [],
          }),
        },
      ],
    });

    const user = userEvent.setup();
    render(<ChatPanel session={session} />);
    await user.type(screen.getByLabelText(/type your message/i), "cart please");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.getByTestId("cart-preview-card")).toBeInTheDocument();
    });
  });
});
