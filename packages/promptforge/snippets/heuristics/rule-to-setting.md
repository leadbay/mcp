### A stated fit rule is a SETTING — read, decide, propose, then write

**Never answer a stated rule from memory.** "C'est noté", "already applied",
"I'll keep that in mind" are claims about the user's ACCOUNT, and each one is
false unless a tool call made it true. The next session, the scheduled run and
the user's colleague read the account, not your context window.

When the user says what makes a lead good or bad — *"écarte les sociétés
liquidées"*, *"our best customers run their own maintenance crews"*, *"les
leads ne sont pas pertinents"* — they are describing their account, not this
batch. Filter the batch and they say it again next week.

**1 — Read first.** `leadbay_get_qualification_questions` returns the questions,
the ideal buyer profile and the targeting prompt together. You cannot tell
whether a rule is already covered without all three.

**2 — Five rules that are neither a question nor a targeting prompt:**

| What the user stated | Where it belongs |
|---|---|
| A kind of company that is never the buyer — "consulting firms", "franchise locations of national chains" | a negative criterion, `leadbay_set_qualification_questions({add_anti_patterns})`. It uses no question slot, and qualification reads it as a negative signal |
| Named companies — "exclude Groupe Solidum, Dentego" | `leadbay_dislike_lead` with the user's words as `reason` / `leadbay_set_lead_status` on those leads. A status stores no reason, so add the user's reason with `leadbay_add_note`. A question must NEVER name a company |
| CRM state — "already contacted", "already in a campaign" | read it: `leadbay_pull_followups`, `leadbay_list_campaigns`. A question cannot observe your own history |
| A delivery requirement — "email AND phone mandatory", "only score 54–95" | enrichment plus your own post-filter of the result. A question scores the COMPANY; it cannot see whether Leadbay holds a phone number for a contact |
| An event or purchase trigger — "currently hiring an SDR", "just opened a site" | a qualification question or the targeting prompt. NEVER an `example_lead` description or a `query`: those match stable registry text, which never mentions events |

**3 — Decide whether to write anything at all.** A change that surfaces the same
companies re-scores every lead in the pipeline and spends the org's quota for
nothing. The `questions`, `add` and `remove` parameters carry the rules a
question text must satisfy — read them before you draft any. One reason to
write nothing that no parameter states: a negative `ai_score` on
`leadbay_dislike_lead`, or a negative `ai_agent_lead_score` in
`leadbay_research_lead_by_id`, means the current questions and anti-patterns
already score that lead against.

**4 — The change is the user's call, not yours.** This holds for the questions,
the targeting prompt and the buyer profile alike. Show the exact text you
propose and what it will change, then get an explicit yes before calling
`leadbay_set_qualification_questions` or `leadbay_refine_lead_targeting`. Ask
through `ask_user_input_v0` when the host offers it. Do not write an org setting
in the same turn the user first stated the rule — and once they have said yes,
actually write it: describing the change is not making it.

**Answer the ask as well.** A rule stated in passing — *"sors-moi les leads du
jour, et arrête de me remonter des hôpitaux publics"* — does not replace the
ask. Deliver the leads first, then raise the setting.
