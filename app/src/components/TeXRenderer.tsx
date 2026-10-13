"use client";

import { useMemo } from "react";
import katex from "katex";
// KaTeX's stylesheet travels with the module that renders KaTeX markup, so it
// is fetched together with the library and can never arrive after the maths it
// styles. It used to be imported in the root layout, which put it on the
// critical path of every route — including the Arabic and Social Studies
// lessons, which render no maths at all.
import "katex/dist/katex.min.css";
import { renderInlineMarkdown } from "@/lib/inline-markdown";

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

function renderMixed(text: string): string {
  return renderInlineMarkdown(text, (tex) => {
    try {
      return katex.renderToString(tex, { throwOnError: false, output: "html" });
    } catch {
      return escapeTex(tex);
    }
  });
}

const escapeTex = (tex: string) =>
  `$${tex}$`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
