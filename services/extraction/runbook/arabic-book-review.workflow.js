export const meta = {
  name: 'arabic-book-review',
  description: 'Full-book audit of the Arabic vertical: per-lesson independent re-solve + provenance, prerequisite-graph pedagogical review, completeness critic',
  phases: [
    { title: 'Audit', detail: 'one independent auditor per lesson — answers re-solved, provenance spot-checked against the PDF' },
    { title: 'Graph', detail: 'every prerequisite edge judged; missing relationships proposed' },
    { title: 'Completeness', detail: 'what did the whole pipeline miss?' },
  ],
}

const ROOT = '/Users/samueltoma/Documents/Claude/Projects/AI Enthusiasts/PoC Tutor School V1'
const EX = `${ROOT}/services/extraction`
const PDF = `${ROOT}/docs/Source/Arabic_Prp3_Tr1_2.pdf`

// slug ↔ workflow-id ↔ printed/pdf pages (identical tables to the conveyor +
// assembler — the auditors need them to find their lesson everywhere)
const t1 = (a, b) => ({ printed: `${a}-${b}`, pdf: `${a + 1}-${b + 1}`, term: 1 })
const t2 = (a, b) => ({ printed: `${a}-${b}`, pdf: `${a + 61}-${b + 61}`, term: 2 })
const LESSONS = [
  { slug: 'ara1-1', title: 'عِبادُ الرَّحمنِ', kind: 'quran', ...t1(8, 13) },
  { slug: 'ara1-2', title: 'كُنْ جَمِيلًا', kind: 'poetry', ...t1(14, 18) },
  { slug: 'ara1-3', title: 'قِصَّةُ أَثَرٍ', kind: 'prose', ...t1(19, 23) },
  { slug: 'ara2-1', title: 'رَحْمَةٌ ومَحَبَّةٌ', kind: 'prose', ...t1(25, 28) },
  { slug: 'ara2-2', title: 'سميرة موسى', kind: 'prose', ...t1(29, 31) },
  { slug: 'ara2-3', title: 'آياتُ العِلمِ', kind: 'poetry', ...t1(32, 35) },
  { slug: 'ara2-4', title: 'طريقُ النورِ', kind: 'prose', ...t1(36, 40) },
  { slug: 'ara3-1', title: 'فَضْلُ العِلمِ', kind: 'hadith', ...t1(42, 47) },
  { slug: 'ara3-2', title: 'زِراعةُ الفَضاءِ', kind: 'prose', ...t1(48, 51) },
  { slug: 'ara3-3', title: 'الكِتابُ', kind: 'poetry', ...t1(52, 61) },
  { slug: 'ara4-1', title: 'سفينةُ نوحٍ عليه السلام', kind: 'quran', ...t2(6, 9) },
  { slug: 'ara4-2', title: 'الحياةُ دقائقُ وثوانٍ', kind: 'prose', ...t2(10, 14) },
  { slug: 'ara4-3', title: 'خِلالٌ كريمةٌ', kind: 'poetry', ...t2(15, 18) },
  { slug: 'ara5-1', title: 'رسالةٌ إلى ابني', kind: 'prose', ...t2(20, 24) },
  { slug: 'ara5-2', title: 'وادي الكنانة', kind: 'poetry', ...t2(25, 30) },
  { slug: 'ara5-3', title: 'فالقُ الحَبِّ والنَّوى', kind: 'prose', ...t2(31, 37) },
  { slug: 'ara6-1', title: 'استعِنْ باللهِ', kind: 'hadith', ...t2(39, 43) },
  { slug: 'ara6-2', title: 'الحمامةُ المطوَّقةُ', kind: 'story', ...t2(44, 48) },
  { slug: 'ara6-3', title: 'حُبُّ الوطنِ', kind: 'poetry', ...t2(49, 53) },
  { slug: 'ara6-4', title: 'المشروعاتُ الصغيرةُ', kind: 'prose', ...t2(54, 58) },
]
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const RUN = LESSONS.filter((l) => !ARGS.only || ARGS.only.includes(l.slug))

const S = (o) => ({ type: 'object', ...o })
const arr = (items) => ({ type: 'array', items })
const str = { type: 'string' }

const FINDINGS = S({ required: ['verdict', 'findings'], properties: {
  verdict: { type: 'string', enum: ['GREEN', 'ISSUES'] },
  findings: arr(S({ required: ['severity', 'kind', 'item_id', 'claim'], properties: {
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    kind: { type: 'string', enum: ['wrong_answer', 'unsupported_by_page', 'text_infidelity',
                                   'bad_mapping', 'missing_content', 'other'] },
    item_id: str,       // question/vocab/rule id, or passage id
    claim: str,         // what is wrong, one sentence
    evidence: str } })) // what the page/bundle actually says
} })

const EDGE_REVIEW = S({ required: ['edges', 'proposed'], properties: {
  edges: arr(S({ required: ['src', 'dst', 'valid', 'reason'], properties: {
    src: str, dst: str, valid: { type: 'boolean' }, reason: str } })),
  proposed: arr(S({ required: ['src', 'dst', 'kind', 'rationale'], properties: {
    src: str, dst: str,
    kind: { type: 'string', enum: ['prerequisite_within_arabic', 'cross_subject_bridge'] },
    rationale: str } })),
} })

const GAPS = S({ required: ['gaps'], properties: {
  gaps: arr(S({ required: ['severity', 'what', 'where'], properties: {
    severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    what: str, where: str, suggestion: str } })),
} })

/* ---------------- per-lesson independent audit ---------------- */
const audits = await pipeline(RUN, (l) => agent(
`أنت مدقّق مستقل لمخرجات استخراج درس لغة عربية. لم ترَ عمل فريق الاستخراج — مهمتك محاولة نقضه.

الدرس: ${l.title} (${l.slug}) — صفحات الكتاب المطبوعة ${l.printed} = صفحات PDF ${l.pdf} في الملف:
${PDF}
(اقرأ صفحات الـPDF بأداة Read مع pages)

بيانات الدرس المستخرَجة:
1. ملف المحتوى: ${EX}/seed/content/${l.slug}.json — فيه النصوص المختومة والمفردات والتفاعليات.
2. أسئلة الدرس داخل الحزمة: ${EX}/seed/arabic-t${l.term}.json — استخرج أسئلة هذا الدرس فقط:
   python3 -c "import json;b=json.load(open('${EX}/seed/arabic-t${l.term}.json'));print(json.dumps([q for q in b['questions'] if q['id'].startswith('q:${l.slug}:')],ensure_ascii=False,indent=1))"
   وكذلك مفردات ${l.slug} من vocab_items وقواعد grammar_rules التي taught_in تشمل ${l.slug}.

افحص — بترتيب الأهمية:
أ. **الإجابات**: أعد حل كل سؤال بنفسك من النص والصفحات المطبوعة فقط. mcq: هل مفتاح الإجابة صحيح؟ lexical: هل المعنى مطابق لجدول مفردات الكتاب؟ short: هل الإجابة مدعومة من النص؟ irab: هل سطر القاعدة المُستشهَد به (rule_ref → gc:…) يُجيز فعلًا هذا الإعراب؟
ب. **الإسناد**: عيّنة ٥ بنود على الأقل (مفردات/أسطر قواعد/مواطن جمال) — هل هي مطبوعة فعلًا في صفحاتها المذكورة؟
ج. **أمانة النص**: قارن نص المقاطع في ملف المحتوى بالمطبوع في الصفحات (شعر: هل الصدر والعجز في مواضعهما؟ هل سقط بيت؟ ${l.kind === 'quran' ? 'قرآن: لا تُقيّم رسم النص — تم توثيقه آليًا من مصدرين — لكن تحقق أن مدى الآيات نفسه صحيح.' : ''}${l.kind === 'hadith' ? 'حديث: النص معلَّم FLAGGED للمراجعة البشرية — تحقق فقط من مطابقته للمطبوع في الصفحة.' : ''})
د. **الاكتمال المحلي**: هل في الصفحات محتوى تعليمي جوهري غير ممثَّل في المخرجات (جدول مفردات ناقص، قاعدة ساقطة، نص إملاء غائب)؟

أخرج FINDINGS: verdict=GREEN فقط إذا لم تجد أي بند high أو medium. لكل بند: item_id (معرّف السؤال/البند أو الصفحة)، claim (ما الخطأ)، evidence (ما الذي يقوله الكتاب/الملف فعلًا). لا تُبلّغ عن أسلوبيات أو تفضيلات — عيوب قابلة للتحقق فقط.`,
  { label: `audit:${l.slug}`, phase: 'Audit', model: 'sonnet', schema: FINDINGS }
).then((r) => ({ slug: l.slug, ...r })))

/* ---------------- prerequisite-graph review ---------------- */
const graph = await agent(
`أنت مراجع تربوي لمنهج اللغة العربية المصري (الصف الثالث الإعدادي). راجع خريطة العلاقات المستخرَجة.

اقرأ حواف prerequisite_of من الحزمتين:
python3 -c "import json;[print(e['src'],'->',e['dst']) for f in ['${EX}/seed/arabic-t1.json','${EX}/seed/arabic-t2.json'] for e in json.load(open(f))['edges'] if e['type']=='prerequisite_of']"

سياق الأعمدة: لكل درس ٥ أهداف — lo:<slug>-1 فهم النص، -2 المفردات، -3 مواطن الجمال، -4 النحو، -5 الإملاء.
الدروس بترتيب الكتاب: ${JSON.stringify(RUN.map((l) => ({ slug: l.slug, title: l.title })), null, 0)}
وموضوعات النحو لكل درس موجودة في grammar_rules (label_ar) داخل الحزمتين.

لكل حافة: valid=true/false مع السبب التربوي (هل فهم الهدف الثاني يتطلب فعلًا الأول؟ سلاسل النحو التراكمية «تابع…» يجب أن تكون valid؛ سلاسل الإملاء عبر الدروس قد تكون أضعف — احكم بنزاهة).
ثم اقترح في proposed ما ينقص: علاقات prerequisite داخل العربية لم نرسمها، و**مرشّحات** جسور cross_subject_bridge مع الدراسات الاجتماعية أو الرياضيات (مثل نصوص تاريخية/علمية تتقاطع مع دروس مادة أخرى) — الجسور تُقترح فقط ولا تُحمَّل إلا بقرار بشري.
أخرج EDGE_REVIEW.`,
  { label: 'graph-review', phase: 'Graph', model: 'sonnet', schema: EDGE_REVIEW })

/* ---------------- completeness critic ---------------- */
const auditSummary = audits.filter(Boolean).map((a) =>
  `${a.slug}: ${a.verdict} (${a.findings.length} findings)`).join(' · ')
const critic = await agent(
`أنت ناقد الاكتمال للكتاب كله. الكتاب: اللغة العربية «لغتي حياتي» ص٣إع — ١٢٢ صفحة PDF في:
${PDF}
استُخرج ${RUN.length} درسًا يغطي الصفحات المطبوعة: ${RUN.map((l) => l.printed).join('، ')} (فصل أول: مطبوع = PDF−1، فصل ثانٍ: مطبوع = PDF−61).

اقرأ فهرس الكتاب وصفحات فواتح الوحدات وخواتيمها في الـPDF (عينات كافية)، وأجب:
- ما المحتوى المطبوع غير المغطى بأي درس مستخرَج؟ (فواتح الوحدات وأهدافها، المراجعات والتدريبات العامة، أقسام «اقرأ واستمتع»، الجداول الملحقة، نصوص الاستماع…)
- هل توجد صفحات بين الدروس سقطت من التقسيم؟
- ملخص تدقيق الدروس: ${auditSummary} — هل نمط المشكلات يشي بعيب منهجي في خط الإنتاج؟
أخرج GAPS مرتبة بالخطورة: what (ما الناقص)، where (الصفحات)، suggestion (كيف يُلتقط في جولة قادمة). كن محددًا بأرقام الصفحات.`,
  { label: 'completeness-critic', phase: 'Completeness', model: 'sonnet', schema: GAPS })

return {
  audits: audits.filter(Boolean),
  failed_audits: RUN.filter((_, i) => !audits[i]).map((l) => l.slug),
  graph,
  gaps: critic?.gaps ?? [],
}
