# Errata found in the Grade 10 maths book while checking the question bank

Source book: Everything Maths, Grade 10 (Siyavula), the copy in `docs/Source`. Written by the AI checking line on 2026-10-01, from its own working through each
question. **No person has read this yet.** Where a line says a plain computer check agrees, the app's own answer marker compared the book's answer with the
expression in the question and found them different; every other finding rests on the AI's own working (a second AI re-did the working only for questions it
wanted to put live). Treat each entry as a lead to confirm against the printed page, not as a ruling.

Nothing here changed the book's answers. A question whose printed answer is wrong was left out of the question bank rather than corrected. A question whose text
lost something in extraction (a missing sign or exponent) is listed with the repair, if there was one.

So far: **102** printed answers that look wrong and **20** questions whose text lost or garbled something, in chapters 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14.

*Regenerated 2026-10-02 (the opening paragraph above still carries the generator's original 2026-10-01 date) from every chapter's G2 recommendation run, chapters 1-7 and 9-14, with
`uv run auto_pass_gates.py g2-recommend-errata g10-math --chapter N ... --out ../../docs/WIP-g10-pilot/errata-g10.md` (from `services/extraction/`). Chapters 1-6 and 9 are unchanged from the
2026-10-01 version (74 and 10); chapters 7, 10, 11, 12, 13 and 14 are new in this list. **Chapter 8 (the pilot) is not in it**: it has no recommendation run, because Samuel decided its G2 himself
(decisions 39-45), and the tool refuses a chapter with no G2 record. Do not hand-edit this file: the next regeneration overwrites it.*

## Chapter 1 — Algebraic expressions


### The book's printed answer is wrong (27)


**Exercise 1-1, question 7e**, page 11

- The question as we have it: Consider the following list of numbers: $-3\;;\;0\;;\;\sqrt{-1}\;;\;-8\frac{4}{5}\;;\;-\sqrt{8}\;;\;\frac{22}{7}\;;\;\frac{14}{0}\;;\;7\;;\;\text{1,}\overline{34}\;;\;\text{3,3231089...}\;;\;3+\sqrt{2}\;;\;9\frac{7}{10}\;;\;\pi\;;\;11$ Which of the numbers are: integers
- The book's answer: -3; 7; 11
- What is wrong: The book's list of integers omits 0, although its own set {...;-3;-2;-1;0;1;2;3;...} contains 0. The key -3; 7; 11 would mark a correct answer wrong.
- The right answer (our own working, not applied to the book): -3; 0; 7; 11
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-3, question 2d**, page 16

- The question as we have it: Estimate the following surds to the nearest $\text{1}$ decimal place, without using a calculator. $\sqrt{90}$
- The book's answer: \text{3,5}
- What is wrong: The book answer 3,5 is wrong. The working moves from 'between 9 and 10' to 'between 3 and 4'. The right estimate is 9,5.
- The right answer (our own working, not applied to the book): 9,5
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-4, question 2v**, page 18

- The question as we have it: Expand the following products: $(3x+2)(3x-2)(9x^2-4)$
- The book's answer: $81x^{4}-72x+16$
- What is wrong: The book drops the exponent on the middle term: $-36x^2-36x^2$ is printed as $-36x-36x$, giving $-72x$ instead of $-72x^2$.
- The right answer (our own working, not applied to the book): 81x^4-72x^2+16
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-4, question 3d**, page 18

- The question as we have it: Expand the following products: $2(x-2y)(x^2+xy+y^2)$
- The book's answer: $2x^{3}-2x^{2}y-2xy^{2}-2y^{3}$
- What is wrong: The working's second line has $-y^3$ where it should be $-2y^3$, so the final $-2y^3$ should be $-4y^3$.
- The right answer (our own working, not applied to the book): 2x^3-2x^2y-2xy^2-4y^3
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-4, question 3i**, page 18

- The question as we have it: Expand the following products: $\left(\dfrac{x}{3}-\dfrac{3}{x}\right)\left(\dfrac{x}{4}+\dfrac{4}{x}\right)$
- The book's answer: x2 12 + 7 12 + 3 x2
- What is wrong: The sign of the last term is wrong in the book's working ($+12/x^2$), and the final line then changes it to $+3/x^2$. The right term is $-12/x^2$.
- The right answer (our own working, not applied to the book): x^2/12 + 7/12 - 12/x^2
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-5, question 15**, page 21

- The question as we have it: Factorise: $7a+4$
- The book's answer: $7a+4$
- What is wrong: Question asks to factorise an irreducible binomial; the book's answer is the unchanged expression, not a product.
- The right answer (our own working, not applied to the book): 7a+4 (cannot be factorised)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-6, question 14**, page 22

- The question as we have it: Factorise: $16k^{2}-4$
- The book's answer: $(4k-2)(4k+2)$
- What is wrong: Printed answer and working stop at (4k-2)(4k+2); a factor 2 remains in each bracket, so it is not fully factorised.
- The right answer (our own working, not applied to the book): 4(2k-1)(2k+1)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-8, question 11**, page 27

- The question as we have it: Factorise the following: $2x^{2}-22x+20$
- The book's answer: $2(x+1)(x+10)$
- What is wrong: Book working and printed answer solve $2x^2+22x+20$; the stem reads $2x^2-22x+20$. Sign of the middle term differs between question and working.
- The right answer (our own working, not applied to the book): 2(x-1)(x-10)
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-8, question 21**, page 27

- The question as we have it: Factorise the following: $98x^{4}+14x^{2}-4$
- The book's answer: $2((7x+2)(7x-1))$
- What is wrong: Book's working loses the exponents (x^2 became x) and flips the sign of the middle term inside the bracket; its answer expands to a quadratic, not the stem's quartic.
- The right answer (our own working, not applied to the book): 2(7x^2+2)(7x^2-1)
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-9, question 17**, page 30

- The question as we have it: Factorise: $8j^{3}k^{3}l^{3}-b^{3}$
- The book's answer: (2jkl −b)(4j2k2l2 + 2jklabc + b2)
- What is wrong: Printed answer and working carry the middle term 2jklabc where it should be 2jklb; the book's key is wrong and the typed key is not the book's answer.
- The right answer (our own working, not applied to the book): (2jkl-b)(4j^2k^2l^2+2jklb+b^2)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-9, question 24**, page 30

- The question as we have it: Factorise: $1-(x-y)^{3}$
- The book's answer: $(1-x+y)(1-x+y+x^{2}-2xy+y^{2})$
- What is wrong: Second factor should be $1+(x-y)+(x-y)^2$; the book applied the sum-of-cubes pattern $1-(x-y)+(x-y)^2$ to a difference of cubes.
- The right answer (our own working, not applied to the book): (1-x+y)(1+x-y+x^2-2xy+y^2)
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 1k**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{b^2-81a^2}{18a-2b}$
- The book's answer: $-\frac{b+9}{2}$
- What is wrong: Book working writes (b-9)(b+9) and 2(9-b), losing the factor a; its answer lacks a in the numerator.
- The right answer (our own working, not applied to the book): -\frac{b+9a}{2}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 2g**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{24a-8}{12}\div\dfrac{9a-3}{6}$
- The book's answer: $=\frac{4(3a-1)}{3(a-1)}$
- What is wrong: Working line 1 factorises $9a-3$ as $3(a-1)$; it is $3(3a-1)$. The answer $\frac{4(3a-1)}{3(a-1)}$ is wrong; the right value is $4/3$ (with restriction $a\ne\frac13$).
- The right answer (our own working, not applied to the book): \frac{4}{3}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 2j**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{5ab-15b}{4a-12}\div\dfrac{6b^{2}}{a+b}$
- The book's answer: $=\frac{30b^{3}}{4(a+b)}$
- What is wrong: Book's final step $\frac{[5b][a+b]}{[4][6b^2]}$ is written as $\frac{30b^3}{4(a+b)}$, which swaps parts; correct is $\frac{5(a+b)}{24b}$.
- The right answer (our own working, not applied to the book): \frac{5(a+b)}{24b}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 3h**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{5}{t-2}-\dfrac{1}{t-3}$
- The book's answer: $=\frac{4t-12}{(t-2)(t-3)}$
- What is wrong: Line 2 of the working writes $5(t-3)-(t-3)$; it should be $5(t-3)-(t-2)$. Correct numerator $4t-13$.
- The right answer (our own working, not applied to the book): \frac{4t-13}{(t-2)(t-3)}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 3i**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{k+2}{k^{2}+2}-\dfrac{1}{k+2}$
- The book's answer: $=\frac{2(k+2)}{(k^{2}+2)(k+2)}$
- What is wrong: Working line 4 gives $4k+2$ but line 5 factors it as $2(k+2)$; it is $2(2k+1)$.
- The right answer (our own working, not applied to the book): \frac{2(2k+1)}{(k^2+2)(k+2)}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 3l**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{x}{x+y}+\dfrac{x^{2}}{y^{2}-x^{2}}$
- The book's answer: $=\frac{2x^{2}-xy}{(x+y)(x-y)}$
- What is wrong: Working line 1 factorises $y^2-x^2$ as $(x+y)(x-y)$; that is $x^2-y^2$. Correct answer $\frac{xy}{(x+y)(y-x)}$.
- The right answer (our own working, not applied to the book): \frac{-xy}{(x+y)(x-y)}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 3n**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{h}{h^{3}-f^{3}}-\dfrac{1}{h^{2}+hf+f^{2}}$
- The book's answer: $=\frac{f}{(h+f)(h^{2}+hf+f^{2})}$
- What is wrong: Book's second working line writes (h+f) in the denominator where (h-f) belongs; h^3-f^3=(h-f)(h^2+hf+f^2). The printed answer and EPUB final repeat the error.
- The right answer (our own working, not applied to the book): \frac{f}{(h-f)(h^{2}+hf+f^{2})}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 21d**, page 38

- The question as we have it: Estimate the following surds to the nearest $\text{1}$ decimal place, without using a calculator. $\sqrt{57}$
- The book's answer: 4,5 or 4,6
- What is wrong: The book's answer 4,5 or 4,6 contradicts its own bracket (between 7 and 8). The value is about 7,5, and the book also accepts two answers.
- The right answer (our own working, not applied to the book): 7,5 (or 7,6 as a rough estimate)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 23f**, page 38

- The question as we have it: Expand the following: $(3a-5b)(3a+5b)(a^2+ab-b^2)$
- The book's answer: $9a^{4}+9a^{3}-34a^{2}b^{2}+25ab^{3}-25b^{4}$
- What is wrong: Book working line 2 writes 9a^3 (lost b), +25ab^3 and -25b^4 where the product gives 9a^3b, -25ab^3 and +25b^4; the printed answer repeats it.
- The right answer (our own working, not applied to the book): 9a^4+9a^3b-34a^2b^2-25ab^3+25b^4
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 23h**, page 38

- The question as we have it: Expand the following: $\left(\dfrac{a}{3}-\dfrac{3}{a}\right)\left(\dfrac{a}{3}+\dfrac{3}{a}\right)$
- The book's answer: $\frac{a^2}{9}-\frac{3}{a^2}$
- What is wrong: Book squares 3/a as 3/a^2 instead of 9/a^2; the printed answer and EPUB answer both carry the error.
- The right answer (our own working, not applied to the book): \frac{a^2}{9}-\frac{9}{a^2}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 25b**, page 38

- The question as we have it: In $(x+2)(x+k)=x^2+bx+c$ : For which of these values of $k$ will $c$ be positive? $-6;-1;0;1;6$
- The book's answer: $0\;;\;1\;;\;6$
- What is wrong: Book includes k=0, which gives c=0 (not positive); the book's own reasoning (any positive k) contradicts its answer.
- The right answer (our own working, not applied to the book): 1; 6
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 26a**, page 38

- The question as we have it: Answer the following: Expand: $\left(3a-\dfrac{1}{2a}\right)^2$
- The book's answer: $9a^2+3+\frac{1}{4a^2}$
- What is wrong: Book's middle term is +3; the cross term of a difference squared is -3.
- The right answer (our own working, not applied to the book): 9a^2-3+\frac{1}{4a^2}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 29n**, page 39

- The question as we have it: Factorise: $x^{2}-2x+1-y^{4}$
- The book's answer: $x(x-2)+(1+y)(1-y)(1+y^{2})$
- What is wrong: Book groups x^2-2x as x(x-2) and leaves a sum; the expression is a difference of squares after (x-1)^2, so the answer is not factorised.
- The right answer (our own working, not applied to the book): (x-1-y^2)(x-1+y^2)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 30k**, page 39

- The question as we have it: Factorise the following: $16x^6-3y^8$
- The book's answer: $4(4x^{3}-3y^{4})(4x^{3}+3y^{4})$
- What is wrong: Step 16x^6-3y^8 = 4(4x^6-9y^8) is false (gives 16x^6-36y^8); likely a printing error for 16x^6-9y^8, but the working does not prove it.
- The right answer (our own working, not applied to the book): (4x^3-\sqrt{3}y^4)(4x^3+\sqrt{3}y^4)
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 31k**, page 39

- The question as we have it: Simplify the following: $\dfrac{a-2}{a^2+4a+3}\div\dfrac{(a-1)(a+1)}{a-1}\times\dfrac{a^2-2a-15}{a-2}$
- The book's answer: \frac{a-5}{(a+2)^{2}}
- What is wrong: Book's last working line gives (a+2)^2; its own line 3 leaves (a+1) twice in the denominator, so the answer is (a+1)^2. Printed answer and EPUB final repeat the error.
- The right answer (our own working, not applied to the book): \frac{a-5}{(a+1)^{2}}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-11, question 31l**, page 39

- The question as we have it: Simplify the following: $\dfrac{a+6}{a^2+12a+11}\times\dfrac{a^2+14a+33}{a+3}\div\dfrac{a^3+216}{a+1}$
- The book's answer: \frac{1}{a^2+6a+36}
- What is wrong: Book's working factors a^3+216 as (a+6)(a^2+6a+36); the correct factor is a^2-6a+36 (sum of cubes), so the final answer has the wrong sign on 6a.
- The right answer (our own working, not applied to the book): \frac{1}{a^{2}-6a+36}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (6)


**Exercise 1-1, question 1b**, page 11

- The question as we have it: The figure here shows the Venn diagram for the special sets $\mathbb{N},\mathbb{N}_0$ and $\mathbb{Z}$ . [figure] In the following list, there are two false statements and one true statement. Which of the statements is true? Every integer is a natural number. Every natural number is a whole number.…
- The book's answer: (ii)
- What is wrong: As the student reads it, statement 3 'There are no decimals in the whole numbers' is TRUE (whole numbers are 0, 1, 2, ...), so (ii) and (iii) are both true, contradicting 'two false, one true'. The book's own working calls it false ('there cannot be any decimal numbers ... making this false'), so t…
- The right answer (our own working, not applied to the book): Book key is (ii) 'Every natural number is a whole number', but (iii) as typed is also true
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-1, question 2b**, page 11

- The question as we have it: The figure here shows the Venn diagram for the special sets $\mathbb{N},\mathbb{N}_0$ and $\mathbb{Z}$ . [figure] In the following list, there are two false statements and one true statement. Which of the statements is true? Every integer is a natural number. Every whole number is an integer. There…
- The book's answer: (ii)
- What is wrong: As typed, statement 3 'There are no decimals in the whole numbers' is TRUE, so (ii) and (iii) are both true; the book's working calls it false. The working also reverses the nesting ('the circle Z is inside N0'; in fact N0 is inside Z) and its reason for (ii) does not follow. Labels (i)(ii)(iii) ar…
- The right answer (our own working, not applied to the book): Book key is (ii) 'Every whole number is an integer', but (iii) as typed is also true
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 1-10, question 2o**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{a^2-2a+8}{a^2+6a+8}\times\dfrac{a^2+a-12}{3}-\dfrac{3}{2}$
- The book's answer: $=\frac{2a^2-14a+15}{6}$
- What is wrong: Stem shows $a^2-2a+8$; working factorises it as $(a-4)(a+2)=a^2-2a-8$, so a sign was lost. With $-8$: result $\frac{(a-4)(a-3)}{3}-\frac{3}{2}=\frac{2a^2-14a+15}{6}$, matching the key.
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **live, with the question text repaired** to: Simplify (assume all denominators are non-zero): $\dfrac{a^2-2a-8}{a^2+6a+8}\times\dfrac{a^2+a-12}{3}-\dfrac{3}{2}$. Marked as an AI repair for you to review.

**Exercise 1-10, question 2p**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{4x^2-1}{3x^2+10x+3}\div\dfrac{6x^2+5x+1}{4x^2+7x-3}\times\dfrac{9x^2+6x+1}{8x^2-6x+1}$
- The book's answer: $=1$
- What is wrong: As shown, $4x^2+7x-3$ does not factor as $(x+3)(4x-1)$ (that is $4x^2+11x-3$), so the stem gives no constant. The working's factors show the intended $4x^2+11x-3$; with it the product is $1$, matching the key.
- In the question bank: **live, with the question text repaired** to: Simplify (assume all denominators are non-zero): $\dfrac{4x^2-1}{3x^2+10x+3}\div\dfrac{6x^2+5x+1}{4x^2+11x-3}\times\dfrac{9x^2+6x+1}{8x^2-6x+1}$. Marked as an AI repair for you to review.

**Exercise 1-10, question 3t**, page 34

- The question as we have it: Simplify (assume all denominators are non-zero): $\dfrac{1}{a^2-4ab+4b^2}+\dfrac{a^2+2ab+b^2}{a^3-8b^3}-\dfrac{1}{a^2-4b^2}$
- The book's answer: \frac{a^{2}+4b-4b^{2}}{(a-2b)^{2}(a+2b)}
- What is wrong: As printed ($b^2$), the key fails (at $a=3,b=1$: $156/95$ vs $9/5$). With $4b^2$, which the working's line 2 uses, the key is right: $1+1-1/5=9/5$. Repair the stem by one character group; key unchanged.
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **live, with the question text repaired** to: Simplify (assume all denominators are non-zero): $\dfrac{1}{a^2-4ab+4b^2}+\dfrac{a^2+2ab+4b^2}{a^3-8b^3}-\dfrac{1}{a^2-4b^2}$. Marked as an AI repair for you to review.

**Exercise 1-11, question 31m**, page 39

- The question as we have it: Simplify the following: $2\div\dfrac{a+b}{a+2b}\times\dfrac{b^2-ba-6a^2}{a^2-4b^2}\times\dfrac{a^2-b-2b^2}{3a-b}$
- The book's answer: -2(2a+b)
- What is wrong: With $a^2-ab-2b^2=(a-2b)(a+b)$ and $b^2-ba-6a^2=(b-3a)(b+2a)$, factors cancel leaving $2(b-3a)(b+2a)/(3a-b)=-2(2a+b)$. As printed, $a^2-b-2b^2$ does not factor and the key fails. Repair one lost letter.
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **live, with the question text repaired** to: Simplify the following: $2\div\dfrac{a+b}{a+2b}\times\dfrac{b^2-ba-6a^2}{a^2-4b^2}\times\dfrac{a^2-ab-2b^2}{3a-b}$. Marked as an AI repair for you to review.

## Chapter 2 — Exponents


### The book's printed answer is wrong (4)


**Exercise 2-1, question 38**, page 49

- The question as we have it: Simplify without using a calculator: $\dfrac{7^{b}+7^{b-2}}{4\times7^{b}+3\times7^{b}}$
- The book's answer: \frac{51}{49}
- What is wrong: Book adds $1+\frac{1}{49}$ and gets $\frac{51}{49}$; the sum is $\frac{50}{49}$. The stem also lost a minus sign in the denominator (working has $4\times7^b-3\times7^b$).
- The right answer (our own working, not applied to the book): \frac{50}{343} for the stem as printed
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 2-1, question 39**, page 49

- The question as we have it: Simplify without using a calculator: $\dfrac{12^{y}-96^{y}}{3^{y}+6^{y}}$
- The book's answer: \frac{4^{y}-2^{5y}}{3}
- What is wrong: Book writes $3^y+6^y=3^y(2+1)$; it should be $3^y(1+2^y)$. The denominator 3 in the printed answer is wrong.
- The right answer (our own working, not applied to the book): \frac{4^{y}-2^{5y}}{1+2^{y}}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 2-2, question 9**, page 51

- The question as we have it: Simplify without using a calculator: $\left(16x^{12}b^6\right)^{\frac{1}{3}}$
- The book's answer: 2\cdot2^{\frac{1}{3}}a^{4}b^{2}
- What is wrong: The book's answer (and working) write a^4 instead of x^4: the variable a does not occur in the stem. Correct answer is 2\cdot2^{1/3}x^4b^2. A person can decide whether to correct the typo.
- The right answer (our own working, not applied to the book): 2\cdot2^{\frac{1}{3}}x^{4}b^{2}
- A plain computer check, with no AI in it, agrees: the book's answer is not equal to the expression in the question.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 2-4, question 3p**, page 57

- The question as we have it: Solve: $\dfrac{16^x-1}{4^2x+1}=3$
- The book's answer: x = \frac{1}{2}
- What is wrong: The stem as printed ($16^x-1$ over $4^2x+1$) does not give $x=\frac12$. The working's first line repeats the same text, then silently uses $(4^{2x}-1)(4^{2x}+1)$ in the numerator. The book's stem is wrong, or its working is.
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 3 — Number patterns


### The book's printed answer is wrong (2)


**Exercise 3-2, question 8b**, page 68

- The question as we have it: Find the sixth term in each of the following sequences: $5\;;\;2\;;\;-1\;;\;-4\;;\;\ldots$
- The book's answer: $T_{6}=-11$
- What is wrong: The book writes $T_n=5+(-3)(n-1)=7-3n$. The correct simplification is $8-3n$. So $T_6=-10$, not $-11$.
- The right answer (our own working, not applied to the book): -10
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 3-2, question 12a**, page 69

- The question as we have it: Study the following sequence $-7\;;\;-21\;;\;-35\;;\;\ldots$ Write down the next $\text{3}$ terms:
- The book's answer: -49;-63;77
- What is wrong: Book's printed answer and working give the third term as +77; the sequence has common difference -14, so it should be -77 (sign lost).
- The right answer (our own working, not applied to the book): -49; -63; -77
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (1)


**Exercise 3-2, question 4**, page 68

- The question as we have it: Consider the list shown here: $2;7;12;17;22;27;32;37;\ldots$ If $T_{5}=\text{22}$ what is the value of $T_{n-3}$ ?
- The book's answer: $T_{n-3}=7$
- What is wrong: The stem says $T_5=22$ and never says $n=5$. As written, $T_{n-3}$ is the general term shifted, $5(n-3)-3=5n-18$. The book's 7 holds only if $n=5$.
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 4 — Equations and inequalities


### The book's printed answer is wrong (14)


**Exercise 4-2, question 3b**, page 81

- The question as we have it: Solve the following equations (note the restrictions that apply): $\dfrac{10z}{3}=1-\dfrac{1}{3z}$
- The book's answer: therefore z=-\frac{1}{5} or z=\frac{1}{2}
- What is wrong: Book factorises 10z^2-3z+1 as (5z+1)(2z-1), which equals 10z^2-3z-1; the roots -1/5 and 1/2 do not satisfy the stem (a sign was lost in the stem or the working).
- The right answer (our own working, not applied to the book): No real solution
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-3, question 4m**, page 89

- The question as we have it: Solve for $x$ and $y$ : $3a+b=\dfrac{6}{2a}$ and $3a^2=3-ab$
- The book's answer: $a$ and $b$ can be any real number except for $0$.
- What is wrong: The book rightly shows the two equations are identical, but its conclusion 'a and b can be any real number except 0' is wrong. b is fixed by a, and b=0 is allowed (a=1 or -1). The stem also asks for x and y while the equations use a and b.
- The right answer (our own working, not applied to the book): Infinitely many solutions: $b=\frac{3}{a}-3a$ for any $a\neq0$
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-4, question 21**, page 94

- The question as we have it: Lisa has 170 beads. She has blue, red and purple beads each weighing $\text{13}$ $\text{g}$ , $\text{4}$ $\text{g}$ and $\text{8}$ $\text{g}$ respectively. If there are twice as many red beads as there are blue beads and all the beads weigh $\text{1,216}$ $\text{kg}$ , how many beads of each type d…
- The book's answer: 48 blue beads, 96 red beads and 36 purple beads,
- What is wrong: The book's own working gives z=170-3x=26, but its final sentence and printed answer state 36 purple beads, which breaks the 170 total. The typed key 48; 96; 36 carries the error.
- The right answer (our own working, not applied to the book): 48 blue, 96 red and 26 purple beads
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-5, question 13**, page 95

- The question as we have it: Solve for $r$ : $A=\piR^{2}-\pir^{2}$ .
- The book's answer: $r=\pm\sqrt{\frac{A-\pi R^{2}}{\pi}}$
- What is wrong: Line 2 of the working has $A-\pi R^2=\pi r^2$, but moving $\pi r^2$ and $A$ across gives $\pi R^2-A=\pi r^2$. The printed and EPUB answers inherit the sign error.
- The right answer (our own working, not applied to the book): r=\pm\sqrt{\frac{\pi R^{2}-A}{\pi}}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-6, question 1a**, page 100

- The question as we have it: Look at the number line and write down the inequality it represents. [figure]
- The book's answer: $x<-1\text{ and }x\geq6;x\in\mathbb{R}$
- What is wrong: The book joins the two rays with 'and' where the figure needs 'or' (union). As written the answer is the empty set.
- The right answer (our own working, not applied to the book): x<-1 or x\geq 6; x\in\mathbb{R}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-6, question 2i**, page 100

- The question as we have it: Solve for $x$ and represent the answer on a number line and in interval notation. $\dfrac{5x-1}{-6}\ge\dfrac{1-2x}{3}$
- The book's answer: $[-1;\infty)$
- What is wrong: The book multiplies both sides by $-6$ but does not reverse the inequality sign, so the interval points the wrong way.
- The right answer (our own working, not applied to the book): (-\infty;-1]
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-6, question 2j**, page 100

- The question as we have it: Solve for $x$ and represent the answer on a number line and in interval notation. $3\le4-x\le16$
- The book's answer: $[1;12]$
- What is wrong: The book's working ends at $1\ge x\ge-12$, but its interval is written as $[1;12]$ instead of $[-12;1]$.
- The right answer (our own working, not applied to the book): [-12;1]
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 2k**, page 101

- The question as we have it: Solve: $0=2x^{2}-5x-18$
- The book's answer: x=-\frac{9}{2} or x=2
- What is wrong: Book factorises 2x^2-5x-18 as (2x+9)(x-2) (sign error); roots -9/2 and 2 do not satisfy the equation.
- The right answer (our own working, not applied to the book): x=-2 or x=\frac{9}{2}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 6n**, page 103

- The question as we have it: Solve the following simultaneous equations: $2a(a-1)-4+a-b=0$ and $2a^2-a=b+4$
- The book's answer: Note that this is the same as the second equation $a$ and $b$ can be any real number except for $\text{0}$
- What is wrong: The book rightly shows the equations coincide, but its stated answer 'a and b can be any real number except 0' is wrong. b depends on a, and a=0 is allowed. The typed choice also uses invented options.
- The right answer (our own working, not applied to the book): Infinitely many solutions: $b=2a^2-a-4$ for any real $a$
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 6o**, page 103

- The question as we have it: Solve the following simultaneous equations: $y=(x-2)^2$ and $x(x+3)-y=3x+4(x-1)$
- The book's answer: Note that this is the same as the first equation. $x$ and $y$ can be any real number except for $\text{0}$
- What is wrong: The book rightly shows the equations coincide, but its stated answer 'x and y can be any real number except 0' is wrong. y is fixed by x, and 0 is allowed. The typed choice also uses invented options.
- The right answer (our own working, not applied to the book): Infinitely many solutions: all $(x;y)$ with $y=(x-2)^2$
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 9a**, page 104

- The question as we have it: Write down the inequality represented by the following: [figure]
- The book's answer: $x<-1\text{ and }x\geq4;x\in\mathbb{R}$
- What is wrong: The book joins the two rays with 'and' where the figure needs 'or' (union). As written the answer is the empty set.
- The right answer (our own working, not applied to the book): x<-1 or x\geq 4; x\in\mathbb{R}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 9c**, page 104

- The question as we have it: Write down the inequality represented by the following: [figure]
- The book's answer: $-1<x\leq-2;x\in\mathbb{R}$
- What is wrong: The printed answer and the EPUB final answer both write the upper bound as $-2$. The figure's filled circle sits at $+2$, so a minus sign was added by mistake. $-1<x\le-2$ has no solutions.
- The right answer (our own working, not applied to the book): -1 < x \le 2; x \in \mathbb{R}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 11b**, page 104

- The question as we have it: Solve and represent your answer on a number line $3(1-b)-4+b>7+b,b\in\mathbb{Z}$
- The book's answer: $b<-4$
- What is wrong: The step from $3-3b-4+b>7+b$ to $-2b>8$ loses the $b$ from the right-hand side. The correct step is $-3b>8$, so $b<-\frac{8}{3}$, not $b<-4$. The printed answer $b>4$ also disagrees with the EPUB's $b<-4$.
- The right answer (our own working, not applied to the book): b < -8/3 (for b in Z: b <= -3)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 4-7, question 12s**, page 104

- The question as we have it: Solve for the unknown variable $3ax+2a-ax=5ax-6a$
- The book's answer: x = \frac{3}{8} if a \neq 0, x \in \mathbb{R}
- What is wrong: The last line writes $x=\frac38$, but $3ax-8a=0$ gives $x=\frac83$. Printed answer repeats the inverted fraction.
- The right answer (our own working, not applied to the book): x=\frac{8}{3}\ (a\ne0)
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (2)


**Exercise 4-7, question 1h**, page 101

- The question as we have it: Solve: $2k+3=2-3(k+2)$
- The book's answer: $k=-2$
- What is wrong: As printed, $2k+3=2-3k-6$ gives $k=-\frac75$ (blind is right for this stem). The book working expands $-3(k+3)=-3k-9$, giving $5k=-10$, $k=-2$, which follows. So the stem lost its '3': repair to $k+3$; key -2 unchanged.
- In the question bank: **live, with the question text repaired** to: Solve: $2k+3=2-3(k+3)$. Marked as an AI repair for you to review.

**Exercise 4-7, question 12e**, page 104

- The question as we have it: Solve for the unknown variable $a-3=2\left(\frac{6}{a}+1\right)$
- The book's answer: therefore a=4 or a=-3
- What is wrong: Stem as shown gives $a^2-5a-12=0$, not the book's roots. The working's first line has $2(\frac6a-1)$, then $a^2-a-12=(a-4)(a+3)=0$, $a=4,-3$; check $a=4$: $1=2(1.5-1)=1$. So the '+' was garbled; repair to '-'. Key unchanged.
- In the question bank: **live, with the question text repaired** to: Solve for the unknown variable $a-3=2\left(\frac{6}{a}-1\right)$. Marked as an AI repair for you to review.

## Chapter 5 — Trigonometry


### The book's printed answer is wrong (14)


**Exercise 5-1, question 3a**, page 113

- The question as we have it: Complete each of the following: [figure] Consider the following diagram: [figure] Without using a calculator, answer each of the following questions. Write down $\cos\hat{O}$ in terms of $m$ , $n$ and $o$ .
- The book's answer: $\cos\hat{O}=\dfrac{\text{adjacent}}{\text{hypotenuse}}=\dfrac{m}{o}$
- What is wrong: The figure shows right angle at N, n = OM (hypotenuse), m = ON (adjacent to O), o = MN (opposite). The book's own working says n is the hypotenuse and m the adjacent side, then writes cos O = adjacent/hypotenuse = m/o. Its last step swaps n for o; the printed answer repeats the error.
- The right answer (our own working, not applied to the book): \cos\hat{O}=\frac{m}{n}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-4, question 1a**, page 124

- The question as we have it: In each triangle find the length of the side marked with a letter. Give your answers correct to $\text{2}$ decimal places. [figure]
- The book's answer: a ≈ 36,11
- What is wrong: Book's multiplication 62 × 0,6018 is given as 36,10890; the correct product is 37,31.
- The right answer (our own working, not applied to the book): 37,31
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-4, question 1e**, page 124

- The question as we have it: In each triangle find the length of the side marked with a letter. Give your answers correct to $\text{2}$ decimal places. [figure]
- The book's answer: e ≈ 3,51
- What is wrong: Book writes sin17° = e/12, but e is the hypotenuse and 12 is the opposite side; correct is e = 12/sin17° = 41,04.
- The right answer (our own working, not applied to the book): 41,04
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-4, question 1j**, page 124

- The question as we have it: In each triangle find the length of the side marked with a letter. Give your answers correct to $\text{2}$ decimal places. [figure]
- The book's answer: x = 9,06
- What is wrong: Figure: right angle at top right, x is the top side (opposite the 65 degree angle), 4,23 is the vertical side (adjacent). x = 4,23 tan65 = 4,23 x 2,14451 = 9,0713, so 9,07 to 2 d.p. The book prints 9,06 (rounded tan65 too early, or an arithmetic slip).
- The right answer (our own working, not applied to the book): 9,07
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-7, question 4b**, page 137

- The question as we have it: Given: $10\cos\beta+8=0$ and $180^{\circ}<\beta<360^{\circ}$ . Determine the value of: $\dfrac{3}{\tan{\beta}}+2\sin^2{\beta}$
- The book's answer: $\frac{3}{\tan{\beta}}+2\sin^2{\beta}=\frac{-82}{25}$
- What is wrong: Sign error in the book's working: $\frac{3(-4)}{-3}$ equals $+4$, but the book writes $\frac{-12}{3}=-4$. So its final $\frac{-82}{25}$ is wrong; the right value is $\frac{118}{25}$ (4,72), which is also the blind answer.
- The right answer (our own working, not applied to the book): \frac{118}{25}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 1c**, page 138

- The question as we have it: State whether each of the following trigonometric ratios has been written correctly. $\sec\theta=\dfrac{\text{hypotenuse}}{\text{adjacent}}$
- The book's answer: Therefore this trigonometric ratio has not been written correctly.
- What is wrong: Book's working recalls $\sec\theta=\text{hypotenuse}/\text{opposite}$. That is cosecant. Secant is $1/\cos\theta=\text{hypotenuse}/\text{adjacent}$, exactly as the stem writes it, so the stem's ratio is correct and the book's 'not written correctly' is wrong.
- The right answer (our own working, not applied to the book): has been written correctly
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 9**, page 141

- The question as we have it: A right-angled triangle has hypotenuse $\text{13}$ $\text{mm}$ . Find the length of the other two sides if one of the angles of the triangle is $\text{50}$ °.
- The book's answer: Therefore the other two sides are 9,96 mm and 8,35 mm.
- What is wrong: The book's final sentence and printed answer give 8,35 mm, but its own working gives $b=8{,}3562\approx8{,}36$ mm. The correct pair is 9,96 mm and 8,36 mm.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 13**, page 143

- The question as we have it: In the following triangle find the size of $A\hat{B}C$ . [figure]
- The book's answer: ≈44,44°
- What is wrong: The book's working writes $DC=9\tan41°=7{,}8235$ but $\tan41°=9/DC$ gives $DC=9/\tan41°=10{,}353$. Printed 44,44° is wrong; the right value is about 53,55°.
- The right answer (our own working, not applied to the book): 53,55°
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 14**, page 143

- The question as we have it: In the following triangle find the length of side $CD$ : [figure]
- The book's answer: =11,88
- What is wrong: Book rounds BC and BD to 2 d.p. before subtracting (24,73-12,85=11,88). Exact working gives 11,8738, so 11,87.
- The right answer (our own working, not applied to the book): 11,87
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 17f**, page 143

- The question as we have it: Solve for $\theta$ if $\theta$ is a positive, acute angle: $\sin3\theta+5=4$
- The book's answer: θ=30°
- What is wrong: The book takes $\sin3\theta=-1$ and writes $3\theta=90$, but $\sin90°=+1$. 30° gives $\sin90°+5=6\ne4$. The stem or the book is in error.
- The right answer (our own working, not applied to the book): No solution (the only solution is 90°, not acute)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 18c**, page 144

- The question as we have it: If $a=29^{\circ}$ , $b=38^{\circ}$ and $c=47^{\circ}$ , use your calculator to evaluate each of the following, correct to 2 decimal places. $\sin(a\times b\times c)$
- The book's answer: \approx\text{0,91}
- What is wrong: Working replaces the product 29×38×47 = 51794 by 114 (the sum a+b+c); sin 114° = 0,91 is the answer to a different expression.
- The right answer (our own working, not applied to the book): -0,72
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 22**, page 144

- The question as we have it: Given the points $E(5;0)$ , $F(6;2)$ and $G(8;-2)$ . Find the angle $F\hat{E}G$ .
- The book's answer: 97,12
- What is wrong: The book adds the rounded part-angles 63,43 and 33,69 to get 97,12. The exact angle is 97,125, so rounded to 2 d.p. it is 97,13. A key of 97,12 would mark a correctly rounded answer wrong.
- The right answer (our own working, not applied to the book): 97,13
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 23**, page 144

- The question as we have it: A triangle with angles $\text{40}$ °, $\text{40}$ ° and $\text{100}$ ° has a perimeter of $\text{20}$ $\text{cm}$ . Find the length of each side of the triangle.
- The book's answer: Therefore the lengths of the sides are 8,7 cm, 5,65 cm and 5,65 cm.
- What is wrong: The book uses $\cos40°\approx0{,}77$ (it is 0,7660), so $a=5{,}65$ instead of 5,66, and $b=8{,}7$ instead of 8,68. The printed lengths are inaccurate.
- The right answer (our own working, not applied to the book): 5,66 cm, 5,66 cm and 8,68 cm
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 5-8, question 24**, page 144

- The question as we have it: Determine the area of $\triangleABC$ . [figure]
- The book's answer: ∴Areaof△ABC=16944units²
- What is wrong: Book rounds intermediate lengths to 3 d.p., so 121,032x140 gives 16944. Unrounded working gives 16944,53, which rounds to 16945.
- The right answer (our own working, not applied to the book): 16945 units² (exact 16944,53)
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (1)


**Exercise 5-2, question 1z**, page 117

- The question as we have it: Use your calculator to determine the value of the following (correct to $\text{2}$ decimal places): $\sqrt{\dfrac{\cot103^{\circ}+\sin1090^{\circ}}{\sec10^{\circ}+5}}$
- The book's answer: 0,21
- What is wrong: Stem as shown: cot103°+sin1090° ≈ -0,23+0,17 < 0, so the root is undefined. The working starts from cot85°: 0,2611/6,0154=0,0434, root 0,2083, so 0,21. The key fits only the cot85 stem. Repair 103 to 85, key unchanged.
- In the question bank: **live, with the question text repaired** to: Use your calculator to determine the value of the following (correct to $\text{2}$ decimal places): $\sqrt{\dfrac{\cot85^{\circ}+\sin1090^{\circ}}{\sec10^{\circ}+5}}$. Marked as an AI repair for you to review.

## Chapter 6 — Functions


### The book's printed answer is wrong (7)


**Exercise 6-1, question 7d**, page 149

- The question as we have it: The cost of petrol and diesel per litre are given by the functions $P$ and $D$ , where: $\begin{align*}P&=\text{13,61}V\\D&=\text{12,46}V\end{align*}$ Use this information to answer the following: How many litres of petrol can you buy with $\text{R275}$ ?
- The book's answer: 22,071 L
- What is wrong: The book's working uses the diesel function D(V)=275 (12,46V) instead of the petrol function P for a petrol question, so 22,071 L is the diesel answer.
- The right answer (our own working, not applied to the book): 20,21 L (275/13,61 using the petrol function P)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-2, question 6b**, page 156

- The question as we have it: Write the following in standard form ( $y=mx+c$ ): $3x-y=5$
- The book's answer: $y=-3x+5$
- What is wrong: Book's last step: from $-y=5-3x$ it prints $y=-3x+5$; dividing by $-1$ gives $y=3x-5$ (sign error in the printed answer and the working).
- The right answer (our own working, not applied to the book): y=3x-5
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-2, question 7f**, page 156

- The question as we have it: Look at the graphs below. Each graph is labelled with a letter. In the questions that follow, match any given equation with the label of a corresponding graph. [figure] $y=\frac{1}{2}x$
- The book's answer: C
- What is wrong: The figure draws line C as $y=\frac14 x$ (passes through (8,2)), while the stem asks for $y=\frac12 x$; the book's key C does not match the graph as drawn.
- The right answer (our own working, not applied to the book): C only by elimination; graph C is y=x/4
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-5, question 6d**, page 187

- The question as we have it: Given the functions $y=2^{x}$ and $y=\left(\frac{1}{2}\right)^{x}$ . Solve the equation $2^{x}=\left(\frac{1}{2}\right)^{x}$ graphically and check your answer is correct by using substitution.
- The book's answer: The graphs intersect at the point $(0;1)$ .
- What is wrong: The stem asks to solve the equation, whose solution is x = 0. The book answers with the intersection point (0;1), which is not the form asked for. A key of (0;1) would mark the right answer x = 0 as wrong.
- The right answer (our own working, not applied to the book): x = 0 (the graphs meet at (0;1))
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-6, question 18a**, page 206

- The question as we have it: Given the following graph. [figure] State the coordinates at $A,~B,~C$ and $D$ .
- The book's answer: We can read the values off the graph: $A=(90^{\circ};4),~B=(90^{\circ};-2),~C=(180^{\circ};4)\text{ and }D=(180^{\circ};-2)$
- What is wrong: The book's working gives B=(90°;-2) and D=(180°;-2). In the figure B and D are at height +2: B sits on the curve at (90,2) and D at (180,2).
- The right answer (our own working, not applied to the book): A=(90^{\circ};4), B=(90^{\circ};2), C=(180^{\circ};4), D=(180^{\circ};2)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-6, question 20a**, page 206

- The question as we have it: Given the following graph: [figure] State the coordinates at $A,~B,~C$ and $D$ .
- The book's answer: We read the values off the graph: $A=(90^{\circ};3),~B=(90^{\circ};2),~C=(180^{\circ};-4)\text{ and }D=(270^{\circ};2)$
- What is wrong: The book's working and typed key give B=(90°;2) and D=(270°;2). The graph shows both points at y=-2. The minus signs were lost in the book.
- The right answer (our own working, not applied to the book): A=(90°;3), B=(90°;-2), C=(180°;-4), D=(270°;-2)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 6-8, question 44**, page 226

- The question as we have it: For which values of $\theta$ is the function positive, in the interval shown? [figure]
- The book's answer: $0^{\circ}<\theta<360^{\circ}$
- What is wrong: The graph runs from 0 to 360 and is 2.5 at both ends, so the endpoints are positive too. The book's strict inequalities leave out values where the function is positive. A marker checking the interval would mark the full-interval answer wrong.
- The right answer (our own working, not applied to the book): 0°≤θ≤360° (positive everywhere on the plotted interval, endpoints included)
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 7 — Euclidean geometry


### The book's printed answer is wrong (4)


**Exercise 7-2, question 6b**, page 250

- The question as we have it: State whether the following pairs of triangles are congruent or not. Give reasons for your answers. If there is not enough information to make a decision, explain why. [figure]
- The book's answer: not congruent
- What is wrong: The book's reasoning only shows the triangles cannot be proved congruent by SAS, and its own note says the angles are 'not necessarily' equal. It still concludes 'not congruent' where its own 6c and 6d answers use 'not enough information'. A key of 'not congruent' would mark a correct student answe…
- The right answer (our own working, not applied to the book): not enough information (SSA does not decide)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 7-3, question 1b**, page 254

- The question as we have it: $PQRS$ is a parallelogram. $PS=OS$ and $QO=QR$ . $S\hat{O}R=96^{\circ}$ and $Q\hat{O}R=x$ . [figure] Write $\hat{P}$ in terms of $x$ .
- The book's answer: $\therefore\hat{P}=2x$
- What is wrong: The working goes from $S\hat{R}O+O\hat{R}Q$ straight to $2x$ without showing $S\hat{R}O=x$. The stem is over-determined (x is forced to 28). A key of 2x marks the natural answer 84° − x wrong, so one key cannot mark both.
- The right answer (our own working, not applied to the book): 84° − x (equal to 2x only at x = 28)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 7-8, question 2h**, page 270

- The question as we have it: Assess whether the following statements are true or false. If the statement is false, explain why: The diagonals of a parallelogram are axes of symmetry.
- The book's answer: True
- What is wrong: The book's printed answer and its working both say 'True'. A parallelogram has no axes of symmetry in general. Its diagonals are axes only for a rhombus.
- The right answer (our own working, not applied to the book): False
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 7-8, question 10d**, page 273

- The question as we have it: Say which of the following pairs of triangles are congruent with reasons. [figure]
- The book's answer: Therefore \triangle QRS \text{ not congruent } \triangle TUV.
- What is wrong: The book's working shows only that SAS fails, then concludes 'not congruent'. That is a non sequitur: SSA does not show the triangles are non-congruent. The typed options 'congruent' and 'not congruent' were invented, as only 'congruent' is in the stem.
- The right answer (our own working, not applied to the book): Not enough information: congruence cannot be concluded (angle is not the included angle, SSA)
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (2)


**Exercise 7-1, question 5f**, page 241

- The question as we have it: Find each of the unknown angles marked in the figure below. Find a reason that leads to the answer in a single step. [figure] Based on the results for the angles above, is $PQ\parallelNR$ ?
- The book's answer: therefore $PQ\parallel NR$.
- What is wrong: Figure: $a=50^\circ$, $b=40^\circ$, $d=40^\circ$ (corresponding to $b$), so $PQ\parallel NR$. Book key right. Stem and working print '\parallelNR' with no space, which will not render. Conclusion marked; angle parts not marked.
- In the question bank: **live, with the question text repaired** to: Find each of the unknown angles marked in the figure below. Find a reason that leads to the answer in a single step. [figure] Based on the results for the angles above, is $PQ \parallel NR$ ?. Marked as an AI repair for you to review.

**Exercise 7-8, question 8**, page 273

- The question as we have it: Have a look at the following triangles, which are drawn to scale: [figure] Are the triangles congruent? If so state the reason and use correct notation to state that they are congruent.
- The book's answer: Therefore, there is not enough information to determine if the two triangles are congruent.
- What is wrong: One angle (F=J) is marked and x and c are different labels, so the book's 'not enough information' is sound as logic. But the stem says the triangles are drawn to scale, and the second triangle is visibly larger, which points to 'not congruent'. The stem and the key pull apart. (kept out as exclude, not hold: its typed shape cannot be emitted — options said to be the stem's are not all in the stem: "not congruent",…
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 9 — Finance and growth


### The book's printed answer is wrong (6)


**Exercise 9-1, question 7**, page 335

- The question as we have it: Sally wanted to calculate the number of years she needed to invest $\text{R1000}$ for in order to accumulate $\text{R2500}$ . She has been offered a simple interest rate of $\text{8,2}$ % p.a. How many years will it take for the money to grow to $\text{R2500}$ ?
- The book's answer: It would take 19 years for R1000 to become R2500 at 8,2% p.a.
- What is wrong: The stem asks 'how many years' with no rounding instruction; the book's working ends at $n=18{,}3$ but the printed answer is 19 (rounded up by an unstated convention).
- The right answer (our own working, not applied to the book): n = 18,3 (18,29) years by the book's working; the book states 19
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 9-2, question 4**, page 340

- The question as we have it: Nicola wants to invest some money at a compound interest rate of $\text{11}$ % p.a. How much money (to the nearest rand) should be invested if she wants to reach a sum of $\text{R100000}$ in five years time?
- The book's answer: R 59 345,13
- What is wrong: Stem says 'to the nearest rand' but the book's printed answer and working end at R 59 345,13 (two decimals).
- The right answer (our own working, not applied to the book): R 59 345 (nearest rand)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 9-3, question 9**, page 344

- The question as we have it: Tlali wants to buy a new computer and decides to buy one on a hire purchase agreement. The computers cash price is $\text{R4250}$ . He will pay it off over $\text{30}$ months at an interest rate of $\text{9,5}$ % p.a. An insurance premium of $\text{R10,75}$ is added to every monthly payment. How mu…
- The book's answer: Add the insurance premium: $\text{R146,09}+\text{R10,75}=\text{R156,84}$
- What is wrong: Book divides by 36 instead of 30 months, giving R156,84; correct is $5259{,}38/30+10{,}75=R186{,}06$.
- The right answer (our own working, not applied to the book): R186,06
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 9-7, question 16a**, page 350

- The question as we have it: Calculate how much you will earn if you invested $\text{R500}$ for $\text{1}$ year at the following interest rates: $\text{6,85}$ % simple interest
- The book's answer: A = \text{R534,25}
- What is wrong: Stem asks how much you EARN (interest, R34,25) but the book's answer is the total amount A = R534,25.
- The right answer (our own working, not applied to the book): R34,25 (interest); the book prints R534,25 (accumulated amount)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 9-7, question 16b**, page 350

- The question as we have it: Calculate how much you will earn if you invested $\text{R500}$ for $\text{1}$ year at the following interest rates: $\text{4,00}$ % compound interest
- The book's answer: A = R520
- What is wrong: Stem says 'earn' but the book's key R520 is the accumulated amount, not the interest.
- The right answer (our own working, not applied to the book): R20 (interest earned); the book prints R520, the total amount
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 9-7, question 31b**, page 352

- The question as we have it: According to the latest census, South Africa currently has a population of $\text{57\000\000}$ . If it is found after $\text{10}$ years that the population has actually increased by $\text{10}$ million to $\text{67}$ million, what was the growth rate?
- The book's answer: 1,7
- What is wrong: After $1{,}01629-1=0{,}01629$ the book writes $100(0{,}016)=1{,}69$ and rounds to 1,7; correct is 1,63, about 1,6.
- The right answer (our own working, not applied to the book): 1,6 (about 1,63%)
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 10 — Statistics


### The book's printed answer is wrong (7)


**Exercise 10-2, question 4d**, page 364

- The question as we have it: Calculate the mean, median and mode of the following data sets: $\{24;35;28;41;31;49;31\}$
- The book's answer: mean: 34,29; median: 31; mode: none
- What is wrong: The book gives mean 34,29 (its working says 34,3), but the mean is 239/7 ≈ 34,14. The book gives mode 'none', but 31 appears twice, so the mode is 31.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 10-7, question 21a**, page 386

- The question as we have it: In a traffic survey, a random sample of $\text{50}$ motorists were asked the distance they drove to work daily. This information is shown in the table below. Distance ( $\text{km}$ )Count $0<d\leq5$ $\text{4}$ $5<d\leq10$ $\text{5}$ $10<d\leq15$ $\text{9}$ $15<d\leq20$ $\text{10}$ $20<d\leq25$ $\te…
- The book's answer: $\begin{align*}\text{mean}&=\frac{4(3)+5(8)+9(13)+10(18)+7(23)+8(28)+3(33)+2(38)+2(43)}{50}\\&=\text{19,9}\end{align*}$
- What is wrong: The book uses 3, 8, 13, ... as class centres for the classes 0<d<=5, 5<d<=10, ... A continuous distance has centres 2,5, 7,5, ...; its 19,9 is therefore the mean for whole-km data, not for the stem as printed.
- The right answer (our own working, not applied to the book): 19,4
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 10-7, question 25a**, page 387

- The question as we have it: The following is a list of data: $3;8;8;5;9;1;4;x$ In each separate case, determine the value of $x$ if the: range = $\text{16}$
- The book's answer: $\begin{align*}\text{range}&=\text{maximum}-\text{minimum}\\16&=x-1\\\therefore x&=17\end{align*}$
- What is wrong: The book's step 'If x<9 the range would be 9-1=8' ignores x below 1. x=-7 also gives range 16, so the book omits a valid answer.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 10-7, question 25e**, page 387

- The question as we have it: The following is a list of data: $3;8;8;5;9;1;4;x$ In each separate case, determine the value of $x$ if the: box-and whiskers plot [figure]
- The book's answer: therefore x = 4
- What is wrong: The plot has min 1, Q1 3, median 4,5, Q3 8, max 9. The book uses the median alone and writes 4,5 = (5+x)/2, which gives x = 4. But the median also holds for any x between 3 and 4. With x = 4 the sorted list 1;3;4;4;5;8;8;9 has Q1 = (3+4)/2 = 3,5, not 3. With x = 3 the list 1;3;3;4;5;8;8;9 has Q1 =…
- The right answer (our own working, not applied to the book): x = 3
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 10-7, question 28a**, page 387

- The question as we have it: There are 14 men working in a factory. Their ages are : $22;25;33;35;38;48;53;55;55;55;55;56;59;64$ Write down the five number summary.
- The book's answer: The five number summary is: $\text{22};\text{36,5};\text{50};\text{55};\text{64}$
- What is wrong: The book's own working gives the median as (53+55)/2 = 54, but its final line and printed answer say 50. The data's 7th and 8th values are 53 and 55, so the median is 54. The printed and typed key 22; 36,5; 50; 55; 64 is wrong in the median.
- The right answer (our own working, not applied to the book): 22; 36,5; 54; 55; 64
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 10-7, question 28c**, page 388

- The question as we have it: There are 14 men working in a factory. Their ages are : $22;25;33;35;38;48;53;55;55;55;55;56;59;64$ Find the mean age of the men in the factory using the original data.
- The book's answer: ¯x = 42,643
- What is wrong: The book's working gives $\bar{x}=597/14=42{,}643$, but the ages sum to 653, so the mean is $653/14\approx46{,}64$.
- In the question bank: **not used**. The book's answer was never changed.

**Worked example 12**, page 375

- The question as we have it: Determine the quartiles of the following data set: $\left\{7;45;11;3;9;35;31;7;16;40;12;6\right\}$
- The book's answer: Therefore the $75^{\text{th}}$ percentile is $\frac{31+35}{2}=33$.
- What is wrong: For the 75th percentile at rank 9,25 the book takes the halfway point $(31+35)/2=33$; a quarter of the way gives 32.
- The right answer (our own working, not applied to the book): 7; 11,5; 32
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 11 — Trigonometry


### The book's printed answer is wrong (7)


**Exercise 11-2, question 5**, page 398

- The question as we have it: A rugby player is trying to kick a ball through the poles. The rugby crossbar is $\text{3,4}$ $\text{m}$ high. The ball is placed $\text{24}$ $\text{m}$ from the poles. What is the minimum angle he needs to launch the ball to get it over the bar?
- The book's answer: Therefore he needs to kick the ball with a minimum angle of 8 ° .
- What is wrong: The key 8 is the book's whole-degree rounding of 8,0632...; the stem asks for no rounding, and 8 degrees would not clear the bar. A student answering 8,06 would be marked wrong.
- The right answer (our own working, not applied to the book): 8,06
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 11**, page 399

- The question as we have it: Determine the perimeter of rectangle $PQRS$ : [figure]
- The book's answer: Therefore the perimeter is 473,52 m .
- What is wrong: The book's line $2(85(\cos35+\sin35))=2(236{,}76)$ is wrong: $85(\cos35+\sin35)=118{,}38$, not 236,76. The printed 473,52 m is twice the true perimeter.
- The right answer (our own working, not applied to the book): 236,76 m
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 12**, page 399

- The question as we have it: A rhombus has diagonals of lengths $\text{6}$ $\text{cm}$ and $\text{9}$ $\text{cm}$ . Calculate the sizes of its interior vertex angles. [figure]
- The book's answer: Therefore the two angles are 106,62 ° and 67,38 °
- What is wrong: The book writes $\theta\approx53{,}31$ (and 41,9872) for $\arctan(4{,}5/3)$; the true value is 56,31. So $2\theta=112{,}62$, not 106,62.
- The right answer (our own working, not applied to the book): 67,38 and 112,62
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 15b**, page 400

- The question as we have it: One of the angles of a rhombus with perimeter $\text{20}$ $\text{cm}$ is $\text{30}$ °. Find the length of both diagonals.
- The book's answer: The one diagonal is $2(\text{4,83})=\text{9,66}\text{ cm}$ and the other diagonal is $2(\text{1,29})=\text{2,58}\text{ cm}$ .
- What is wrong: The short diagonal 2(1,29)=2,58 comes from rounding intermediate values; the exact value is 2,588, i.e. 2,59. The book's key 2,58 is off in the last digit.
- The right answer (our own working, not applied to the book): 9,66 cm and 2,59 cm
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 17b**, page 400

- The question as we have it: The angle of elevation of a hot air balloon, climbing vertically, changes from 25 degrees at 11:00 am to 60 degrees at 11:02 am. The point of observation of the angle of elevation is situated 300 metres away from the take off point. Calculate the increase in height between 11:00 am and 11:02 am.
- The book's answer: The difference is: 519,62 m - 129,89 m = 379,73 m
- What is wrong: Worked solution subtracts 129,89 instead of 139,89, so its final line is arithmetically wrong. The key 379,73 differs from the exact 379,72 in the second decimal.
- The right answer (our own working, not applied to the book): 379,72 m (book prints 379,73 from rounded intermediates)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 18**, page 400

- The question as we have it: When the top, $T$ , of a mountain is viewed from point $A$ , $\text{2000}$ $\text{m}$ from the ground, the angle of depression ( $a$ ) is equal to 15°. When it is viewed from point $B$ on the ground, the angle of elevation ( $b$ ) is equal to 10°. If the points $A$ and $B$ are on the same vertical…
- The book's answer: 793,77 m
- What is wrong: The stem asks for one decimal place but the printed answer 793,77 m has two. The book gives no working (figure only).
- The right answer (our own working, not applied to the book): 793,8 m
- In the question bank: **not used**. The book's answer was never changed.

**Worked example 2**, page 393

- The question as we have it: $ABCD$ is a trapezium with $AB=\text{4}\text{cm}$ , $CD=\text{6}\text{cm}$ , $BC=\text{5}\text{cm}$ and $AD=\text{5}\text{cm}$ . Point $E$ on diagonal $AC$ divides the diagonal such that $AE=\text{3}\text{cm}$ . $B\hat{E}C=90^{\circ}$ . Find $A\hat{B}C$ .
- The book's answer: $A\hat{B}C=\text{48,6}^{\circ}+\text{58,1}^{\circ}=\text{106,7}^{\circ}$
- What is wrong: Step 5 adds the two intermediate angles after rounding each to 1 d.p. (48,6 + 58,1 = 106,7). The unrounded sum 48,5903 + 58,0519 = 106,6422 gives 106,6. The book's 106,7 is a rounding-accumulation error.
- The right answer (our own working, not applied to the book): 106,6
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (2)


**Exercise 11-2, question 2b**, page 398

- The question as we have it: Captain Jack is sailing towards a cliff with a height of $\text{10}$ $\text{m}$ . If the boat sails $\text{7}$ $\text{m}$ closer to the cliff, what is the new angle of elevation from the boat to the top of the cliff?
- The book's answer: The new angle of elevation is 23 °.
- What is wrong: The stem omits the 30 m starting distance, which is in part (a). The book key 23 is also a whole-degree rounding of 23,4986 with no rounding asked for.
- The right answer (our own working, not applied to the book): 23,5 (given 30 m from part a)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 11-2, question 16b**, page 400

- The question as we have it: Upright sticks and the shadows they cast can be used to judge the sun's altitude in the sky (the angle the sun makes with the horizontal) and the heights of objects. At the same time, the shadow of a building is found to be 47 metres long. What is the height of the building?
- The book's answer: h = 47 tan 36,53° = 34,82 m
- What is wrong: Part depends on 16a: the 1 m stick, 1,35 m shadow and the angle are not in this stem. The book's 34,82 comes from the rounded angle; the unrounded value is 34,81, so a right answer would be marked wrong.
- The right answer (our own working, not applied to the book): 34,81 m exactly; the book's 34,82 m only with the angle rounded to 36,53°
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 12 — Euclidean geometry


### The book's printed answer is wrong (1)


**Exercise 12-1, question 7c**, page 407

- The question as we have it: Determine the value of $x$ .
- The book's answer: 42◦
- What is wrong: Printed answer 42 checks out ($180-36-102=42$; $360-72=288$, $288/2=144$, $144-102=42$). The working misprints: it states $X\hat{U}W=42^{\circ}$ where its own line uses 102; it writes $\hat{U}=\frac{298}{2}=149^{\circ}$ where $360-72=288$ and $U=144^{\circ}$; and $149-102=47$, not 42. Correct answe…
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 13 — Measurements


### The book's printed answer is wrong (7)


**Exercise 13-3, question 4**, page 431

- The question as we have it: Calculate the volumes of the following prisms (correct to $\text{1}$ decimal place): The figure here is a triangular prism. The height of the prism is $\text{7}$ units; the triangles, which both contain right angles, have sides which are $\text{2}$ , $\sqrt{21}$ and $\text{5}$ units long. Calculate…
- The book's answer: ≈ 32,06
- What is wrong: Book evaluates $7\sqrt{21}$ as 32,06; correct value is 32,08 ($\sqrt{21}=4.5826$). Printed answer field also runs on into items 5 and 6.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-4, question 1b**, page 438

- The question as we have it: Find the total surface area of the following objects (correct to 1 decimal place if necessary): [figure]
- The book's answer: $\approx\text{45,6}$ $\text{cm}^{2}$
- What is wrong: Book writes $\frac12(6)(\sqrt{27}+10)$ where its own formula $\frac12 b(h_b+3h_s)$ gives $\frac12(6)(\sqrt{27}+30)\approx105.6$. The printed 45,6 is wrong.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-5, question 6a**, page 450

- The question as we have it: Calculate the following properties for the pyramid shown below. Round your answers to two decimal places. [figure] Surface area
- The book's answer: Therefore the surface area of the triangular pyramid is: $\text{91,39}$ $\text{cm}^{2}$ .
- What is wrong: Book substitutes b=6 instead of the base side 4 in A=1/2*b*(h_b+3h_s); 1/2(4)(sqrt12+27)=60.93, not 91.39. Printed answer and EPUB repeat the error.
- The right answer (our own working, not applied to the book): 60.93 cm^2
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-5, question 6b**, page 450

- The question as we have it: Calculate the following properties for the pyramid shown below. Round your answers to two decimal places. [figure] Volume
- The book's answer: Therefore the volume of the pyramid is: $\text{29,39}$ $\text{cm}^{3}$ .
- What is wrong: Book takes H^2=9^2-3^2 (foot of the slant height treated as 3 from the centre) and base 6; the inradius of the side-4 equilateral base is sqrt(12)/3, giving H~8.93 and V~20.61, not 29.39.
- The right answer (our own working, not applied to the book): 20.61 cm^3
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-7, question 26b**, page 464

- The question as we have it: Determine the volume of the following: $ABCD$ is a square, $AC=\text{12}\text{cm}$ , $AP=\text{10}\text{cm}$ . [figure]
- The book's answer: ≈ 645,07 cm³
- What is wrong: Book computes 144/2 as 77 (should be 72) and uses V=1/3*pi*b^2*H, a cone formula with pi, for a square pyramid; correct V=1/3(72)(8)=192 cm^3.
- The right answer (our own working, not applied to the book): 192 cm^3
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-7, question 28b**, page 466

- The question as we have it: A cooldrink container is made in the shape of a pyramid with an isosceles triangular base. This is known as a tetrahedron. The angle of elevation of the top of the container is $\text{33,557}^{\circ}$ . $CI=\text{7}\text{cm}$ ; $JI=\text{18}\text{cm}$ . [figure] The container is filled with the jui…
- The book's answer: 74,626 cm3
- What is wrong: Book's total volume 84,661 is exactly half of 1/3*(base area 51.05)*(height 9.95)=169.3; the working just asserts 84,661 and the EPUB has no final line. Juice volume should be ~149.2 cm^3, not 74,626.
- The right answer (our own working, not applied to the book): about 149.2 cm^3
- In the question bank: **not used**. The book's answer was never changed.

**Worked example 13**, page 442

- The question as we have it: Find the volume of the following triangular pyramid (correct to 1 decimal place): [figure]
- The book's answer: The volume of the triangular pyramid is $\text{105,3}$ $\text{cm$^{3}$}$ .
- What is wrong: Book uses $H=\sqrt{130}$ but the side-triangle figure (12 cm, 4 cm) gives $\sqrt{128}$; resulting volume is about 104,5 cm³, not 105,3.
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (2)


**Exercise 13-2, question 2a**, page 427

- The question as we have it: If a litre of paint covers an area of $\text{2}$ $\text{m}^{2}$ , how much paint does a painter need to cover: a rectangular swimming pool with dimensions $\text{4}\text{m}\times\text{3}\text{m}\times\text{2,5}\text{m}$ (the inside walls and floor only);
- The book's answer: the painter will need \frac{47}{2} = 24 l of paint
- What is wrong: Stem does not ask for rounding up to whole litres, yet the book's key 24 depends on it. The exact value $47/2=23{,}5$ is correct as the stem reads, and a single key of 24 would mark it wrong.
- The right answer (our own working, not applied to the book): 23,5 litres (24 only if rounded up to whole litres, which the stem does not say)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 13-2, question 2b**, page 427

- The question as we have it: If a litre of paint covers an area of $\text{2}$ $\text{m}^{2}$ , how much paint does a painter need to cover: the inside walls and floor of a circular reservoir with diameter $\text{4}$ $\text{m}$ and height $\text{2,5}$ $\text{m}$ . [figure]
- The book's answer: the painter will need \frac{44}{2} = 22 l of paint
- What is wrong: Book rounds the area to 44 and the volume of paint up to 22 although the stem asks for no rounding; a student giving 21,99 (or 7π) would be marked wrong against the key 22.
- The right answer (our own working, not applied to the book): 7π ≈ 21,99 litres (22 only if rounded up to whole litres)
- In the question bank: **not used**. The book's answer was never changed.

## Chapter 14 — Probability


### The book's printed answer is wrong (2)


**Exercise 14-8, question 12f**, page 493

- The question as we have it: A small nursery school has a class with children of various ages. The table gives the number of children of each age in the class. 3 years old 4 years old 5 years old Male $\text{2}$ $\text{7}$ $\text{6}$ Female $\text{6}$ $\text{5}$ $\text{4}$ If a child is selected at random what is the probabili…
- The book's answer: = 0,56
- What is wrong: The book's own working reaches 17/30 = 0,5667 but prints 0,56 (truncated). The correct rounding is 0,57, so the printed key is wrong.
- The right answer (our own working, not applied to the book): 17/30 (0,57 to 2 d.p.)
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 14-8, question 13f**, page 493

- The question as we have it: Fiona has $\text{85}$ labelled discs, which are numbered from $\text{1}$ to $\text{85}$ . If a disc is selected at random what is the probability that the disc number: is a multiple of $\text{3}$ or $\text{4}$
- The book's answer: = 0,55
- What is wrong: The book lists 21 multiples of 4 but says 28, and then subtracts the product P(3)*P(4) as if the events were independent. The correct overlap is the multiples of 12, 7 of them. The printed 0,55 is wrong.
- The right answer (our own working, not applied to the book): 42/85 (0,49 to 2 d.p.)
- In the question bank: **not used**. The book's answer was never changed.

### The question's text is damaged or unclear (4)


**Exercise 14-1, question 7e**, page 474

- The question as we have it: A playing card is selected randomly from a pack of $\text{52}$ cards. Determine the probability that it is: a number less than $\text{4}$
- The book's answer: $&=\frac{3}{13}$
- What is wrong: The stem does not say the ace counts as 1. The book's key 3/13 depends on counting the ace as a number less than 4. Under the usual reading that an ace is not a number card, the answer is 2/13, and a student giving it would be marked wrong.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 14-3, question 1**, page 480

- The question as we have it: A group of learners are given the following Venn diagram: [figure] The sample space can be described as $\{n:n\epsilon\mathbb{Z},1\leq n\leq15\}$ . They are asked to identify the event set of $B$ . They get stuck, and you offer to help them find it. Which of the following sets best describes the ev…
- The book's answer: Therefore the event set {1;2;3;4;5;7;8;9;10;11;12;13;14;15} best describes the event set of B.
- What is wrong: The book's answer {1;2;3;4;5;7;8;9;10;11;12;13;14;15} is not among the stem's options: the second option reads {1;2;3;4;5;7;8;9;10;11;12;14;15} and lacks 13. Either an element was lost from the option or the book misprints it.
- The right answer (our own working, not applied to the book): {1;2;3;4;5;7;8;9;10;11;12;13;14;15}
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 14-3, question 3e**, page 480

- The question as we have it: Pieces of paper labelled with the numbers $\text{1}$ to $\text{12}$ are placed in a box and the box is shaken. One piece of paper is taken out and then replaced. Find: $n(S)$ $n(A)$ $n(B)$
- The book's answer: (none printed)
- What is wrong: The stem asks for n(A) and n(B), but events A and B are defined in an earlier part of the question and were not copied into this item. The book's 12, 6, 5 cannot be checked from what the student sees. The book working has no steps to restore A and B from.
- In the question bank: **not used**. The book's answer was never changed.

**Exercise 14-8, question 27e**, page 495

- The question as we have it: All the clubs are taken out of a pack of cards. The remaining cards are then shuffled and one card chosen. After being chosen, the card is replaced before the next card is chosen. What description of the sets $P$ and $N$ is suitable? (Hint: Find any elements of $P$ in $N$ and of $N$ in $P$ .)
- The book's answer: Mutually exclusive and complementary.
- What is wrong: Sets P and N are not defined in the stem; the typed options are invented combinations of categories. The book's own answer is 'Mutually exclusive and complementary' (not verifiable here).
- In the question bank: **not used**. The book's answer was never changed.
