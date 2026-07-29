"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  DEMO_STUDENT_COOKIE,
  DEMO_STUDENT_COOKIE_MAX_AGE,
  type DemoStudent,
} from "@/lib/demo-student";
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
}: {
  students: DemoStudent[];
  currentId: number;
  /** wrapped element = the (invisible) trigger; omit for a corner hot-zone */
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  // The panel is position:FIXED, anchored to the trigger's measured rect.
  // An absolutely-positioned panel would be painted under later siblings —
  // the page sections each create their own stacking context (anim-rise), so
  // "z-50 inside an earlier section" still loses to the graph card.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const toggle = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      setPos({
        top: r.bottom + 8,
        right: Math.max(12, window.innerWidth - r.right),
      });
    }
    setOpen((o) => !o);
  }, []);
  const onTap = useTripleTap(toggle);

  const choose = useCallback(
    (id: number) => {
      // Deliberately client-writable: this is a demo switch, not a session.
      document.cookie =
        `${DEMO_STUDENT_COOKIE}=${id}; path=/; ` +
        `max-age=${DEMO_STUDENT_COOKIE_MAX_AGE}; samesite=lax`;
      setOpen(false);
      router.refresh(); // re-render the server components with the new student
    },
    [router]
  );

  return (
    <span ref={wrapRef} className="relative inline-block" dir="ltr">
      {children ? (
        <span
          onClick={onTap}
          className="cursor-default select-none"
          title="" /* no hint: students must not discover this */
        >
          {children}
        </span>
      ) : (
        // bottom-RIGHT on purpose: Next's dev-tools badge owns the bottom-left
        <span
          onClick={onTap}
          aria-hidden
          className="fixed bottom-0 right-0 z-40 h-11 w-11 cursor-default select-none"
        />
      )}

      {open && (
        <>
          {/* click-away */}
          <span
            className="fixed inset-0 z-[60]"
            onClick={() => setOpen(false)}
          />
          <div
            style={children && pos ? { top: pos.top, right: pos.right } : undefined}
            className={`ledger-card fixed z-[61] w-[19rem] p-3 text-left shadow-xl ${
              children ? "" : "bottom-12 right-3"
            }`}
          >
            <p className="rule-label mb-2">Demo student · not auth</p>
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
                  no students seeded
                </li>
              )}
            </ul>
            <p className="mt-2 px-2.5 font-mono text-[10px] leading-relaxed text-ink-faint">
              demo affordance — a cookie, validated server-side. Not a login.
            </p>
          </div>
        </>
      )}
    </span>
  );
}
