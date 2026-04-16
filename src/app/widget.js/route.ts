import { WIDGET_SOURCE } from "@/app/widget.js/widget-source";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(WIDGET_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control":
        "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
