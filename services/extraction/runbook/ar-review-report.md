# Arabic full-book review — findings register (2026-07-30)

22-agent orchestrated audit: 20 independent per-lesson auditors (answers re-solved against the
PDF, provenance spot-checks, text fidelity), a pedagogical review of every prerequisite edge,
and a completeness critic over all 122 pages. Raw output: `runbook/ar-review.run.local.json`.

**Already fixed in the assembler** (2026-07-30): section-anchored page attribution for
vocab/إملاء rows · interactive `rule_ref` normalized to `gc:` ids · 14 book-order إملاء edges
dropped per the review veto · 4 derivational-morphology edges added (review proposal).

## Wrong answers / explanations flagged (all at review status — human gate items)

- **ara1-1** `q:ara1-1:q12` [medium]: تعليل إعراب «راغبين» في «يا راغبين في نهضةِ مصرَ» يقول: «منادى شبيه بالمضاف منصوب وعلامة نصبه الياء نائبة عن الفتحة لأنه ملحق بجمع المذكر السالم». لكن «راغبين» ليست من الملحقات بجمع المذكر السالم (كـ: أهلون، عالمون، سنون، بنون، أولو، ذوو)، بل هي جمع 
- **ara3-3** `q:ara3-3:q15` [medium]: The irab answer marks 'يزيد' (in 'الطالبُ يزيدُ يجب أن يزيد ثقافته بالقراءة') as مجرور بالفتحة, but in that sentence 'يزيد' (the proper name) functions as بدل/عطف بيان of 'الطالب' — a مبتدأ مرفوع with the definite article, which blocks إضافة, and no 
- **ara4-2** `q:ara4-2:q12` [medium]: الإجابة المرجعية «أميرُ الشُّعَراءِ أحمَد شوقي» (بضمة على أمير) لا تطابق الحركة الإعرابية الصحيحة كما وردت في السياق المطبوع، وهي فتحة لأنها اسم (لعلّ) منصوب.
- **ara5-2** `q:ara5-2:q06` [high]: مفتاح الإجابة يصنّف "فَيَا وَادِيَ الكِنَانَةِ" بأنه "تشبيه"، وهذا يخالف كتاب المدرسة ويناقض تفاعلًا آخر في نفس الملف.
- **ara5-2** `interactive hamza_seat item (content/ara5-2.json, lo:ara5-2-` [high]: مفتاح الإجابة يزعم أن مقعد الهمزة "سطر" بسبب أنها "متوسطة مفتوحة"، لكن الهمزة في السياق المجرور مكسورة، والقاعدة الصحيحة (كسر > سكون) تقتضي كتابتها على ياء، وهو ما يطابق تهجئة الكلمة الفعلية في نفس الملف.
- **ara6-1** `q:ara6-1:q11` [high]: مفتاح إجابة السؤال (نوع الأسلوب) خاطئ ومتناقض داخليًا: حقل answer.type = "أمر" لعبارة «رُفِعَتِ الْأَقْلَامُ، وَجَفَّتِ الصُّحُفُ»، بينما هذه جملة فعلية ماضية مبنية للمجهول (أسلوب خبري)، وليست أسلوب أمر بأي حال. وهذا يناقض حتى نص الحل المرافق لنفس ال
- **ara6-1** `q:ara6-1:q03` [high]: الإعراب الوارد لكلمة "المَسْعى" خاطئ نحويًا: يذكر أن علامة الجر "الألف الظاهرة"، بينما "المسعى" اسم مقصور (منتهٍ بألف لازمة)، وعلامة جره الصحيحة هي الكسرة المقدَّرة على الألف منع من ظهورها التعذر، وليست "الألف" ولا "ظاهرة". هذا خطأ في قاعدة أساسية من

## Re-run candidates (under-extraction confirmed by auditors + coverage oracle)

- `ara1-2` — 0 high finding(s), 3 uncovered printed item(s)
- `ara2-2` — 2 high finding(s), 1 uncovered printed item(s)
- `ara3-2` — 2 high finding(s), 3 uncovered printed item(s)
- `ara3-3` — 2 high finding(s), 1 uncovered printed item(s)
- `ara4-2` — 2 high finding(s), 1 uncovered printed item(s)
- `ara4-3` — 1 high finding(s), 3 uncovered printed item(s)
- `ara5-2` — 5 high finding(s), 0 uncovered printed item(s)
- `ara6-1` — 2 high finding(s), 2 uncovered printed item(s)
- `ara6-2` — 2 high finding(s), 1 uncovered printed item(s)
- `ara6-4` — 3 high finding(s), 1 uncovered printed item(s)

(ar-t1u2l3/ara2-3 lost its grammar+إملاء sections per the coverage oracle — re-run first.)

## Cross-subject bridge candidates (proposals ONLY — Samuel curates db/bridges.sql)

- `lo:ara2-2-1` ↔ `module:soc-t1-u4`: مرشّح جسر فقط، لا يُحمَّل بلا مراجعة بشرية: سيرة سميرة موسى (مواليد ١٩١٧) تقع في حقبة الاحتلال البريطاني، وربط قصتها بين العلم والنهضة الوطنية يوفر سياقًا طبيعيًا للتقاطع مع وحدة ا
- `lo:ara5-2-1` ↔ `module:soc-t1-u4`: مرشّح جسر فقط: قصيدة 'وادي الكنانة' نداء وطني صريح للنهوض والوحدة أمام التحديات، يتقاطع مباشرة مع محتوى وحدة التاريخ عن مصر والاستعمار ومحاولات التحرر — يحتاج تأكيدًا بشريًا لملاءم
- `lo:ara6-3-1` ↔ `module:soc-t1-u3`: مرشّح جسر فقط: موضوع 'حب الوطن' يصلح للربط بوحدتي التاريخ عن مصر (الحكم العثماني ثم الزحف الاستعماري)، بحيث يُثري النص الأدبي بخلفية تاريخية زمنية حقيقية — الاختيار بين الوحدتين يح
- `lo:ara6-4-1` ↔ `module:u2`: مرشّح جسر فقط: نص 'المشروعات الصغيرة' يناقش الإنتاج والتصدير والتكلفة، سياق واقعي مباشر لتطبيق دروس الرياضيات في وحدة 'النسبة والتناسب والتناسب الطردي والعكسي' (حساب نسب الربح/التك

## Completeness gaps (conveyor backlog for the next iteration)

- [high] أهداف الوحدة (unit-opener objectives page, 11–14 outcomes) is 100% uncovered — every one of the 6 unit-opener pages falls in the single-page gap immediately before that unit's first lesson, and no nod — طبعة الفصل الأول: صفحات مطبوعة ٧، ٢٤، ٤١ (= pdf 8, 25, 42). طبعة الفصل الثاني: ص
  - fix: أضِف نوع عقدة جديد (unit_objective أو ملحق على عقدة module) يلتقط أهداف الوحدة الـ١١-١٤ لكل وحدة، ووسّع جدول مدى الصفحات بحيث يضم صفحة الافتتاحية ضمن نطاق الدرس الأول التالي لها (أ
- [high] حقل enrichment (يغطي اقرأ واستمتع / قرأت لك) مُثبَّت فارغًا (`"enrichment": [], "misconceptions": []`) في الكود نفسه — ليس خطأ استخراج لكل درس بل جذع غير موصول في المُجمِّع (assembler)؛ كل الدروس العش — services/extraction/assemble_arabic.py:850 (السطر البرمجي)؛ كل ملفات seed/conten
  - fix: وصل استخراج صندوقي «اقرأ واستمتع» و«قرأت لك» فعليًا في الـconveyor بدل القيمة الفارغة الثابتة، وأضف قاعدة تدقيق آلية (audit_arabic.py) تفشل إذا وُجد صندوق قراءة إثرائية في مصدر الص
- [medium] حقل misconceptions مُثبَّت فارغًا بنفس السطر البرمجي — لا يوجد أي محتوى «مفاهيم خاطئة شائعة» في أي من الدروس العشرين، وهو عنصر مهم لحلقة «شرح كل خطأ خطوة بخطوة» في PRD. — services/extraction/assemble_arabic.py:850؛ كل ملفات seed/content/ara*.json (٢٠/
  - fix: تأكيد مع سامويل: هل هذا استبعاد MVP مقصود (ويُوثَّق كـADR) أم فجوة تحتاج جولة استخراج تالية؛ إن كان مقصودًا فوثّقه صراحة بدل تركه صامتًا في الكود.
- [medium] نمط ملخص التدقيق (٢٠/٢٠ دروس بها ISSUES، بلا درس نظيف واحد، من ٢ إلى ٩ ملاحظات، بمتوسط ≈٥.٨٥) يشي بعيب على مستوى خط الإنتاج لا بأخطاء متفرقة لكل درس — توافق مباشر مع اكتشاف حقلي enrichment/misconcepti — ملخص التدقيق المُعطى: ara1-1..ara6-4، جميعها ISSUES؛ حالتا الشذوذ ara5-3 (٢) وar
  - fix: صنّف ملاحظات التدقيق العشرين حسب الفئة (لا العدد فقط) لمعرفة أي نسبة تُفسَّر بسبب جذري واحد (enrichment/misconceptions الفارغين)؛ إن كانت الغالبية، فإصلاح المُجمِّع مرة واحدة يحل م
- [low] مقدّمات الكتاب (غلافان، المقدمة، فهرس كل فصل) وخاتمته (رقم الإيداع، المواصفات الفنية، غلاف خلفي) خارج أي نطاق درس — وهذا سليم ومتوقَّع، لا فقدان صفحات حقيقي هنا؛ التحقق الحسابي (٨+٥٤+٢+١+١+٥٣+٣ = ١٢٢) — pdf 1-7، pdf 63-65، pdf 120-122.
  - fix: لا حاجة لعمل — يُوثَّق فقط كي لا يُعاد الإبلاغ عنه كفجوة في جولة تدقيق قادمة.
- [low] رمز QR «لمزيد من التدريبات يرجى الدخول على الموقع الإلكتروني للوزارة» يتكرر في نهاية معظم الدروس، ويشير لموقع خارجي غير قابل للاستخراج من الـPDF نفسه. — متكرر في آخر صفحة لمعظم الدروس (مثال: مطبوع ٤٠، ٥٨، ٦١ بالفصل الأول، ونظيرها بال
  - fix: لا إجراء استخراجي مطلوب؛ يمكن فقط تدوين وجود تدريبات إلكترونية تكميلية في البيانات الوصفية للدرس لأغراض المنتج فقط.

## Per-lesson verdicts

- `ara1-1`: ISSUES — 1 high, 4 medium, 1 low
- `ara1-2`: ISSUES — 5 medium
- `ara1-3`: ISSUES — 1 high, 6 medium, 1 low
- `ara2-1`: ISSUES — 1 high, 3 medium, 1 low
- `ara2-2`: ISSUES — 2 high, 1 medium, 1 low
- `ara2-3`: ISSUES — 1 high, 2 medium, 1 low
- `ara2-4`: ISSUES — 1 high, 6 medium
- `ara3-1`: ISSUES — 1 high, 3 medium, 1 low
- `ara3-2`: ISSUES — 2 high, 4 medium, 1 low
- `ara3-3`: ISSUES — 2 high, 4 medium, 3 low
- `ara4-1`: ISSUES — 4 medium, 1 low
- `ara4-2`: ISSUES — 2 high, 4 medium, 1 low
- `ara4-3`: ISSUES — 1 high, 2 medium, 1 low
- `ara5-1`: ISSUES — 1 high, 4 medium, 1 low
- `ara5-2`: ISSUES — 5 high, 3 medium
- `ara5-3`: ISSUES — 1 high, 1 medium
- `ara6-1`: ISSUES — 2 high, 2 medium, 2 low
- `ara6-2`: ISSUES — 2 high, 3 medium, 1 low
- `ara6-3`: ISSUES — 1 high, 1 medium
- `ara6-4`: ISSUES — 3 high, 3 medium, 3 low
