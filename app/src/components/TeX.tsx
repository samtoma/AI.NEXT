"use client";

import { useMemo } from "react";
import katex from "katex";

/**
 * Renders a string containing inline $...$ LaTeX segments (the format used by
 * question stems and canonical solution steps in the spine).
 */
export function TeX({
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
