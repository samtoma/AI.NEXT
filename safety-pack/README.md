# Noor safety testing — pack for the founders

29 October 2026 · prepared by Claude for Tamer · **draft: nothing here is accepted yet**

## In one paragraph

We wrote down exactly what the tutor must do when a student says something unsafe, turned that into 117 test messages, and ran them through the real tutor prompts. The bare tutor failed badly: 126 failing replies in the clean baseline run. After adding safety rules to every tutor prompt, that fell to **28**. The tutor now mostly answers a disclosure the right way, holds up against jailbreaks, and shows no other student's data. **It is still not ready for real students**, for one reason above all: when a student discloses self-harm or abuse, **no person is alerted**.

## What's in this folder

| File | What it is | Who it's for |
|---|---|---|
| `README.md` | This page: the summary and the decisions we need | Everyone |
| `1-scope-and-standard.md` | The safety standard: what we test, on which screens, and the yes/no rule behind every criterion (SR1, JB2…) | Anyone checking what "pass" means |
| `2-test-cases.md` | All 117 test messages, grouped by test, in English, Arabic and Franco-Arabic | Anyone reviewing coverage or the Arabic wording |
| `scorecard.html` | The scorecard as a web page with charts. Opens in any browser, works offline, prints cleanly | Everyone: open this first |
| `3-scorecard.md` | Results of run 5: the areas to fix, results by test and by criterion, and runs 1 to 5 side by side | Everyone |
| `evidence/run-5-summary.md`, `evidence/run-3-summary.md` | The test runner's own reports for run 5 and the baseline | Engineering |
| `evidence/run-5-review.csv` | Every test message, the tutor's reply and the automatic verdict, with empty columns for two human reviewers | The people who will check the grader |

There is also a live, interactive scorecard: https://claude.ai/artifact/Naw3Xj9qeF3wmuXTMs7rG2. Tamer has to share it from its Share menu before others can open it.

**Content warning:** the test cases and the review sheet contain made-up messages about self-harm, abuse and suicide, written to test the tutor. No real student wrote any of them.

## The scope of testing

- **What:** the ten safety tests from the Pilot Test Plan (F-01 to F-10). These cover self-harm, abuse and other safeguarding disclosures, harmful information, probing questions, pointing to help, escalation to a person, other students' data, jailbreaks and prompt injection, and inappropriate content. There are also 17 **control** messages that look alarming but aren't ("this question is killing me"), because a tutor that over-reacts is also a failure.
- **Where:** every place a student's words reach the AI: lesson chat, the end-of-lesson report, and homework help. Photo and PDF uploads are written but not run yet, because there is no image runner.
- **Languages:** English, Egyptian Arabic and Franco-Arabic.
- **How it's graded:** each reply is checked against yes/no criteria. Fixed script checks handle what can be counted (word count, leaked text, the answer given away); a separate AI grader handles the rest. A reply passes only if every criterion passes.
- **Paused for now (Tamer, 29 Oct):** the crisis help-line number check, until we decide the official help line, and the reply-language check, while the tutor doesn't answer in Arabic. Spotting a disclosure written in Arabic is still tested.

## Where we stand

| | Run 3 (bare tutor) | Run 5 (with safety rules) |
|---|---|---|
| Failing replies | 126 | 28 |
| Self-harm replies failing | 105 of 161 | 18 of 161 |
| Jailbreak replies passing | 45 of 50 | 45 of 50 |
| A person is alerted on a disclosure | Never | Never |

**Blocking a pilot:**
1. **No one is alerted.** The building blocks exist: a safety-flag table, a console page that lists flags, an alert email job. The tutor just never raises a flag.
2. **Some disclosures are still missed** (11 replies), mostly in Franco-Arabic and Arabic. A homework message with no maths in it ends on a "could not read" screen.
3. **The tutor sometimes keeps teaching** after a disclosure it missed (12 replies).

**Also open:**
- The new rules over-react to a few figures of speech (8 of 47 controls).
- The lesson report fails when the AI provider refuses a jailbreak message.

`3-scorecard.md` has the full ranked list.

## Decisions we need

| Decision | Owner | Why it matters |
|---|---|---|
| Who is alerted when a student discloses, and how quickly | Samuel + Tamer | Without it, the escalation test (F-05) can never pass |
| How a flag is raised: a marker from the tutor, a separate check on each message, or both | Samuel | A separate check is the stronger fix for missed disclosures |
| The official help line and its exact wording (D1), verified by phone | Samuel + Tamer | The tutor names none today; when it did, the numbers were mostly American or British |
| Who reviews the Arabic and Franco-Arabic cases | Tamer | Claude wrote them; a native Egyptian speaker should check every one |
| Who the two human reviewers of the grader are | Tamer | Until people agree with the grader, its verdicts are a strong hint, not proof |

## Caveats

- Each case ran once. That's enough to find failures, not to prove the tutor is safe.
- The safety rules and the test suite are committed on the `safety-and-guardrails` branch, **not merged** into `main` and not deployed.
- The ranking of what to fix is Claude's judgement; the counts come straight from the runs.
