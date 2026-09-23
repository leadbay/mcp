### Crafting the `example_lead` seed — the input that decides result quality

The `example_lead` is a FICTIONAL typical ideal customer, matched against real
registry/website descriptions — which state what a company **IS**, never what
is happening. Write it the same way or the matcher drifts. Every rule below is
measured:

1. **Describe the BUYER, never the seller.** Ask: "would this company write a
   check to my user?" A seed describing what the user SELLS surfaces their
   *competitors and vendors*. If the product helps companies of type X serve
   customers of type Y, the seed describes X — never Y.
2. **Put everything in `description`; leave `name` unset.** An invented brand
   name pulls matching toward name-lookalikes — a seed named "Meridian
   Analytics" returned five unrelated "Meridian" companies.
3. **Registry style, one sentence to ~250 chars.** Industry niche, business
   model, what they sell or operate, who they serve, observable scale. Write
   it like the first paragraph of their About-Us page.
   - STRONG: "Operator of full-service fitness centers offering strength
     areas, group classes and personal training to members across clubs."
   - WEAK: "A gym in Texas." WRONG: "Supplier of gym flooring." (seller-side)
4. **NO event language — in `description` or `query`.** "recrute", "hiring",
   "expanding", "just raised" never appear in registry text, so they match
   nothing. Send the trigger to `leadbay_set_qualification_questions` or
   `leadbay_refine_lead_targeting` and say so. "companies hiring a senior SDR" seeds as
   "B2B software company operating an in-house outbound sales team."
5. **No meta-markers.** Never "(example)", "(fictional)", "(placeholder)".
6. **Hard constraints go in `filters`, not prose — exact keys:**
   `sectors: string[]`, `locations: string[]`, `employees_min: number`,
   `employees_max: number`. FLAT numbers — nested `employees: {min, max}`
   exists only in RESULT payloads. `example_lead.employees` does not filter.
   `locations` take city/state/region names ("Dallas, TX", "Île-de-France");
   never a country: this workspace's own is dropped, any other is refused.
7. **Prefer `example_lead` over `query`.** Query matches topic *vocabulary*:
   "gyms that need durable flooring" surfaced flooring VENDORS, 0 delivered.
8. **One seed per buyer archetype.** An ask spanning two segments ("gyms and
   warehouses") needs one search each with its own description and
   `request_id` — a blended seed lands between the clusters, matching neither.
