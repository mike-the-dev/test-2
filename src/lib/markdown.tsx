"use client";

import type { AnchorHTMLAttributes, ReactElement } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * Sanitization schema for assistant replies. Permits the structured text the
 * backend emits (paragraphs, numbered/unordered lists with nesting, bold,
 * italic, strikethrough, inline code and fenced code blocks, links) while
 * continuing to strip raw HTML, scripts, styles, iframes, event handler
 * attributes, and non-http URL schemes.
 */
const CHAT_SCHEMA = {
  ...defaultSchema,
  tagNames: [
    "p",
    "br",
    "strong",
    "em",
    "del",
    "s",
    "ul",
    "ol",
    "li",
    "code",
    "pre",
    "a",
  ],
  attributes: {
    a: ["href"],
    code: [],
    pre: [],
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
      // remark-gfm adds strikethrough, tables, and task lists to the parser.
      // rehype-sanitize stays wired as belt-and-suspenders for XSS defense.
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, CHAT_SCHEMA]]}
      components={components}
      skipHtml
    >
      {content}
    </ReactMarkdown>
  );
}
