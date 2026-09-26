"use client";

import { VizRefCard } from "./VizRefCard";

/**
 * A question's OWN stored figures, on its card (consistency review
 * 2026-09-27, A3; `lib/question-figures.ts`). Each is fetched through the
 * gated `/api/visuals?id=` like any stored figure, so a figure outside the
 * student's scope is "not found", never shown. Renders nothing when the
 * question has none.
 */
export function QuestionFigures({ ids }: { ids?: readonly string[] }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div className="mt-2 grid gap-2">
      {ids.map((id) => (
        <VizRefCard key={id} id={id} />
      ))}
    </div>
  );
}
