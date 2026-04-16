"use client";

import { Button, Card } from "@heroui/react";
import type { ReactElement } from "react";

export interface ChatErrorCardProps {
  message: string;
  onRetry: () => void;
}

export function ChatErrorCard({
  message,
  onRetry,
}: ChatErrorCardProps): ReactElement {
  return (
    <Card className="max-w-sm" data-testid="chat-error-card">
      <Card.Header>
        <Card.Title>Something went wrong</Card.Title>
      </Card.Header>
      <Card.Content>
        <p className="text-sm text-default-600">{message}</p>
      </Card.Content>
      <Card.Footer>
        <Button variant="primary" size="sm" onPress={onRetry}>
          Try again
        </Button>
      </Card.Footer>
    </Card>
  );
}
