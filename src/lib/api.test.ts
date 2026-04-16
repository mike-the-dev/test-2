import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatApiError, createSession, sendMessage } from "@/lib/api";

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
      body: { sessionUlid: "S1", displayName: "Shopping Assistant" },
    });

    const result = await createSession({
      agentName: "shopping_assistant",
      guestUlid: "G1",
    });

    expect(result).toEqual({
      sessionUlid: "S1",
      displayName: "Shopping Assistant",
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
      })
    );
  });

  it("createSession includes hostDomain in the body when provided and omits it otherwise", async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      body: { sessionUlid: "S1", displayName: "Shopping Assistant" },
    });

    await createSession({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      hostDomain: "practice.example.com",
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, initWith] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(initWith.body as string)).toEqual({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      hostDomain: "practice.example.com",
    });

    // Undefined hostDomain must not serialize into the body at all.
    mockFetchOnce({
      ok: true,
      status: 200,
      body: { sessionUlid: "S2", displayName: "Shopping Assistant" },
    });

    await createSession({
      agentName: "shopping_assistant",
      guestUlid: "G1",
      hostDomain: undefined,
    });

    const fetchMock2 = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, initWithout] = fetchMock2.mock.calls[0] as [string, RequestInit];
    const parsed = JSON.parse(initWithout.body as string) as Record<
      string,
      unknown
    >;
    expect(parsed).toEqual({
      agentName: "shopping_assistant",
      guestUlid: "G1",
    });
    expect(Object.prototype.hasOwnProperty.call(parsed, "hostDomain")).toBe(
      false
    );
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
      createSession({ agentName: "shopping_assistant", guestUlid: "G1" })
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
});
