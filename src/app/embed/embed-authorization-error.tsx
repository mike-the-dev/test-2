import { Card } from "@heroui/react";
import type { ReactElement } from "react";

/**
 * @author mike-the-dev (Michael Camacho)
 * @editor mike-the-dev (Michael Camacho)
 * @lastUpdated 2026-04-20
 * @name EmbedAuthorizationError
 * @description Server-renderable error card shown when the embed authorization
 *   gate denies the request. Matches the visual weight of `ChatErrorCard`
 *   using the same HeroUI Card primitives. No retry button — the operator
 *   must correct their allow-list configuration.
 * @returns A centered card with the authorization-denied copy.
 */
export const EmbedAuthorizationError = (): ReactElement => (
  <div className="flex flex-1 w-full items-center justify-center p-6">
    <Card className="max-w-sm" data-testid="embed-authorization-error">
      <Card.Header>
        <Card.Title>This site isn&apos;t authorized to embed this widget.</Card.Title>
      </Card.Header>
      <Card.Content>
        <p className="text-sm text-default-600">
          Contact the site owner if you believe this is a mistake.
        </p>
      </Card.Content>
    </Card>
  </div>
);
