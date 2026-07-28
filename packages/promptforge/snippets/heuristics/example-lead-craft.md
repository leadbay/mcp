### Crafting the `example_lead` seed — the input that decides result quality

The `example_lead` is a FICTIONAL typical ideal customer. Its text is embedded
and matched against millions of real company descriptions sourced from business
registries and company websites. Those descriptions state what a company **IS**
(stable business profile) — never what is happening. Write the seed the same
way, or the matcher drifts to the wrong companies. Each rule below is
load-bearing (validated live against staging, 2026-07-28):

1. **Describe the BUYER, never the seller.** Before writing, answer: "would
   this company write a check to my user?" A seed that describes what the user
   sells surfaces the user's *competitors and vendors*, not their customers.
   Classic trap: if the user's product helps companies of type X serve their
   customers of type Y, the seed describes X — never Y.
2. **Put everything in `description`; leave `name` unset.** A distinctive
   invented brand name pulls matching toward name-lookalikes: a seed named
   "Meridian Analytics" returned five unrelated companies all named
   "Meridian". No name beats any name.
3. **Registry style, one sentence to ~250 chars.** State the business profile:
   industry niche, business model, what they sell or operate, who they serve,
   observable scale (sites, membership, fleet). Write it like the first
   paragraph of the company's About-Us page.
   - STRONG: "Operator of full-service fitness centers offering strength
     training areas, group classes and personal training to individual members
     across multiple club locations."
   - WEAK (generic): "A gym in Texas."
   - WRONG (seller-side): "Supplier of durable modular flooring for gyms."
4. **No event language.** "hiring", "expanding", "just raised", "opening a new
   site" are not filters — real registry descriptions never contain them, so
   they dilute the profile and attract event-flavored noise. Temporal criteria
   in a `query` become best-effort ranking annotations at most (the response
   `explain.scope_notes` says so). Put purchase-trigger criteria in the org's
   qualification questions instead, where the paid qualification stage scores
   them from fresh research.
5. **No meta-markers.** Never "(example)", "(fictional)", "(placeholder)" —
   real descriptions don't carry them.
6. **Hard constraints go in `filters`, not prose.** Geography, sector, size
   bounds written into the description only *tint* the ranking; `filters` are
   enforced. Seed describes the archetype; filters draw the fence.
7. **Prefer `example_lead` over `query`.** Query text matches topic
   *vocabulary* — "gyms that need durable flooring" surfaces flooring VENDORS
   as strongly as gym BUYERS (measured: the same ICP delivered 0 leads from a
   query and on-profile leads from an example_lead). Use `query` only when the
   user's own wording carries signal an example can't express.
8. **One seed per buyer archetype.** If the ask spans two distinct segments
   (e.g. "gyms and logistics warehouses"), run one search per segment with its
   own description — a blended seed lands between the two clusters and matches
   neither. Distinct asks need distinct `request_id`s.
