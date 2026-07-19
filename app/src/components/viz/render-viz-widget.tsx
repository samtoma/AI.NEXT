"use client";

/**
 * Shared renderer for the two figure directives every chat surface supports:
 *   {{widget:viz:{"kind":…,"spec":{…},"caption":"…"}}}  → inline composed figure
 *   {{widget:viz_ref:v:geo1-1:001}}                     → stored figure by id
 * Returns null for anything else so callers can layer their own widgets
 * (pair_plotter, product_builder, …) on top.
 */

import type { ReactNode } from "react";
import { VizCard } from "./VizCard";
import { VizRefCard } from "./VizRefCard";

export function renderVizWidget(
  name: string,
  props: Record<string, unknown>
): ReactNode | null {
  if (name === "viz_ref") {
    const id = props.id;
    if (typeof id === "string" && id.length > 0 && id.length <= 120) {
      return <VizRefCard id={id} />;
    }
    return null;
  }
  if (name === "viz") {
    const kind = props.kind;
    const spec = props.spec;
    if (
      typeof kind === "string" &&
      spec !== null &&
      typeof spec === "object" &&
      !Array.isArray(spec)
    ) {
      return (
        <VizCard
          kind={kind}
          spec={spec as Record<string, unknown>}
          caption={typeof props.caption === "string" ? props.caption : undefined}
        />
      );
    }
  }
  return null;
}
