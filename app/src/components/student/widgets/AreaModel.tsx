"use client";

/**
 * {{widget:area_model:{"prompt":"Expand (x + 2)(x - 3) with the tiles.","mode":"expand","a":2,"b":-3}}}
 * {{widget:area_model:{"prompt":"Factorise x^2 - x - 6 by building its rectangle.","mode":"factor","a":-3,"b":2}}}
 *
 * Algebra tiles as a grid the student places into, one cell at a time — the
 * "box method" made literal (FR-1202: a construction, not a menu of finished
 * answers). One x² tile, taken as the top-left corner of the rectangle,
 * anchors everything else: a run of x-tiles grows right from it (the "a"
 * edge), another grows down (the "b" edge), and the block those two runs
 * bound is where the ab unit tiles belong. `expand` and `factor` share this
 * one construction and one grading path (`area-model-grade.ts`) — the
 * difference between "here is (x+a)(x+b), build its product" and "here is
 * the product, find a and b" is only in the prompt, never in what counts as
 * correct.
 *
 * NEGATIVE TILES ARE NEVER COLOUR-ONLY (constitution, Noor Play — nothing
 * distinguished by colour alone). Every negative tile carries an explicit
 * minus sign AND a diagonal hatch a positive tile does not have; a
 * colour-blind reader or a greyscale screenshot loses neither cue.
 *
 * THE GRID IS A UNIFORM BOX, NOT SIZED MANIPULATIVES. A physical algebra-tile
 * set draws the x² tile x-by-x and the x-tile 1-by-x, which is the point of
 * the physical version — here every cell is one unit of the "box method"
 * grid instead, which is the same mathematics (`docs/decisions/`, widgets
 * ADR) in the form that actually fits a phone-width grid: what matters for
 * the rectangle check is ADJACENCY, not literal area on screen.
 */

import { useCallback, useState } from "react";
import { cx } from "@/components/sticker";
import { BUTTON_SECONDARY, BUTTON_TERTIARY } from "@/components/sticker";
import { WidgetShell, type Verdict, WIDGET_ACTIONS, WIDGET_WELL } from "./WidgetShell";
import { OK, type WidgetOutcome } from "@/lib/widget-predicates";
import { gradeAreaModel, type Cell, type TileKind } from "./area-model-grade";

const ROWS = 7;
const COLS = 7;

const TILE_META: Record<TileKind, { label: string; negative: boolean; big: boolean }> = {
  x2: { label: "x²", negative: false, big: true },
  xPos: { label: "x", negative: false, big: false },
  xNeg: { label: "−x", negative: true, big: false },
  uPos: { label: "1", negative: false, big: false },
  uNeg: { label: "−1", negative: true, big: false },
};

const PALETTE: TileKind[] = ["x2", "xPos", "xNeg", "uPos", "uNeg"];

/** The hatch a negative tile carries IN ADDITION to its minus sign — plain
 *  inline CSS, not styled-jsx, which is not a pattern this codebase's Next.js
 *  build is proven against (`app/AGENTS.md`: breaking changes, verify before
 *  using anything unfamiliar). Tokens only: both stripe colours are Noor Play
 *  CSS variables, never a literal. */
const HATCH_STYLE: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, var(--card-warm) 0px, var(--card-warm) 3px, var(--line-soft) 3px, var(--line-soft) 4px)",
};

function cellClass(kind: TileKind | undefined, disabled: boolean): string {
  if (!kind) {
    return cx(
      "border-dashed border-[length:var(--play-stroke-sm)] border-[color:var(--play-disabled-border)]",
      "bg-card text-[color:var(--play-text-muted)]"
    );
  }
  const meta = TILE_META[kind];
  return cx(
    "border-[length:var(--play-stroke-sm)] border-ink font-bold",
    meta.negative ? "text-ink" : "bg-card-warm text-ink",
    meta.big && "font-display",
    disabled && "opacity-90"
  );
}

export function AreaModel({
  prompt,
  mode,
  a,
  b,
  studentName,
  onResult,
}: {
  prompt: string;
  mode: "expand" | "factor";
  a: number;
  b: number;
  /** The signed-in student's display name, narrated into the [live event]
   *  line below in place of the retired "Omar" demo persona (FR-2602,
   *  ADR-0010 plan A10). Falls back to a name-free "the student" — never a
   *  guess — when a caller (dev fixture, admin replay) has none to give. */
  studentName?: string;
  onResult: (outcome: WidgetOutcome) => void;
}) {
  const who = studentName?.trim() || "the student";
  const [active, setActive] = useState<TileKind>("x2");
  const [cells, setCells] = useState<Cell[]>([]);
  const [verdict, setVerdict] = useState<Verdict>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fired, setFired] = useState(false);

  const at = useCallback(
    (row: number, col: number) => cells.find((c) => c.row === row && c.col === col),
    [cells]
  );

  const tap = (row: number, col: number) => {
    if (verdict) return;
    setCells((cur) => {
      const idx = cur.findIndex((c) => c.row === row && c.col === col);
      if (idx >= 0) return cur.filter((_, i) => i !== idx);
      return [...cur, { row, col, kind: active }];
    });
  };

  const check = () => {
    if (fired || cells.length === 0) return;
    setFired(true);
    const g = gradeAreaModel(a, b, cells);
    setVerdict(g.ok ? "correct" : "wrong");
    const wantExpr = `x² ${a + b >= 0 ? "+" : "−"} ${Math.abs(a + b)}x ${a * b >= 0 ? "+" : "−"} ${Math.abs(a * b)}`;
    const gotExpr = Number.isNaN(g.sum)
      ? "a shape that is not a rectangle"
      : `x² ${g.sum >= 0 ? "+" : "−"} ${Math.abs(g.sum)}x ${g.product >= 0 ? "+" : "−"} ${Math.abs(g.product)}`;
    setNote(
      g.ok
        ? `(x ${a >= 0 ? "+" : "−"} ${Math.abs(a)})(x ${b >= 0 ? "+" : "−"} ${Math.abs(b)}) = ${wantExpr}.`
        : `Your tiles give ${gotExpr}; the target is ${wantExpr}.`
    );
    onResult({
      correct: g.ok,
      predicate: g.ok ? OK : g.predicate,
      given: gotExpr,
      detail: g.ok
        ? `✓ ${who} tiled (x${a >= 0 ? "+" : ""}${a})(x${b >= 0 ? "+" : ""}${b}) = ${wantExpr} correctly`
        : `✗ ${who}'s tiles gave ${gotExpr} against ${wantExpr} — ${g.predicate}`,
    });
  };

  return (
    <WidgetShell
      kind={`area model · ${mode}`}
      hint="tap a tile, then tap the grid"
      prompt={prompt}
      verdict={verdict}
      feedback={note}
      onReset={
        verdict
          ? undefined
          : cells.length > 0
          ? () => setCells([])
          : undefined
      }
      resetLabel="Clear the grid"
      footer={
        verdict ? null : (
          <span className="text-ink-faint">
            start with the x² tile near the top-left corner, then build its edges outward
          </span>
        )
      }
    >
      <div
        className={cx("mx-auto grid w-full max-w-[360px] gap-1 p-1.5", WIDGET_WELL)}
        style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}
        role="grid"
        aria-label="the rectangle grid"
      >
        {Array.from({ length: ROWS }, (_, row) =>
          Array.from({ length: COLS }, (_, col) => {
            const cell = at(row, col);
            const meta = cell ? TILE_META[cell.kind] : null;
            return (
              <button
                key={`${row}-${col}`}
                type="button"
                role="gridcell"
                disabled={!!verdict}
                onClick={() => tap(row, col)}
                aria-label={
                  meta
                    ? `row ${row + 1}, column ${col + 1}: ${meta.label} tile, tap to remove`
                    : `row ${row + 1}, column ${col + 1}: empty, tap to place ${TILE_META[active].label}`
                }
                style={meta?.negative ? HATCH_STYLE : undefined}
                className={cx(
                  "aspect-square min-h-0 rounded-[3px] text-[11px] leading-none",
                  cellClass(cell?.kind, !!verdict)
                )}
              >
                {meta?.label ?? ""}
              </button>
            );
          })
        )}
      </div>

      {!verdict && (
        <>
          <div className={WIDGET_ACTIONS} role="radiogroup" aria-label="tile to place">
            {PALETTE.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={active === k}
                onClick={() => setActive(k)}
                style={TILE_META[k].negative ? HATCH_STYLE : undefined}
                className={cx(active === k ? BUTTON_SECONDARY : BUTTON_TERTIARY)}
              >
                {TILE_META[k].label}
              </button>
            ))}
          </div>

          <div className={WIDGET_ACTIONS}>
            <button type="button" onClick={check} disabled={cells.length === 0} className={BUTTON_SECONDARY}>
              Check my rectangle
            </button>
          </div>
        </>
      )}
    </WidgetShell>
  );
}
