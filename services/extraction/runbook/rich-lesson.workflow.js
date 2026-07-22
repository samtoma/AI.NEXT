export const meta = {
  name: 'rich-lesson',
  description: 'Full-book conveyor at richer depth — exposition + dense varied questions + interactive widgets, coverage-audited',
  phases: [
    { title: 'Segment', detail: 'auto-segment + exposition/keyterms/enrichment/misconceptions (Sonnet)' },
    { title: 'Claims', detail: 'per sub-topic grounded claims + passage (Sonnet)' },
    { title: 'Questions', detail: 'dense, style-varied, grounded (Sonnet)' },
    { title: 'Widgets', detail: '3–5 interactive/animated per lesson (Sonnet)' },
    { title: 'Verify', detail: 'adversarial re-solve (Sonnet) + provenance (Haiku)' },
    { title: 'Coverage', detail: 'checklist vs produced — the completeness gate (Sonnet)' },
  ],
}

const PDF = '/Users/samueltoma/Documents/Claude/Projects/AI Enthusiasts/PoC Tutor School V1/docs/Source/Social_prp3_T1_2.pdf'
const COURSE = 'course:prep3-social-ar'
// printed book page = PDF index - 7
const pp = (a, b) => `${a + 7}-${b + 7}`
// id, title, topic, printed range, pdf range
const LESSONS = [
  { id: 'soc1-1', title: 'قارات العالم (الموقع والمساحة)', topic: 'geography-social', printed: '2-6', pdf: pp(2, 6) },
  { id: 'soc1-2', title: 'تضاريس العالم', topic: 'geography-social', printed: '7-14', pdf: pp(7, 14) },
  { id: 'soc1-3', title: 'المناخ والنبات الطبيعي في العالم', topic: 'geography-social', printed: '15-22', pdf: pp(15, 22) },
  { id: 'soc2-1', title: 'السلالات البشرية في العالم', topic: 'geography-social', printed: '23-27', pdf: pp(23, 27) },
  { id: 'soc2-2', title: 'توزيع السكان في العالم', topic: 'geography-social', printed: '28-33', pdf: pp(28, 33) },
  { id: 'soc2-3', title: 'خصائص سكان العالم', topic: 'geography-social', printed: '34-40', pdf: pp(34, 40) },
  { id: 'soc3-1', title: 'مصر بين المماليك والعثمانيين', topic: 'history', printed: '41-46', pdf: pp(41, 46) },
  { id: 'soc3-2', title: 'الحملة الفرنسية على مصر (1798-1801)', topic: 'history', printed: '47-52', pdf: pp(47, 52) },
  { id: 'soc3-3', title: 'ثورة الشعب المصري وتولية محمد علي', topic: 'history', printed: '53-56', pdf: pp(53, 56) },
  { id: 'soc3-4', title: 'محمد علي وبناء مصر الحديثة', topic: 'history', printed: '57-63', pdf: pp(57, 63) },
  { id: 'soc4-1', title: 'خلفاء محمد علي وازدياد النفوذ الأجنبي', topic: 'history', printed: '64-71', pdf: pp(64, 71) },
  { id: 'soc4-2', title: 'الحركة الوطنية والثورة العرابية', topic: 'history', printed: '72-77', pdf: pp(72, 77) },
  { id: 'soc4-3', title: 'الكفاح الوطني ضد الاحتلال البريطاني', topic: 'history', printed: '78-80', pdf: pp(78, 80) },
  { id: 'soc4-4', title: 'مصر من الحماية البريطانية حتى ثورة يوليو 1952', topic: 'history', printed: '81-90', pdf: pp(81, 90) },
]
// args may arrive as an object OR a JSON string depending on the caller — handle both.
const ARGS = typeof args === 'string' ? (args ? JSON.parse(args) : {}) : (args || {})
const ONLY = (ARGS && ARGS.only) || ['soc1-1']
const RUN = LESSONS.filter((l) => ONLY.includes(l.id))

const BASES = 'world, africa, asia, europe, north_america, south_america, australia, egypt, arab_world, nile_valley, mediterranean_east'
const FACTS = { type: 'array', items: { type: 'object', required: ['kind', 'entity', 'value'], properties: { kind: { type: 'string' }, entity: { type: 'string' }, value: { type: 'string' } } } }
const EVK = { type: 'string', enum: ['text', 'map', 'concept_box', 'enrichment_box'] }

const SEGMENT_SCHEMA = { type: 'object', required: ['objectives', 'subtopics'], properties: {
  objectives: { type: 'array', items: { type: 'object', required: ['n', 'text'], properties: { n: { type: 'integer' }, text: { type: 'string' } } } },
  tamheed: { type: 'string' },
  subtopics: { type: 'array', items: { type: 'object', required: ['key', 'title', 'must_cover', 'printed_page'], properties: {
    key: { type: 'string' }, title: { type: 'string' }, must_cover: { type: 'string' }, printed_page: { type: 'integer' } } } },
  key_terms: { type: 'array', items: { type: 'object', required: ['term_ar', 'definition_ar', 'page'], properties: { term_ar: { type: 'string' }, definition_ar: { type: 'string' }, page: { type: 'integer' } } } },
  enrichment: { type: 'array', items: { type: 'object', required: ['title', 'body_ar', 'page'], properties: { title: { type: 'string' }, body_ar: { type: 'string' }, page: { type: 'integer' } } } },
  misconceptions: { type: 'array', items: { type: 'object', required: ['wrong', 'correction'], properties: { wrong: { type: 'string' }, correction: { type: 'string' } } } },
} }

const CLAIMS_SCHEMA = { type: 'object', required: ['key', 'exposition', 'claims'], properties: {
  key: { type: 'string' },
  exposition: { type: 'string' },
  claims: { type: 'array', items: { type: 'object', required: ['lo_n', 'claim_ar', 'evidence_page', 'evidence_kind'], properties: {
    lo_n: { type: 'integer' }, group: { type: 'string' }, claim_ar: { type: 'string' }, evidence_page: { type: 'integer' }, evidence_kind: EVK, facts: FACTS } } } } }

const QUESTIONS_SCHEMA = { type: 'object', required: ['key', 'questions'], properties: {
  key: { type: 'string' },
  questions: { type: 'array', items: { type: 'object', required: ['id', 'lo_n', 'tier', 'type', 'style', 'stem', 'answer', 'solution', 'source_page'], properties: {
    id: { type: 'string' }, lo_n: { type: 'integer' },
    tier: { type: 'string', enum: ['basic', 'standard', 'advanced'] },
    type: { type: 'string', enum: ['mcq', 'short'] },
    style: { type: 'string', enum: ['recall', 'explain_why', 'compare', 'consequence', 'order', 'locate', 'concept'] },
    stem: { type: 'string' },
    choices: { type: 'array', items: { type: 'object', required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } } },
    answer: { type: 'string' },
    solution: { type: 'array', items: { type: 'object', required: ['claim_ar', 'evidence_page', 'evidence_kind'], properties: { claim_ar: { type: 'string' }, evidence_page: { type: 'integer' }, evidence_kind: EVK, facts: FACTS } } },
    source_page: { type: 'integer' } } } } } }

const WIDGETS_SCHEMA = { type: 'object', required: ['visuals', 'interactives'], properties: {
  visuals: { type: 'array', items: { type: 'object', required: ['lo_n', 'kind', 'caption', 'source_page', 'spec'], properties: {
    lo_n: { type: 'integer' }, kind: { type: 'string', enum: ['map_scene', 'timeline', 'flow_chain'] }, caption: { type: 'string' }, source_page: { type: 'integer' }, spec: { type: 'object', additionalProperties: true } } } },
  interactives: { type: 'array', items: { type: 'object', required: ['lo_n', 'kind', 'prompt_ar', 'source_page', 'spec'], properties: {
    lo_n: { type: 'integer' }, kind: { type: 'string', enum: ['locate_on_map', 'term_match', 'timeline_builder', 'chain_builder'] }, prompt_ar: { type: 'string' }, source_page: { type: 'integer' }, spec: { type: 'object', additionalProperties: true } } } } } }

const VERIFY_SCHEMA = { type: 'object', required: ['key', 'verdicts'], properties: { key: { type: 'string' }, verdicts: { type: 'array', items: { type: 'object', required: ['id', 'my_answer'], properties: { id: { type: 'string' }, my_answer: { type: 'string' }, reason: { type: 'string' } } } } } }
const PROV_SCHEMA = { type: 'object', required: ['key', 'checks'], properties: { key: { type: 'string' }, checks: { type: 'array', items: { type: 'object', required: ['claim_ar', 'evidence_page', 'supported'], properties: { claim_ar: { type: 'string' }, evidence_page: { type: 'integer' }, supported: { type: 'boolean' }, note: { type: 'string' } } } } } }
const COVERAGE_SCHEMA = { type: 'object', required: ['verdict', 'subtopics'], properties: { verdict: { type: 'string', enum: ['GREEN', 'RED'] }, subtopics: { type: 'array', items: { type: 'object', required: ['key', 'status'], properties: { key: { type: 'string' }, status: { type: 'string', enum: ['covered', 'thin', 'MISSING'] }, missing_items: { type: 'array', items: { type: 'string' } } } } } } }

const RULES = `القواعد (عقد الاستخراج، أمانة تامة للكتاب):
- لا معلومة خارج صفحات الدرس المذكورة. مصطلحات الوزارة حرفية. أرقام الصفحات = صفحات الكتاب المطبوعة.
- الأرقام والسنوات ليست أهدافًا امتحانية؛ ركّز على أفعال الاستنتاج (بم تفسر / النتائج المترتبة / قارن / رتّب / ميّز)، والاسترجاع للمصطلحات.
- الغِنى مطلوب: الشرح ليس جملة واحدة بل فقرة تعليمية، والأسئلة متنوعة الأساليب، والوسائط تفاعلية.`

const head = (l) => `الملف: ${PDF}
اقرأ صفحات الـPDF بأداة Read (pages): ${l.pdf} — تقابل صفحات الكتاب المطبوعة ${l.printed}.
الدرس: ${l.id} — ${l.title} (${l.topic === 'history' ? 'تاريخ' : 'جغرافيا'}).`

const segPrompt = (l) => `أنت مُخطِّط الدرس. اقرأ الدرس كاملًا واستخرج بنيته الغنية.
${head(l)}
${RULES}
أخرج SEGMENT_SCHEMA:
- objectives: الأهداف حرفيًا من صندوق «أهداف الدرس» (رقم + نص).
- tamheed: فقرة تمهيد تعليمية جذّابة مستندة للكتاب.
- subtopics: قائمة الموضوعات الفرعية بترتيب الكتاب، لكلٍّ key (إنجليزي مختصر) + title + must_cover (كل ما يجب تغطيته من الكتاب) + printed_page.
- key_terms: مصطلحات «مفاهيم أتعلمها» بتعريفها الحرفي.
- enrichment: صناديق «معلومات إثرائية» (عنوان + نص).
- misconceptions: أخطاء شائعة متوقعة + تصحيحها (تُغذّي المشتتات والمعلّم).`

const expoNote = `- exposition: فقرة تعليمية غنية (3–6 جمل) تشرح هذا الموضوع الفرعي للتلميذ كأنّ معلمًا يحكي — لا مجرد تعداد.`
const claimsPrompt = (l, st) => `استخرج المحتوى الغني للموضوع الفرعي «${st.title}» من درس ${l.title}.
${head(l)}
ما يجب تغطيته (من الكتاب): ${st.must_cover}
${RULES}
أخرج CLAIMS_SCHEMA للمفتاح key="${st.key}":
${expoNote}
- claims: ادعاءات ذرّية مُسنَدة، كلٌّ مربوط برقم الهدف lo_n (من قائمة الأهداف) + group + evidence_page + evidence_kind + facts. غطِّ كل بند في must_cover.`

const qPrompt = (l, st, cl) => `ألّف بنكًا غنيًّا ومتنوعًا من الأسئلة للموضوع «${st.title}»، مبنيًّا حصريًا على الادعاءات.
الادعاءات: ${JSON.stringify(cl.claims || [], null, 1).slice(0, 6000)}
${RULES}
اكتب 6–8 أسئلة تغطي أهداف الموضوع عبر المستويات (basic/standard/advanced) وبأساليب متنوعة (style): على الأقل 4 أساليب مختلفة من {recall, explain_why, compare, consequence, order, locate, concept}، ومنها سؤالان على الأقل higher-order (advanced).
- id بالنمط q:${l.id}:${st.key}:NN. الحل solution قائمة claim-steps من الادعاءات. mcq بأربعة اختيارات ومفتاح صحيح. source_page = رقم الكتاب المطبوع. أخرج QUESTIONS_SCHEMA (key="${st.key}").`

const wPrompt = (l, seg, claims) => `صمّم من 3 إلى 5 وسائط تفاعلية/متحركة غنية لدرس ${l.title}، مُسنَدة للمحتوى.
الخرائط المتاحة (base): ${BASES}.
ملخص الادعاءات: ${JSON.stringify(claims.slice(0, 60), null, 1).slice(0, 7000)}
${RULES}
أخرج WIDGETS_SCHEMA:
- visuals: بصريات متحركة تُحمَّل في البنك — kind من {map_scene, timeline, flow_chain}. map_scene spec: {base, marks:[{kind:"region"|"point"|"route", place:"اسم من المعجم", label, color:"rust"|"gold"|"green", step}], animate:"sequence"}. timeline/flow_chain حسب VIZ_SPEC.
- interactives: تحدّيات تفاعلية للتلميذ — kind من {locate_on_map (حدّد المعلم على الخريطة), term_match (طابق المصطلح بتعريفه), timeline_builder, chain_builder (رتّب سلسلة السبب→النتيجة)}. لكلٍّ prompt_ar + spec (بيانات التحدّي: العناصر والإجابة الصحيحة).
اربط كل عنصر بـ lo_n المناسب. للجغرافيا فضّل map_scene+locate؛ للتاريخ فضّل timeline+chain.`

const redact = (qs) => (qs || []).map((q) => ({ id: q.id, stem: q.stem, type: q.type, choices: q.choices }))
const vPrompt = (l, st, cl, qs) => `مُصحِّح مستقل (لست المؤلف). حُلّ كل سؤال من الادعاءات فقط دون رؤية إجابة المؤلف. الموضوع: ${st.title}.
الادعاءات: ${JSON.stringify(cl.claims || [], null, 1).slice(0, 5500)}
الأسئلة (بلا إجابات): ${JSON.stringify(redact(qs.questions), null, 1).slice(0, 4500)}
لكل سؤال my_answer (مفتاح الاختيار أو نص موجز) وسبب مختصر. أخرج VERIFY_SCHEMA (key="${st.key}").`
const provPrompt = (l, st, cl) => `تحقّق من الإسناد. اقرأ صفحات الدرس وتأكّد أن كل ادعاء موجود فعلًا في صفحته.
${head(l)}
الادعاءات: ${JSON.stringify(cl.claims || [], null, 1).slice(0, 6000)}
أخرج PROV_SCHEMA (key="${st.key}").`

// ---------------- run ----------------
const out = []
for (const l of RUN) {
  const seg = await agent(segPrompt(l), { label: `segment:${l.id}`, phase: 'Segment', model: 'sonnet', schema: SEGMENT_SCHEMA })
  const subs = (seg.subtopics || []).slice(0, 12)
  log(`${l.id}: ${subs.length} sub-topics · ${(seg.objectives || []).length} objectives · ${(seg.key_terms || []).length} terms · ${(seg.enrichment || []).length} enrichment boxes`)

  const rows = await parallel(subs.map((st) => () =>
    agent(claimsPrompt(l, st), { label: `claims:${l.id}:${st.key}`, phase: 'Claims', model: 'sonnet', schema: CLAIMS_SCHEMA })
      .then((cl) => agent(qPrompt(l, st, cl), { label: `q:${l.id}:${st.key}`, phase: 'Questions', model: 'sonnet', schema: QUESTIONS_SCHEMA })
        .then((qs) => parallel([
          () => agent(vPrompt(l, st, cl, qs), { label: `verify:${l.id}:${st.key}`, phase: 'Verify', model: 'sonnet', schema: VERIFY_SCHEMA }),
          () => agent(provPrompt(l, st, cl), { label: `prov:${l.id}:${st.key}`, phase: 'Verify', model: 'haiku', effort: 'low', schema: PROV_SCHEMA }),
        ]).then(([v, p]) => ({ key: st.key, title: st.title, claims: cl, questions: qs, verify: v, prov: p }))))))

  const clean = rows.filter(Boolean)
  const allClaims = clean.flatMap((r) => (r.claims?.claims) || [])
  const widgets = await agent(wPrompt(l, seg, allClaims), { label: `widgets:${l.id}`, phase: 'Widgets', model: 'sonnet', schema: WIDGETS_SCHEMA })

  const tally = clean.map((r) => ({ key: r.key, title: r.title, claims: (r.claims?.claims || []).length, questions: (r.questions?.questions || []).length, claim_texts: (r.claims?.claims || []).map((x) => x.claim_ar).slice(0, 30) }))
  const covPrompt = `مدقّق التغطية لدرس ${l.title}. المطلوب لكل موضوع فرعي:
${subs.map((s) => `• ${s.key} (${s.title}): ${s.must_cover}`).join('\n')}
المُنتَج فعليًا: ${JSON.stringify(tally, null, 1).slice(0, 12000)}
لكل موضوع status (covered/thin/MISSING) + missing_items. verdict=GREEN فقط إذا كل المواضيع covered. أخرج COVERAGE_SCHEMA.`
  const coverage = await agent(covPrompt, { label: `coverage:${l.id}`, phase: 'Coverage', model: 'sonnet', schema: COVERAGE_SCHEMA })

  out.push({ lessonId: l.id, title: l.title, topic: l.topic, objectives: seg.objectives, tamheed: seg.tamheed, key_terms: seg.key_terms, enrichment: seg.enrichment, misconceptions: seg.misconceptions, subtopics: clean, widgets, coverage })
}

return { lessons: out }
