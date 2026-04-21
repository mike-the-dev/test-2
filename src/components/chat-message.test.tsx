import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChatMessageView } from "@/components/chat-message";

describe("ChatMessageView", () => {
  it("renders user messages with their plain text content", () => {
    render(
      <ChatMessageView
        message={{ id: "u1", role: "user", content: "Hello there" }}
      />
    );
    const bubble = screen.getByTestId("chat-message-user");
    expect(bubble).toHaveTextContent("Hello there");
  });

  it("renders assistant messages as Markdown with safe links", () => {
    render(
      <ChatMessageView
        message={{
          id: "a1",
          role: "assistant",
          content: "Visit [our site](https://example.com) for more.",
        }}
      />
    );
    const link = screen.getByRole("link", { name: /our site/i });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders an Open checkout button when the reply contains a checkout URL", () => {
    render(
      <ChatMessageView
        message={{
          id: "a2",
          role: "assistant",
          content:
            "All set! [Click here](https://shop.example.com/checkout?cart=abc) to pay.",
        }}
      />
    );
    const button = screen.getByTestId("open-checkout-button");
    expect(button).toHaveAttribute(
      "href",
      "https://shop.example.com/checkout?cart=abc"
    );
    expect(button).toHaveAttribute("target", "_blank");
    expect(button).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the Open checkout button when there is no checkout URL", () => {
    render(
      <ChatMessageView
        message={{
          id: "a3",
          role: "assistant",
          content: "Thanks for reaching out!",
        }}
      />
    );
    expect(screen.queryByTestId("open-checkout-button")).toBeNull();
  });

  it("renders a cart-preview-card when the assistant message carries a preview_cart tool output", () => {
    const cartOutput = {
      toolName: "preview_cart",
      content: JSON.stringify({
        cart_id: "C1",
        item_count: 0,
        currency: "usd",
        cart_total: 0,
        lines: [],
      }),
    };

    render(
      <ChatMessageView
        message={{
          id: "a4",
          role: "assistant",
          content: "Here is your cart.",
          toolOutputs: [cartOutput],
        }}
      />
    );

    expect(screen.getByTestId("cart-preview-card")).toBeInTheDocument();
  });

  it("does not render tool outputs while the assistant message is pending", () => {
    const cartOutput = {
      toolName: "preview_cart",
      content: JSON.stringify({
        cart_id: "C1",
        item_count: 0,
        currency: "usd",
        cart_total: 0,
        lines: [],
      }),
    };

    render(
      <ChatMessageView
        message={{
          id: "a5",
          role: "assistant",
          content: "",
          pending: true,
          toolOutputs: [cartOutput],
        }}
      />
    );

    expect(screen.queryByTestId("cart-preview-card")).toBeNull();
  });

  it("does not render tool outputs for user messages", () => {
    const cartOutput = {
      toolName: "preview_cart",
      content: JSON.stringify({
        cart_id: "C1",
        item_count: 0,
        currency: "usd",
        cart_total: 0,
        lines: [],
      }),
    };

    render(
      <ChatMessageView
        message={{
          id: "u2",
          role: "user",
          content: "hello",
          toolOutputs: [cartOutput],
        }}
      />
    );

    expect(screen.queryByTestId("cart-preview-card")).toBeNull();
  });

  it("does not render tool outputs for registered stubs that return null", () => {
    const stubOutput = {
      toolName: "save_user_fact",
      content: '{"fact":"prefers evening"}',
    };

    render(
      <ChatMessageView
        message={{
          id: "a6",
          role: "assistant",
          content: "Got it, noted.",
          toolOutputs: [stubOutput],
        }}
      />
    );

    // save_user_fact is a stub that returns null — nothing extra should render.
    expect(screen.queryByTestId("cart-preview-card")).toBeNull();
  });
});
