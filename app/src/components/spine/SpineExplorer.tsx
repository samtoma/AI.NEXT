"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttemptResult, SpineData, SpineQuestion } from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { GraphCanvas, type AsOf } from "./GraphCanvas";
import { LoPanel } from "./LoPanel";
import { QuestionModal } from "./QuestionModal";
import { NoorPanel } from "./NoorPanel";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { MASTERY_LEGEND, masteryStage, masteryPhrase } from "@/lib/mastery";
import { DemoStudentSwitcher } from "@/components/DemoStudentSwitcher";
import { DEFAULT_STUDENT_ID, type DemoStudent } from "@/lib/demo-student";

/** "mathematics" → "Mathematics". The subject, never a unit name. */
const titleCase = (s: string) =>
  s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s;

/**
 * The skill map — "How you're doing", subject-wide.
 *
 * This screen used to be "The Evidence Walk": the same tree and the same
 * chat, wrapped in an internal tool. What came off, and why (Noor Play skill
 * map v1 build spec):
 *
 *  · the stat-chip row — 90 objectives, 1041 questions, 112 prerequisite
 *    edges, 117 attempts. Graph metadata. A student needs their own place in
 *    the graph, not its size.
 *  · the as-of query string — "MASTERY FOR SYSTEM_TIME AS OF NOW()", a
 *    literal temporal-table clause printed at a fifteen-year-old. The two
 *    states it named are now two tabs in plain words.
 *  · node ids leading every card, and a percentage badge on every node.
 *  · the DAG footer ("graph_edges where edge_type='prerequisite_of'"), the
 *    arrowheads, and the "→ = is prerequisite of" key.
 *  · the live session-cost meter in the chat header (see NoorPanel).
 *
 * Scope widened with it: the tree covers the whole subject, so the title
 * names the subject and nothing smaller. A unit-level view is a different
 * screen.
 *
 * The demo-student switcher survives on its invisible corner hot-zone. It is
 * a founders' affordance with no visible chrome by design, and the chip it
 * used to hide behind ("Omar (demo) · avg 12%") was a stat chip with a
 * percentage on it — exactly what this redesign cuts.
 */
export function SpineExplorer({
  data,
  demoStudents = [],
  demoStudentId = DEFAULT_STUDENT_ID,
}: {
  data: SpineData;
  demoStudents?: DemoStudent[];
  demoStudentId?: number;
}) {
  const router = useRouter();
  const [asOf, setAsOf] = useState<AsOf>("today");
  const [selectedLoId, setSelectedLoId] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<SpineQuestion | null>(null);
  /* Where the student has dragged the topic panel. Held HERE, not in the
     panel: LoPanel is keyed by topic id so it remounts on every click
     through, and a position that lived inside it would snap back to the
     dock each time — which is exactly the behaviour dragging is meant to
     escape. */
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  // Topics Noor references while she writes: the card rings once.
  const [citedIds, setCitedIds] = useState<Set<string>>(new Set());
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const pulseNonce = useRef(0);

  const selectedLo = useMemo(
    () => data.los.find((l) => l.id === selectedLoId) ?? null,
    [data.los, selectedLoId]
  );
  const questionsByLo = useMemo(() => {
    const m = new Map<string, SpineQuestion[]>();
    for (const q of data.questions) {
      const list = m.get(q.loId) ?? [];
      list.push(q);
      m.set(q.loId, list);
    }
    return m;
  }, [data.questions]);
  const questionsById = useMemo(
    () => new Map(data.questions.map((q) => [q.id, q])),
    [data.questions]
  );
  const losById = useMemo(
    () => new Map(data.los.map((l) => [l.id, l])),
    [data.los]
  );
  const questionCounts = useMemo(
    () =>
      new Map(
        data.los.map((l) => [l.id, questionsByLo.get(l.id)?.length ?? 0])
      ),
    [data.los, questionsByLo]
  );

  /**
   * How many topics sit on each step of the ramp, in the active snapshot.
   *
   * This replaced a single averaged stage, and the average was the wrong
   * statistic. It divided by every topic in the subject, so 90 topics with 19
   * touched came out at 0.12 and the header read "Just started" while five
   * cards on the map read "Nailed it" — a COVERAGE number wearing a mastery
   * label, and one that would sit on the lowest band for months however well
   * she did. Averaging only the touched topics fixes the contradiction and
   * introduces another: it would climb while most of the subject stayed
   * untouched, and it still answers a question nobody asked with one word for
   * ninety topics.
   *
   * A tally answers both at once and hides nothing — 71 not started IS the
   * coverage fact, 5 nailed IS the mastery fact, and the two sit side by side
   * without either one being averaged into the other.
   *
   * Not the stat-chip row the redesign cut. That row was the size of the
   * GRAPH (90 objectives, 1041 questions, 112 edges); this is the student's
   * own distribution across it, which is the one count she has any use for.
   */
  const tally = useMemo(() => {
    const key = asOf === "today" ? "current" : "baseline";
    const counts = [0, 0, 0, 0, 0];
    for (const lo of data.los) {
      const score = lo[key];
      counts[masteryStage(score, score > 0)] += 1;
    }
    return counts;
  }, [data.los, asOf]);

  const pulseLo = useCallback((loIds: string[]) => {
    if (loIds.length === 0) return;
    setCitedIds((prev) => {
      const next = new Set(prev);
      for (const id of loIds) next.add(id);
      return next;
    });
    setPulses((prev) => {
      const next = { ...prev };
      for (const id of loIds) next[id] = ++pulseNonce.current;
      return next;
    });
  }, []);

  const citeToLos = useCallback(
    (c: Cite): string[] => {
      if (c.kind === "lo") return losById.has(c.id) ? [c.id] : [];
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q ? [q.loId] : [];
      }
      return [];
    },
    [losById, questionsById]
  );

  const handleCite = useCallback(
    (c: Cite) => pulseLo(citeToLos(c)),
    [pulseLo, citeToLos]
  );

  const handleCiteClick = useCallback(
    (c: Cite) => {
      if (c.kind === "lo" && losById.has(c.id)) {
        setSelectedLoId(c.id);
        pulseLo([c.id]);
      } else if (c.kind === "q") {
        const q = questionsById.get(c.id);
        if (q) setOpenQuestion(q);
      }
    },
    [losById, questionsById, pulseLo]
  );

  /**
   * What a reference inside Noor's answer expands to on hover.
   *
   * Citations are allowed to appear INSIDE her answers; what they may not do
   * is carry the engineering surface back in. So this used to read "mastery
   * 69% today · 15% at baseline · book p.12" for a topic and "standard ·
   * lo:u3-1 · p.40 · reviewed ✓" for a question — a percentage, an internal
   * key and review vocabulary, one hover away from a screen that cut all
   * three. The topic now names its stage in the same words its card uses,
   * and a question names the page it came from.
   */
  const resolveCite = useCallback(
    (c: Cite): CiteInfo | null => {
      if (c.kind === "lo") {
        const lo = losById.get(c.id);
        if (!lo) return null;
        const stage = masteryStage(lo.current, lo.current > 0);
        const n = questionCounts.get(lo.id) ?? 0;
        return {
          title: lo.label,
          sub: `${masteryPhrase(stage)} · ${n} questions${
            lo.sourcePage ? ` · book p.${lo.sourcePage}` : ""
          }`,
        };
      }
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q
          ? {
              title: q.stem.length > 90 ? `${q.stem.slice(0, 90)}…` : q.stem,
              sub: q.provenance.sourcePage
                ? `From the book, p.${q.provenance.sourcePage}`
                : "From the book",
            }
          : null;
      }
      return {
        title: data.doc.title,
        sub: `${data.doc.publisher} · page ${c.id}`,
      };
    },
    [losById, questionsById, questionCounts, data.doc]
  );

  const handleChatAttempt = useCallback(
    (r: AttemptResult, _q: SpineQuestion) => {
      void _q;
      pulseLo([r.loId]);
      router.refresh(); // re-query mastery → the fills move
    },
    [pulseLo, router]
  );

  return (
    /* Full-bleed, and deliberately not a card.
     *
     * The map was a 1400px sticker frame floating on the page: rounded, ink
     * outlined, offset shadow — the same treatment as a button, wrapped
     * around the one thing on the screen that is bigger than the screen.
     * That box cost ~250px of width and ~170px of height to draw a border
     * nobody needed, and it framed a 3500px-wide graph in a 630px window.
     * The map is the page now. It runs edge to edge and takes every pixel
     * the app chrome is not using; the sticker language stays where it
     * belongs, on the things you press.
     *
     * The height is the viewport minus the shell's own header and footer.
     * Those are fixed-height bars in `app/layout.tsx` (57 + 50.5 ≈ 108) and
     * a couple of px of slack is invisible, where an undershoot would put a
     * second scrollbar on the document. `dvh`, so an iPad's collapsing URL
     * bar does not leave a strip of dead paper under the panel. */
    <main
      className="anim-rise flex flex-col"
      style={{ height: "calc(100dvh - 108px)", minHeight: 560 }}
    >
      {/* header — the subject, the two snapshots, and where she stands */}
      <header
        className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 bg-card-warm px-6 py-4"
        style={{
          borderBlockEndWidth: 3,
          borderBlockEndStyle: "solid",
          borderBlockEndColor: "var(--ink)",
        }}
      >
        <div>
          <p className="font-display text-[0.78rem] font-bold leading-none text-ink-soft">
            {titleCase(data.doc.subject)}
          </p>
          <h1 className="mt-1 font-display text-[1.25rem] font-extrabold leading-[1.1] text-ink">
            How you&apos;re doing
          </h1>
        </div>

        {/* The demo-student switcher, on its invisible corner hot-zone —
              the same variant /student uses. Wrapping the title in it
              instead would have worked, but the wrapper pins dir="ltr" on
              whatever it holds, and direction is never hard-coded on a
              student-facing string. Nothing here is visible to a student. */}
        <DemoStudentSwitcher
          students={demoStudents}
          currentId={demoStudentId}
        />

        <div className="flex gap-1.5 rounded-full border-[2.5px] border-ink bg-card p-[3px]">
          {(
            [
              ["baseline", "Where you started"],
              ["today", "Today"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setAsOf(key)}
              aria-pressed={asOf === key}
              className="rounded-full px-3.5 py-2 font-display text-[0.82rem] font-bold leading-none transition-colors duration-200"
              style={
                asOf === key
                  ? { background: "var(--noor-action)", color: "var(--ink)" }
                  : { color: "var(--ink-soft)" }
              }
            >
              {label}
            </button>
          ))}
        </div>

        <StageTally counts={tally} />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* the tree — subject-wide, so it scrolls in both axes.
            `overflow-clip` is what stops a dragged topic panel from growing
            the DOCUMENT: the panel is absolutely positioned in here, and
            absolute overflow propagates up to the nearest scroll container,
            which on a page with no scroll container is the document itself.
            Drag the panel low enough and the whole app picks up a scrollbar
            and the shell header scrolls away with it. */}
        <div className="relative min-w-0 flex-1 overflow-clip">
          <GraphCanvas
            los={data.los}
            edges={data.edges}
            asOf={asOf}
            selectedLoId={selectedLoId}
            questionCounts={questionCounts}
            onSelect={(id) =>
              setSelectedLoId((cur) => (cur === id ? null : id))
            }
            citedIds={citedIds}
            pulses={pulses}
          />

          {/* One topic, opened. It covers the tree it came from — never
                Noor's panel, which stays docked at its own full height. */}
          {selectedLo && (
            <LoPanel
              key={selectedLo.id}
              lo={selectedLo}
              allLos={data.los}
              questions={questionsByLo.get(selectedLo.id) ?? []}
              asOf={asOf}
              offset={panelOffset}
              onOffsetChange={setPanelOffset}
              onClose={() => setSelectedLoId(null)}
              onSelectLo={setSelectedLoId}
              onOpenQuestion={setOpenQuestion}
            />
          )}
        </div>

        <NoorPanel
          lookupQuestion={(qid) => questionsById.get(qid)}
          resolveCite={resolveCite}
          onCite={handleCite}
          onCiteClick={handleCiteClick}
          onAttemptResult={handleChatAttempt}
        />
      </div>

      {openQuestion && (
        <QuestionModal
          question={openQuestion}
          lo={data.los.find((l) => l.id === openQuestion.loId) ?? null}
          doc={data.doc}
          onClose={() => setOpenQuestion(null)}
        />
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The header's summary: how many topics sit on each step of the ramp.
 *
 * Five entries, always, including the ones reading zero. The set is fixed so
 * that flipping between the two snapshots compares like with like — "0 Nailed
 * it" at baseline against "5 Nailed it" today is the single strongest thing
 * this screen can say, and it only lands if the row does not reshuffle
 * underneath the tab. Hiding empty bands would also make the ramp look like
 * it has a different number of steps depending on when you look.
 *
 * Colour is never the only carrier here either: every swatch is named in
 * words beside it, so the row survives greyscale and CVD, and the swatches
 * take the same ink outline the fill segments do so a lit band is a
 * fill-vs-empty difference rather than only a hue one.
 *
 * Sized to stay on ONE header row beside the title and the tabs at 1024, the
 * narrowest width this layout targets. The first cut missed that by 7px and
 * wrapped, which turned a 70px header into a 120px one and took the
 * difference straight out of the map — so the gaps, the type and the
 * swatches here are all a notch tighter than they would otherwise be. It is
 * still `flex-wrap` underneath: below 1024 it drops to its own line rather
 * than crushing the tabs.
 *
 * "Your topics", not "Across Mathematics": the subject is already named two
 * inches to the left, and saying it twice in one bar is the kind of chrome
 * this redesign spent its budget removing.
 */
function StageTally({ counts }: { counts: number[] }) {
  return (
    <div className="ms-auto">
      <p className="font-display text-[0.72rem] font-bold leading-none text-ink-soft">
        Your topics
      </p>
      <ul className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {MASTERY_LEGEND.map((step, stage) => (
          <li key={step.band} className="flex items-center gap-1">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-[3px] border-[1.5px] border-ink"
              style={{ background: step.hex }}
            />
            {/* The numeral gets its own span for a future dir="ltr" wrap. */}
            <span
              dir="ltr"
              className="font-display text-[0.8rem] font-extrabold leading-none text-ink"
            >
              {counts[stage]}
            </span>
            <span className="font-display text-[0.7rem] font-bold leading-none text-ink-soft">
              {masteryPhrase(stage as 0 | 1 | 2 | 3 | 4)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
