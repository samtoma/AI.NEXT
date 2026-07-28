import { amiriQuran } from "@/app/fonts-quran";

/**
 * Wrapper for a Quranic passage (ADR-0006 §3).
 *
 * This is the opt-in point for the Amiri Quran face: importing it is what pulls
 * the font into a route's CSS, so any page that does not render scripture never
 * downloads it. Nothing renders Quranic text yet — the Arabic vertical has not
 * been extracted — so this exists to make the lazy path the obvious one when
 * that component arrives, rather than having someone reach for the global font.
 *
 * The text itself must come from the pinned, checksummed حفص corpus (ADR-0006
 * §2: vendor, never transcribe). This component only decides how it looks.
 */
export function QuranPassage({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      dir="rtl"
      lang="ar"
      className={`${amiriQuran.variable} font-quran ${className}`}
    >
      {children}
    </span>
  );
}
