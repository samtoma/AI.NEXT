"""Build the misconception catalogue for Prep-3 Mathematics.

    uv run build_misconceptions.py --out seed/misconceptions-math.json

WHY THIS EXISTS. The tutor's teaching bet is that a wrong answer should be met
with a refutation of the specific error the student made, not a restatement of
the right method. Until now nothing supported that: 750 distractors across the
250 book multiple-choice questions carried no misconception at all, and
`explanation_library` was empty, so even a diagnosed error had nothing grounded
to serve.

TWO KINDS OF ENTRY, and the distinction is load-bearing:

  * `distractor` — the error is encoded by a wrong option somebody deliberately
    wrote. Selecting that option IS the diagnosis, with no classifier needed.
    These are mined from the book's own MCQs, whose distractors turn out to be
    carefully chosen: in `q:u1-1-1:001` the wrong options are 15 (multiplied
    instead of adding), 2 (subtracted) and 35 (concatenated). Naming them makes
    250 existing questions diagnostic that were not before.

  * `conceptual` — a confusion a student voices rather than clicks. It has no
    distractor and never will. The prompt for this was Samuel reviewing a
    generated standard-deviation item: a reviewer asked why the divisor is n and
    not n−1. The book defines σ with n and never mentions the sample estimator,
    so the ITEM is right — but a student who meets n−1 from a tutor, a sibling
    or another AI has a real question, and today the tutor has nothing grounded
    to answer it with. That is what these entries are for.

GROUNDING. Every entry is written against the objective's own description and
the book's own distractors, not against mathematics in general. A refutation
that corrects a student using a convention the syllabus does not teach is worse
than silence: it contradicts their textbook and their teacher.

UNREVIEWED. These ship under the same standing exception as the generated
questions (constitution III as amended, ADR-0008): attributed, flagged, bounded
to the comparison environment, and sampled for human review.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

CATALOGUE: list[dict] = []


def mc(
    mid: str,
    lo: str,
    label: str,
    description: str,
    signal: str,
    refutation: list[str],
    maps: list[tuple[str, str]] | None = None,
    kind: str = "book_distractor",
    aliases: list[str] | None = None,
) -> None:
    """Register one misconception plus the refutation the tutor will serve.

    `refutation` is a list of plain steps. Step 1 always names what the student
    was thinking WITHOUT calling it stupid — the handoff's rule is to name the
    mistake precisely and kindly — and the last step always leaves them with the
    move that works, so the entry ends on something usable rather than on the
    correction.
    """
    CATALOGUE.append({
        "id": mid,
        "lo_id": lo,
        "label": label,
        "description": description,
        "signal": signal,
        "kind": kind,
        "refutation": [{"step": i, "text_md": t} for i, t in enumerate(refutation, 1)],
        "maps": [{"question_id": q, "choice_text": c} for q, c in (maps or [])],
        # Ids the question generator invented for the same error before this
        # catalogue existed. Folding them in here keeps ONE entry per error:
        # two ids for one misconception split its refutation and its evidence,
        # and the split is invisible until someone wonders why a common mistake
        # has half the attempts it should.
        "aliases": aliases or [],
    })


# ===========================================================================
# UNIT 1 — Relations and Functions
# ===========================================================================

mc("mc:u1-1-1:multiplied-not-added", "lo:u1-1-1",
   "Components multiplied when the question asks for their sum",
   "Finds a and b correctly from the equal pairs, then combines them with the wrong operation.",
   "The answer equals a x b where a + b was asked, or the reverse.",
   ["You read the pair correctly — that is the hard part, and you did it.",
    "From $(a, 5) = (3, b)$ the like components match: $a = 3$ and $b = 5$.",
    "The question then asks for $a + b$, which is $8$. The answer $15$ is $a \\times b$.",
    "Worth a habit: once you have the two values, read the last line of the question again before you combine them."],
   [("q:u1-1-1:001", "15")])

mc("mc:u1-1-1:components-subtracted", "lo:u1-1-1",
   "Components subtracted instead of added",
   "Reaches the right pair of values but subtracts them.",
   "The answer equals the difference of the two components.",
   ["Your values are right: $a = 3$ and $b = 5$.",
    "The question asks for $a + b = 8$; $2$ is $b - a$.",
    "The equality of ordered pairs gives you the two numbers. What you do with them afterwards is whatever the question asks for."],
   [("q:u1-1-1:001", "2")])

mc("mc:u1-1-1:digits-joined", "lo:u1-1-1",
   "Values written side by side instead of combined",
   "Writes the two components as digits of one number rather than performing the operation.",
   "The answer is the two component values concatenated.",
   ["You found $a = 3$ and $b = 5$ correctly.",
    "Writing them next to each other gives $35$, which is a new number, not a sum.",
    "$a + b$ means add: $3 + 5 = 8$."],
   [("q:u1-1-1:001", "35")])

mc("mc:u1-1-1:pair-order-ignored", "lo:u1-1-1",
   "Order of the pair ignored",
   "Reports (b, a) where (a, b) was asked; treats an ordered pair as an unordered set.",
   "The answer is the correct pair with its components swapped.",
   ["Both of your numbers are right — the issue is which one goes first.",
    "An ordered pair is *ordered*: $(0, 2)$ and $(2, 0)$ name different points and are not equal unless the two components happen to be the same.",
    "Match first-with-first and second-with-second, and keep them in that order when you write the answer."],
   [("q:u1-1-1:003", "$(2, 4)$")],
   aliases=['mc:pair-components-swapped'])

mc("mc:u1-1-2:product-commutes", "lo:u1-1-2",
   "X × Y treated as the same as Y × X",
   "Assumes the Cartesian product is commutative, so the pairs come out reversed.",
   "Every pair in the answer is a pair of the correct answer with its components swapped.",
   ["You built every pair the product contains — the pairing is right.",
    "But in $X \\times Y$ the FIRST component always comes from $X$. With $X = \\{1, 2\\}$ and $Y = \\{5\\}$ that gives $\\{(1,5), (2,5)\\}$.",
    "$Y \\times X$ would give $\\{(5,1), (5,2)\\}$ — the same elements, a different set.",
    "Read the product left to right: first set supplies the first component."],
   [("q:u1-1-2:001", "$\\{(5,1), (5,2)\\}$")])

mc("mc:u1-1-2:product-is-union", "lo:u1-1-2",
   "Cartesian product confused with the union",
   "Lists the elements of both sets instead of forming ordered pairs.",
   "The answer is a set of single elements rather than a set of pairs.",
   ["The elements you listed are the right ones to be working with.",
    "But $X \\times Y$ is a set of ORDERED PAIRS, not a set of elements: each pair takes one element from $X$ and one from $Y$.",
    "$\\{1, 2, 5\\}$ is $X \\cup Y$. The product is $\\{(1,5), (2,5)\\}$."],
   [("q:u1-1-2:001", "$\\{1, 2, 5\\}$")])

mc("mc:u1-1-3:arrow-starts-at-y", "lo:u1-1-3",
   "Arrows drawn from the second set",
   "Starts each arrow in an arrow diagram from an element of Y rather than of X.",
   "The diagram or the reasoning reverses the direction of every arrow.",
   ["You know the diagram joins one set to the other — that is the idea.",
    "In the arrow diagram of $X \\times Y$ every arrow STARTS at an element of $X$, the first projection, and ends at an element of $Y$.",
    "The direction carries the order of the pair; reversing it draws $Y \\times X$ instead."],
   [("q:u1-1-3:001", "an element of $Y$ (the second projection)")])

mc("mc:u1-1-4:quadrant-from-x-alone", "lo:u1-1-4",
   "Quadrant chosen from one coordinate",
   "Names the quadrant from the sign of x without checking y, or the reverse.",
   "The named quadrant matches one coordinate's sign and contradicts the other.",
   ["You are reading signs, which is exactly the right instinct.",
    "A quadrant needs BOTH signs: $(-2, 5)$ is negative then positive, which is the second quadrant.",
    "In order: $(+,+)$ first, $(-,+)$ second, $(-,-)$ third, $(+,-)$ fourth."],
   [("q:u1-1-4:001", "first quadrant"), ("q:u1-1-4:001", "third quadrant")],
   aliases=['mc:quadrant-from-x-only', 'mc:quadrant-sign-order'])

mc("mc:u1-1-4:axis-point-given-a-quadrant", "lo:u1-1-4",
   "A point on an axis placed in a quadrant",
   "Assigns a point with a zero coordinate to a quadrant; the axes belong to none.",
   "A point containing 0 is reported as being in a quadrant.",
   ["The sign you did read is right.",
    "But $(0, -3)$ has a zero first coordinate, so it sits ON the $y$-axis rather than inside any quadrant.",
    "The axes divide the plane into the four quadrants and belong to none of them — a zero anywhere in the pair puts the point on an axis."],
   [("q:u1-1-4:002", "in the third quadrant"), ("q:u1-1-4:002", "in the fourth quadrant")])

mc("mc:u1-2-1:relation-subset-of-one-set", "lo:u1-2-1",
   "A relation taken to be a subset of one of the sets",
   "Treats a relation as a set of elements rather than a set of ordered pairs.",
   "The answer names X or Y where X x Y is required.",
   ["A relation does involve both sets — that part is right.",
    "But its members are ORDERED PAIRS, so a relation from $X$ to $Y$ is a subset of $X \\times Y$.",
    "$X$ alone holds single elements, and a pair cannot be an element of it."],
   [("q:u1-2-1:001", "$X$"), ("q:u1-2-1:001", "$Y$")])

mc("mc:u1-2-1:rule-applied-backwards", "lo:u1-2-1",
   "The rule of the relation applied in reverse",
   "Reads a R b as b R a, producing every pair the wrong way round.",
   "Each pair in the answer is a correct pair reversed.",
   ["You applied the rule to every element, which is the method.",
    "The rule $b = 2a$ takes $a$ from $X$ first: $a = 1$ gives $b = 2$, so the pair is $(1, 2)$.",
    "Writing $(2, 1)$ answers a different question — the relation 'is half of' rather than 'is double of'.",
    "Say the rule aloud in the order the pair is written and it stays straight."],
   [("q:u1-2-1:002", "$\\{(2,1), (4,2)\\}$")])

mc("mc:u1-2-2:self-pairs-dropped", "lo:u1-2-2",
   "Pairs of an element with itself left out",
   "Omits (x, x) from a relation on a set, assuming a relation must join two different elements.",
   "The answer is the correct relation minus its self-paired members.",
   ["Every pair you listed genuinely satisfies the rule.",
    "One is missing: with $a + b = 0$ and $a = b = 0$, the pair $(0, 0)$ satisfies it too.",
    "A relation on a set may pair an element with itself — nothing in the definition forbids it."],
   [("q:u1-2-2:001", "$\\{(-1,1), (1,-1)\\}$")])

mc("mc:u1-3-1:function-condition-on-y", "lo:u1-3-1",
   "The function condition applied to the second set",
   "Requires each element of Y to appear once, instead of each element of X appearing exactly once as a first projection.",
   "The stated condition is about images rather than about the domain.",
   ["You have the right shape of condition — 'exactly once' is the key phrase.",
    "It applies to the FIRST set: every element of $X$ must appear exactly once as a first projection.",
    "Elements of $Y$ may repeat, or not appear at all — that is why the range can be a proper subset of the codomain."],
   [("q:u1-3-1:001", "each element of $Y$ appears exactly once as a second projection")])

mc("mc:u1-3-1:domain-element-repeated", "lo:u1-3-1",
   "An element of the domain given two images",
   "Accepts a relation as a function although one first projection appears twice.",
   "The chosen relation contains two pairs sharing a first component.",
   ["Every pair there is legal on its own.",
    "But $1$ appears as a first projection twice, in $(1,2)$ and $(1,3)$, so $1$ has two images.",
    "A function gives each input exactly one output — one repeat is enough to disqualify it."],
   [("q:u1-3-1:002", "$\\{(1,2), (1,3), (2,1), (3,2)\\}$")])

mc("mc:u1-3-1:domain-element-missing", "lo:u1-3-1",
   "An element of the domain left without an image",
   "Accepts a relation as a function although some element of X never appears.",
   "The chosen relation has fewer pairs than n(X).",
   ["No element is doubled here, which is half the condition.",
    "The other half is that EVERY element of $X$ must appear. With $X = \\{1,2,3\\}$ and only $(1,2), (2,3)$, the element $3$ has no image.",
    "Count the pairs against $n(X)$: for a function on $X$ they must match."],
   [("q:u1-3-1:002", "$\\{(1,2), (2,3)\\}$")])

mc("mc:u1-3-2:range-is-codomain", "lo:u1-3-2",
   "Range and codomain treated as the same set",
   "Reports the whole codomain as the range; the range is the set of images actually reached.",
   "The answer is Y rather than the set of second components of f.",
   ["You have found the right set to be looking at — $Y$ is where the images live.",
    "The RANGE is only the part of $Y$ that is actually reached: the second components of the pairs, $\\{3, 5, 7\\}$.",
    "$2$ belongs to the codomain but is nobody's image, so it is not in the range.",
    "Range $\\subseteq$ codomain, and the two are equal only when every element of $Y$ gets used."],
   [("q:u1-3-2:001", "$\\{2, 3, 5, 7\\}$"), ("q:u1-3-2:002", "The codomain must equal $\\{4, 6, 8\\}$")],
   aliases=['mc:range-is-codomain'])

mc("mc:u1-3-2:range-is-domain", "lo:u1-3-2",
   "Range confused with the domain",
   "Gives the set of inputs where the set of images was asked.",
   "The answer is X rather than the images.",
   ["That set is the domain — the inputs.",
    "The range is what comes OUT: the second component of each pair, $\\{3, 5, 7\\}$.",
    "Domain in, range out; the arrow diagram runs left to right."],
   [("q:u1-3-2:001", "$\\{-1, 2, 3\\}$"), ("q:u1-3-2:002", "The domain is $\\{4, 6, 8\\}$")])

mc("mc:u1-4-1:negative-or-fractional-power", "lo:u1-4-1",
   "An expression with a negative or fractional power called a polynomial",
   "Accepts 1/x or √x inside a polynomial function.",
   "The chosen function contains a variable in a denominator or under a root.",
   ["Most of that expression IS polynomial — the $x^3$ and the constant are fine.",
    "A polynomial function allows only whole-number powers of $x$, so $\\frac{1}{x}$ (which is $x^{-1}$) and $\\sqrt{x}$ (which is $x^{1/2}$) both disqualify it.",
    "Check every term: any $x$ in a denominator or under a root means it is not a polynomial."],
   [("q:u1-4-1:001", "$f(x) = x^3 + \\frac{1}{x} + 7$"),
    ("q:u1-4-1:001", "$f(x) = x^2 + \\sqrt{x} + 8$"),
    ("q:u1-4-1:001", "$f(x) = \\frac{2}{x^2}$")])

mc("mc:u1-4-1:degree-read-before-expanding", "lo:u1-4-1",
   "Degree read off without expanding",
   "Takes the highest power visible in the unexpanded form instead of multiplying out first.",
   "The reported degree is the largest exponent appearing in the brackets.",
   ["You are looking for the highest power, which is the right definition.",
    "It has to be the highest power AFTER multiplying out: $x(x - 2x^2) = x^2 - 2x^3$, so the degree is $3$.",
    "Expand first, then read the degree."],
   [("q:u1-4-1:004", "2")])

mc("mc:u1-4-2:line-through-0-a", "lo:u1-4-2",
   "f(x) = ax assumed to cut the y-axis at a",
   "Confuses the coefficient with an intercept, so the line is thought to pass through (0, a).",
   "The named fixed point is (0, a) or (a, 0) rather than the origin.",
   ["You are right that the line has a fixed point regardless of $a$.",
    "Substitute $x = 0$: $f(0) = a \\times 0 = 0$, so the line passes through $(0,0)$, the origin.",
    "In $f(x) = ax + b$ the intercept is $b$; here $b = 0$, which is exactly what puts the line through the origin."],
   [("q:u1-4-2:001", "the point $(0, a)$"), ("q:u1-4-2:001", "the point $(a, 0)$")])

mc("mc:u1-4-2:point-coordinates-swapped", "lo:u1-4-2",
   "Point tested with its coordinates the wrong way round",
   "Substitutes the y-value for x when checking whether a point lies on a line.",
   "The rejected/accepted point is the correct one reversed.",
   ["Your substitution method is right — that is how you test a point.",
    "Substitute the FIRST coordinate for $x$: for $(2, 1)$, $f(2) = 2(2) - 3 = 1$, which matches the second coordinate. It lies on the line.",
    "Testing $(3, 2)$ the same way gives $f(3) = 3$, not $2$."],
   [("q:u1-4-2:002", "$(3, 2)$")])

mc("mc:u1-4-2:constant-line-vertical", "lo:u1-4-2",
   "Constant function drawn as a vertical line",
   "Takes f(x) = c to be parallel to the y-axis rather than the x-axis.",
   "The answer names the y-axis where the x-axis is correct.",
   ["You know the graph is a line parallel to an axis — that is the right picture.",
    "$f(x) = 5$ means the output is $5$ for EVERY input, so the height never changes: a horizontal line, parallel to the $x$-axis.",
    "A vertical line would give one input many outputs, which cannot be a function at all."],
   [("q:u1-4-2:003", "parallel to the y-axis")])

mc("mc:u1-4-3:max-min-confused", "lo:u1-4-3",
   "Maximum and minimum exchanged",
   "Reads the sign of a the wrong way: a < 0 opens downward and gives a maximum.",
   "The answer names a minimum where the curve opens downward, or the reverse.",
   ["Your value is right — the issue is what to call it.",
    "In $f(x) = -x^2 + 4x - 1$ the coefficient of $x^2$ is negative, so the parabola opens DOWNWARD and the vertex is the highest point: a maximum.",
    "$a > 0$ opens upward and gives a minimum; $a < 0$ opens downward and gives a maximum."],
   [("q:u1-4-3:003", "minimum value equal to 3")])

mc("mc:u1-4-3:vertex-y-read-as-c", "lo:u1-4-3",
   "Constant term read as the extreme value",
   "Reports c as the maximum or minimum instead of evaluating f at the vertex.",
   "The stated extreme value equals the constant term.",
   ["$-1$ is in the function, so it is a reasonable thing to reach for.",
    "But $c$ is the value at $x = 0$, not at the vertex. The vertex is at $x = -\\frac{b}{2a} = 2$, and $f(2) = -4 + 8 - 1 = 3$.",
    "Find the vertex's $x$ first, then substitute to get the extreme value."],
   [("q:u1-4-3:003", "maximum value equal to $-1$")])


# ===========================================================================
# UNIT 2 — Ratio, proportion and variation
# ===========================================================================

mc("mc:u2-1-1:antecedent-consequent-swapped", "lo:u2-1-1",
   "Antecedent and consequent exchanged",
   "Names the second term of a ratio as the antecedent.",
   "The answer is the consequent, or the ratio written in reverse order.",
   ["You have identified a term of the ratio correctly.",
    "In $4 : 9$ the FIRST term, $4$, is the antecedent and the second, $9$, is the consequent.",
    "The order matters: $4 : 9$ and $9 : 4$ are different ratios."],
   [("q:u2-1-1:001", "9"), ("q:u2-1-1:002", "$4 : 3$"), ("q:u2-1-1:003", "$5 : 3$")])

mc("mc:u2-1-1:ratio-terms-added", "lo:u2-1-1",
   "Terms of a ratio added together",
   "Combines the two terms into their sum rather than keeping the comparison.",
   "The answer is a single number equal to the sum of the terms.",
   ["Both numbers are the right ones.",
    "A ratio COMPARES two quantities; it is not a single total. $4 : 9$ stays as a pair.",
    "$13$ would be the total number of parts, which is a different (and sometimes useful) quantity."],
   [("q:u2-1-1:001", "13")])

mc("mc:u2-1-1:ratio-left-unreduced", "lo:u2-1-1",
   "Ratio not reduced to simplest form",
   "Gives the raw ratio where the simplest form is asked.",
   "The answer is a correct but unreduced equivalent.",
   ["The comparison you wrote is correct — it is the same ratio.",
    "Simplest form means dividing both terms by their highest common factor: $6 : 8$ has HCF $2$, giving $3 : 4$.",
    "Check afterwards that the two terms share no factor other than $1$."],
   [("q:u2-1-1:002", "$6 : 8$")],
   aliases=['mc:ratio-not-reduced'])

mc("mc:u2-1-1:equal-ratio-by-difference", "lo:u2-1-1",
   "Equivalent ratios found by adding rather than multiplying",
   "Looks for a constant difference between terms instead of a constant multiplier.",
   "The chosen ratio keeps the gap between the terms, not their quotient.",
   ["You spotted a pattern — but it is the wrong one for ratios.",
    "Equivalent ratios come from MULTIPLYING both terms by the same number: $3 : 5$ times $4$ gives $12 : 20$.",
    "$5 : 7$ keeps the difference of $2$, which does not preserve the ratio: $\\frac{3}{5} \\neq \\frac{5}{7}$."],
   [("q:u2-1-1:003", "$5 : 7$")])

mc("mc:u2-1-1:one-term-squared", "lo:u2-1-1",
   "Only one term multiplied",
   "Scales the terms of a ratio by different factors.",
   "One term is scaled and the other is not, or each by a different amount.",
   ["Multiplying to find an equivalent ratio is the right move.",
    "Both terms must be multiplied by the SAME number. $9 : 25$ comes from $3 \\times 3$ and $5 \\times 5$ — different factors, so a different ratio.",
    "$3 : 5$ times $4$ gives $12 : 20$; check by simplifying back."],
   [("q:u2-1-1:003", "$9 : 25$")])

mc("mc:u2-1-1:ratio-fixes-the-values", "lo:u2-1-1",
   "A ratio read as fixing the actual values",
   "Takes a/b = 2/7 to mean a = 2 and b = 7 exactly, rather than a = 2m, b = 7m.",
   "The answer asserts specific values, or a specific sum, from a ratio alone.",
   ["Those values do satisfy the ratio — they are one possible pair.",
    "But a ratio fixes only the RELATIONSHIP: $a = 2m$ and $b = 7m$ for some $m \\neq 0$. $a = 4, b = 14$ works just as well.",
    "That is also why $a + b = 9$ is not certain: the sum is $9m$, which depends on $m$."],
   [("q:u2-1-1:004", "$a = 2$ and $b = 7$"), ("q:u2-1-1:004", "$a + b = 9$")])

mc("mc:u2-1-2:adding-preserves-ratio", "lo:u2-1-2",
   "Adding the same number to both terms assumed to preserve the ratio",
   "Carries the rule for multiplication over to addition.",
   "The student asserts the ratio is unchanged after adding to both terms.",
   ["The rule you are thinking of is real — but it is about multiplying.",
    "Multiplying both terms by the same nonzero number leaves a ratio unchanged. ADDING does not: $3 : 5$ becomes $4 : 6 = 2 : 3$, which is different.",
    "Test it with the numbers whenever you are unsure — one example settles it."],
   [("q:u2-1-2:001", "never changes")])

mc("mc:u2-2-1:proportion-is-a-sum-or-product", "lo:u2-2-1",
   "Proportion defined as a sum or product of ratios",
   "Treats a proportion as an operation between ratios rather than an equality of them.",
   "The definition chosen involves adding or multiplying two ratios.",
   ["You know a proportion involves two ratios.",
    "It is their EQUALITY: $\\frac{a}{b} = \\frac{c}{d}$. Nothing is added or multiplied — the statement is that the two comparisons are the same.",
    "That equality is what lets you cross-multiply."],
   [("q:u2-2-1:001", "the sum of two ratios"), ("q:u2-2-1:001", "the product of two ratios")])

mc("mc:u2-2-1:means-extremes-swapped", "lo:u2-2-1",
   "Means and extremes exchanged",
   "Names b and c as the extremes of a/b = c/d.",
   "The answer gives the middle pair where the outer pair is asked.",
   ["You have the right pair of terms in mind, just the other pair.",
    "Written as $a : b = c : d$, the EXTREMES are the outer terms $a$ and $d$; the means are the inner terms $b$ and $c$.",
    "The rule 'product of the extremes = product of the means' is exactly $ad = bc$."],
   [("q:u2-2-1:002", "$b$ and $c$")])

mc("mc:u2-2-2:cross-multiplication-reversed", "lo:u2-2-2",
   "Cross-multiplication paired incorrectly",
   "Multiplies numerator by numerator and denominator by denominator, or top-to-bottom on the same side.",
   "The stated product is ab = cd or ac = bd rather than ad = bc.",
   ["Cross-multiplying is the right tool here.",
    "It pairs each numerator with the OTHER fraction's denominator: $\\frac{a}{b} = \\frac{c}{d}$ gives $a \\times d = b \\times c$.",
    "Draw the two diagonals of the equality and multiply along each one — they cross, which is where the name comes from."],
   [("q:u2-2-2:001", "$ab = cd$"), ("q:u2-2-2:001", "$ac = bd$")])


# ===========================================================================
# UNIT 3 — Statistics
# ===========================================================================

mc("mc:u3-1-1:secondary-called-primary", "lo:u3-1-1",
   "Ready-made data called a primary resource",
   "Classifies data taken from published records as field data because the student gathered it themselves.",
   "A record, website or publication is described as a primary resource.",
   ["Collecting the data yourself does feel like field work — that is the honest confusion here.",
    "What decides it is where the data ORIGINATED. Figures already compiled by someone else are SECONDARY, however you obtained them.",
    "Primary means you generated the observations: a questionnaire you distributed, an interview you conducted, a count you made."],
   [("q:u3-1-1:002", "primary (field)"),
    ("q:u3-1-1:005", "Hany, who copied population figures from a newspaper report"),
    ("q:u3-1-1:005", "Omar, who downloaded last year's exam statistics from the ministry website"),
    ("q:u3-1-1:005", "Sara, who used tables published by a statistics agency")])

mc("mc:u3-1-1:primary-assumed-cheap", "lo:u3-1-1",
   "Primary resources assumed to be the quick and cheap option",
   "Reverses the trade-off: field data is accurate but costly; secondary data is cheap but second-hand.",
   "The answer attributes low cost or speed to primary collection.",
   ["There is a real trade-off here, and you are reaching for it.",
    "It runs the other way: PRIMARY resources are the accurate ones and cost the most time, effort and money. SECONDARY resources save all three but you did not control how they were gathered.",
    "Accuracy costs; convenience costs accuracy."],
   [("q:u3-1-1:004", "low cost; give inaccurate outcomes"),
    ("q:u3-1-1:003", "They are the most accurate of all resources")])

mc("mc:u3-1-2:sample-assumed-more-accurate", "lo:u3-1-2",
   "A sample assumed to be more accurate than a census",
   "Justifies sampling by accuracy rather than by cost, size or destructive testing.",
   "The reason given for sampling is that it is more accurate.",
   ["Sampling is the right method in that situation — the reason is what slipped.",
    "A census covers every value, so it is the MORE accurate method. We sample when a census is impossible or self-defeating: the society is gigantic, or the test destroys what it measures.",
    "Testing every lamp until it burns out would leave nothing to sell."],
   [("q:u3-1-2:003", "Because samples always give more accurate outcomes than a census")])

mc("mc:u3-2-1:zero-dispersion-means-zero-values", "lo:u3-2-1",
   "Zero dispersion read as zero values",
   "Takes 'dispersion = 0' to mean the values or the mean are zero, rather than that the values are identical.",
   "The answer claims a value, mean or count of zero.",
   ["Zero is doing something specific here, and it is worth being exact about what.",
    "Dispersion measures how far apart the values are. Zero dispersion means they are ALL EQUAL — not that they are zero.",
    "$7, 7, 7, 7$ has dispersion zero and a mean of $7$."],
   [("q:u3-2-1:002", "the set has no values"),
    ("q:u3-2-1:002", "the greatest value is zero"),
    ("q:u3-2-1:002", "the mean is zero")])

mc("mc:u3-2-1:range-thought-to-use-all-values", "lo:u3-2-1",
   "The range assumed to reflect every value",
   "Misses that the range depends only on the two extremes, which is precisely its weakness.",
   "The stated weakness of the range involves the mean, the count or the middle value.",
   ["You are right that the range has a weakness — this is the one.",
    "It uses ONLY the greatest and smallest values. Everything in between could move anywhere without changing it.",
    "That is why the standard deviation exists: it is affected by every value in the set."],
   [("q:u3-2-1:004", "the mean of the values"),
    ("q:u3-2-1:004", "the number of the values"),
    ("q:u3-2-1:004", "the middle value of the set")])

mc("mc:u3-2-2:variance-not-rooted", "lo:u3-2-2",
   "Square root never taken",
   "Stops at the variance and reports it as the standard deviation.",
   "The answer is the square of the correct standard deviation.",
   ["Every step up to there was right — you found the average of the squared deviations correctly.",
    "That average is the VARIANCE. The standard deviation is its positive square root.",
    "For $3, 5, 5, 7$: mean $5$, squared deviations $4, 0, 0, 4$, average $2$, so $\\sigma = \\sqrt{2}$.",
    "One last step, every time: take the root."],
   [("q:u3-2-2:004", "$2$")])

mc("mc:u3-2-2:deviations-not-averaged", "lo:u3-2-2",
   "Squared deviations summed but not averaged",
   "Divides by nothing before taking the root, so the sum is used in place of its mean.",
   "The answer is √(Σd²) rather than √(Σd²/n).",
   ["Your deviations and their squares are right.",
    "They have to be AVERAGED before the root: divide the sum by $n$, the number of values.",
    "Sum $= 8$, $n = 4$, so the average is $2$ and $\\sigma = \\sqrt{2}$ — not $\\sqrt{8}$.",
    "The formula carries the division inside the root: $\\sigma = \\sqrt{\\frac{\\sum (x - \\bar{x})^2}{n}}$."],
   [("q:u3-2-2:004", "$\\sqrt{8}$")])

mc("mc:u3-2-2:sigma-as-range-or-mean", "lo:u3-2-2",
   "Standard deviation confused with the range or the mean",
   "Defines σ as a spread already named, or as the average of the values themselves.",
   "The definition chosen is the range, or the mean, rather than the root of the mean squared deviation.",
   ["Those are all real statistics — they just answer different questions.",
    "$\\sigma$ is the positive square root of the AVERAGE OF THE SQUARES OF THE DEVIATIONS from the mean.",
    "The mean says where the values sit; the range and $\\sigma$ say how spread out they are, and $\\sigma$ uses every value while the range uses two."],
   [("q:u3-2-2:001", "the difference between the greatest and smallest values"),
    ("q:u3-2-2:001", "the mean of the values"),
    ("q:u3-2-2:001", "the sum of the values divided by their range")])

mc("mc:u3-2-2:divisor-n-minus-one", "lo:u3-2-2",
   "Dividing by n − 1 instead of n",
   "Uses the sample standard deviation formula, which this curriculum does not define. "
   "Usually arrives from outside the book — a tutor, an older sibling, a calculator mode, or an AI assistant.",
   "The answer is larger than the expected one by the factor √(n/(n−1)); for five values, 2.24 where 2.00 is expected.",
   ["Good question, and you have not made a mistake in the arithmetic — you have met a second formula that exists in statistics.",
    "Your book defines the standard deviation of a SET OF VALUES as $\\sigma = \\sqrt{\\frac{\\sum (x - \\bar{x})^2}{n}}$ — divide by $n$, the number of values. That is the one to use here, and the one your exam will mark.",
    "The version with $n - 1$ belongs to a different situation: when the values are a SAMPLE and you want to estimate the spread of a much larger group you did not measure. Dividing by $n - 1$ makes that estimate slightly larger, because a small sample tends to look tighter than the group it came from.",
    "Your syllabus does not cover that case, so: divide by $n$. If a calculator or a website gives you a different number, check whether it used the sample setting."],
   kind="conceptual")

mc("mc:u3-2-3:x-read-as-frequency", "lo:u3-2-3",
   "Frequency substituted for the value",
   "Puts k where x belongs in the frequency-distribution formula.",
   "Deviations are computed from the frequencies rather than from the values.",
   ["You are using the right formula — the letters are what got crossed.",
    "$x$ is the VALUE (for classes, the centre of the set); $k$ is how many times it occurs.",
    "The deviation $(x - \\bar{x})$ measures how far a value sits from the mean; a frequency has no distance from the mean."],
   [("q:u3-2-3:001", "the frequency of the set")])


# ===========================================================================
# UNIT 4 — Trigonometry
# ===========================================================================

mc("mc:u4-1-1:degree-split-decimally", "lo:u4-1-1",
   "Degree divided into 100 parts",
   "Applies decimal place-value to degrees and minutes, so 0.25° is read as 25'.",
   "The minutes in the answer are the decimal digits of the degrees.",
   ["Decimals usually do work that way — angles are the exception.",
    "A degree is divided into $60$ minutes, and a minute into $60$ seconds. So $0.25^\\circ = 0.25 \\times 60 = 15'$, giving $20^\\circ\\ 15'$.",
    "Multiply the decimal part by $60$; never copy the digits across."],
   [("q:u4-1-1:001", "100 minutes"),
    ("q:u4-1-1:004", "$20^\\circ\\ 25'$"),
    ("q:u4-1-1:006", "$28^\\circ\\ 51'$"),
    ("q:u4-1-1:006", "$28^\\circ\\ 5'\\ 1''$")])

mc("mc:u4-1-1:minute-second-confused", "lo:u4-1-1",
   "Minutes and seconds confused",
   "Names 60 seconds as the subdivision of a degree, or leaves a decimal inside the minutes.",
   "The unit named for the first subdivision of a degree is the second.",
   ["The number $60$ is right — it is the unit that slipped.",
    "A degree splits into $60$ MINUTES; each minute then splits into $60$ SECONDS.",
    "So a leftover decimal in the minutes is converted again: $0.6' = 0.6 \\times 60 = 36''$."],
   [("q:u4-1-1:001", "60 seconds"),
    ("q:u4-1-1:004", "$20^\\circ\\ 2.5'$"),
    ("q:u4-1-1:006", "$28^\\circ\\ 30'\\ 6''$")])

mc("mc:u4-1-2:opposite-adjacent-swapped", "lo:u4-1-2",
   "Opposite and adjacent sides exchanged",
   "Takes the side next to the angle where the side facing it is required, swapping sine with cosine or inverting the tangent.",
   "The answer is the ratio of the other acute angle, or the reciprocal.",
   ["You picked the right two sides — the question is which is which.",
    "'Opposite' means the side FACING the angle, across the triangle from it; 'adjacent' is the side touching it that is not the hypotenuse.",
    "Mark the angle you are working from first, then label the three sides relative to THAT angle. They change when you switch angles.",
    "$\\sin = \\frac{\\text{opposite}}{\\text{hypotenuse}}$, $\\cos = \\frac{\\text{adjacent}}{\\text{hypotenuse}}$, $\\tan = \\frac{\\text{opposite}}{\\text{adjacent}}$."],
   [("q:u4-1-2:001", "$\\frac{BC}{AC}$"),
    ("q:u4-1-2:002", "adjacent ÷ opposite"),
    ("q:u4-1-2:003", "$\\frac{3}{5}$"),
    ("q:u4-1-2:004", "$\\frac{4}{3}$")])

mc("mc:u4-1-2:ratio-inverted", "lo:u4-1-2",
   "Ratio written upside down",
   "Divides the hypotenuse by a leg instead of the leg by the hypotenuse.",
   "The answer is greater than 1 for a sine or cosine, which is impossible.",
   ["The two sides are correct — they are the wrong way up.",
    "$\\sin$ and $\\cos$ put the HYPOTENUSE on the bottom, so both are always less than $1$ in a right-angled triangle.",
    "An answer above $1$ for a sine or cosine is a signal to flip the fraction and check."],
   [("q:u4-1-2:001", "$\\frac{AC}{AB}$"), ("q:u4-1-2:003", "$\\frac{5}{4}$")])

mc("mc:u4-1-2:tan-uses-hypotenuse", "lo:u4-1-2",
   "Hypotenuse used in the tangent",
   "Builds tan from a leg and the hypotenuse rather than from the two legs.",
   "The tangent is reported as a sine or cosine value.",
   ["You are choosing between the three sides, which is the right process.",
    "The tangent is the only ratio that does NOT use the hypotenuse: opposite over adjacent, the two legs.",
    "If the hypotenuse appears in your fraction, you have written a sine or a cosine."],
   [("q:u4-1-2:002", "opposite ÷ hypotenuse"),
    ("q:u4-1-2:002", "adjacent ÷ hypotenuse"),
    ("q:u4-1-2:004", "$\\frac{3}{5}$"),
    ("q:u4-1-2:004", "$\\frac{4}{5}$")])


# ===========================================================================
# UNIT 5 — Coordinate geometry
# ===========================================================================

mc("mc:u5-1-1:coordinates-added", "lo:u5-1-1",
   "Coordinates added instead of subtracted",
   "Uses x1 + x2 where x2 − x1 is required, so the distance comes out as a sum.",
   "The answer is the sum of the coordinates rather than their difference.",
   ["You are combining the coordinates, which is the right idea.",
    "Distance measures a DIFFERENCE: $AB = |x_2 - x_1|$ along the $x$-axis, so $|6 - 2| = 4$.",
    "$8$ is $6 + 2$. Adding gives you a bigger number that no longer describes a gap."],
   [("q:u5-1-1:001", "8")],
   aliases=['mc:distance-coords-added'])

mc("mc:u5-1-1:one-coordinate-used", "lo:u5-1-1",
   "Distance read from one point only",
   "Reports one point's coordinate as the distance instead of the separation between both.",
   "The answer equals one of the given coordinates.",
   ["That number is in the question, which is why it is tempting.",
    "A distance always involves BOTH points: $|6 - 2| = 4$, not $6$ or $2$ on their own.",
    "Ask what the number is measuring FROM as well as to."],
   [("q:u5-1-1:001", "2"), ("q:u5-1-1:001", "6")])

mc("mc:u5-1-1:root-not-taken", "lo:u5-1-1",
   "Square root never taken in the distance rule",
   "Stops at the sum of the squares.",
   "The answer is the square of the correct distance.",
   ["Your squares are right: $6^2 + 8^2 = 36 + 64 = 100$.",
    "That $100$ is the square of the distance. The rule ends with a root: $\\sqrt{100} = 10$.",
    "$AB = \\sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$ — the root is part of the formula, not an optional tidy-up."],
   [("q:u5-1-1:004", "100")],
   aliases=['mc:distance-root-dropped'])

mc("mc:u5-1-1:legs-added-before-squaring", "lo:u5-1-1",
   "Differences added before squaring",
   "Computes (dx + dy) rather than √(dx² + dy²).",
   "The answer equals the sum of the two coordinate differences.",
   ["Both differences are right — it is how they combine that changes.",
    "They cannot simply be added: the two directions are perpendicular, so Pythagoras applies. $\\sqrt{6^2 + 8^2} = 10$, not $6 + 8 = 14$.",
    "Square, add, then root — in that order."],
   [("q:u5-1-1:004", "14"), ("q:u5-1-1:004", "$\\sqrt{14}$")])

mc("mc:u5-2-1:midpoint-from-difference", "lo:u5-2-1",
   "Midpoint built from differences or sums without halving",
   "Subtracts or adds the coordinates instead of averaging them.",
   "The answer is the sum of the coordinates, or their difference halved.",
   ["You are working with both points, which is right.",
    "The midpoint AVERAGES: $M = \\left(\\frac{x_1 + x_2}{2},\\ \\frac{y_1 + y_2}{2}\\right)$, so $\\left(\\frac{2+4}{2},\\ \\frac{6+0}{2}\\right) = (3, 3)$.",
    "$(6, 6)$ is the sum with the halving forgotten. A midpoint must land BETWEEN the two points — check that it does."],
   [("q:u5-2-1:001", "$(6, 6)$")],
   aliases=['mc:midpoint-uses-difference'])

mc("mc:u5-1-2:right-angle-at-wrong-vertex", "lo:u5-1-2",
   "Right angle placed at the wrong vertex",
   "Identifies that the triangle is right-angled but names a vertex other than the one where the two shorter sides meet.",
   "The named vertex is not the one opposite the longest side.",
   ["You correctly spotted that it IS right-angled.",
    "The right angle sits at the vertex OPPOSITE the longest side — where the two shorter sides meet.",
    "Compute all three lengths, find the largest, and the right angle is at the vertex not touching it."],
   [("q:u5-1-2:001", "$A$"), ("q:u5-1-2:001", "$C$")])

mc("mc:u5-1-2:collinear-read-as-triangle", "lo:u5-1-2",
   "Three collinear points treated as a triangle",
   "Misses that AB + BC = AC means the points lie on one line and enclose no area.",
   "The answer describes a triangle although the three distances satisfy AB + BC = AC.",
   ["Your three lengths are right, and you are reading them against each other, which is the method.",
    "When the two shorter distances ADD EXACTLY to the longest, the points cannot form a triangle — the 'path' $A \\to B \\to C$ is as short as going straight, so $B$ lies on $\\overline{AC}$.",
    "They are collinear. A genuine triangle needs $AB + BC > AC$."],
   [("q:u5-1-2:005", "vertices of a right triangle"),
    ("q:u5-1-2:005", "vertices of an isosceles triangle")])

mc("mc:u5-3-1:slope-inverted", "lo:u5-3-1",
   "Run divided by rise",
   "Computes Δx/Δy instead of Δy/Δx.",
   "The answer is the reciprocal of the correct slope.",
   ["Both differences are right — the fraction is upside down.",
    "Slope is RISE over RUN: $m = \\frac{y_2 - y_1}{x_2 - x_1}$.",
    "A memory hook: slope answers 'how much does it climb for each step sideways', so the climb is on top."],
   kind="generated_distractor", aliases=['mc:slope-inverted'])

mc("mc:u5-3-3:perpendicular-sign-only", "lo:u5-3-3",
   "Sign flipped without taking the reciprocal",
   "Uses −m for a perpendicular slope instead of −1/m.",
   "The answer is the negative of the original slope.",
   ["Changing the sign is half of the rule, and you got that half.",
    "Perpendicular slopes multiply to $-1$, so the other slope is $\\frac{-1}{m}$ — flip the fraction AND change the sign.",
    "Check by multiplying: if the product is not $-1$, the lines are not perpendicular."],
   kind="generated_distractor", aliases=['mc:perpendicular-not-reciprocal'])


# ===========================================================================
# TERM 2 — Equations, fractions, probability
# ===========================================================================

mc("mc:t2u1-2-2:discriminant-sign", "lo:t2u1-2-2",
   "Sign of the discriminant misread",
   "Reports real roots when b² − 4ac < 0, or no roots when it is positive.",
   "The stated number of roots contradicts the sign of the discriminant.",
   ["Computing the discriminant is exactly the right first move.",
    "Its SIGN decides: positive gives two different real roots, zero gives one repeated root, negative gives none in $\\mathbb{R}$.",
    "A negative discriminant means the curve never meets the $x$-axis, so the solution set is $\\varnothing$."],
   kind="generated_distractor", aliases=['mc:discriminant-misread', 'mc:discriminant-sign'])

mc("mc:t2u2-2-1:domain-from-numerator", "lo:t2u2-2-1",
   "Domain excluded using the numerator",
   "Solves the numerator equal to zero when finding which values are excluded.",
   "The excluded value is the zero of the numerator instead of the denominator.",
   ["You are looking for where something equals zero, which is right.",
    "It is the DENOMINATOR that matters: division by zero is what is undefined.",
    "A zero numerator is perfectly fine — it just makes the whole fraction zero."],
   kind="generated_distractor", aliases=['mc:domain-from-numerator'])

mc("mc:t2u3-1-1:probability-denominator", "lo:t2u3-1-1",
   "Divided by the wrong total",
   "Puts n(S) on top, or divides by the outcomes NOT in A.",
   "The answer is greater than 1, or uses n(S) − n(A) as the denominator.",
   ["Your two counts are right.",
    "$P(A) = \\frac{n(A)}{n(S)}$ — favourable outcomes over ALL outcomes, including the favourable ones.",
    "A probability can never exceed $1$; if yours does, the fraction is inverted."],
   kind="generated_distractor", aliases=['mc:probability-denominator'])

mc("mc:t2u3-1-3:union-double-counts", "lo:t2u3-1-3",
   "Overlap counted twice in a union",
   "Adds P(A) and P(B) without subtracting P(A ∩ B).",
   "The answer exceeds the correct union probability by exactly P(A ∩ B).",
   ["Adding the two is the right starting point.",
    "Outcomes in BOTH events get counted once in each, so they are counted twice. Subtract the overlap: $P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$.",
    "When the events are mutually exclusive the overlap is empty and the subtraction changes nothing — which is why the simple sum sometimes appears to work."],
   kind="conceptual")

mc("mc:t2u3-2-1:complement-not-from-one", "lo:t2u3-2-1",
   "Complement not subtracted from 1",
   "Reports P(A) itself, or inverts it, instead of 1 − P(A).",
   "The answer and P(A) do not sum to 1.",
   ["You have the right probability in hand.",
    "An event and its complement cover everything that can happen, so they sum to $1$: $P(A^c) = 1 - P(A)$.",
    "Quick check: add your two probabilities. If they do not make $1$, one of them is not the complement."],
   kind="generated_distractor", aliases=['mc:complement-not-one-minus'])


# ===========================================================================
# GEOMETRY — circle
# ===========================================================================

mc("mc:geo1-2-1:point-position-reversed", "lo:geo1-2-1",
   "Inside and outside reversed",
   "Compares the distance from the centre with the radius the wrong way round.",
   "A point with MA > r is called inside, or the reverse.",
   ["Comparing $MA$ with $r$ is exactly the right test.",
    "Further from the centre than the radius means OUTSIDE: $MA > r$ is outside, $MA < r$ is inside, $MA = r$ is on the circle.",
    "Picture the radius as the wall: past it is outside."],
   kind="generated_distractor", aliases=['mc:point-position-reversed'])

mc("mc:geo2-2-2:inscribed-angle-doubled", "lo:geo2-2-2",
   "Inscribed angle doubled instead of halved",
   "Takes the inscribed angle to equal its arc, or twice it, rather than half.",
   "The answer equals the arc measure or twice it.",
   ["You have the right pair — the angle and its arc are linked.",
    "The INSCRIBED angle is HALF the arc it subtends; the CENTRAL angle on the same arc is the whole of it.",
    "So a $100^\\circ$ arc gives a $50^\\circ$ inscribed angle and a $100^\\circ$ central angle.",
    "Ask first where the vertex sits: on the circle (inscribed, half) or at the centre (central, whole)."],
   kind="generated_distractor", aliases=['mc:inscribed-doubled'])

mc("mc:geo2-5-1:cyclic-angles-equal", "lo:geo2-5-1",
   "Opposite angles of a cyclic quadrilateral taken as equal",
   "Applies the parallelogram property to a cyclic quadrilateral.",
   "The answer repeats the given angle instead of its supplement.",
   ["You are using a real property of quadrilaterals — it belongs to parallelograms.",
    "In a CYCLIC quadrilateral the opposite angles are SUPPLEMENTARY: they add to $180^\\circ$.",
    "So $m(\\angle A) = 100^\\circ$ gives $m(\\angle C) = 80^\\circ$.",
    "Equal opposite angles would only happen when both are $90^\\circ$."],
   kind="generated_distractor", aliases=['mc:cyclic-angles-equal'])




# ===========================================================================
# Errors the question generator encodes that the book's own distractors do not.
# These carried 287 distractors between them and had nothing to teach from:
# the diagnosis landed and the tutor had no grounded reply. An entry each.
# ===========================================================================

mc("mc:u1-1-1:transposition-sign", "lo:u1-1-1",
   "Sign lost when moving a term across the equals sign",
   "Solves x − 4 = 9 as x = 9 − 4, or y + 2 = 7 as y = 7 + 2.",
   "The answer differs from the correct one by twice the transposed term.",
   ["Transposing is the right move — the sign is what flips.",
    "Whatever is SUBTRACTED on one side is ADDED on the other: $x - 4 = 9$ gives $x = 9 + 4 = 13$.",
    "And the reverse: $y + 2 = 7$ gives $y = 7 - 2 = 5$.",
    "Check by substituting back into the original equation — it costs five seconds and catches every sign slip."],
   kind="generated_distractor", aliases=["mc:transposition-sign"])

mc("mc:u4-1-3:opposite-adjacent-swapped", "lo:u4-1-3",
   "Opposite and adjacent exchanged when computing a ratio",
   "Labels the sides relative to the wrong acute angle, or swaps opposite with adjacent.",
   "The answer is the ratio of the other acute angle, or the reciprocal.",
   ["You chose the right two sides — which is which is the question.",
    "Label the sides relative to the angle you are ASKED about: 'opposite' faces it across the triangle, 'adjacent' touches it and is not the hypotenuse.",
    "Both labels swap when you move to the other acute angle, which is why $\\sin A = \\cos C$ in a right-angled triangle.",
    "Mark the angle first, then label, then choose the ratio."],
   kind="generated_distractor", aliases=["mc:sin-cos-swapped"])

mc("mc:u3-2-1:range-is-mean", "lo:u3-2-1",
   "Range confused with the mean",
   "Averages the values instead of subtracting the smallest from the largest.",
   "The answer is the mean of the set.",
   ["The mean is a real and useful number — it just answers a different question.",
    "The mean says where the values SIT; the range says how far apart they are.",
    "Range $=$ greatest $-$ smallest. Nothing is divided."],
   kind="generated_distractor", aliases=["mc:range-is-mean"])

mc("mc:u1-2-2:relation-subset-of-x", "lo:u1-2-2",
   "A relation on X taken to be a subset of X",
   "Treats a relation on a set as a set of elements rather than of ordered pairs.",
   "The answer names X, or a set of single elements.",
   ["A relation on $X$ does live entirely inside $X$'s world — that instinct is right.",
    "Its members are ORDERED PAIRS of elements of $X$, so $R \\subseteq X \\times X$.",
    "$X$ itself holds single elements, and a pair is not one of them."],
   kind="generated_distractor", aliases=["mc:relation-subset-of-x"])

mc("mc:u1-4-2:intercept-is-slope", "lo:u1-4-2",
   "Slope and y-intercept exchanged",
   "Reads b as the slope and a as the intercept in f(x) = ax + b.",
   "The two values appear in each other's roles.",
   ["Both numbers are the right ones to be using.",
    "In $f(x) = ax + b$ the number ATTACHED TO $x$ is the slope; the loose number is the $y$-intercept.",
    "Substituting $x = 0$ settles it: $f(0) = b$, so $b$ is where the line crosses the $y$-axis."],
   kind="generated_distractor", aliases=["mc:intercept-is-slope"])

mc("mc:u1-4-2:constant-means-zero", "lo:u1-4-2",
   "Constant function taken to mean the function is zero",
   "Reads 'constant' as 'equal to zero' rather than 'unchanging'.",
   "The answer sets the whole function, rather than the coefficient of x, to zero.",
   ["You are right that something has to be zero — it is the coefficient of $x$, not the function.",
    "Constant means the output never CHANGES, whatever $x$ is. $f(x) = 5$ is constant and never zero.",
    "So in $f(x) = (m-3)x + 5$ the condition is $m - 3 = 0$, which leaves $f(x) = 5$."],
   kind="generated_distractor", aliases=["mc:constant-means-zero"])

mc("mc:u1-1-3:product-commutes", "lo:u1-1-3",
   "Diagram of X × Y assumed to serve for Y × X",
   "Treats the Cartesian product as commutative, so the shape of the diagram is assumed unchanged when the factors swap.",
   "The answer for Y x X repeats the count or shape belonging to X x Y.",
   ["The two diagrams do contain the same number of points — that much is true.",
    "But their SHAPE differs: in $X \\times Y$ the columns count the elements of $X$; in $Y \\times X$ they count the elements of $Y$.",
    "The product is not commutative: $X \\times Y$ and $Y \\times X$ are different sets of pairs unless $X = Y$."],
   kind="generated_distractor", aliases=["mc:cartesian-commutes"])

mc("mc:u1-1-3:points-vs-columns", "lo:u1-1-3",
   "Total points read as the number of columns",
   "Reports the whole point count of a net diagram where a column count is asked.",
   "The answer equals n(X) x n(Y) rather than one of the factors.",
   ["That number is genuinely in the diagram — it is the total of the points.",
    "Each COLUMN holds $n(Y)$ points, so the number of columns is the total divided by the height.",
    "$15$ points in columns of $3$ gives $5$ columns."],
   kind="generated_distractor", aliases=["mc:points-vs-columns"])

mc("mc:u1-1-3:product-is-sum", "lo:u1-1-3",
   "Cardinalities added instead of multiplied",
   "Computes n(X) + n(Y) where n(X) x n(Y) is required.",
   "The answer is the sum of the two set sizes.",
   ["You are combining the two sizes, which is the right shape of answer.",
    "Every element of $X$ pairs with EVERY element of $Y$, so the count multiplies: $n(X \\times Y) = n(X) \\times n(Y)$.",
    "Adding would count each element once instead of pairing them."],
   kind="generated_distractor", aliases=["mc:product-is-sum"])

mc("mc:t2u1-2-1:touch-means-two-roots", "lo:t2u1-2-1",
   "A touching curve read as having two distinct roots",
   "Treats a curve that meets the x-axis at one point as having two different solutions.",
   "The solution set given has two elements where the curve only touches.",
   ["You are reading roots off the graph, which is exactly what this method is.",
    "Count the points where the curve MEETS the axis: touching at one point means one repeated root, so the solution set has a single element.",
    "Two distinct roots need the curve to cross the axis twice — and that is the case where the discriminant is positive rather than zero."],
   kind="generated_distractor", aliases=["mc:touch-means-two-roots"])


# ===========================================================================
# driver
# ===========================================================================


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    ids = [m["id"] for m in CATALOGUE]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"duplicate misconception ids: {sorted(dupes)}")
    for m in CATALOGUE:
        if not m["refutation"]:
            raise SystemExit(f"{m['id']}: no refutation — a misconception with nothing to teach is a label, not an entry")
        if m["kind"] == "book_distractor" and not m["maps"]:
            raise SystemExit(f"{m['id']}: declared as book-distractor-encoded but maps to no book choice")
        if m["kind"] == "generated_distractor" and not m["aliases"]:
            raise SystemExit(f"{m['id']}: generated-distractor entries must alias the generator id they replace")
        if m["kind"] not in ("book_distractor", "generated_distractor", "conceptual"):
            raise SystemExit(f"{m['id']}: unknown kind {m['kind']!r}")

    bundle = {
        "catalogue": "prep3-math-misconceptions-v1",
        "generated_at": "2026-09-12",
        "generator": "authored against the book's own objectives and distractors — services/extraction/build_misconceptions.py",
        "course_id": "course:prep3-math-en",
        "reviewed": False,
        "misconceptions": CATALOGUE,
    }
    args.out.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n")

    by_kind: dict[str, int] = {}
    for m in CATALOGUE:
        by_kind[m["kind"]] = by_kind.get(m["kind"], 0) + 1
    mapped = sum(len(m["maps"]) for m in CATALOGUE)
    aliased = sum(len(m["aliases"]) for m in CATALOGUE)
    print(f"wrote {args.out} — {len(CATALOGUE)} misconceptions across "
          f"{len({m['lo_id'] for m in CATALOGUE})} objectives")
    print(f"  kinds: {dict(sorted(by_kind.items()))}")
    print(f"  book distractor mappings declared: {mapped}")
    print(f"  generator ids folded in as aliases: {aliased}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
