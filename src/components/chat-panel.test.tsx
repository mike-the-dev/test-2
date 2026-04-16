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

const session = {
  sessionUlid: "01HSESSION00000000000000000",
  displayName: "Shopping Assistant",
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
      sessionUlid: session.sessionUlid,
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
});
