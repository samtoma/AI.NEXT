import { redirect } from "next/navigation";

import { getSpineData } from "@/lib/queries";
import { resolveStudentContext } from "@/lib/student-context";
import { SpineExplorer } from "@/components/spine/SpineExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Evidence Walk — Noor Tutor PoC",
};

/**
 * /spine — the curriculum graph, coloured by the signed-in student's mastery.
 *
 * Signed out → `/signin`: the colours on this graph are one student's record,
 * and there is no anonymous version of it to show.
 *
 * **Unverified is deliberately NOT gated.** FR-2004 gates learning, and this
 * is content: a map of what the syllabus contains and what she has met so far.
 * Nothing here starts a lesson, spends an AI turn or writes an attempt. A
 * student who is waiting on an email should be able to look around the thing
 * she just signed up for.
 */
export default async function SpinePage() {
  const me = await resolveStudentContext();
  if (!me) redirect("/signin?next=/spine");

  const data = await getSpineData(me.studentId);
  return <SpineExplorer data={data} />;
}
