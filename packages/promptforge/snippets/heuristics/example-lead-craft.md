### Crafting the `example_lead` seed — the input that decides result quality

The `example_lead` is a FICTIONAL typical ideal customer. Its text is embedded
and matched against millions of real registry/website company descriptions,
which state what a company **IS** — never what is happening. Write the seed
the same way or the matcher drifts. Every rule below is measured:

1. **Describe the BUYER, never the seller.** Ask: "would this company write a
   check to my user?" A seed describing what the user SELLS surfaces their
   *competitors and vendors*. Classic trap: if the product helps companies of
   type X serve customers of type Y, the seed describes X — never Y.
2. **Put everything in `description`; leave `name` unset.** An invented brand
   name pulls matching toward name-lookalikes — a seed named "Meridian
   Analytics" returned five unrelated "Meridian" companies.
3. **Registry style, one sentence to ~250 chars.** State the business profile:
   industry niche, business model, what they sell or operate, who they serve,
   observable scale (sites, membership, fleet). Write it like the first
   paragraph of the company's About-Us page.
   - STRONG: "Operator of full-service fitness centers offering strength
     training areas, group classes and personal training to individual members
     across multiple club locations."
   - WEAK (generic): "A gym in Texas."
   - WRONG (seller-side): "Supplier of durable modular flooring for gyms."
4. **No event language.** "hiring", "expanding", "just raised" are not
   filters — registry descriptions never contain them, so they dilute the
   profile. Purchase-trigger criteria belong in the org's qualification
   questions, where the paid stage scores them from fresh research.
5. **No meta-markers.** Never "(example)", "(fictional)", "(placeholder)" —
   real descriptions don't carry them.
6. **Hard constraints go in `filters`, not prose — exact keys:**
   `sectors: string[]`, `locations: string[]`, `employees_min: number`,
   `employees_max: number`. FLAT numbers — a nested `employees: {min, max}`
   object exists only in RESULT payloads, never on input. `locations` take
   city/state/region names ("Dallas, TX", "Texas", "Île-de-France"); NEVER
   a country — each universe is single-country, so whole-country intent =
   omit `locations` (a country name silently matches a same-named town:
   measured, "France" → the village of Francs). `example_lead.employees`
   does not filter; only `filters.employees_min/max` do.
7. **Prefer `example_lead` over `query`.** Query matches topic *vocabulary* —
   "gyms that need durable flooring" surfaces flooring VENDORS as strongly as
   gym BUYERS (measured: 0 delivered vs on-profile from the example). Use
   `query` only for signal an example can't express.
8. **One seed per buyer archetype.** An ask spanning two segments ("gyms and
   warehouses") needs one search each with its own description and
   `request_id` — a blended seed lands between the clusters and matches
   neither.
