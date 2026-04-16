"use client";

import type { AnchorHTMLAttributes, ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/**
 * Narrow sanitization schema: only the inline elements we use to render chat
 * replies. No raw HTML, no headings, no images, no block quotes, no lists --
 * the agent output is conversational prose.
 */
const CHAT_SCHEMA = {
  ...defaultSchema,
  tagNames: ["p", "strong", "em", "code", "a", "br"],
  attributes: {
    a: ["href"],
    code: [],
    span: [],
  },
  protocols: {
    href: ["http", "https", "mailto"],
  },
};

function isSafeHref(href: string | undefined): href is string {
  if (!href) return false;
  // Block `javascript:`, `data:` and other non-http schemes defensively,
  // even though rehype-sanitize should already strip them.
  const lowered = href.trim().toLowerCase();
  if (lowered.startsWith("javascript:")) return false;
  if (lowered.startsWith("data:")) return false;
  if (lowered.startsWith("vbscript:")) return false;
  return (
    lowered.startsWith("http://") ||
    lowered.startsWith("https://") ||
    lowered.startsWith("mailto:")
  );
}

const components: Components = {
  a(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
    const { href, children, ...rest } = props;
    if (!isSafeHref(href)) {
      return <span>{children}</span>;
    }
    return (
      <a
        {...rest}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-primary"
      >
        {children}
      </a>
    );
  },
  code({ children, ...rest }) {
    return (
      <code
        {...rest}
        className="rounded bg-default-100 px-1 py-0.5 font-mono text-[0.9em]"
      >
        {children}
      </code>
    );
  },
};

export interface SafeMarkdownProps {
  content: string;
}

export function SafeMarkdown({ content }: SafeMarkdownProps): ReactElement {
  return (
    <ReactMarkdown
      // Disallow raw HTML by only enabling inline Markdown. We pass a
      // rehype-sanitize pass as belt-and-suspenders.
      rehypePlugins={[[rehypeSanitize, CHAT_SCHEMA]]}
      components={components}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
}
