export const meta = {
  name: 'arabic-lesson',
  description: 'Arabic language conveyor (ADR-0006): text capture → language artefacts → questions → interactives → blind إعراب re-derivation → coverage oracle',
  phases: [
    { title: 'Segment', detail: "the book's own lesson skeleton + objectives box" },
    { title: 'Text', detail: 'verbatim capture — K=2 for prose/poetry, citation+transcript for sacred' },
    { title: 'Artefacts', detail: 'vocab · rhetoric · grammar rule · spelling · exposition' },
    { title: 'Questions', detail: 'the Egyptian-exam repertoire, grounded' },
    { title: 'Interactives', detail: 'text-anchored widgets (the passage is the figure)' },
    { title: 'Verify', detail: 'blind إعراب re-derivation + provenance' },
    { title: 'Coverage', detail: 'integer equalities + OUT_OF_SCOPE — the completeness gate' },
  ],
}

const PDF = '/Users/samueltoma/Documents/Claude/Projects/AI Enthusiasts/PoC Tutor School V1/docs/Source/Arabic_Prp3_Tr1_2.pdf'

// Page-offset regimes (scout, verified at 30 sample pages). NOT one rule:
//   Term 1: printed = PDF − 1   (PDF 9–62)
//   Term 2: printed = PDF − 61  (PDF 67–119)
// Carrying T1's rule into T2 cites a REAL but WRONG page — silent corruption.
const t1 = (a, b) => ({ printed: `${a}-${b}`, pdf: `${a + 1}-${b + 1}` })
const t2 = (a, b) => ({ printed: `${a}-${b}`, pdf: `${a + 61}-${b + 61}` })

// IDs are TERM-QUALIFIED: «كُنْ جَمِيلًا» is both a T1 lesson and a T2 unit title,
// and unit numbers restart per term — anything keyed on unit+lesson collides.
const LESSONS = [
  { id: 'ar-t1u1l1', title: 'عِبادُ الرَّحمنِ', grammar: 'المنادى المضاف – الشبيه بالمضاف – النكرة غير المقصودة', kind: 'quran',  src: 'سورة الفرقان ٦٣–٧٠', ...t1(8, 13) },
  { id: 'ar-t1u1l2', title: 'كُنْ جَمِيلًا', grammar: 'المنادى (المفرد – النكرة المقصودة)', kind: 'poetry', src: 'إيليا أبو ماضي', ...t1(14, 18) },
  { id: 'ar-t1u1l3', title: 'قِصَّةُ أَثَرٍ', grammar: 'المنادى (نداء ما فيه ال)', kind: 'prose', src: 'الكنيسة المعلقة / قلعة قايتباي', ...t1(19, 23) },
  { id: 'ar-t1u2l1', title: 'رَحْمَةٌ ومَحَبَّةٌ', grammar: 'البدل وأنواعه', kind: 'prose', src: 'قاسم أمين', ...t1(25, 28) },
  { id: 'ar-t1u2l2', title: 'سميرة موسى', grammar: '(تابع) أنواع البدل', kind: 'prose', src: 'سيرة', ...t1(29, 31) },
  { id: 'ar-t1u2l3', title: 'آياتُ العِلمِ', grammar: '(تابع) أنواع البدل', kind: 'poetry', src: 'الهراوي', ...t1(32, 35) },
  { id: 'ar-t1u2l4', title: 'طريقُ النورِ', grammar: 'أسلوبا المدح والذم', kind: 'prose', src: 'لويس برايل', ...t1(36, 40) },
  { id: 'ar-t1u3l1', title: 'فَضْلُ العِلمِ', grammar: 'فاعل نعم وبئس', kind: 'hadith', src: 'عن أبي الدرداء', ...t1(42, 47) },
  { id: 'ar-t1u3l2', title: 'زِراعةُ الفَضاءِ', grammar: 'حبذا، لا حبذا', kind: 'prose', src: 'مقال علمي', ...t1(48, 51) },
  { id: 'ar-t1u3l3', title: 'الكِتابُ', grammar: 'الممنوع من الصرف', kind: 'poetry', src: 'أحمد شوقي', ...t1(52, 61) },
  { id: 'ar-t2u1l1', title: 'سفينةُ نوحٍ عليه السلام', grammar: 'اسم الفاعل من الثلاثي الصحيح', kind: 'quran', src: 'سورة هود ٣٦–٤٢', ...t2(6, 9) },
  { id: 'ar-t2u1l2', title: 'الحياةُ دقائقُ وثوانٍ', grammar: 'اسم الفاعل من الثلاثي معتل العين واللام', kind: 'prose', src: 'مقال (يقتبس بيتين لشوقي)', ...t2(10, 14) },
  { id: 'ar-t2u1l3', title: 'خِلالٌ كريمةٌ', grammar: 'اسم الفاعل من غير الثلاثي', kind: 'poetry', src: 'حافظ إبراهيم', ...t2(15, 18) },
  { id: 'ar-t2u2l1', title: 'رسالةٌ إلى ابني', grammar: 'صيغ المبالغة', kind: 'prose', src: 'د. فاخر عاقل', ...t2(20, 24) },
  { id: 'ar-t2u2l2', title: 'وادي الكنانة', grammar: 'اسم المفعول', kind: 'poetry', src: 'الهراوي', ...t2(25, 30) },
  { id: 'ar-t2u2l3', title: 'فالقُ الحَبِّ والنَّوى', grammar: 'اسما الزمان والمكان', kind: 'prose', src: 'زكي نجيب محمود', ...t2(31, 37) },
  { id: 'ar-t2u3l1', title: 'استعِنْ باللهِ', grammar: 'مراجعة اسمي الزمان والمكان', kind: 'hadith', src: 'عن ابن عباس، رواه الترمذي', ...t2(39, 43) },
  { id: 'ar-t2u3l2', title: 'الحمامةُ المطوَّقةُ', grammar: 'اسم الآلة', kind: 'story', src: 'ابن المقفع، كليلة ودمنة', ...t2(44, 48) },
  { id: 'ar-t2u3l3', title: 'حُبُّ الوطنِ', grammar: 'أسلوب التفضيل', kind: 'poetry', src: 'مصطفى صادق الرافعي', ...t2(49, 53) },
  { id: 'ar-t2u3l4', title: 'المشروعاتُ الصغيرةُ', grammar: 'صوغ اسم التفضيل', kind: 'prose', src: 'مقال', ...t2(54, 58) },
]

const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const RUN = LESSONS.filter((l) => (ARGS.only || ['ar-t1u1l1']).includes(l.id))
const isSacred = (l) => l.kind === 'quran' || l.kind === 'hadith'

/* ------------------------------- schemas ------------------------------- */
const S = (o) => ({ type: 'object', ...o })
const arr = (items) => ({ type: 'array', items })
const str = { type: 'string' }
const int = { type: 'integer' }

const SEGMENT = S({ required: ['objectives', 'sections'], properties: {
  objectives: arr(S({ required: ['n', 'text', 'assessable'], properties: {
    n: int, text: str,
    // خط and تعبير are printed objectives we cannot assess (ADR-0006 §4):
    // mark them so they become OUT_OF_SCOPE rather than silent 0%-forever LOs.
    assessable: { type: 'boolean' }, skill: { type: 'string', enum: ['reading','listening','speaking','grammar','spelling','rhetoric','vocabulary','handwriting','composition','recitation'] } } })),
  sections: arr(S({ required: ['key', 'title', 'printed_page'], properties: { key: str, title: str, printed_page: int } })),
  // Printed «القضايا المتضمنة» box (bug fix, 2026-07-29): the lesson opener lists
  // the issues/values the text carries (e.g. 3 items on p.8 of ar-t1u1l1). They are
  // printed content — dropping them is a coverage gap, not a simplification.
  qadaya: arr(S({ required: ['text', 'printed_page'], properties: { text: str, printed_page: int } })),
  tamheed: str,
} })

const TEXT = S({ required: ['passages'], properties: { passages: arr(S({
  required: ['id', 'kind', 'printed_page', 'text'], properties: {
    id: str, kind: { type: 'string', enum: ['quran','hadith','poetry','prose','dictation'] },
    printed_page: int,
    text: str,                       // verbatim, full تشكيل, EXACTLY as printed
    citation: str,                   // sacred only: e.g. "25:63-70" — the integers matter
    attribution: str,                // poet/author as printed
    verses: arr(S({ required: ['n','sadr','ajuz'], properties: { n: int, sadr: str, ajuz: str } })), // poetry only
    // Sacred only (bug fix, 2026-07-29): one row per آية/sentence — the Quran must
    // arrive STRUCTURED, never as one blob, so the authority cross-check can diff
    // verse-by-verse and TextPassage.units can carry printed آية numbers.
    units: arr(S({ required: ['n','printed_n','text'], properties: {
      n: int,                        // 1-based within the passage
      printed_n: str,                // آية number AS PRINTED, Arabic-Indic: "٦٣"
      text: str } })),               // that آية verbatim, full تشكيل
  } })) } })

const ARTEFACTS = S({ required: ['vocab', 'rhetoric', 'grammar', 'exposition'], properties: {
  exposition: str,
  vocab: arr(S({ required: ['word', 'meaning'], properties: { word: str, meaning: str, plural: str, singular: str, antonym: str, authored: { type: 'boolean' } } })),
  rhetoric: arr(S({ required: ['expression', 'type', 'effect', 'printed_page'], properties: { expression: str, type: str, effect: str, printed_page: int } })),
  grammar: S({ required: ['topic', 'rule_lines'], properties: {
    topic: str, continuation: { type: 'boolean' },
    rule_lines: arr(S({ required: ['id', 'text', 'printed_page'], properties: { id: str, text: str, printed_page: int } })),
    types: arr(S({ required: ['name', 'sign'], properties: { name: str, sign: str, example: str } })) } }),
  spelling: S({ properties: { topic: str, cases: arr(S({ required: ['condition','examples'], properties: { condition: str, examples: arr(str) } })) } }),
} })

const IRAB = S({ required: ['role','state','sign'], properties: {
  role: str, state: str, sign: str, sign_kind: str, rule_ref: str } })

const QUESTIONS = S({ required: ['questions'], properties: { questions: arr(S({
  required: ['id','lo_n','tier','type','stem','source_page'], properties: {
    id: str, lo_n: int, tier: { type: 'string', enum: ['basic','standard','advanced'] },
    type: { type: 'string', enum: ['irab','extract','explain','lexical','rhetoric_purpose','spelling','mcq','short'] },
    stem: str,
    choices: arr(S({ required: ['key','text'], properties: { key: str, text: str } })),
    answer: str,                    // non-إعراب types
    irab_answer: IRAB,              // type=irab ONLY — typed slots, never a string
    target_word: str,               // the word being parsed / extracted
    accepted: arr(str),             // credit variants for open answers
    grounded_in: str,               // rule_line id or rhetoric expression it rests on
    source_page: int } })) } })

const INTERACTIVES = S({ required: ['interactives'], properties: { interactives: arr(S({
  required: ['kind','lo_n','prompt_ar','spec'], properties: {
    kind: { type: 'string', enum: ['extract_spans','hamza_seat','style_purpose','irab_builder','term_match'] },
    lo_n: int, prompt_ar: str, spec: S({ additionalProperties: true }) } })) } })

const REDERIVE = S({ required: ['verdicts'], properties: { verdicts: arr(S({
  required: ['id','my_irab'], properties: { id: str, my_irab: IRAB, reason: str } })) } })

const PROV = S({ required: ['checks'], properties: { checks: arr(S({
  required: ['claim','printed_page','supported'], properties: { claim: str, printed_page: int, supported: { type: 'boolean' }, note: str } })) } })

const COVERAGE = S({ required: ['verdict','items'], properties: {
  verdict: { type: 'string', enum: ['GREEN','RED'] },
  items: arr(S({ required: ['key','status'], properties: {
    key: str,
    status: { type: 'string', enum: ['covered','thin','MISSING','OUT_OF_SCOPE'] },
    reason: str, missing: arr(str) } })) } })

/* ------------------------------- prompts ------------------------------- */
const head = (l) => `الملف: ${PDF}
اقرأ صفحات الـPDF بأداة Read (pages): ${l.pdf} — تقابل صفحات الكتاب المطبوعة ${l.printed}.
الدرس: ${l.title} (${l.id}) — نوع النص: ${l.kind} — ${l.src}. موضوع اللغويات: ${l.grammar}.
⚠ أرقام الصفحات في كل مخرجاتك هي أرقام الكتاب المطبوعة (${l.printed})، لا أرقام الـPDF.`

const LAW = `القوانين (عقد اللغة العربية — ADR-0006):
- النص المنقول حرفيٌّ تمامًا بكل التشكيل كما هو مطبوع. إعادة الصياغة عيبٌ لا نسخةٌ أضعف.
- لا تخترع قاعدة نحوية غير مطبوعة في الدرس. كل إعراب يجب أن يستند إلى سطر قاعدة مطبوع (rule_ref).
- المصطلحات بلفظ الكتاب حرفيًا.
- النحو تراكمي: يجوز الاستناد إلى قواعد الدروس السابقة في نفس السلسلة (المنادى/البدل/اسم الفاعل تُدرَّس على أقساط)، ولا يجوز تجاوز ما لم يُدرَّس بعد.`

// Bug fix (2026-07-29): the first run came back imlā'ī — 0×ٱ against 18 in the
// authority text, plus a بسملة that is NOT printed inside the passage. The
// transcript is EVIDENCE for the cross-check, never the stored text (the
// assembler fetches the citation raw from two authorities and stores the
// canonical Uthmani — ADR-0006 §2) — but a memory-typed imlā'ī transcript
// still costs us the transcript_agrees leg, so the prompt now names the trap.
const SACRED = `⚠ نصٌّ مقدّس (${'قرآن/حديث'}): انقله حرفيًا كما هو مطبوع **بالرسم العثماني** بكل التشكيل، **وأيضًا** اذكر الاستشهاد الرقمي في الحقل citation (مثل "25:63-70" للسورة والآيات).
- الرسم العثماني ليس الرسم الإملائي: انسخ ألف الوصل ٱ كما تراها مطبوعة (لا تكتب ا أو أ مكانها)، وانسخ الألف الخنجرية ـٰ وعلامات الوقف الصغيرة كما هي.
- انقل ما هو مطبوع داخل حدود المقطع فقط: **لا تُضِف البسملة** إن لم تكن مطبوعة في أول المقطع نفسه.
- املأ units: صفًّا لكل آية — n تسلسلي، printed_n رقم الآية المطبوع بالأرقام الهندية (مثل "٦٣")، text نص الآية حرفيًا. لا تدمج الآيات في كتلة واحدة.
- سيتم التحقّق من النص آليًا بمقارنته بمصدرين مستقلّين — لا تصحّح ولا تُجمّل ولا تُكمل من ذاكرتك، وإن تعذّرت قراءة حرفٍ فاذكر ذلك بدل التخمين.`

// Lessons are INDEPENDENT — they run concurrently through the pipeline (the
// substrate caps live agents); the 7 stages inside one lesson stay strictly
// sequential because each feeds the next. A lesson whose chain dies resolves
// to null and is reported, never silently dropped.
const runLesson = async (l) => {
  const seg = await agent(`أنت مخطّط الدرس. اقرأ الدرس كاملًا واستخرج بنيته.
${head(l)}
${LAW}
أخرج SEGMENT:
- objectives: أهداف الدرس حرفيًا من صندوق «أهداف الدرس»، ولكل هدف: skill، و assessable=false لأهداف الخط (handwriting) والتعبير (composition) والتلاوة (recitation) لأننا لا نقيسها، و true لغيرها.
- sections: أقسام الدرس بالترتيب المطبوع (استمع/اسأل وناقش/اقرأ صامتة/لغويات وتراكيب/الكتابة…) مع رقم الصفحة المطبوعة. انتبه: ترقيم الأقسام غير ثابت بين الدروس؛ اعتمد على العناوين لا الأرقام.
- qadaya: بنود صندوق «القضايا المتضمنة» حرفيًا كما هي مطبوعة في افتتاحية الدرس (إن وُجد الصندوق) مع رقم صفحته — لا تُسقطه ولا تلخّصه.
- tamheed: فقرة تمهيد تعليمية من روح الدرس.`,
    { label: `segment:${l.id}`, phase: 'Segment', model: 'sonnet', schema: SEGMENT })

  const text = await agent(`انقل النصوص الحرفية لهذا الدرس.
${head(l)}
${LAW}
${isSacred(l) ? SACRED : ''}
أخرج TEXT: كل نصٍّ مقروء في الدرس (النص الأساسي، وقطعة الإملاء إن وُجدت) بحقل text حرفيًا بكل التشكيل.
${l.kind === 'poetry' ? '- شِعر: املأ verses لكل بيت (n, sadr = الصدر, ajuz = العجز) بالإضافة إلى text الكامل. لا تدمج الصدر بالعجز.' : ''}
${isSacred(l) ? '- املأ citation بالأرقام (سورة:من-إلى).' : ''}
- attribution: الشاعر/المؤلف كما هو مطبوع.`,
    { label: `text:${l.id}`, phase: 'Text', model: 'sonnet', schema: TEXT })

  const art = await agent(`استخرج المادة اللغوية للدرس.
${head(l)}
${LAW}
أخرج ARTEFACTS:
- exposition: شرح تعليمي غني (٤–٧ جمل) بصوت معلم دافئ — لا سرد للنص.
- vocab: جدول «معاني المفردات» كما هو مطبوع (word/meaning) وأضف plural/singular/antonym فقط إن كانت مطبوعة؛ وإن ألّفتها للحاجة الامتحانية فضع authored=true.
- rhetoric: «مواطن الجمال» — لكل بند: expression (الشاهد حرفيًا من النص) + type (نوعه: تشبيه/تضاد/أسلوب مؤكد/نداء للتنبيه…) + effect (غرضه/أثره) + الصفحة. ⚠ استوعب كل الأساليب التي تذكرها أهداف الدرس: إن ذكر هدفٌ «أمر ونهي واستفهام» فيجب أن يظهر شاهد مطبوع لكل نوع منها (لا تكتفِ بالأمر وحده) — وإن لم يطبع الكتاب شاهدًا لنوعٍ ما فلا تخترعه.
- grammar: موضوع «لغويات وتراكيب» — topic، و continuation=true إن كان العنوان «تابع…»، و rule_lines: أسطر القاعدة المطبوعة حرفيًا ولكلٍّ id مثل R1/R2 (هذه الأسطر هي المرجع الوحيد المسموح لأي إعراب لاحق)، و types: أنواعه وعلامة إعراب كلٍّ منها.
- spelling: قسم الإملاء إن وُجد (الحالات وأمثلتها المطبوعة).`,
    { label: `artefacts:${l.id}`, phase: 'Artefacts', model: 'sonnet', schema: ARTEFACTS })

  const qs = await agent(`ألّف بنك أسئلة امتحانيًّا مبنيًّا حصريًا على مادة الدرس.
النصوص: ${JSON.stringify(text.passages?.map((p) => ({ id: p.id, kind: p.kind, text: (p.text || '').slice(0, 1200) })), null, 1).slice(0, 6000)}
المادة اللغوية: ${JSON.stringify({ vocab: art.vocab, rhetoric: art.rhetoric, grammar: art.grammar, spelling: art.spelling }, null, 1).slice(0, 8000)}
${LAW}
اكتب ١٢–١٦ سؤالًا موزّعة على أنواع الامتحان المصري: irab (أعرب ما تحته خط) · extract (استخرج من النص) · explain (اشرح البيت/الفقرة بأسلوبك) · lexical (مرادف/مضاد/جمع/مفرد) · rhetoric_purpose (ما نوع الأسلوب وغرضه) · spelling (اضبط/صوّب) · mcq · short. غطِّ الأهداف القابلة للقياس عبر ثلاثة مستويات.
- لأسئلة irab: املأ irab_answer بالحقول المنفصلة (role=الموقع الإعرابي، state=حالته، sign=العلامة، sign_kind=نوعها، rule_ref=معرّف سطر القاعدة R#) و target_word بالكلمة المطلوب إعرابها. **لا تكتب الإعراب كنصٍّ واحد.**
- grounded_in: معرّف سطر القاعدة أو الشاهد البلاغي الذي يستند إليه السؤال.
- accepted: صيغ إجابة مقبولة بديلة (للأسئلة المفتوحة).
- source_page: رقم الصفحة المطبوعة.`,
    { label: `q:${l.id}`, phase: 'Questions', model: 'sonnet', schema: QUESTIONS })

  const inter = await agent(`صمّم تدريبات تفاعلية مثبّتة على النص.
النص: ${JSON.stringify(text.passages?.[0]?.text?.slice(0, 1500) || '')}
المادة: ${JSON.stringify({ rhetoric: art.rhetoric, grammar: art.grammar, spelling: art.spelling, vocab: art.vocab }, null, 1).slice(0, 6000)}
${LAW}
أخرج INTERACTIVES (٣–٥):
- extract_spans: {passage_id, category, targets:[الكلمات/العبارات حرفيًا من النص], decoys:[]} — «استخرج من النص».
- hamza_seat: {items:[{word, seat:"واو|ألف|ياء|سطر", why}]} — الهمزة المتوسطة (أكثر مهارات الكتاب تدريبًا).
- style_purpose: {expression, type_options:[], purpose_options:[], type, purpose} — «أسلوب: … غرضه: …».
- irab_builder: {target_word, sentence, role_options:[], sign_options:[], answer:{role,state,sign,sign_kind,rule_ref}}.
- term_match: {pairs:[{term, definition}]} — من المصطلحات/المفردات المطبوعة.
كل عنصر مثبّت حرفيًا على النص أو على سطر قاعدة مطبوع.`,
    { label: `interactives:${l.id}`, phase: 'Interactives', model: 'sonnet', schema: INTERACTIVES })

  // Blind re-derivation: a DIFFERENT instance re-derives each إعراب from the
  // printed rule lines WITHOUT seeing the proposed answer. This is the
  // independent oracle Social Studies never had.
  const irabQs = (qs.questions || []).filter((q) => q.type === 'irab')
  const [rederive, prov] = await parallel([
    () => irabQs.length === 0 ? Promise.resolve({ verdicts: [] }) : agent(
      `أنت نحويٌّ مستقل. أعرب كل كلمة أدناه اعتمادًا على أسطر القاعدة المطبوعة فقط، دون أن ترى إجابة أحد.
أسطر القاعدة: ${JSON.stringify(art.grammar?.rule_lines, null, 1)}
أنواع ${art.grammar?.topic} وعلاماتها: ${JSON.stringify(art.grammar?.types, null, 1)}
الكلمات في سياقها: ${JSON.stringify(irabQs.map((q) => ({ id: q.id, word: q.target_word, stem: q.stem })), null, 1).slice(0, 5000)}
أخرج REDERIVE: لكل id حقول my_irab المنفصلة (role/state/sign/sign_kind/rule_ref) وسببًا موجزًا.`,
      { label: `rederive:${l.id}`, phase: 'Verify', model: 'sonnet', schema: REDERIVE }),
    () => agent(`تحقّق من الإسناد: أعد قراءة صفحات الدرس وتأكّد أن كل بند أدناه مطبوعٌ فعلًا في صفحته.
${head(l)}
البنود: ${JSON.stringify([...(art.rhetoric || []).map((r) => ({ claim: r.expression + ' → ' + r.type, printed_page: r.printed_page })), ...(art.grammar?.rule_lines || []).map((r) => ({ claim: r.text, printed_page: r.printed_page }))], null, 1).slice(0, 7000)}
أخرج PROV.`,
      { label: `prov:${l.id}`, phase: 'Verify', model: 'haiku', effort: 'low', schema: PROV }),
  ])

  // Cardinality facts for the oracle — counted in CODE, not asked of a model.
  const counts = {
    passages: (text.passages || []).length,
    verses: (text.passages || []).reduce((n, p) => n + ((p.verses || []).length), 0),
    // Sacred structure (bug fix): آيات arrive as per-verse units, counted here so
    // the oracle can assert them against the citation range (e.g. 25:63-70 = 8).
    sacred_units: (text.passages || []).reduce((n, p) => n + ((p.units || []).length), 0),
    qadaya: (seg.qadaya || []).length,
    vocab: (art.vocab || []).length,
    rhetoric: (art.rhetoric || []).length,
    rule_lines: (art.grammar?.rule_lines || []).length,
    spelling_cases: (art.spelling?.cases || []).length,
    questions: (qs.questions || []).length,
    irab_questions: irabQs.length,
    interactives: (inter.interactives || []).length,
  }

  const coverage = await agent(`مدقّق التغطية لدرس ${l.title}.
أهداف الدرس المطبوعة: ${JSON.stringify(seg.objectives, null, 1)}
أقسام الدرس المطبوعة: ${JSON.stringify(seg.sections, null, 1)}
القضايا المتضمنة المستخرجة: ${JSON.stringify(seg.qadaya || [], null, 1)}
ما أُنتج فعلًا (أعداد محسوبة برمجيًا، لا رأي): ${JSON.stringify(counts, null, 1)}
عيّنات: مفردات=${JSON.stringify((art.vocab || []).map((v) => v.word).slice(0, 40))} · مواطن جمال=${JSON.stringify((art.rhetoric || []).map((r) => r.expression).slice(0, 30))} · قواعد=${JSON.stringify((art.grammar?.rule_lines || []).map((r) => r.id))}
تحقّق بندًا بندًا مقابل ما هو مطبوع في الصفحات ${l.printed}: هل كل خلية في جدول المفردات مُستخرَجة؟ كل بند من مواطن الجمال (بكل أنواع الأساليب التي تذكرها الأهداف: أمر/نهي/استفهام…)؟ كل سطر قاعدة؟ كل حالة إملائية؟ كل بيت شعري؟ ${isSacred(l) ? 'كل آية صفًّا مستقلًا في units (قارن sacred_units بمدى الاستشهاد)؟' : ''} كل بند من صندوق «القضايا المتضمنة» إن كان مطبوعًا؟
لكل بند status: covered / thin / MISSING / **OUT_OF_SCOPE** — واستخدم OUT_OF_SCOPE (مع reason) للأهداف المطبوعة التي لا نقيسها أصلًا (الخط، التعبير، التلاوة) بدل إسقاطها بصمت.
verdict=GREEN فقط إذا لم يبقَ أي بند thin أو MISSING. أخرج COVERAGE.`,
    { label: `coverage:${l.id}`, phase: 'Coverage', model: 'sonnet', schema: COVERAGE })

  return { lesson: l, segment: seg, text, artefacts: art, questions: qs, interactives: inter,
           rederive, prov, counts, coverage }
}

const results = await pipeline(RUN, (l) => runLesson(l))
const out = results.filter(Boolean)
const failed = RUN.filter((_, i) => !results[i]).map((l) => l.id)
if (failed.length) log(`⚠ ${failed.length} lesson(s) died mid-chain and are NOT in the output: ${failed.join(', ')}`)

return { lessons: out, failed }
