import { getLessonContent } from "@/lib/lesson-content";
import { LessonContentView } from "@/components/student/LessonContentView";

/**
 * DEV HARNESS — renders the rich-content lesson surface from the checked-in
 * `_sample.json` bundle so the loader + LessonContentView + the four
 * interactive adapters are exercisable with zero DB / AI. Not linked from
 * anywhere; harmless static route. (Temporary — delete with _sample.json.)
 */
export const dynamic = "force-dynamic";

export default async function DevLessonContentPage() {
  const content = await getLessonContent("_sample");
  if (!content) {
    return (
      <main className="mx-auto max-w-xl px-6 pt-16 text-center">
        <p className="font-mono text-[11px] text-rust">
          _sample.json not found under services/extraction/seed/content/
        </p>
      </main>
    );
  }
  return <LessonContentView content={content} />;
}
