"use client";

import { useCallback, useEffect, useRef, type Ref, type SVGProps } from "react";

/**
 * The `<svg>` every figure and widget draws in, so its text can be set in the
 * px the student actually sees (globals.css, "TEXT IN WIDGETS, FIGURES AND
 * QUESTION CARDS").
 *
 * A figure is drawn in viewBox units and scaled to its column; a label sized
 * in those units is as big as the column makes it, which on an iPad was under
 * 9px. This element measures itself and writes `--fig-u` — viewBox units per
 * rendered px — so the `.fig-read` / `.fig-label` / `.fig-data` classes come
 * out at the Noor Play type steps whatever the width.
 *
 * The measurement is the layout box (ResizeObserver), not the painted one, so
 * an entry animation's scale never leaks into the type. Before the first
 * measurement the classes fall back to 1 unit = 1px, which is where every
 * widget already sits within a few percent; nothing jumps on hydration.
 *
 * KEEPS LABELS IN THE FRAME. Text set in px is wider in viewBox units on a
 * narrow column than the figure was drawn for, so a label near an edge can
 * run out of the picture. After each measurement (and whenever the figure's
 * text changes) every unrotated label that crosses the left or right edge is
 * slid back inside with `dx` — clipped text is worse than a label that sits a
 * little off its anchor. Labels this element moved are marked
 * `data-fig-nudge`; it never touches a `dx` React set.
 *
 * Accepts every `<svg>` prop, and a ref that is forwarded — the interactive
 * widgets need their svg for pointer → plane coordinates (widgets/drag.ts).
 */
export function FigureSvg({
  ref,
  ...props
}: SVGProps<SVGSVGElement> & { ref?: Ref<SVGSVGElement> }) {
  const local = useRef<SVGSVGElement | null>(null);

  const setRef = useCallback(
    (el: SVGSVGElement | null) => {
      local.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as { current: SVGSVGElement | null }).current = el;
    },
    [ref]
  );

  useEffect(() => {
    const el = local.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // a timeout, not a frame: a background tab never paints one
    const refit = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => keepLabelsInFrame(el), 30);
    };
    const measure = (width: number, height: number) => {
      const vb = el.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height || width <= 0 || height <= 0) return;
      // preserveAspectRatio "meet": the tighter axis sets the scale
      const u = Math.max(vb.width / width, vb.height / height);
      el.style.setProperty("--fig-u", u.toFixed(4));
      refit();
    };
    // Now, from the layout box (clientWidth ignores the entry animation's
    // transform) — a ResizeObserver's first callback can wait for a frame
    // that a background tab never paints.
    measure(el.clientWidth, el.clientHeight);
    const ro =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(([entry]) =>
            measure(entry.contentRect.width, entry.contentRect.height)
          );
    ro?.observe(el);
    // a label's words or position changed (a drag, a hover readout)
    const mo = new MutationObserver(refit);
    mo.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributeFilter: ["x", "y", "class"],
    });
    // the webfont's metrics, not the fallback's
    document.fonts?.ready.then(refit).catch(() => {});
    return () => {
      ro?.disconnect();
      mo.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return <svg ref={setRef} data-fig="" {...props} />;
}

/** Slide every unrotated label that crosses a side edge back inside the viewBox. */
function keepLabelsInFrame(svg: SVGSVGElement): void {
  const vb = svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  const left = vb.x + 1;
  const right = vb.x + vb.width - 1;
  for (const t of svg.querySelectorAll("text")) {
    if (t.hasAttribute("data-fig-nudge")) {
      t.removeAttribute("dx");
      t.removeAttribute("data-fig-nudge");
    } else if (t.hasAttribute("dx") || t.hasAttribute("transform")) {
      continue; // React's own offset, or a rotated label: leave it be
    }
    let box: DOMRect;
    try {
      box = t.getBBox();
    } catch {
      continue; // not rendered (display: none)
    }
    if (!box.width || box.width > right - left) continue;
    const dx =
      box.x < left ? left - box.x : box.x + box.width > right ? right - (box.x + box.width) : 0;
    if (Math.abs(dx) < 0.5) continue;
    t.setAttribute("dx", dx.toFixed(1));
    t.setAttribute("data-fig-nudge", "");
  }
}
