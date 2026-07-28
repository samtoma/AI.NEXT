"use client";

import { useMemo } from "react";
import katex from "katex";
// KaTeX's stylesheet travels with the module that renders KaTeX markup, so it
// is fetched together with the library and can never arrive after the maths it
// styles. It used to be imported in the root layout, which put it on the
// critical path of every route — including the Arabic and Social Studies
// lessons, which render no maths at all.
import "katex/dist/katex.min.css";

/**
 * Renders a string containing inline $...$ LaTeX segments (the format used by
 * question stems and canonical solution steps in the spine).
 *
 * Import this through `./TeX`, never directly — that wrapper is what keeps
 * KaTeX out of the bundles of routes that show no maths.
 */
export function TeXRenderer({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const html = useMemo(() => renderMixed(text), [text]);
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMixed(text: string): string {
  // Defensive: never crash on a missing/non-string field (e.g. a social
  // claim-step has no text_md). Render nothing rather than throw.
  if (typeof text !== "string" || text.length === 0) return "";
  // split on $...$ (non-greedy, no escaped-dollar handling needed for this corpus)
  const parts = text.split(/(\$[^$]+\$)/g);
  return parts
    .map((part) => {
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
        try {
          return katex.renderToString(part.slice(1, -1), {
            throwOnError: false,
            output: "html",
          });
        } catch {
          return escapeHtml(part);
        }
      }
      // minimal markdown: **bold** and *emphasis*. Emphasis requires the
      // asterisks to hug non-space text (common markdown rule), so
      // multiplication like "3 * 4" stays literal.
      return escapeHtml(part)
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\*([^\s*](?:[^*]*[^\s*])?)\*/g, "<em>$1</em>");
    })
    .join("");
}
