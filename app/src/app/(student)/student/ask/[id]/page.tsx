import { notFound, redirect } from "next/navigation";
import { resolveStudentContext } from "@/lib/student-context";
import { getAsk } from "@/lib/homework";
import { coerceId } from "@/lib/homework-rules";
import { OutstandingScreen } from "@/components/auth/OutstandingScreen";
import { HomeworkSession } from "@/components/student/HomeworkSession";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Your question — Noor",
};

/**
 * /student/ask/:id — one homework ask (spec 004, FR-3607…FR-3613).
 *
 * The same two gates as /student, in the same order: anonymous goes to sign-in
 * and comes back here; unverified sees the outstanding screen. The ask is read
 * under the student's principal, so somebody else's id is a 404, the same as
 * an id that never existed.
 */
export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await resolveStudentContext();
  if (!me) redirect(`/signin?next=${encodeURIComponent(`/student/ask/${id}`)}`);
  if (!me.emailVerified) return <OutstandingScreen studentName={me.studentName} />;

  const askId = coerceId(id);
  if (!askId) notFound();
  const ask = await getAsk(me.studentId, askId);
  if (!ask) notFound();

  return <HomeworkSession initial={ask} />;
}
