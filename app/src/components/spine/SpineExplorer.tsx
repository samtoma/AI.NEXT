"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  AttemptResult,
  SpineData,
  SpineQuestion,
  SpineSubject,
} from "@/lib/types";
import type { Cite } from "@/lib/chat-parse";
import { SPINE_SUBJECT_KEYS, displayLabelOfSpineKey } from "@/lib/subjects";
import { GraphCanvas, type AsOf } from "./GraphCanvas";
import { LoPanel } from "./LoPanel";
import { QuestionModal } from "./QuestionModal";
import { AskSpineDock } from "@/components/chat/AskSpineDock";
import type { CiteInfo } from "@/components/chat/CitationChip";
import { MASTERY_LEGEND, pct } from "@/lib/mastery";
import {
  HEADING,
  MASTERY_SWATCH,
  STICKER_CARD,
  STROKE,
  cx,
} from "@/components/sticker";

/** The as-of / subject toggles: one sticker pill holding its segments. */
const SEGMENTED = cx(
  STROKE,
  "flex items-center gap-1 rounded-[var(--play-radius-pill)] bg-card p-1 sticker-shadow"
);
/** A segment keeps the 52px target; the chosen one is the ink surface with
 *  its inverse text, the pairing every ink control in the product uses. */
const segment = (on: boolean) =>
  cx(
    "inline-flex min-h-[var(--noor-touch-min)] items-center rounded-[var(--play-radius-pill)] px-4",
    "font-display text-[0.85rem] font-bold transition-colors duration-200",
    on ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
  );

const fmtDate = (iso: string) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "—";

export function SpineExplorer({ data }: { data: SpineData }) {
  const router = useRouter();
  const [asOf, setAsOf] = useState<AsOf>("today");
  const [subjectFilter, setSubjectFilter] = useState<"all" | SpineSubject>("all");
  const [selectedLoId, setSelectedLoId] = useState<string | null>(null);
  const [openQuestion, setOpenQuestion] = useState<SpineQuestion | null>(null);
  // AI-citation choreography: cited nodes glow; each cite fires a pulse ring
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

  // Subjects present in the loaded graph, in registry order (the filter only
  // appears when >1). Unfiled LOs contribute no filter chip — they are only
  // ever visible under "All subjects".
  const subjectsPresent = useMemo(() => {
    const present = new Set(data.los.map((l) => l.subject));
    return SPINE_SUBJECT_KEYS.filter((k) => present.has(k));
  }, [data.los]);

  // The graph shows one territory (filtered) or all (territories side by side).
  const visibleLos = useMemo(
    () =>
      subjectFilter === "all"
        ? data.los
        : data.los.filter((l) => l.subject === subjectFilter),
    [data.los, subjectFilter]
  );
  const visibleLoIds = useMemo(
    () => new Set(visibleLos.map((l) => l.id)),
    [visibleLos]
  );
  // A bridge only draws when BOTH its endpoints are on screen.
  const visibleBridges = useMemo(
    () =>
      data.bridges.filter(
        (b) => visibleLoIds.has(b.src) && visibleLoIds.has(b.dst)
      ),
    [data.bridges, visibleLoIds]
  );

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

  /** cite → LO id(s) to light up on the DAG */
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
      // page chips pin their own mini source-reference card
    },
    [losById, questionsById, pulseLo]
  );

  const resolveCite = useCallback(
    (c: Cite): CiteInfo | null => {
      if (c.kind === "lo") {
        const lo = losById.get(c.id);
        return lo
          ? {
              title: lo.label,
              sub: `mastery ${pct(lo.current)} today · ${pct(lo.baseline)} at baseline · book p.${lo.sourcePage ?? "—"}`,
            }
          : null;
      }
      if (c.kind === "q") {
        const q = questionsById.get(c.id);
        return q
          ? {
              title:
                q.stem.length > 90 ? `${q.stem.slice(0, 90)}…` : q.stem,
              sub: `${q.tier} · ${q.loId} · p.${q.provenance.sourcePage ?? "—"} · reviewed ✓`,
            }
          : null;
      }
      return {
        title: data.doc.title,
        sub: `${data.doc.publisher} · edition ${data.doc.edition} · page ${c.id}`,
      };
    },
    [losById, questionsById, data.doc]
  );

  const handleChatAttempt = useCallback(
    (r: AttemptResult, _q: SpineQuestion) => {
      void _q;
      pulseLo([r.loId]);
      router.refresh(); // re-query mastery → the graph ripples
    },
    [pulseLo, router]
  );

  const avg = (key: "baseline" | "current") =>
    visibleLos.reduce((s, l) => s + l[key], 0) / Math.max(1, visibleLos.length);

  const pickSubject = (s: "all" | SpineSubject) => {
    setSubjectFilter(s);
    // drop a selection that's about to leave the view
    setSelectedLoId((cur) =>
      cur && s !== "all" && losById.get(cur)?.subject !== s ? null : cur
    );
  };

  return (
    <main className="mx-auto max-w-[1400px] px-6 pb-12">
      {/* header strip */}
      <section className="anim-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pb-5 pt-9">
        <div className="max-w-2xl">
          <p className="rule-label mb-4">The Evidence Walk</p>
          <h1 className={cx(HEADING, "text-3xl md:text-4xl")}>
            The curriculum spine, with receipts.
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-ink-soft">
            Extracted from:{" "}
            <strong className="font-semibold text-ink">{data.doc.title}</strong>{" "}
            — {data.doc.publisher}. Click any objective, then any question, and
            follow it back to the page it came from.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="chip border-gold/50 text-gold">
            syllabus {data.syllabusVersion}
          </span>
          <span className="chip">{data.counts.los} learning objectives</span>
          <span className="chip">{data.counts.questions} live questions</span>
          <span className="chip">{data.counts.edges} prerequisite edges</span>
          <span className="chip">{data.counts.attempts} attempts logged</span>
        </div>
      </section>

      {/* toolbar: as-of toggle + legend */}
      <section
        className="anim-rise mb-4 flex flex-wrap items-center justify-between gap-4"
        style={{ animationDelay: "90ms" }}
      >
        <div className="flex flex-wrap items-center gap-4">
          {subjectsPresent.length > 1 && (
            <div className={SEGMENTED}>
              {(["all", ...subjectsPresent] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => pickSubject(key)}
                  className={segment(subjectFilter === key)}
                >
                  {key === "all" ? "All subjects" : displayLabelOfSpineKey(key)}
                </button>
              ))}
            </div>
          )}
          <div className={SEGMENTED}>
            {(
              [
                ["baseline", `Baseline (diagnostic) · ${fmtDate(data.baselineDate)}`],
                ["today", `Today · ${fmtDate(data.currentDate)}`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setAsOf(key)}
                className={segment(asOf === key)}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint lg:inline">
            as-of query · mastery for system_time as of{" "}
            {asOf === "baseline" ? fmtDate(data.baselineDate) : "now()"}
          </span>
        </div>

        <div className="flex items-center gap-5">
          {/* The same five-step ramp every other screen paints (lib/mastery):
              not started → amber → teal, no red, each step named, because
              colour is never the only carrier of a band. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              mastery
            </span>
            <ul
              aria-label="Mastery bands"
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
            >
              {MASTERY_LEGEND.map((s) => (
                <li
                  key={s.band}
                  className="inline-flex items-center gap-1.5 font-display text-[0.72rem] font-bold text-ink-soft"
                >
                  <span
                    aria-hidden
                    className={MASTERY_SWATCH}
                    style={{ backgroundColor: s.color }}
                  />
                  {s.band}
                </li>
              ))}
            </ul>
          </div>
          {/* Whose graph this is. It used to be a triple-tap door onto the
              demo-student switcher; the cast is retired and the student now
              comes from the session, so the chip is just a label again. */}
          <span className="chip">
            {data.studentName} · avg{" "}
            <strong
              className="font-semibold text-ink transition-all duration-500"
              key={asOf}
            >
              {pct(avg(asOf === "today" ? "current" : "baseline"))}
            </strong>
          </span>
        </div>
      </section>

      {/* graph + panel */}
      <section
        className="anim-rise flex items-stretch gap-4"
        style={{ animationDelay: "160ms" }}
      >
        <div className={cx(STICKER_CARD, "min-w-0 flex-1 overflow-hidden")}>
          <GraphCanvas
            los={visibleLos}
            edges={data.edges}
            bridges={visibleBridges}
            showTerritories={subjectFilter === "all" && subjectsPresent.length > 1}
            asOf={asOf}
            selectedLoId={selectedLoId}
            questionCounts={
              new Map(
                visibleLos.map((l) => [l.id, questionsByLo.get(l.id)?.length ?? 0])
              )
            }
            onSelect={(id) =>
              setSelectedLoId((cur) => (cur === id ? null : id))
            }
            citedIds={citedIds}
            pulses={pulses}
          />
          <div className="flex items-center justify-between border-t border-line-soft px-5 py-2.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              prerequisite DAG · layered by depth · graph_edges where
              edge_type=&apos;prerequisite_of&apos; and system_to is null
            </span>
            <span className="font-mono text-[10px] text-ink-faint">
              → arrow = &quot;is prerequisite of&quot;
            </span>
          </div>
        </div>

        {selectedLo && (
          <LoPanel
            key={selectedLo.id}
            lo={selectedLo}
            allLos={data.los}
            questions={questionsByLo.get(selectedLo.id) ?? []}
            bridges={data.bridges.filter(
              (b) => b.src === selectedLo.id || b.dst === selectedLo.id
            )}
            asOf={asOf}
            onClose={() => setSelectedLoId(null)}
            onSelectLo={setSelectedLoId}
            onOpenQuestion={setOpenQuestion}
          />
        )}
      </section>

      {openQuestion && (
        <QuestionModal
          question={openQuestion}
          lo={data.los.find((l) => l.id === openQuestion.loId) ?? null}
          doc={data.doc}
          onClose={() => setOpenQuestion(null)}
        />
      )}

      <AskSpineDock
        lookupQuestion={(qid) => questionsById.get(qid)}
        resolveCite={resolveCite}
        onCite={handleCite}
        onCiteClick={handleCiteClick}
        onAttemptResult={handleChatAttempt}
        studentName={data.studentName}
      />
    </main>
  );
}
