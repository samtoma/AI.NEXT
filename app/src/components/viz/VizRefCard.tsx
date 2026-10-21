"use client";

/**
 * {{widget:viz_ref:v:geo1-1:001}} — a STORED, human-curated figure pushed
 * into chat by id. Fetches the visual row from /api/visuals?id=… and renders
 * the standard VizCard with its caption + provenance stamp. A bad or unknown
 * id degrades to a quiet "figure not found" chip — never crashes the stream.
 */

import { useContext, useEffect, useState } from "react";
import { VizCard } from "./VizCard";
import { FigureNoteContext } from "./figure-note-context";
import { interactionsFor, splitTaskId } from "@/lib/figure-interactions";
import { InteractiveFigure } from "@/components/student/figures/InteractiveFigure";
import { authFetch } from "@/lib/auth/client-session";

interface VisualDto {
  id: string;
  kind: string;
  spec: Record<string, unknown>;
  caption: string | null;
  sourcePage: number | null;
}

type State =
  | { s: "loading" }
  | { s: "ok"; v: VisualDto }
  | { s: "missing" };

export function VizRefCard({ id, task = false }: { id: string; task?: boolean }) {
  const [state, setState] = useState<State>({ s: "loading" });
  // {{widget:figure_task:…}}: the figure as a task the student works
  // (prototype, lib/figure-interactions). Only when the tutor asked for it —
  // a figure it merely shows stays a picture, so it never asks a second
  // question beside the tutor's own.
  const onNote = useContext(FigureNoteContext);

  useEffect(() => {
    let alive = true;
    setState({ s: "loading" });
    // a task id names one of the figure's tasks after a "#": the row is the figure's
    authFetch(`/api/visuals?id=${encodeURIComponent(splitTaskId(id).figureId)}`)
      .then(async (res) => {
        if (!alive) return;
        if (!res.ok) {
          setState({ s: "missing" });
          return;
        }
        const j = (await res.json()) as { visual?: VisualDto };
        if (!alive) return;
        if (j.visual && j.visual.spec && typeof j.visual.spec === "object") {
          setState({ s: "ok", v: j.visual });
        } else {
          setState({ s: "missing" });
        }
      })
      .catch(() => {
        if (alive) setState({ s: "missing" });
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // the tasks travel in the figure's spec (the pipeline writes them at compile)
  const steps = task && state.s === "ok" ? interactionsFor(id, state.v.spec) : null;
  if (state.s === "ok" && steps && (state.v.kind === "geo_scene" || state.v.kind === "arrow_map")) {
    return <InteractiveFigure figure={state.v} steps={steps} taskId={id} onNote={onNote ?? undefined} />;
  }

  if (state.s === "ok") {
    return (
      <VizCard
        kind={state.v.kind}
        spec={state.v.spec}
        caption={state.v.caption ?? undefined}
        refId={state.v.id}
        sourcePage={state.v.sourcePage}
      />
    );
  }

  if (state.s === "loading") {
    return (
      <div className="anim-pop my-2 flex max-w-[420px] items-center gap-2 rounded-lg border border-line-soft bg-card-warm px-3.5 py-2.5">
        <span className="inline-flex gap-[3px]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1 w-1 rounded-full bg-accent"
              style={{
                animation: `think-dot 1.1s ease-in-out ${i * 0.18}s infinite`,
              }}
            />
          ))}
        </span>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-faint">
          fetching figure · {id}
        </span>
      </div>
    );
  }

  return (
    <div className="anim-pop my-2 flex max-w-[420px] items-center gap-2 rounded-lg border border-dashed border-rust/40 bg-rust-wash/50 px-3.5 py-2.5">
      <span aria-hidden className="text-[13px] leading-none text-rust">
        ▧
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-rust">
          figure not found
        </span>
        <span className="block truncate font-mono text-[9px] text-ink-faint">
          {id}
        </span>
      </span>
    </div>
  );
}
