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

import EmbedPage from "@/app/embed/page";
import * as api from "@/lib/api";

// Route the Next navigation hook to a simple in-memory store.
const currentParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => currentParams,
}));

describe("EmbedPage", () => {
  let createSessionSpy: MockInstance<typeof api.createSession>;

  beforeEach(() => {
    currentParams.forEach((_, key) => currentParams.delete(key));
    createSessionSpy = vi.spyOn(api, "createSession");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a session with URL query params and renders the ChatPanel on success", async () => {
    currentParams.set("guestId", "01HGUEST0000000000000000000");
    currentParams.set("agent", "shopping_assistant");
    createSessionSpy.mockResolvedValue({
      sessionUlid: "01HSESSION00000000000000000",
      displayName: "Shopping Assistant",
    });

    render(<EmbedPage />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /shopping assistant/i })
      ).toBeInTheDocument();
    });
    expect(createSessionSpy).toHaveBeenCalledWith(
      {
        agentName: "shopping_assistant",
        guestUlid: "01HGUEST0000000000000000000",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("forwards hostDomain from the URL query params to createSession", async () => {
    currentParams.set("guestId", "01HGUEST0000000000000000000");
    currentParams.set("agent", "shopping_assistant");
    currentParams.set("hostDomain", "practice.example.com");
    createSessionSpy.mockResolvedValue({
      sessionUlid: "01HSESSION00000000000000000",
      displayName: "Shopping Assistant",
    });

    render(<EmbedPage />);

    await waitFor(() => {
      expect(createSessionSpy).toHaveBeenCalledWith(
        {
          agentName: "shopping_assistant",
          guestUlid: "01HGUEST0000000000000000000",
          hostDomain: "practice.example.com",
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  it("renders an error card with a retry button on failure and retries on click", async () => {
    currentParams.set("guestId", "01HGUEST0000000000000000000");
    createSessionSpy
      .mockRejectedValueOnce(new api.ChatApiError("nope", 500, null))
      .mockResolvedValueOnce({
        sessionUlid: "01HSESSION00000000000000000",
        displayName: "Shopping Assistant",
      });

    const user = userEvent.setup();
    render(<EmbedPage />);

    const errorCard = await screen.findByTestId("chat-error-card");
    expect(errorCard).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /shopping assistant/i })
      ).toBeInTheDocument();
    });
    expect(createSessionSpy).toHaveBeenCalledTimes(2);
  });
});
