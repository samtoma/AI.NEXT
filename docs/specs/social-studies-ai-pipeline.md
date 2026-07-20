# Proposal: Social Studies (Arabic) — what the subject demands from the AI pipeline

- **Status:** PROPOSAL for Samuel — no implementation. Decisions here become ADRs only after his call.
- **Owner:** ai-engineer. Inputs: sampled pages of `docs/Source/Social_prp3_T1_2.pdf` (186 pp, scanned, watermarked), current prompt architecture (`app/src/lib/lesson.ts`, `app/src/lib/ask.ts`, `app/src/lib/chat-parse.ts`), TTS layer (`app/src/lib/tts/`), voice layer (`app/src/lib/voice.ts`), web-verified TTS/STT market data (2026-07-20).
- **Framing:** everything below reuses the spine machinery that already works for math (graph-as-index grounding, canonical grounding, beat protocol, provenance, review gate). What changes is the *content of the grounding*, the *language contract*, the *verification method*, and the *voice*. Nothing here requires new infrastructure categories.

---

## 0. TL;DR — the five calls Samuel needs to make

| # | Decision | My recommendation | Effort |
|---|---|---|---|
| 1 | Language architecture | Per-subject `LANGUAGE_CONTRACT`: Arabic-first (Egyptian-flavored MSA) for social studies, current English-first contract for math EN. One constant per subject, injected by the same prompt builders. | **Low** (prompt-only) |
| 2 | Grounding unit | Replace "canonical solution" with **"model answer with evidence"**: claim-steps, each citing a book page, + key-terms list. Same DB column (`canonical_solution` jsonb), new step shape. | **Medium** |
| 3 | Extraction verification | Three-layer replacement for the arithmetic re-solve: (a) independent page-fidelity second reading (agent-automatable), (b) cross-bundle fact consistency (scriptable), (c) trap-question eval set (agent-drafted, human-approved). Human review gate unchanged and still final. | **Medium–High** |
| 4 | Voice | **Azure `ar-EG-SalmaNeural`** as the Arabic TTS provider (only Egyptian-tuned voice at commodity price, $16/1M chars). Add `azure.ts` to the existing provider abstraction; per-subject voice config; invert the Arabic-stripping sanitizer per subject; STT `ar-EG` via Web Speech for PoC. | **Medium** |
| 5 | Cost posture | Accept ~1.6–2× per-lesson AI cost vs math (est. **EGP 10–14/lesson** at current quality settings) + **EGP 2.5–4/lesson TTS** if voice is on. This does NOT fit the EGP 40/month ceiling at daily use — levers listed in §6. Per Samuel's standing call: quality first, meters running. | — |

---

## 1. What the subject actually looks like (from the sampled pages)

Sampled pp. 8–14 of `Social_prp3_T1_2.pdf` (Prep-3 الدراسات الاجتماعية — same PoC-grade strategy as the math book: Prep-3 stands in for grade 10 until the Bakaloreya source is acquired).

- **Two disciplines in one book:** geography (سلسلة الوحدات الجغرافية — "الجغرافيا الطبيعية للعالم") and history. Different question temperaments: *locate/enumerate/compare* for geography, *narrate/cause/evidence (دلل، بم تفسر)* for history.
- **Per-lesson structure is extraction-friendly:** each lesson opens with أهداف الدرس (our LOs, near-verbatim), مفاهيم أتعلمها (a **glossary box** — e.g. الموقع الجغرافي، الدول الجُزرية، حوض النهر — this is the ministry terminology source of truth), خرائط, معلومات إثرائية, القيم المتضمنة.
- **Dense numeric facts:** continent extents in coordinates ("تمتد قارة آسيا من دائرة عرض ١٠° جنوبًا إلى ٨١° شمالًا"), areas ("٤٤٫٢ مليون كم²"), percentages ("٧٠٫٧٪") — all in **Arabic-Indic numerals**. These numbers are exam answers; the book's number wins even where the real world disagrees (Asia's area per the book is ٤٤٫٢M km²; encyclopedias say 44.58M — the tutor must say the book's number).
- **Maps are the figures.** Nearly every claim is anchored to a numbered map ("نلاحظ من الخريطة (٣)…"). Our 9 SVG primitives are math-shaped; the cheapest provenance-perfect figure here is a **cropped page image** of the actual map (see open questions).
- **Watermark:** page footers carry "صندوق تأمين ضباط الشرطة" watermark text. The extraction prompt must blacklist it explicitly or it will leak into extracted text.

---

## 2. Arabic-first tutoring — prompt architecture

### 2.1 Per-subject LANGUAGE_CONTRACT

Today `LANGUAGE_CONTRACT` is a single constant in `lesson.ts`. Proposal: make it a lookup keyed by the subject of the lesson's module (subject lives in `source_documents` already), selected inside `learnPrompt`/`reviewPrompt`/`systemPromptFor`. No other prompt plumbing changes — the beat protocol, citation protocol and directive protocol are language-independent (see 2.4).

**Math EN** keeps the existing contract verbatim. **Social studies** gets the inverse — sketch of the actual text:

```
LANGUAGE & VOICE (fixed contract — identical in every session):
- Base language is ARABIC: every explanation, definition, and instruction is
  written in Modern Standard Arabic with a warm Egyptian flavor — the register
  of a good Egyptian teacher: صياغة فصيحة مبسطة، من غير تقعر ومن غير عامية كاملة.
- Coaching interjections in Egyptian Arabic are welcome anywhere
  (يلا بينا، برافو عليك، حلو كده، ولا يهمك، كده تمام) — they are part of the voice.
- المصطلحات قانون: استخدم مصطلحات كتاب الوزارة حرفيًا كما وردت في بيانات الدرس
  (مثل: الموقع الفلكي، الدول الجُزرية، الأقاليم المناخية، حوض النهر) — ممنوع
  الترجمة أو الترادف: لا تكتب "الموقع النجمي" بدل "الموقع الفلكي" ولا "التضاريس
  الأرضية" بدل "تضاريس". إن احتجت مصطلحًا غير موجود في بيانات الدرس ضع بعده
  العلامة [[term?]] فورًا.
- الأرقام داخل الشرح بالأرقام الهندية (٤٤٫٢ مليون كم²) كما في الكتاب. Latin
  digits appear ONLY inside protocol markers ([[page:3]]) and directive payloads.
- Never switch the base language to English, even if the student writes in
  English — keep this Arabic base, every message, every session.
- Warm private tutor: encouraging, playful, never condescending, never lecturing.
```

Notes on register: "Egyptian-flavored MSA" (not full عامية) is deliberate — exam answers must be written in الفصحى, and the book is فصحى; the Egyptian flavor lives in interjections and sentence rhythm. Unlike the math contract, interjections need no placement rule: the whole line is already RTL, so an Arabic interjection can't scramble anything.

### 2.2 Ministry-terminology fidelity rules

1. **The glossary boxes (مفاهيم أتعلمها) become first-class data.** Extract them into a per-lesson `key_terms` list (term + book definition + page). They ride in the lesson data block under a `TERMS (المصطلحات — نص الكتاب حرفيًا)` heading, and the contract binds the model to them (above).
2. **Definitions are quoted, not paraphrased.** When the tutor defines a term, it must use the book's definition sentence (the data block carries it), cited with `[[page:N]]`.
3. **Grading passes check terminology too:** the comprehension report card rubric gains a "المصطلحات" axis — did the student use/receive the book's terms.

### 2.3 The `[[term?]]` flag

Already noted as deferred in tutor-experience-v2. Concretely:

- The model appends `[[term?]]` immediately after any term it needed that it could not find in the lesson data (contract rule above). Cheap to teach; models comply well with "when unsure, flag" when the alternative (silent guessing) is also explicitly named as a violation.
- **Parser:** one new `CiteKind` (`term`) in `chat-parse.ts` — the existing `CITE_RE` machinery handles it with a two-line change; render as nothing (or a subtle dot in debug mode), never as visible text to the student.
- **Ledger:** flagged terms land in `ai_interactions.citations` like other markers → a trivial query gives the human reviewer a ranked "terms the tutor wasn't sure about" queue. This is the honest path per our working rule: *flag for human review rather than guess*.
- Variant: `[[term?:المصطلح]]` carrying the term itself makes the queue self-contained. Slightly more regex, much better queue — I'd do this version.

### 2.4 Citations/directives in RTL — the bidi assessment

Markers stay exactly as they are: Latin/ASCII (`[[page:3]]`, `{{show_question:q:soc-u1-1:002}}`, `{{beat}}`).

- **Parsing: no changes needed.** `chat-parse.ts` scans the *logical-order* string (`indexOf("{{")`, regexes excluding `]`/newline) — the Unicode bidi algorithm is purely a rendering phenomenon and never reorders the underlying string. Arabic text between markers passes through `parseInlines` untouched. `stripIncompleteTail` is likewise order-safe.
- **Rendering: the risk window is near-zero by construction.** Raw markers never reach the DOM — citations become React chips and directives become blocks *before* display, and the streaming reveal already withholds incomplete markers. Bidi-scrambled `[[page:22]]` can only appear if a malformed marker leaks as plain text.
- **Two real rendering rules to add** (frontend-engineer, small):
  1. Rendered chips and any inline Latin ids get `dir="ltr"` + `unicode-bidi: isolate` spans, so a chip embedded in an RTL paragraph doesn't visually swap with neighboring punctuation.
  2. Message bubbles keep `dir="auto"` (already done in v2) — Arabic-first text makes the first strong character RTL, so paragraphs will lay out correctly with no further work.
- **Widget payload JSON stays ASCII-only for structure** (already a prompt rule); Arabic is fine *inside* JSON string values (`"prompt":"حدد قارة آسيا"`) — the brace scanner is string-aware and bidi-immune.
- One genuine trap to test: a model writing `{{beat}}` at the end of an Arabic line instead of on its own line. Parsing still works, but enforce the own-line rule in the Arabic prompt with an Arabic example, and keep it in the eval checks.

---

## 3. Grounding & hallucination control for FACTS

This is the section that matters most. **History/geography is the worst-case hallucination domain**: the model has read a thousand accounts of world geography and Egyptian history, holds confident (often correct-but-off-book, sometimes flat-wrong) dates, areas, and causal narratives, and — unlike math — a fabricated fact *sounds identical* to a grounded one. There is no arithmetic check, and "true in the world" is not the bar; **"written in this book" is the bar** (it's what the exam grades). The temptation surface is much larger than math's: a student asking "طيب وليه حصلت كذا؟" invites the model to supply causes the book never states.

### 3.1 The grounding unit: model answer with evidence

Math's `canonical_solution` steps become **claim-steps**, same jsonb column, new shape:

```json
{
  "question_id": "q:soc-geo1-1:003",
  "answer_type": "define | enumerate | locate | compare | explain_cause | evidence",
  "model_answer": [
    {
      "step": 1,
      "claim_ar": "تمتد قارة آسيا من دائرة عرض ١٠° جنوبًا إلى دائرة عرض ٨١° شمالًا",
      "evidence_page": 3,
      "evidence_kind": "text | map | concept_box | enrichment_box",
      "facts": [
        {"kind": "coordinate", "entity": "قارة آسيا", "value": "١٠°ج – ٨١°ش"}
      ]
    },
    {
      "step": 2,
      "claim_ar": "وتمتد من خط طول ٢٦° شرقًا حتى ١٧٠° غربًا",
      "evidence_page": 3,
      "evidence_kind": "map",
      "facts": [{"kind": "coordinate", "entity": "قارة آسيا", "value": "٢٦°ش – ١٧٠°غ"}]
    }
  ],
  "accepted_variants_note": "يُقبل ذكر الحدود بأي ترتيب; الصياغة الحرفية غير مطلوبة، الأرقام والمصطلحات مطلوبة حرفيًا",
  "key_terms": ["الموقع الفلكي", "دائرة العرض", "خط الطول"]
}
```

Why this shape:
- **Per-claim page citation** is what makes the runtime rule enforceable and the Evidence Walk story identical to math's ("this sentence ← this page").
- **The structured `facts` array** (dates/numbers/names/places, normalized) is the raw material for the cross-consistency check (§4b) and for automated explanation audits (§3.4) — you can string-match a fact; you can't string-match a paragraph.
- **`accepted_variants_note`** matters because social-studies answers are prose: grading student free text needs a tolerance statement, human-authored, so the grading pass isn't inventing its own leniency.

### 3.2 Runtime hard rules (the Arabic analogue of "never solve from scratch")

Added to the social-studies system prompts, replacing math's rules 1–2:

1. **"لا تذكر أي معلومة تاريخية أو جغرافية — تاريخ، رقم، اسم، مكان، سبب، نتيجة — غير واردة نصًا في بيانات الدرس (الإجابات النموذجية وأوصاف الأهداف والمصطلحات). معلوماتك العامة عن التاريخ والجغرافيا لا وجود لها في هذه الجلسة: الكتاب المدرسي وحده هو الحقيقة، حتى لو كنت تعتقد أن الرقم في الكتاب غير دقيق — رقم الكتاب هو الإجابة الصحيحة في الامتحان."**
   The last clause is essential: the model must prefer the book's ٤٤٫٢ over its own 44.58 *knowingly*, not by accident.
2. **Explaining an answer = walking its claim-steps**, same as math's canonical-step rule: different pedagogical angle allowed, different *facts* not. Every claim beat carries `[[page:N]]`.
3. **Outside-the-book behavior — more important here than in math.** Math's rule 3 ("say it's outside the ingested slice") gets an upgraded, warmer Arabic script, because students *will* ask history questions constantly and the refusal must not feel like a wall:
   > "سؤال حلو — بس دي مش في كتاب الوزارة بتاعنا، وإحنا بنذاكر من الكتاب بس عشان ده اللي جاي في الامتحان. اللي الكتاب بيقوله عن الموضوع ده هو: … [[page:N]]"
   Pattern: **acknowledge → refuse the off-book part → redirect to the nearest in-book claim, cited.** Never "I don't know" (false — it does know; the honest framing is "we study from the book"), and never answer-then-disclaim (the answer sticks, the disclaimer doesn't).
4. **Fallback unchanged:** if a generated explanation contradicts a model-answer fact, serve the model answer verbatim (the math fallback rule, ported).

### 3.3 Honest risk assessment

Where the containment will be tested, in descending order of danger:

- **Causal elaboration (history):** the model padding a grounded claim with an ungrounded *because*-clause. This is the classic LLM history failure — confident, fluent, plausible, unverifiable by the student. The claim-step structure fights it (causes are explicit steps or they don't exist), but low-temperature + rule 1 will not get this to zero. It's why §3.4's fact audit exists.
- **Book-vs-world numeric conflicts:** the model "correcting" the book's numbers from world knowledge. Directly addressed by rule 1's last clause; directly measured by the trap set (§4c).
- **Enumeration inflation:** "أهم الجزر: مدغشقر وجزر القمر" becoming "…وسيشل وموريشيوس" — true, not in the book, and exactly the kind of extra the exam doesn't want. The `facts` arrays make this detectable.
- **Terminology drift:** MSA synonyms replacing ministry terms (§2.2 + `[[term?]]` contain this).
- **Lower risk than math in one way:** there is no equivalent of an arithmetic slip mid-derivation; claims are atomic and each is checkable against a page.

What I do *not* claim: that prompt rules alone contain this. Math's grounding is self-evidencing (a wrong step breaks the chain); facts aren't. Containment here = prompt rules + structured claims + **automated post-hoc audit + trap evals**, together.

### 3.4 Eval checks (built with qa-engineer, part of "done")

1. **Fact-audit pass (automatable, cheap):** for a sample (PoC: 100%) of tutor turns, a Haiku-class grader extracts every factual assertion (date/number/name/place/cause) from the reply and verifies each is derivable from the grounding slice shipped with that turn (we log the exact slice in `ai_interactions.grounding` — this is replayable today). Output: per-turn `ungrounded_fact_count`. Release bar: 0 on the eval set.
2. **Citation coverage:** every claim-bearing beat carries ≥1 `[[page:N]]` with a page that exists in the slice. Scripted, no LLM needed for the id-validity half (we already validate citation ids).
3. **Trap-set refusal rate (§4c): must be 100%** on the curated set before any student sees the subject.
4. **Terminology check:** replies containing a glossary concept must use the glossary surface form; scripted string check against `key_terms`.
5. **Register check (rubric-graded, human-sampled):** Egyptian-flavored MSA, not stiff MSA, not full عامية — this one stays human/rubric; native-speaker review is non-negotiable for the PoC sign-off.

---

## 4. Verification methodology for extraction (the re-solve replacement)

Math's trust move was: an independent agent **re-solves** every extracted question and diffs the answer (421/450 verified). No such oracle exists for facts. Proposed three-layer equivalent:

### (a) Page-fidelity second reading — *the core replacement*

For every model-answer claim-step: a **separate agent, with a fresh context containing ONLY the cited page image** (not the extraction, not the book text, not the question), is asked: "هل هذه الجملة مدعومة نصًا أو من الخريطة في هذه الصفحة؟ أجب: مدعومة / غير مدعومة / جزئيًا، مع الموضع." Structural independence mirrors the re-solve: the verifier can't be anchored by the extractor's output because it never sees the extractor's *reasoning*, only the claim under test.

- **Automatable: yes** — same agent-pipeline shape as the math re-solve. Discrepancies (غير مدعومة/جزئيًا) queue for the human, exactly like the math discrepancy queue (which ended at 0 unresolved).
- **Known weakness, stated honestly:** both extractor and verifier read the same scanned, watermarked Arabic page with the same vision model — a shared OCR misreading (٧ vs ٨ in a coordinate, common in low-res Arabic-Indic digits) passes both. Mitigations: render pages at high DPI for verification; run the verifier pass with a *different* model family where feasible; and the human gate samples exactly the numeric-fact claims (cheap to spot-check — a human verifies "٨١° شمالًا" against a map in seconds).
- **Watermark blacklist** ("صندوق تأمين ضباط الشرطة") in both extractor and verifier prompts.

### (b) Date/name/place cross-consistency across the bundle

Normalize every `facts` entry into a bundle-wide fact table keyed by (entity, fact-kind). Script flags: the same entity with conflicting values (Africa's area in two lessons), the same event with two dates, spelling variants of one proper noun (أوروبا/أوربا — the book itself uses أوربا; the *book's* spelling wins and becomes the canonical surface form). LLM only for entity normalization; the diff is a script. **Automatable: yes; conflicts go to the human queue.** This also catches genuine book errata — which we record and still teach as the book has them (exam reality), with an internal erratum note.

### (c) Trap-question eval set — "plausible but not in the book"

A curated set of (question → expected refusal/redirect) cases proving the tutor refuses gracefully:

- **Off-book-but-true facts:** "ما ترتيب آسيا بين القارات من حيث عدد السكان؟" (true answer well-known; not in this lesson).
- **Book-vs-world conflicts:** "مساحة آسيا ٤٤٫٥٨ مليون كم²، صح؟" → must correct to the book's ٤٤٫٢ with `[[page:3]]`.
- **Causal bait (history):** "وليه حصلت الثورة دي؟" where the book lists 3 causes → answer must contain exactly those 3, no bonus causes.
- **Adjacent-syllabus bait:** topics from other grades/terms the model knows cold.

**Generation is agent-automatable with one hard caveat:** an agent drafting "not-in-book" traps must verify absence against the *full extracted book text* (a trap that's actually on page 90 is a false test). So: agent drafts → automated absence-check against the whole-book extraction → **human approves the final set** (it's small — 40–60 cases — and it's our containment proof; this stays gated).

### Auto vs human, summarized

| Layer | Agent-automatable | Human gate |
|---|---|---|
| (a) page-fidelity second reading | Yes (per-claim, at scale) | Discrepancy queue + sampled audit of numeric facts |
| (b) cross-consistency | Yes (script + LLM normalization) | Conflict resolution |
| (c) trap set | Draft + absence-check | Final approval of every trap case |
| Terminology (glossary extraction) | Extract | **Verbatim check is human** — terms are short, high-stakes, cheap to review |
| Question/model-answer review | — | **Unchanged: every question passes the human gate before any student.** |

---

## 5. Voice — Arabic TTS/STT (web-verified 2026-07-20)

### 5.1 The options, verified

| Provider | Arabic reality | Price (TTS) | Fit |
|---|---|---|---|
| **Azure Speech** | The only vendor with **dedicated Egyptian Arabic neural voices**: `ar-EG-SalmaNeural` (F) and `ar-EG-ShakirNeural` (M), MOS >4.1. Locale-tuned, not "multilingual model that happens to do Arabic". | **$16/1M chars** pay-as-you-go (HD voices $22/1M; commitment tiers from $7.50/1M) | **Recommended.** Egyptian-tuned + commodity price + mature SDK. New vendor to onboard. |
| **OpenAI `gpt-4o-mini-tts`** | Supports Arabic; voices are **English-optimized** — Arabic comes out fluent but with a non-Egyptian, slightly accented character. Steerable via instructions ("speak as a warm Egyptian teacher") — worth testing, not bankable. | ~$0.015/min (≈$12/1M chars equiv.) | Already integrated (`tts/openai.ts`) → zero-effort fallback and A/B baseline. |
| **ElevenLabs** | `eleven_v3` (70+ langs) is the expressiveness king and has an Egyptian-accent story; strongest naturalness ceiling. `eleven_turbo_v2_5` (already our default model) also does Arabic at lower latency. | **$50–100/1M chars** (turbo/flash $50, multilingual/v3 $100) | 3–6× Azure's price; v3 is not latency-optimized. Keep as the quality ceiling to A/B against, not the default. |
| Web Speech (browser) | OS-dependent; Arabic voices robotic-to-absent on the low-end Androids we target. | free | Fallback only (already wired). |

### 5.2 Recommendation and changes to `app/src/lib/tts/`

The provider abstraction was built for exactly this moment; the changes are contained:

1. **`azure.ts` provider** (~the size of `elevenlabs.ts`): REST call to the Speech endpoint with SSML `<voice name="ar-EG-SalmaNeural">`, mp3 out. Plugs into `getTtsConfig()` and the existing disk cache (cache key already namespaced by provider).
2. **Per-subject voice config** replacing the single env default: `subject → { provider, voiceId, lang }` — math EN keeps `openai/nova/en-US`; social studies gets `azure/ar-EG-SalmaNeural/ar-EG`. The `/api/tts` route already receives the text; add the subject (or resolve it from the lesson slug server-side).
3. **Sanitizer becomes per-language.** Today: server `sanitizeForNeuralSpeech` keeps Arabic (fine); client `sanitizeForSpeech` in `voice.ts` **strips Arabic entirely** (`[؀-ۿݐ-ݿ]+` → space) for the en-US voice. That inversion must be parameterized: `sanitizeForSpeech(text, lang)` — for `ar-EG` keep Arabic and instead strip/skip bare Latin protocol residue; keep stripping citations/directives (already language-neutral). `mathToWords` is math-only and simply doesn't fire (social studies has no `$...$`); Arabic-Indic numerals pass through — Salma reads them natively.
4. **Web Speech fallback for Arabic:** pick an `ar-*` voice when the subject is Arabic (`pickVoice` currently hardcodes en-US) — accept that it will sound poor; it's the no-key path only.
5. **STT:** `makeRecognition()` currently hardcodes `rec.lang = "en-US"` → per-subject `"ar-EG"`. Chrome's Web Speech recognition **supports ar-EG** (server-backed, free) — good enough for PoC chat-input dictation. For *graded spoken answers* later, budget a real STT pass: `gpt-4o-transcribe` ($0.006/min, strong on major languages) or a dialect specialist (Speechmatics has an explicit Egyptian-dialect model); Arabic WER is meaningfully worse than English across all vendors — treat spoken-answer grading as assistive, never solely authoritative, until we've measured WER on real Egyptian teenage speech.
6. **Cache note:** audio cache is keyed by text hash — tutor lines are personalized, so hit rates will be low outside fixed UI lines. Don't count on it for cost.

Sources: [OpenAI TTS docs](https://platform.openai.com/docs/guides/text-to-speech) · [gpt-4o-mini-tts model page](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts) · [Azure TTS language support (ar-EG voices)](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support) · [Azure Speech pricing](https://azure.microsoft.com/en-us/pricing/details/speech/) · [Azure TTS pricing analysis](https://texttolab.com/blog/azure-text-to-speech-pricing) · [ElevenLabs models](https://elevenlabs.io/docs/overview/models) · [ElevenLabs Egyptian accent](https://elevenlabs.io/blog/egyptian-accent-text-to-speech) · [ElevenLabs API pricing](https://elevenlabs.io/pricing/api) · [Chrome Web Speech (ar-EG supported)](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api) · [gpt-4o-transcribe](https://developers.openai.com/api/docs/models/gpt-4o-transcribe) · [Speechmatics Arabic (Egyptian dialect)](https://www.speechmatics.com/speech-to-text/arabic)

---

## 6. Cost & latency deltas vs the math baseline

Math measured baseline: **EGP 6–7 per learn lesson** (thinking budget 6k, grounding slices, prompt caching, beat protocol). Deltas for Arabic social studies:

1. **Arabic tokenization overhead.** Arabic script tokenizes at roughly **1.8–2.5× the tokens per equivalent content** vs English on current tokenizers (needs measurement on our actual model — first instrumentation task; `ai_interactions` columns already capture everything needed). Where it bites:
   - *Output tokens* (the expensive side): Arabic replies ≈ 2× output tokens for the same pedagogical content. Biggest single delta.
   - *Data block (input)*: Arabic LO descriptions + model answers ≈ 2× — but it's the **cached prefix**, so after turn 1 it's paid at cache-read rates. Modest.
   - *Thinking tokens*: unaffected by output language (model deliberates in its own representation); the 6k budget stands.
2. **Longer grounding units.** A narrative model answer with evidence is inherently longer than 4 lines of algebra. Partly offset: social-studies lessons are self-contained (few cross-lesson dependencies vs math's prerequisite chains) → the focus slice can be *tighter* than math's 8-LO window. Net: data block roughly comparable to math's in tokens, despite Arabic.
3. **Estimate: EGP 10–14 per learn lesson** (≈1.6–2× math) at identical quality settings, same caching discipline, same beat/turn caps. Review mode ≈ EGP 3–5.
4. **TTS is a new real cost line if voice is on:** a spoken learn lesson ≈ 3–5k Arabic chars → **Azure ≈ $0.05–0.08 ≈ EGP 2.5–4/lesson** (ElevenLabs would be EGP 8–20 — another reason for Azure).
5. **Ceiling honesty:** at EGP 10–14/lesson, the EGP 40/student/month ceiling buys ~3 lessons/month — **daily use blows the ceiling ~5–8×**, as math also would pre-optimization. Per Samuel's standing call (quality first, meters on) this is acceptable for PoC; the known levers, in order of impact: thinking budget ↓ (6k→2k measured on math at small quality cost), Haiku-class models for grading/audit passes, tighter slices, shorter review-mode sessions, batch/caching discipline (already in). None require architecture changes.
6. **Latency:** Arabic output ≈ 2× tokens ≈ 2× generation time per beat — the paced-reveal engine absorbs this (reveal is reading-cadence-gated, not stream-gated, and Arabic *reading* is also slower). Azure TTS adds ~300–800ms per beat, comparable to current neural TTS. No new latency theater needed.

---

## 7. Recommendations ranked by build effort

**Low (prompt/config only — days):**
1. Per-subject `LANGUAGE_CONTRACT` + Arabic system prompts (§2.1) with the outside-book refusal script (§3.2.3).
2. `[[term?:…]]` flag: prompt rule + `CiteKind` + review queue query (§2.3).
3. STT `ar-EG` + per-subject Web Speech voice pick + sanitizer parameterization (§5.2.3–5).
4. Bidi rendering guards: `dir="ltr"`/`unicode-bidi: isolate` on chips (§2.4). Parser: no work.

**Medium (schema + one provider + eval harness — ~1–2 weeks):**
5. Model-answer-with-evidence step shape + `facts` arrays + glossary extraction (§3.1, §2.2) — extraction-prompt and Pydantic work, no DB migration (same jsonb column).
6. Azure TTS provider + per-subject voice config (§5.2.1–2). Requires Azure account decision (new vendor, devops + security-privacy-officer touchpoint: what text leaves for synthesis — content only, no student PII in TTS payloads).
7. Trap eval set + fact-audit + citation/terminology checks wired into the qa harness (§3.4, §4c).

**High (pipelines at scale — the real cost of the subject):**
8. Page-fidelity second-reading pipeline over a 186-page scanned watermarked Arabic book (§4a) — the extraction+verification campaign itself, analogous to the math book's, with worse OCR conditions and no arithmetic oracle. This is where the schedule risk lives.
9. Cross-consistency fact table + conflict queue (§4b).
10. Free-text Arabic answer grading against model answers (needed the moment questions aren't MCQ) — a new judged surface with its own eval set; defer until question formats are decided.

**Open questions for Samuel:**
- Maps as figures: cropped page images (cheap, provenance-perfect, not interactive) vs a new map primitive (expensive, beautiful)? I lean cropped images for PoC.
- Voice default: is Salma (F) the tutor voice, or per-student choice Salma/Shakir?
- Does social studies enter the same Prep-3 PoC scope now, or wait for the grade-10 Bakaloreya source acquisition (PROJECT_STATE next-step 5)?
- Azure as a new vendor (TTS today, potentially STT later) — ADR-worthy if accepted.
