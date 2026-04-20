import { Card, Link } from "@heroui/react";
import type { ReactElement } from "react";

const INTEGRATOR_SNIPPET = `<script src="https://chat.instapaytient.com/widget.js" data-account-ulid="YOUR_ACCOUNT_ULID" async></script>`;

export default function HomePage(): ReactElement {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-6 py-16">
      <Card className="max-w-2xl w-full">
        <Card.Header>
          <Card.Title>Instapaytient Chat</Card.Title>
          <Card.Description>
            The embeddable shopping assistant for Instapaytient practice sites.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <p className="text-sm text-default-600 mb-4">
            The widget runs entirely in the browser. To add the chat bubble to
            a practice site, drop this tag into the page (just before the
            closing <code>{"</body>"}</code>):
          </p>
          <pre className="rounded-lg bg-default-100 p-4 text-xs font-mono text-foreground overflow-x-auto">
            <code>{INTEGRATOR_SNIPPET}</code>
          </pre>
        </Card.Content>
        <Card.Footer>
          <Link
            href="/embed?agent=shopping_assistant"
            target="_blank"
            rel="noopener noreferrer"
          >
            Preview the chat panel
          </Link>
        </Card.Footer>
      </Card>
    </main>
  );
}
