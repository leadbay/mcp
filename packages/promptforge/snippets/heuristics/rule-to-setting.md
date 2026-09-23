### A stated fit rule is a SETTING — read, decide, propose, then write

**Never answer a stated rule from memory.** "C'est noté", "already applied",
"I'll keep that in mind", "the rule is now active" — every one of those is a
claim about the user's ACCOUNT, and it is false unless a tool call made it
true. The rule lives in the org's settings or it does not exist: your context
window ends with this conversation, and the next session, the scheduled run and
the user's colleague all read the account, not your memory. If you have not
called a tool, do not say the rule is in place.

When the user says what makes a lead good or bad — *"écarte les sociétés
liquidées"*, *"je ne veux pas d'associations"*, *"our best customers run their
own maintenance crews"*, *"les leads ne sont pas pertinents"* — they are
describing their account, not just this batch. Filter the batch and they say
it again next week; their questions, buyer profile and targeting prompt never
move.

**1 — Read before you decide.** Call `leadbay_get_qualification_questions`
first. It returns the question set PLUS the ideal buyer profile and the
targeting prompt those questions sit beside. You cannot judge whether a rule is
already covered without seeing them.

**2 — Decide WHERE the rule belongs.** One rule, one destination:

| What the user stated | Where it belongs |
|---|---|
| A sector, a headcount band, a territory | `leadbay_adjust_audience` / `leadbay_new_lens` filters — never a question |
| A company trait a stranger could estimate from that company's own website or registry record — "runs its own maintenance crew", "operates a large vehicle fleet", "is legally active and not in liquidation" | a qualification question |
| A kind of company that is never the buyer — "consulting firms", "franchise locations of national chains", "subsidiaries of large listed groups" | a negative criterion of the ideal buyer profile, `leadbay_set_qualification_questions({add_anti_patterns})`. It uses no question slot, and qualification reads it as a negative signal |
| A qualitative orientation too broad for one yes/no — "we sell to the private sector, not the public one", "harden the exclusion on the business model" | the targeting prompt, `leadbay_refine_lead_targeting` |
| Named companies — "exclude Groupe Solidum, Dentego" | `leadbay_dislike_lead` with the user's words as `reason` / `leadbay_set_lead_status` on those leads. A status stores no reason, so add the user's reason with `leadbay_add_note`. A question must NEVER name a company |
| CRM state — "already contacted", "already in a campaign", "already excluded" | read it: `leadbay_pull_followups`, `leadbay_list_campaigns`. A question cannot observe your own history |
| A delivery requirement — "email AND phone mandatory", "only score 54–95" | enrichment plus your own post-filter of the result. A question scores the COMPANY; it cannot see whether Leadbay holds a phone number for a contact |
| An event or purchase trigger — "currently hiring an SDR", "just opened a site" | a qualification question or the targeting prompt. NEVER an `example_lead` description or a `query`: those match stable registry text, which never mentions events |

**3 — Decide whether to change anything at all.** Touching a question
re-scores every lead in the pipeline and draws on the org's quota, so a change
that surfaces the same companies is a pure loss. Five reasons to write NOTHING
and say why:

1. **An existing question already covers the rule.** Quote that question back
   and stop. **Never reword a question that already means the same thing** —
   even when the user asks you to "clarify" or "improve" the wording. A reword
   is a removal plus an addition: it re-scores every lead, spends quota, and
   surfaces exactly the same companies. Offer instead to find out whether any
   question is testing the WRONG thing.
2. **The audience filter already enforces it** — sector, headcount, territory.
3. **An existing question already tests that dimension.** Two questions on one
   dimension waste a slot and add no signal.
4. **The question the user asked for is not decisive.** See step 4: say so,
   offer the sharper version, and write only what they then choose. Adding a
   question you know separates nothing is worse than adding none.
5. **Qualification already rejects the lead the user turned down.** A negative
   `ai_score` on `leadbay_dislike_lead`, or a negative `ai_agent_lead_score` in
   `leadbay_research_lead_by_id`, means the current questions and anti-patterns
   already score it against. An existing `anti_patterns` entry that says the same
   thing counts too.

**The ceiling is 5 questions.** Read the count before you answer an "add a
question" request: at 5 the honest answer is not "sure, I'll add it". Say in
that same turn that the set is full, list the five, and let the USER name which
one goes. Never pre-pick the casualty.

**4 — Write a DECISIVE question.** Check all six before you propose the text:

1. **The estimative marker is literal and mandatory.** English questions start
   `Is the company likely to …`. French questions start
   `L'entreprise est-elle susceptible de/d' …`. There is no third form. The
   scorer works from public text it cannot verify, so a verifiable question
   scores almost everything as no.
   - ✅ `Is the company likely to run its own in-house maintenance crew?`
   - ❌ `Does the company run its own maintenance crew?`
   - ❌ `Is the company a cold-storage plant?` — no `likely to`
   - ✅ `L'entreprise est-elle susceptible d'être en liquidation judiciaire ?`
   - ❌ `L'entreprise est-elle en liquidation ?` — no `susceptible`
2. **It tests the lead as a BUYER.** Before you write a question, ask: would
   a company answering yes write a cheque to THIS user? A question that only
   describes what the lead's own business does — "Is the company likely to
   manufacture branded pharmaceuticals?" for a seller of advertising — is a
   category test, not a buying test, and it scores the user's competitors and
   suppliers as well as their prospects. Test the need the user's offering
   meets: "Is the company likely to run consumer campaigns that need paid media
   placement?"
3. **Estimable from public material** — the company's website, its about page,
   its job postings, its registry entry. Never its budget, its internal plans
   or its future intentions. When the user's rule is un-observable ("has budget
   for copywriting"), propose the observable proxy, and tell them you swapped
   it and why.
4. **One dimension each.** `Is the company likely to operate a cold-storage
   plant AND run its own maintenance crew?` is two questions. Split it into
   two, or pick the one that discriminates better.
5. **Decisive.** It should split companies in general roughly 30/70 while the
   user's own customers answer yes. A question nearly everyone answers yes to
   — "has a website", "uses email", "is a company" — separates nobody. Do NOT
   write it as asked: say it would add no signal, and offer the sharper version
   you would write instead.
6. **≤120 characters, in the user's language.**

An org with **zero** questions scores every lead on firmographics alone. That
is a finding worth stating, and the fix is a starter set of **3** questions on
three different dimensions — not one. Propose all three at once.

**5 — The change is the user's call, not yours.** This holds for the questions,
the targeting prompt and the buyer profile alike. Show the exact text you
propose and what it will change, then get an explicit yes before calling
`leadbay_set_qualification_questions` or `leadbay_refine_lead_targeting`. Ask through
`ask_user_input_v0` when the host offers it. A removal or a swap additionally
needs `confirm:true`. Do not write an org setting in the same turn the user
first stated the rule — and once they have said yes, actually write it:
describing the change is not making it.

**Answer the ask as well.** A rule stated in passing — *"sors-moi les leads du
jour, et arrête de me remonter des hôpitaux publics"* — does not replace the
ask. Deliver the leads first, then raise the setting.
