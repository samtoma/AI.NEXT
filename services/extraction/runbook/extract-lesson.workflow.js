export const meta = {
  name: 'extract-lesson',
  description: 'Coverage-audited extraction line for one lesson (Phase A: Geography L2, all 6 continents)',
  phases: [
    { title: 'Claims', detail: 'per-continent grounded claim extraction (Sonnet)' },
    { title: 'Questions', detail: 'per-continent question authoring, grounded in claims (Sonnet)' },
    { title: 'Verify', detail: 'adversarial re-solve (Sonnet) + provenance spot-check (Haiku)' },
    { title: 'Coverage', detail: 'checklist vs produced content — the Africa detector (Sonnet)' },
  ],
}

// ---- Lesson config (from services/extraction/manifest/social-prep3-t1.json) ----
const PDF = '/Users/samueltoma/Documents/Claude/Projects/AI Enthusiasts/PoC Tutor School V1/docs/Source/Social_prp3_T1_2.pdf'
// printed book page = PDF index - 7
const LOS = {
  'lo:soc1-2-1': 'يقرأ التضاريس من خريطة تضاريس العالم',
  'lo:soc1-2-2': 'يصف التضاريس التي تميز كل قارة من قارات العالم',
  'lo:soc1-2-3': 'يميز بين أنواع السهول في العالم',
  'lo:soc1-2-4': 'يقارن بين مظاهر السطح في قارات العالم',
}
const CONTINENTS = [
  { key: 'asia', name: 'قارة آسيا', pdf: '15-17', printed: '8-10',
    must: 'المقدمة: خريطة تضاريس العالم والأقسام الثلاثة (جبال/هضاب/سهول). جبال غرب القارة (طوروس، زاجروس)، وسط القارة (الهيمالايا وقمة إفرست 8848م)، شرق القارة (جبال اليابان). هضاب: التبت (سقف العالم)، الدكن، شبه الجزيرة العربية. السهول نوعان — لا تُغفل الفيضية: (1) سهول ساحلية حول بحر قزوين؛ (2) سهول فيضية: السهول الشمالية الواسعة/سيبيريا وأنهارها أوب وينسي ولينا (تصب في المحيط القطبي الشمالي وتتجمد شتاءً)، سهول شرق القارة/الصين ومنشوريا ونهر اليانجتسي، وسهول نهري دجلة والفرات ونهر السند. اقرأ حتى أعلى صفحة الكتاب المطبوعة رقم 10 حيث تكمُل سهول آسيا الفيضية قبل بداية تضاريس إفريقيا.' },
  { key: 'africa', name: 'قارة إفريقيا', pdf: '17-18', printed: '10-11',
    must: 'جبال: أطلس (أقصى الشمال الغربي، تحصر هضبة الشطوط)، البحر الأحمر (مصر/السودان/أريتريا)، كينيا وكلمنجارو (الشرق)، دراكنزبرج (الجنوب الشرقي). هضاب: الصحراء الكبرى، البحيرات الاستوائية، الحبشة (تنبع منهما روافد النيل)، جنوب إفريقيا. السهول ثلاثة أنواع — اذكر كلًّا منها صراحةً بادعاء مستقل: (1) ساحلية على سواحل البحار والمحيطات وتتسع عند مصبات الأنهار؛ (2) فيضية (النيل، الكونغو، النيجر — جودة التربة وصلاحيتها للزراعة)؛ (3) صحراوية رملية (كلنشو، بحر الرمال العظيم، كلهاري).' },
  { key: 'europe', name: 'قارة أوروبا', pdf: '18-19', printed: '11-12',
    must: 'جبال: سلاسل الألب (تمتد من الغرب للشرق، البرانس في شمال إسبانيا، الألب الدينارية في البلقان). هضاب: المزيتا (معظم إسبانيا)، فرنسا الوسطى. سهول: ساحلية متعرجة؛ فيضية (السهل الأوروبي العظيم من الأطلنطي حتى الأورال، مدن باريس وبرلين)، أنهار الفولجا (أطول، يصب في قزوين)، الراين (بحر الشمال)، الدانوب (البحر الأسود).' },
  { key: 'north_america', name: 'قارة أمريكا الشمالية', pdf: '19-20', printed: '12-13',
    must: 'جبال: الأبلاش (الشرق)، روكي (الغرب، أعلى القارة، يغطيها الجليد شتاءً). هضاب: المكسيك (الجنوب)، لبرادور (الشمال الشرقي). سهول: ساحلية على الأطلنطي وخليج المكسيك وسهول ضيقة على الهادي؛ فيضية (البحيرات العظمى، نهر المسيسيبي، نهرا نلسن وسانت لورانس، الأراضي الزراعية).' },
  { key: 'south_america', name: 'قارة أمريكا الجنوبية', pdf: '20-21', printed: '13-14',
    must: 'جبال: الأنديز (الغرب قرب الهادي، من الشمال حتى الأطراف الجنوبية). هضاب: جيانا (الشمال)، البرازيل (الشرق، أكبر وأعلى الهضاب)، باتاجونيا (الجنوب، أصغر هضبة مساحة). سهول: فيضية (الأمازون أوسع سهل فيضي في العالم، لابلاتا: بارانا وباراجواي وأوروجواي)، سهل أورينوكو؛ ساحلية تضيق في الغرب.' },
  { key: 'australia', name: 'قارة أستراليا (الأوقيانوسية)', pdf: '21', printed: '14',
    must: 'جبال: الحاجز الكبير (الألب الأسترالية، على الساحل الشرقي، قوس مقسم للحاجز والحاجز الكبير). هضاب: تشبه إفريقيا، الهضبة الغربية تشغل نصف مساحة القارة واستواء السطح. سهول: فيضية (نهرا موري ودارلنج، الخليج الأسترالي الكبير، سهول زراعية)؛ ساحلية (الحاجز المرجاني العظيم 2000كم)؛ صحراوية رملية داخلية وغربية.' },
]

const LO_ENUM = Object.keys(LOS)
const FACTS = { type: 'array', items: { type: 'object', required: ['kind', 'entity', 'value'],
  properties: { kind: { type: 'string' }, entity: { type: 'string' }, value: { type: 'string' } } } }
const EVID_KIND = { type: 'string', enum: ['text', 'map', 'concept_box', 'enrichment_box'] }

const CLAIMS_SCHEMA = { type: 'object', required: ['continent', 'claims'], properties: {
  continent: { type: 'string' },
  claims: { type: 'array', items: { type: 'object', required: ['lo', 'group', 'claim_ar', 'evidence_page', 'evidence_kind'],
    properties: {
      lo: { type: 'string', enum: LO_ENUM },
      group: { type: 'string', enum: ['مقدمة', 'جبال', 'هضاب', 'سهول', 'مقارنة'] },
      claim_ar: { type: 'string' },
      evidence_page: { type: 'integer' },
      evidence_kind: EVID_KIND,
      facts: FACTS,
    } } } } }

const QUESTIONS_SCHEMA = { type: 'object', required: ['continent', 'questions'], properties: {
  continent: { type: 'string' },
  questions: { type: 'array', items: { type: 'object',
    required: ['id', 'lo', 'tier', 'type', 'stem', 'answer', 'solution', 'source_page', 'source_note'],
    properties: {
      id: { type: 'string' },
      lo: { type: 'string', enum: LO_ENUM },
      tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
      type: { type: 'string', enum: ['mcq', 'short'] },
      stem: { type: 'string' },
      choices: { type: 'array', items: { type: 'object', required: ['key', 'text'],
        properties: { key: { type: 'string' }, text: { type: 'string' } } } },
      answer: { type: 'string' },
      solution: { type: 'array', items: { type: 'object', required: ['claim_ar', 'evidence_page', 'evidence_kind'],
        properties: { claim_ar: { type: 'string' }, evidence_page: { type: 'integer' }, evidence_kind: EVID_KIND, facts: FACTS } } },
      source_page: { type: 'integer' },
      source_note: { type: 'string' },
    } } } } }

const VERIFY_SCHEMA = { type: 'object', required: ['continent', 'verdicts'], properties: {
  continent: { type: 'string' },
  verdicts: { type: 'array', items: { type: 'object', required: ['id', 'my_answer', 'reason'],
    properties: { id: { type: 'string' }, my_answer: { type: 'string' }, reason: { type: 'string' } } } } } }

const PROV_SCHEMA = { type: 'object', required: ['continent', 'checks'], properties: {
  continent: { type: 'string' },
  checks: { type: 'array', items: { type: 'object', required: ['claim_ar', 'evidence_page', 'supported'],
    properties: { claim_ar: { type: 'string' }, evidence_page: { type: 'integer' }, supported: { type: 'boolean' }, note: { type: 'string' } } } } } }

const COVERAGE_SCHEMA = { type: 'object', required: ['verdict', 'subtopics'], properties: {
  verdict: { type: 'string', enum: ['GREEN', 'RED'] },
  subtopics: { type: 'array', items: { type: 'object', required: ['key', 'status'],
    properties: {
      key: { type: 'string' },
      claims_count: { type: 'integer' }, questions_count: { type: 'integer' },
      status: { type: 'string', enum: ['covered', 'thin', 'MISSING'] },
      missing_items: { type: 'array', items: { type: 'string' } },
    } } } } }

const RULES = `القواعد الصارمة (عقد الاستخراج، thesis Pillar I):
- أمين للكتاب حرفيًا: لا تُدرِج أي معلومة غير موجودة على الصفحات المذكورة. لا اجتهاد ولا معرفة خارجية.
- كل ادعاء (claim) يجب أن يشير إلى رقم صفحة الكتاب المطبوع (printed page) الذي ورد فيه — وليس رقم صفحة الـPDF.
- استخدم مصطلحات الوزارة الحرفية كما وردت (أسماء الجبال/الهضاب/السهول/الأنهار بالضبط).
- الأرقام والسنوات ليست أهدافًا امتحانية؛ ركّز الأسئلة على أفعال الاستنتاج (بم تفسر / النتائج المترتبة / قارن / ميّز)، والاسترجاع فقط للمصطلحات.`

const pdfNote = (c) => `الملف: ${PDF}
اقرأ صفحات الـPDF التالية بأداة Read (pages): ${c.pdf}  — وهي تقابل صفحات الكتاب المطبوعة ${c.printed}.
الدرس: الوحدة الأولى — تضاريس العالم. القارة: ${c.name}.
ما يجب أن يغطيه الاستخراج لهذه القارة (قائمة مرجعية من الكتاب):
${c.must}`

const loBlock = LO_ENUM.map((k) => `  ${k} = ${LOS[k]}`).join('\n')

const claimsPrompt = (c) => `أنت مُستخرِج بيانات مناهج. استخرج ادعاءات الدراسات الاجتماعية لقارة واحدة من درس تضاريس العالم.
${pdfNote(c)}

الأهداف التعليمية لهذا الدرس (اربط كل ادعاء بالهدف المناسب):
${loBlock}
- ادعاءات قراءة الخريطة/الأقسام الثلاثة → lo:soc1-2-1
- وصف جبال/هضاب القارة → lo:soc1-2-2
- تمييز أنواع السهول → lo:soc1-2-3
- نقاط المقارنة بين القارات (أعلى/أكبر/يشبه) → lo:soc1-2-4

${RULES}

أخرج CLAIMS_SCHEMA: قائمة ادعاءات، كل منها {lo, group, claim_ar, evidence_page (رقم الكتاب المطبوع), evidence_kind, facts}.
غطِّ كل بند في القائمة المرجعية أعلاه بادعاء واحد على الأقل. المجموعات (group): مقدمة/جبال/هضاب/سهول/مقارنة.`

const questionsPrompt = (c, claims) => `أنت مؤلف أسئلة مناهج. ألّف أسئلة لقارة ${c.name} في درس تضاريس العالم، مبنية حصريًا على الادعاءات المستخرجة (لا تحلّ من جديد ولا تُضِف معلومات).

الادعاءات المتاحة (الحقيقة الوحيدة المسموح بها):
${JSON.stringify(claims.claims || claims, null, 1).slice(0, 6000)}

${RULES}

اكتب من 4 إلى 6 أسئلة تغطي أهداف الدرس (soc1-2-1..4) وعبر المستويات (basic/standard/advanced).
- معرّف كل سؤال بالنمط: q:soc1-2:${c.key}:NN (NN تسلسلي بادئ بصفر).
- الحل (solution) قائمة claim-steps: {claim_ar, evidence_page (رقم الكتاب), evidence_kind, facts} — مأخوذة من الادعاءات.
- أسئلة mcq تحتاج 4 اختيارات (choices) ومفتاح إجابة صحيح (answer) من مفاتيحها.
- source_page = رقم صفحة الكتاب المطبوع. source_note = وصف موجز لمكان المصدر.
أخرج QUESTIONS_SCHEMA.`

// verify sees questions with the answer REDACTED (independent re-solve)
const redact = (qs) => (qs || []).map((q) => ({ id: q.id, stem: q.stem, type: q.type, choices: q.choices }))
const verifyPrompt = (c, claims, questions) => `أنت مُصحِّح مستقل (لست المؤلف). حُلّ كل سؤال بنفسك اعتمادًا فقط على الادعاءات، دون رؤية إجابة المؤلف.
القارة: ${c.name}.
الادعاءات:
${JSON.stringify(claims.claims || claims, null, 1).slice(0, 6000)}
الأسئلة (بدون إجابات):
${JSON.stringify(redact(questions.questions), null, 1).slice(0, 5000)}
لكل سؤال أعطِ إجابتك (my_answer: مفتاح الاختيار لأسئلة mcq، أو نص موجز للأسئلة المقالية) وسببًا مختصرًا مستندًا للادعاء. أخرج VERIFY_SCHEMA.`

const provPrompt = (c, claims) => `تحقّق من الإسناد (provenance). لكل ادعاء تحقّق أن رقم الصفحة المذكور (الكتاب المطبوع ${c.printed}) يحتوي فعلًا على الادعاء.
${pdfNote(c)}
الادعاءات:
${JSON.stringify(claims.claims || claims, null, 1).slice(0, 6000)}
اقرأ الصفحات وتحقّق. أخرج PROV_SCHEMA: لكل ادعاء {claim_ar, evidence_page, supported (هل الصفحة تدعمه؟), note}.`

// ---------------- run ----------------
const rows = await pipeline(
  CONTINENTS,
  (c) => agent(claimsPrompt(c), { label: `claims:${c.key}`, phase: 'Claims', model: 'sonnet', schema: CLAIMS_SCHEMA }),
  (claims, c) => agent(questionsPrompt(c, claims), { label: `questions:${c.key}`, phase: 'Questions', model: 'sonnet', schema: QUESTIONS_SCHEMA })
    .then((questions) => ({ c, claims, questions })),
  ({ c, claims, questions }) => parallel([
    () => agent(verifyPrompt(c, claims, questions), { label: `verify:${c.key}`, phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA }),
    () => agent(provPrompt(c, claims), { label: `prov:${c.key}`, phase: 'Verify', model: 'haiku', effort: 'low', schema: PROV_SCHEMA }),
  ]).then(([verify, prov]) => ({ key: c.key, name: c.name, claims, questions, verify, prov })),
)

const clean = rows.filter(Boolean)

// deterministic per-continent tallies for the coverage auditor
const tally = clean.map((r) => ({
  key: r.key,
  claims_count: (r.claims?.claims || []).length,
  questions_count: (r.questions?.questions || []).length,
  claim_texts: (r.claims?.claims || []).map((x) => x.claim_ar).slice(0, 40),
}))

const coveragePrompt = `أنت مدقّق التغطية (coverage oracle) — الفحص الذي يمنع تكرار خطأ "إفريقيا فقط".
القائمة المرجعية المطلوبة لكل قارة في درس تضاريس العالم:
${CONTINENTS.map((c) => `• ${c.key} (${c.name}): ${c.must}`).join('\n')}

ما أنتجه خط الاستخراج فعليًا (عدد الادعاءات ونصوصها لكل قارة):
${JSON.stringify(tally, null, 1).slice(0, 12000)}

لكل قارة قارن المُنتَج بالمطلوب وأعطِ status (covered/thin/MISSING) وقائمة missing_items (البنود الناقصة من الكتاب). verdict=GREEN فقط إذا كانت كل القارات covered. أخرج COVERAGE_SCHEMA.`

const coverage = await agent(coveragePrompt, { label: 'coverage-audit', phase: 'Coverage', model: 'sonnet', schema: COVERAGE_SCHEMA })

return { lesson: 'soc1-2', continents: clean, coverage }
