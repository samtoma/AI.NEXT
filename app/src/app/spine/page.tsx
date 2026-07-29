import { getSpineData } from "@/lib/queries";
import { resolveStudentContext } from "@/lib/student-context";
import { SpineExplorer } from "@/components/spine/SpineExplorer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "The Evidence Walk — AI.Next Tutor PoC",
};

export default async function SpinePage() {
  // Which demo student's mastery colours the graph. Cookie-selected and
  // validated against the students table; falls back to the default student.
  // A demo affordance, NOT auth (auth is a PRD §3 non-goal for the MVP).
  const { studentId, students } = await resolveStudentContext();
  const data = await getSpineData(studentId);
  return (
    <SpineExplorer
      data={data}
      demoStudents={students}
      demoStudentId={studentId}
    />
  );
}
