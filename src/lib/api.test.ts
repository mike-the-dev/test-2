import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatApiError,
  authorizeEmbed,
  completeOnboarding,
  createSession,
  fetchSessionMessages,
  sendMessage,
} from "@/lib/api";
import { SESSION_ID_KEY } from "@/lib/session-id";

function mockFetchOnce(response: {
  ok: boolean;
  status: number;
  body: unknown;
}): void {
  const text =
    response.body === null || response.body === undefined
      ? ""
      : typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body);

  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: () => Promise.resolve(text),
      })
    )
  );
}

function mockFetchSequence(
  responses: Array<{ ok: boolean; status: number; body: unknown }>
): void {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const response = responses[call] ?? responses[responses.length - 1];
      call += 1;
      const text =
        response.body === null || response.body === undefined
          ? ""
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body);
      return Promise.resolve({
        ok: response.ok,
        status: response.status,
        text: () => Promise.resolve(text),
      });
    })
  );
}

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe("createSession", () => {
    it("posts to /chat/web/sessions with JSON body and headers", async () => {
      mockFetchOnce({
        ok: true,
        status: 200,
        body: {
          sessionId: "S1",
          displayName: "Shopping Assistant",
          onboardingCompletedAt: null,
          kickoffCompletedAt: null,
          splash: null,
          onboardingData: null,
        },
      });

      const result = await createSession({
        agentName: "shopping_assistant",
        accountUlid: "A#01HACCOUNT0000000000000000",
      });

      expect(result).toEqual({
        sessionId: "S1",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: null,
        kickoffCompletedAt: null,
        splash: null,
        onboardingData: null,
      });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:8081/chat/web/sessions");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ "Content-Type": "application/json" });
      expect(init.body).toBe(
        JSON.stringify({
          agentName: "shopping_assistant",
          accountUlid: "A#01HACCOUNT0000000000000000",
        })
      );
    });

    it("serializes accountUlid verbatim (no prefix stripping) in the body", async () => {
      mockFetchOnce({
        ok: true,
        status: 200,
        body: {
          sessionId: "S1",
          displayName: "Shopping Assistant",
          onboardingCompletedAt: null,
          kickoffCompletedAt: null,
          splash: null,
          onboardingData: null,
        },
      });

      await createSession({
        agentName: "shopping_assistant",
        accountUlid: "A#01K2XR5G6G22TB71SJCA823ESB",
      });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        agentName: "shopping_assistant",
        accountUlid: "A#01K2XR5G6G22TB71SJCA823ESB",
      });
    });

    it("sends sessionId in body when provided", async () => {
      mockFetchOnce({
        ok: true,
        status: 201,
        body: {
          sessionId: "S1",
          displayName: "Shopping Assistant",
          onboardingCompletedAt: null,
          kickoffCompletedAt: null,
          splash: null,
          onboardingData: null,
        },
      });

      await createSession({
        agentName: "a",
        accountUlid: "A#x",
        sessionId: "01HSTORED",
      });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toMatchObject({
        sessionId: "01HSTORED",
      });
    });

    it("clears localStorage and retries createSession without sessionId on 400", async () => {
      localStorage.setItem(SESSION_ID_KEY, "01HSTALE");

      const freshSession = {
        sessionId: "01HNEWSESSION",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: null,
        kickoffCompletedAt: null,
        splash: null,
        onboardingData: null,
      };

      mockFetchSequence([
        { ok: false, status: 400, body: { error: "invalid session id format" } },
        { ok: true, status: 201, body: freshSession },
      ]);

      const result = await createSession({
        agentName: "shopping_assistant",
        accountUlid: "A#01HACCOUNT0000000000000000",
        sessionId: "01HSTALE",
      });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      const retryBody = JSON.parse(retryInit.body as string);
      expect(retryBody).not.toHaveProperty("sessionId");

      expect(localStorage.getItem(SESSION_ID_KEY)).toBeNull();
      expect(result).toEqual(freshSession);
    });

    it("surfaces ChatApiError when both initial and retry fetches return 400", async () => {
      mockFetchSequence([
        { ok: false, status: 400, body: { error: "invalid session id format" } },
        { ok: false, status: 400, body: { error: "still bad" } },
      ]);

      await expect(
        createSession({
          agentName: "shopping_assistant",
          accountUlid: "A#01HACCOUNT0000000000000000",
          sessionId: "01HSTALE",
        })
      ).rejects.toMatchObject({ name: "ChatApiError", status: 400 });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws ChatApiError with status and parsed body on 4xx (no sessionId — no retry)", async () => {
      mockFetchOnce({
        ok: false,
        status: 400,
        body: { error: "bad request" },
      });

      await expect(
        createSession({
          agentName: "shopping_assistant",
          accountUlid: "A#01HACCOUNT0000000000000000",
        })
      ).rejects.toMatchObject({
        name: "ChatApiError",
        status: 400,
        body: { error: "bad request" },
      });

      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws ChatApiError with status 0 on network failure", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Failed to fetch");
        })
      );

      const err = await createSession({
        agentName: "shopping_assistant",
        accountUlid: "A#01HACCOUNT0000000000000000",
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ChatApiError);
      expect((err as ChatApiError).status).toBe(0);
      expect((err as ChatApiError).body).toBeNull();
    });
  });

  it("completeOnboarding posts to the session's onboarding endpoint with onboardingData body and returns the updated session", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        sessionId: "S1",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
        kickoffCompletedAt: null,
        splash: null,
        onboardingData: { budgetCents: 150_000 },
      },
    });

    const result = await completeOnboarding("01HSESSION0001", {
      onboardingData: { budgetCents: 150_000 },
    });

    expect(result).toEqual({
      sessionId: "S1",
      displayName: "Shopping Assistant",
      onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
      kickoffCompletedAt: null,
      splash: null,
      onboardingData: { budgetCents: 150_000 },
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8081/chat/web/sessions/01HSESSION0001/onboarding"
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ onboardingData: { budgetCents: 150_000 } }));
  });

  it("fetchSessionMessages GETs the session's messages endpoint and returns the filtered history", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        messages: [
          {
            id: "01MSG0000000000000000000USR",
            role: "user",
            content: "hi",
            timestamp: "2026-04-20T12:01:00.000Z",
          },
          {
            id: "01MSG0000000000000000000AST",
            role: "assistant",
            content: "hello!",
            timestamp: "2026-04-20T12:01:02.000Z",
          },
        ],
      },
    });

    const result = await fetchSessionMessages("01HSESSION0001");

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      role: "user",
      content: "hi",
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8081/chat/web/sessions/01HSESSION0001/messages"
    );
    expect(init.method).toBe("GET");
    // GET must NOT carry a Content-Type header or a body.
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("sendMessage posts to /chat/web/messages with JSON body", async () => {
    mockFetchOnce({ ok: true, status: 200, body: { reply: "hi there" } });

    const result = await sendMessage({
      sessionId: "S1",
      message: "hello",
    });

    expect(result).toEqual({ reply: "hi there" });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8081/chat/web/messages");
    expect(init.body).toBe(
      JSON.stringify({ sessionId: "S1", message: "hello" })
    );
  });

  it("sendMessage omits toolOutputs from the result when wire has no tool_outputs", async () => {
    mockFetchOnce({ ok: true, status: 200, body: { reply: "hi" } });

    const result = await sendMessage({ sessionId: "S1", message: "hello" });

    expect(result).toEqual({ reply: "hi" });
    expect(result).not.toHaveProperty("toolOutputs");
  });

  it("sendMessage normalizes tool_outputs snake_case fields to camelCase toolOutputs", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        reply: "here is your cart",
        tool_outputs: [
          { tool_name: "preview_cart", content: '{"cart_id":"C1"}', is_error: false },
          { tool_name: "save_user_fact", content: '{"fact":"budget"}' },
        ],
      },
    });

    const result = await sendMessage({ sessionId: "S1", message: "show cart" });

    expect(result.reply).toBe("here is your cart");
    expect(result.toolOutputs).toHaveLength(2);
    expect(result.toolOutputs![0]).toEqual({
      toolName: "preview_cart",
      content: '{"cart_id":"C1"}',
      isError: false,
    });
    expect(result.toolOutputs![1]).toEqual({
      toolName: "save_user_fact",
      content: '{"fact":"budget"}',
      isError: undefined,
    });
  });

  it("sendMessage preserves toolOutputs as undefined (not []) when tool_outputs is absent", async () => {
    mockFetchOnce({ ok: true, status: 200, body: { reply: "ok" } });

    const result = await sendMessage({ sessionId: "S1", message: "ok" });

    expect("toolOutputs" in result).toBe(false);
  });

  it("throws ChatApiError with status and parsed body on 5xx", async () => {
    mockFetchOnce({ ok: false, status: 500, body: { error: "kaboom" } });

    await expect(
      sendMessage({ sessionId: "S1", message: "hi" })
    ).rejects.toMatchObject({
      name: "ChatApiError",
      status: 500,
      body: { error: "kaboom" },
    });
  });

  it("tolerates empty or non-JSON error bodies", async () => {
    mockFetchOnce({ ok: false, status: 502, body: null });

    const err = await sendMessage({
      sessionId: "S1",
      message: "hi",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatApiError);
    expect((err as ChatApiError).status).toBe(502);
    expect((err as ChatApiError).body).toBeNull();
  });

  it("authorizeEmbed posts to /chat/web/embed/authorize with correct URL, body, Content-Type header, and no-store cache on authorized: true", async () => {
    mockFetchOnce({ ok: true, status: 200, body: { authorized: true } });

    const result = await authorizeEmbed({
      accountUlid: "A#01HACCOUNT0000000000000000",
      parentDomain: "shop.example.com",
    });

    expect(result).toEqual({ authorized: true });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8081/chat/web/embed/authorize");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(init.body as string)).toEqual({
      accountUlid: "A#01HACCOUNT0000000000000000",
      parentDomain: "shop.example.com",
    });
  });

  it("authorizeEmbed throws ChatApiError on non-2xx response", async () => {
    mockFetchOnce({ ok: false, status: 403, body: { error: "forbidden" } });

    const err = await authorizeEmbed({
      accountUlid: "A#01HACCOUNT0000000000000000",
      parentDomain: "evil.com",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatApiError);
    expect((err as ChatApiError).status).toBe(403);
  });

  it("authorizeEmbed throws ChatApiError when response body lacks the authorized boolean", async () => {
    mockFetchOnce({ ok: true, status: 200, body: { something: "else" } });

    const err = await authorizeEmbed({
      accountUlid: "A#01HACCOUNT0000000000000000",
      parentDomain: "shop.example.com",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatApiError);
    expect((err as ChatApiError).status).toBe(200);
    expect((err as ChatApiError).message).toBe("malformed authorize response");
  });
});
