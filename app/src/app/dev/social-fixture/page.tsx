"use client";

import { useState } from "react";
import { LessonSession } from "@/components/student/LessonSession";
import type { ChatMsg, LessonData } from "@/lib/types";
import { SUBJECTS } from "@/lib/subjects";

/**
 * DEV HARNESS (Wave 1 Track B) — renders the social-ar lesson surface from a
 * hardcoded fixture while the social bundles are still being extracted:
 * fabricated LessonData (subject "social-ar") + a seeded saved session whose
 * assistant messages carry one directive per new widget, so LessonSession's
 * renderWidget path, the whiteboard interception of the v2 viz kinds, the RTL
 * flip and the [[term?:…]] chip are all exercisable with zero AI turns.
 * (Interacting with a widget still fires the real [live event] → auto-continue
 * flow, which spends an AI turn — that part is the point.)
 * Not linked from anywhere; harmless static route.
 */

const FIXTURE: LessonData = {
  slug: "socfx-1",
  lessonRef: "الدرس ١",
  title: "الحملة الفرنسية على مصر",
  moduleLabel: "الوحدة الأولى — مصر والحملة الفرنسية",
  courseId: SUBJECTS["social-ar"].courseId,
  subject: "social-ar",
  los: [
    {
      id: "lo:socfx-1-1",
      label: "يفسر أسباب الحملة الفرنسية على مصر",
      description: null,
      sourcePage: 12,
      mastery: 0.2,
    },
    {
      id: "lo:socfx-1-2",
      label: "يتتبع خط سير الحملة الفرنسية",
      description: null,
      sourcePage: 13,
      mastery: 0.1,
    },
  ],
  questions: [
    {
      id: "q:socfx-1-1:001",
      loId: "lo:socfx-1-1",
      tier: "basic",
      questionType: "mcq",
      stem: "بم تفسر: اتجاه فرنسا إلى احتلال مصر؟",
      choices: [
        { key: "a", text: "لقطع الطريق بين إنجلترا ومستعمراتها في الهند" },
        { key: "b", text: "لنشر اللغة الفرنسية" },
        { key: "c", text: "للبحث عن الذهب" },
      ],
      correctAnswer: "a",
      solution: [],
      solutionVersion: 1,
      status: "live",
      provenance: {
        source: "fixture",
        sourceSha256: "fixture",
        sourcePage: 12,
        sourceNote: null,
        reviewedBy: null,
        reviewedAt: null,
        extractor: null,
        extractorVersion: null,
        extractionFinishedAt: null,
      },
    },
  ],
  visuals: [],
  mapBases: ["egypt"],
  docTitle: "الدراسات الاجتماعية — الصف الثالث الإعدادي",
  studentName: "Omar Hassan",
  studentId: 1,
};

const A = (text: string): ChatMsg => ({ role: "assistant", text });

const MESSAGES: ChatMsg[] = [
  A(
    `أهلاً يا عمر! النهاردة هنفهم الحملة الفرنسية على مصر خطوة خطوة [[page:12]]. أول مصطلح مهم هو الموقع الفلكي [[term?:الموقع الفلكي]].\n\n{{beat}}\n\nخلينا نبدأ بالخريطة — فين قناة السويس؟\n\n{{widget:locate_on_map:{"base":"egypt","prompt":"فين قناة السويس؟ دوس على مكانها","target":"قناة السويس","decoys":["نهر النيل","خليج العقبة"]}}}`
  ),
  A(
    `جميل! دلوقتي نرتب أحداث الحملة زي ما حصلت [[lo:socfx-1-2]].\n\n{{widget:timeline_builder:{"prompt":"رتب الأحداث زي ما حصلت","events":["وصول الحملة الفرنسية إلى الإسكندرية","موقعة إمبابة","موقعة أبي قير البحرية"],"correctOrder":[0,1,2]}}}`
  ),
  A(
    `حلو كده. طيب — بم تفسر قيام ثورة القاهرة الأولى؟ ركّب السلسلة بنفسك.\n\n{{widget:chain_builder:{"prompt":"ركّب سلسلة «بم تفسر»","cards":[{"label":"فرض الضرائب الفادحة","role":"سبب"},{"label":"ثورة القاهرة الأولى","role":"حدث"},{"label":"إعدام عدد من الثوار","role":"نتيجة"}],"correctChain":[0,1,2]}}}`
  ),
  A(
    `آخر تدريب — المصطلحات.\n\n{{widget:term_match:{"prompt":"وصّل المصطلح بمعناه","pairs":[{"term":"الموقع الفلكي","definition":"موقع المكان بالنسبة لدوائر العرض وخطوط الطول"},{"term":"الجلاء","definition":"رحيل قوات الاحتلال عن البلد المحتل"}],"decoyDefs":["اتساع المكان من الشمال إلى الجنوب"]}}}`
  ),
  A(
    `وبص على خط سير الحملة على السبورة ✎.\n\n{{widget:viz:{"kind":"map_scene","spec":{"base":"egypt","marks":[{"kind":"point","place":"الإسكندرية","step":1},{"kind":"route","through":["الإسكندرية","رشيد","القاهرة"],"label":"خط السير","step":2},{"kind":"badge","place":"القاهرة","label":"دخول القاهرة ١٧٩٨م","step":3}],"animate":"sequence"},"caption":"خط سير الحملة الفرنسية من الإسكندرية إلى القاهرة"}}}`
  ),
  A(
    `والخط الزمني للأحداث كمان.\n\n{{widget:viz:{"kind":"timeline","spec":{"era":[1798,1801],"events":[{"label":"وصول الحملة","when":"١٧٩٨م","step":1},{"label":"ثورة القاهرة الأولى","when":"أكتوبر ١٧٩٨م","step":2},{"label":"الجلاء","when":"١٨٠١م","step":3}],"animate":"sequence"},"caption":"من الوصول إلى الجلاء"}}}\n\n{{beat}}\n\nوسلسلة السبب والنتيجة.\n\n{{widget:viz:{"kind":"flow_chain","spec":{"nodes":[{"label":"فرض الضرائب","role":"سبب","step":1},{"label":"ثورة القاهرة","role":"حدث","step":2},{"label":"إعدام الثوار","role":"نتيجة","step":3}],"animate":"sequence"},"caption":"بم تفسر قيام الثورة"}}}\n\n{{show_question:q:socfx-1-1:001}}`
  ),
];

export default function SocialFixturePage() {
  const [mounted, setMounted] = useState(false);

  if (mounted) return <LessonSession mode="learn" lesson={FIXTURE} />;

  return (
    <main className="mx-auto max-w-xl px-6 pt-16 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-faint">
        dev harness · social widgets fixture
      </p>
      <button
        onClick={() => {
          try {
            sessionStorage.setItem(
              `ainext-lesson:learn:${FIXTURE.slug}`,
              JSON.stringify({
                v: 1,
                sid: "fixture-socfx",
                messages: MESSAGES,
                board: [],
                focusKey: null,
                covered: ["lo:socfx-1-1"],
                at: Date.now(),
              })
            );
          } catch {
            /* storage unavailable — LessonSession will start fresh */
          }
          setMounted(true);
        }}
        className="mt-6 rounded-full bg-ink px-6 py-2.5 text-[14px] font-semibold text-paper"
      >
        Load fixture lesson →
      </button>
      <p className="mt-3 text-[12px] text-ink-soft">
        Seeds a saved social-ar session (all four widgets + the three v2 viz
        kinds + a [[term?]] flag), then mounts LessonSession. Resume it via
        «كمل من حيث وقفت» — zero AI turns until you interact.
      </p>
    </main>
  );
}
