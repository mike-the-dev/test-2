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
});
