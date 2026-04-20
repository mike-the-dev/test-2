import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChatApiError,
  authorizeEmbed,
  completeOnboarding,
  createSession,
  fetchSessionMessages,
  sendMessage,
} from "@/lib/api";

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

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("createSession posts to /chat/web/sessions with JSON body and headers", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        sessionUlid: "S1",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: null,
        budgetCents: null,
      },
    });

    const result = await createSession({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      accountUlid: "A#01HACCOUNT0000000000000000",
    });

    expect(result).toEqual({
      sessionUlid: "S1",
      displayName: "Shopping Assistant",
      onboardingCompletedAt: null,
      budgetCents: null,
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
        guestUlid: "G1",
        accountUlid: "A#01HACCOUNT0000000000000000",
      })
    );
  });

  it("createSession serializes accountUlid verbatim (no prefix stripping) in the body", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        sessionUlid: "S1",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: null,
        budgetCents: null,
      },
    });

    await createSession({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      accountUlid: "A#01K2XR5G6G22TB71SJCA823ESB",
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      accountUlid: "A#01K2XR5G6G22TB71SJCA823ESB",
    });
  });

  it("completeOnboarding posts to the session's onboarding endpoint with cents body and returns the updated session", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: {
        sessionUlid: "S1",
        displayName: "Shopping Assistant",
        onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
        budgetCents: 150_000,
      },
    });

    const result = await completeOnboarding("01HSESSION0001", {
      budgetCents: 150_000,
    });

    expect(result).toEqual({
      sessionUlid: "S1",
      displayName: "Shopping Assistant",
      onboardingCompletedAt: "2026-04-20T12:00:00.000Z",
      budgetCents: 150_000,
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "http://localhost:8081/chat/web/sessions/01HSESSION0001/onboarding"
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ budgetCents: 150_000 }));
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
      sessionUlid: "S1",
      message: "hello",
    });

    expect(result).toEqual({ reply: "hi there" });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8081/chat/web/messages");
    expect(init.body).toBe(
      JSON.stringify({ sessionUlid: "S1", message: "hello" })
    );
  });

  it("throws ChatApiError with status and parsed body on 4xx", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: { error: "bad request" },
    });

    await expect(
      createSession({
        agentName: "shopping_assistant",
        guestUlid: "G1",
        accountUlid: "A#01HACCOUNT0000000000000000",
      })
    ).rejects.toMatchObject({
      name: "ChatApiError",
      status: 400,
      body: { error: "bad request" },
    });
  });

  it("throws ChatApiError with status and parsed body on 5xx", async () => {
    mockFetchOnce({ ok: false, status: 500, body: { error: "kaboom" } });

    await expect(
      sendMessage({ sessionUlid: "S1", message: "hi" })
    ).rejects.toMatchObject({
      name: "ChatApiError",
      status: 500,
      body: { error: "kaboom" },
    });
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
      guestUlid: "G1",
      accountUlid: "A#01HACCOUNT0000000000000000",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ChatApiError);
    expect((err as ChatApiError).status).toBe(0);
    expect((err as ChatApiError).body).toBeNull();
  });

  it("tolerates empty or non-JSON error bodies", async () => {
    mockFetchOnce({ ok: false, status: 502, body: null });

    const err = await sendMessage({
      sessionUlid: "S1",
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
