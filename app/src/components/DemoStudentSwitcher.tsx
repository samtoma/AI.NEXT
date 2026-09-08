"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  DEMO_STUDENT_COOKIE,
  DEMO_STUDENT_COOKIE_MAX_AGE,
  type DemoStudent,
} from "@/lib/demo-student";
import {
  INTEREST_CATEGORIES,
  DETAIL_CATEGORIES,
  GRADES,
  gradeLabel,
  type InterestId,
} from "@/lib/profile";
import { useTripleTap } from "@/lib/use-triple-tap";

/**
 * The demo student switcher, hidden behind the founders' triple-tap.
 *
 * ⚠️  A DEMO AFFORDANCE, NOT AUTH (PRD §3 puts auth out of MVP scope). ⚠️
 * It writes a plain cookie naming which seeded student the PoC renders; the
 * server validates that id against the `students` table on every request and
 * falls back to the default student when it doesn't resolve. Nothing here
 * grants access to anything — it selects among demo rows that are all equally
 * visible to whoever can open the site.
 *
 * Samuel's call: a real student must never see this control, so it has NO
 * visible chrome. Triple-tap the wrapped element (or the invisible corner
 * hot-zone in `variant="corner"`) to reveal it — the same gesture that reveals
 * the debug receipts inside a lesson.
 */
export function DemoStudentSwitcher({
  students,
  currentId,
  children,
  visible = false,
}: {
  students: DemoStudent[];
  currentId: number;
  /** wrapped element = the (invisible) trigger; omit for a corner hot-zone */
  children?: ReactNode;
  /** PoC (Samuel, 2026-07-30): render a VISIBLE profile dropdown — single
   *  click, normal button showing the current student — instead of the
   *  hidden triple-tap affordance. The hidden variants stay for the lesson
   *  surfaces; this one fronts the student home as a "who's studying?" pick. */
  visible?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGrade, setNewGrade] = useState<string>("9");
  const [newInterests, setNewInterests] = useState<InterestId[]>([]);
  const [detailWhich, setDetailWhich] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  // The panel is position:FIXED, anchored to the trigger's measured rect.
  // An absolutely-positioned panel would be painted under later siblings —
  // the page sections each create their own stacking context (anim-rise), so
  // "z-50 inside an earlier section" still loses to the graph card.
  const [pos, setPos] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);
  const toggle = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const vw = window.innerWidth;
      // anchor to whichever side keeps the 19rem panel on-screen — the
      // visible trigger sits at the RTL start (left edge), where a
      // right-anchored panel clips off the viewport
      setPos(
        r.left < vw / 2
          ? { top: r.bottom + 8, left: Math.max(12, r.left) }
          : { top: r.bottom + 8, right: Math.max(12, vw - r.right) }
      );
    }
    setOpen((o) => !o);
  }, []);
  const onTap = useTripleTap(toggle);

  // The corner hot-zone and the panel render through a PORTAL to <body>: the
  // page sections (anim-rise) and the z-10 footer each create stacking
  // contexts, so a fixed z-40 span nested inside a section paints UNDER the
  // footer — elementFromPoint returns the footer and the taps never arrive.
  // Portaling escapes every ancestor context. (Found in Wave D verification.)
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const choose = useCallback(
    (id: number) => {
      // Deliberately client-writable: this is a picker, not a session.
      // The 30-day max-age is what satisfies "remembered across visits"
      // (FR-105) — no login to re-enter, the last pick simply persists.
      document.cookie =
        `${DEMO_STUDENT_COOKIE}=${id}; path=/; ` +
        `max-age=${DEMO_STUDENT_COOKIE_MAX_AGE}; samesite=lax`;
      // Fire-and-forget: the cookie is already written, so a failed event must
      // not stop the student getting into their lesson.
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: "student_selected" }),
        keepalive: true,
      }).catch(() => {});
      setOpen(false);
      router.refresh(); // re-render the server components with the new student
    },
    [router]
  );

  const current = students.find((s) => s.id === currentId);

  return (
    <span ref={wrapRef} className="relative inline-block" dir="ltr">
      {visible ? (
        // PoC profile dropdown: one click, clearly labeled (not the hidden
        // founders' gesture) — "who's studying today?"
        <button
          onClick={toggle}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium text-ink shadow-sm transition-all duration-150 hover:-translate-y-px hover:border-accent/50"
        >
          <span aria-hidden>👤</span>
          {current?.displayName ?? "الطالب"}
          <span className="text-[10px] text-ink-faint" aria-hidden>
            ▾
          </span>
        </button>
      ) : (
        children && (
          <span
            onClick={onTap}
            className="cursor-default select-none"
            title="" /* no hint: students must not discover this */
          >
            {children}
          </span>
        )
      )}
      {mounted &&
        !children &&
        !visible &&
        createPortal(
          // bottom-RIGHT on purpose: Next's dev-tools badge owns the bottom-left
          <span
            onClick={onTap}
            aria-hidden
            className="fixed bottom-0 right-0 z-[59] h-11 w-11 cursor-default select-none"
          />,
          document.body
        )}

      {mounted &&
        open &&
        createPortal(
        <span dir="ltr">
          {/* click-away */}
          <span
            className="fixed inset-0 z-[60]"
            onClick={() => setOpen(false)}
          />
          <div
            style={
              (children || visible) && pos
                ? { top: pos.top, left: pos.left, right: pos.right }
                : undefined
            }
            className={`ledger-card fixed z-[61] w-[19rem] p-3 text-left shadow-xl ${
              children || visible ? "" : "bottom-12 right-3"
            }`}
          >
            <p className="rule-label mb-2">Who is studying? · picker, not a login</p>
            <ul className="space-y-1">
              {students.map((s) => {
                const active = s.id === currentId;
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => choose(s.id)}
                      className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
                        active
                          ? "bg-ink text-paper"
                          : "text-ink-soft hover:bg-ink/5 hover:text-ink"
                      }`}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] font-medium">
                          {s.displayName}
                        </span>
                        <span
                          className={`font-mono text-[10px] ${
                            active ? "text-paper/70" : "text-ink-faint"
                          }`}
                        >
                          id {s.id}
                        </span>
                      </span>
                      <span
                        className={`mt-0.5 block font-mono text-[10px] ${
                          active ? "text-paper/70" : "text-ink-faint"
                        }`}
                      >
                        {gradeLabel(s.grade)}
                        {" · "}
                        {s.attempts === 0 && s.masteryRows === 0
                          ? "cold start · 0 attempts · no mastery yet"
                          : `${s.attempts} attempts · avg ${Math.round(
                              s.avgMastery * 100
                            )}%`}
                      </span>
                    </button>
                  </li>
                );
              })}
              {students.length === 0 && (
                <li className="px-2.5 py-2 font-mono text-[11px] text-ink-faint">
                  no students yet — create one below
                </li>
              )}
            </ul>

            {/*
              Create a student: name + grade are required (FR-103), interests are
              optional and must never block (FR-104). Deliberately one short
              form, per Samuel's "as easy as possible" (decisions.md Q5) — no
              password, no verification, no multi-step wizard.
            */}
            <form
              className="mt-2 space-y-2 border-t border-line-soft px-1 pt-2.5"
              onSubmit={async (e) => {
                e.preventDefault();
                const name = newName.trim();
                if (name.length < 2 || creating) return;
                setCreating(true);
                try {
                  // Only send detail for categories that were actually picked —
                  // the server drops the rest anyway, and an analogy anchored to
                  // an unselected interest would be exactly the invention FR-203
                  // forbids.
                  const interestDetail: Record<string, { which: string[] }> = {};
                  for (const cat of DETAIL_CATEGORIES) {
                    const raw = (detailWhich[cat] ?? "").trim();
                    if (newInterests.includes(cat) && raw) {
                      interestDetail[cat] = {
                        which: raw.split(",").map((w) => w.trim()).filter(Boolean),
                      };
                    }
                  }
                  const res = await fetch("/api/demo-students", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name,
                      grade: newGrade,
                      interests: newInterests,
                      interestDetail,
                    }),
                  });
                  if (res.ok) {
                    const j = (await res.json()) as { id: number };
                    setNewName("");
                    setNewInterests([]);
                    setDetailWhich({});
                    choose(j.id); // switch to the new student + refresh the roster
                  }
                } finally {
                  setCreating(false);
                }
              }}
            >
              <p className="rule-label">Create new user</p>

              <div className="flex items-center gap-1.5">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Name"
                  maxLength={40}
                  aria-label="Student name"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-accent/60"
                />
                <select
                  value={newGrade}
                  onChange={(e) => setNewGrade(e.target.value)}
                  aria-label="Grade"
                  className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent/60"
                >
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      Grade {g}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-1">
                {INTEREST_CATEGORIES.map((c) => {
                  const on = newInterests.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setNewInterests((prev) =>
                          prev.includes(c.id)
                            ? prev.filter((x) => x !== c.id)
                            : [...prev, c.id]
                        )
                      }
                      aria-pressed={on}
                      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                        on
                          ? "border-accent/50 bg-accent-wash text-accent-deep"
                          : "border-line text-ink-faint hover:text-ink"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>

              {/* PRD A3: one follow-up for Sports and Music only — a category
                  label alone is not something an analogy can be anchored to. */}
              {DETAIL_CATEGORIES.filter((c) => newInterests.includes(c)).map((c) => (
                <input
                  key={c}
                  value={detailWhich[c] ?? ""}
                  onChange={(e) =>
                    setDetailWhich((prev) => ({ ...prev, [c]: e.target.value }))
                  }
                  placeholder={
                    c === "sports" ? "Which sport(s)?" : "Which instrument / kind?"
                  }
                  maxLength={60}
                  aria-label={`${c} detail`}
                  className="w-full rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent/60"
                />
              ))}

              <button
                type="submit"
                disabled={creating || newName.trim().length < 2}
                className="w-full rounded-lg bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors disabled:opacity-40"
              >
                {creating ? "…" : "Add student"}
              </button>
              <p className="font-mono text-[10px] leading-relaxed text-ink-faint">
                Interests are optional — skipping them just means a colder start.
              </p>
            </form>
            <p className="mt-2 px-2.5 font-mono text-[10px] leading-relaxed text-ink-faint">
              A picker, validated server-side. Not a login.
            </p>
          </div>
        </span>,
        document.body
      )}
    </span>
  );
}
