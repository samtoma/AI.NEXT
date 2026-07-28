"use client";

import dynamic from "next/dynamic";

/**
 * `<TeX>` — the only entry point for maths rendering.
 *
 * This file is deliberately a thin lazy wrapper. KaTeX (library + stylesheet)
 * is roughly 75 KB gzipped, and it used to be loaded on every route because the
 * stylesheet sat in the root layout and the library sat in each route's client
 * bundle. Most of the product renders no maths at all: the Social Studies
 * lessons, the Arabic reading surface («شرح الدرس»), the subject home and the
 * check-in. They were all paying for it.
 *
 * Splitting it here rather than at the ~6 call sites means no caller can
 * accidentally reintroduce the eager path — importing `TeX` is always the light
 * import, and `TeXRenderer` is only reachable through this boundary.
 *
 * Loading behaviour, verified against a production build on this Next version
 * (16.2.10) rather than assumed:
 *  - Server-rendered maths (e.g. /pipeline's reviewed question, the practice
 *    plan) still renders in the HTML, and Next emits the KaTeX stylesheet as a
 *    `rel="stylesheet" data-precedence="dynamic"` link in <head>, ahead of the
 *    maths markup — so it is render-blocking and cannot flash unstyled.
 *  - Client-mounted maths (the LO panel, the question modal, chat messages)
 *    waits one chunk fetch, and React holds the subtree until both the chunk
 *    and its stylesheet are ready. Measured on /spine: stylesheet at t+13 ms,
 *    first `.katex` node at t+71 ms, zero frames with maths but no stylesheet.
 *
 * The trade is a one-time deferral of the first client-mounted equation per
 * session, against ~75 KB removed from every maths-free route.
 */
export const TeX = dynamic(() =>
  import("./TeXRenderer").then((m) => m.TeXRenderer),
);
