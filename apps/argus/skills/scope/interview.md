# The interview

Adapted from `interview-me` in addy-agent-skills (MIT, © 2025 Addy Osmani): the grounding comes first, and the restate ends in `intent.md`.

What people ask for and what they want are different things. They say "a dashboard" because that is what one asks for, and "make it faster" without a number. The cheapest moment to find the gap is now, before a spec exists. You are done at 95%: when you can predict the user's reaction to the next three questions you would ask.

## 1. Commit to a hypothesis, with a number

After the grounding in step 1 of `SKILL.md`, write your best read in one sentence and an honest confidence. Report the number again every round, so the gap is visible. Below 95%, say on the same line what is missing: that list is the interview's agenda, and it is worked through one question at a time.

```
HYPOTHESIS: You want a failed job to be re-runnable from its page on the same base, without retyping.
CONFIDENCE: ~45% — missing: same base or current tip, a new row or the same one, which failures qualify
```

A number you cannot defend by predicting the next three answers is the wrong number.

## 2. One question at a time, each with your guess

```
Q:     Should the re-run use the failed job's base commit, or the branch's tip today?
GUESS: The same base. A flaky install is the thing you want to retry, and a moved base
       would change two things at once. If you want the tip, it is closer to a new job.
```

Wait for the answer. The third question depends on the first; a batch buries your guesses and invites skimming. Attach the guess because reacting is faster than generating — and sometimes guess the way you expect to be corrected, so a polite user cannot just agree.

Ground every guess in what you read: the spec's criterion, the arch doc's contract, the code at its base branch. A guess that cites `S-20` or a file is one the user can check.

Pitch every question to a junior engineer who is ready for senior: they will follow any reasoning, and they have not read the spec. So name the thing, not its id — what happens today, what would change, and what it costs either way. An `S-n` or a file path is a citation at the end of a sentence, never the sentence itself. A question the user must open a file to understand is a question that gets a polite, uninformed yes.

## 3. When two readings lead to different work, show them

A question whose answers change the shape of the work — a new record or a field on an old one, a page or a command — gets two or three short options, your recommendation first and why, then the user's pick. This is the interview's divergent move; use it at the forks, not on every question.

## 4. Listen for "should want"

Watch for answers that sound like best practice rather than a want: "scalable", "clean", "the standard way", "I should probably…". Ask: *if you didn't have to justify this to anyone, what would you actually want?*

When the user asks something in return — a claim to check, what others do, what a talk said — answer it properly, with sources, before the next question. When you think their idea is wrong, say so and why; agreement you do not believe is the failure this interview exists to prevent.

## 5. Restate, in their words

At 95% or better, and not before, write it back, one line each, so it can be corrected line by line:

```
Outcome:      <one line>
User:         <who benefits>
Why now:      <what changed>
Success:      <how we know it worked>
Constraint:   <the binding limit>
Out of scope: <what we are explicitly not doing>
Yes / no / refine?
```

Out of scope is never optional: half of misalignment is silent disagreement about what is not being built.

## 6. The gate is an explicit yes

Not yes: "whatever you think" (re-ask as two options), "sounds good" (ask what they would refine), "sure, let's go" (the same), silence then "ok start" (ask what you missed). Fold every correction in and restate. After several rounds without your confidence rising, say so and ask whether to step back; that is information about the ask.

The yes produces `intent.md` in the shape in `SHAPES.md`, with the restate's lines expanded into its sections and the sources you cited listed at the end.
