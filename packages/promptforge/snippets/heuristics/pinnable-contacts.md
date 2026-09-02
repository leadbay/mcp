**Only `source: "org"` contacts are pinnable.** Every contact returned by `leadbay_research_lead_by_id` carries a `source` field, and the two sources are separate id namespaces on the backend:

- `source: "org"` — a row in your organization's own contact directory. Pinnable. Also carries `pinned` (true when someone has pinned it) and `pinned_by_ai` (true when Leadbay's AI pinned it rather than a human).
- `source: "paid"` — an enrichment *candidate* (the `candidates` bucket): a person Leadbay suggests but has not yet resolved into your directory. NOT pinnable, and carries no `pinned` field at all.

Passing a `source: "paid"` id here returns **`contact not found`**. That is the expected answer for a candidate, not an outage and not a transient error: nothing is broken, the person is simply not an org contact yet. Do not retry, do not re-fetch the lead hoping for a different result, and do not tell the user that pinning is failing or unavailable.

To pin someone who is currently only a candidate, first make them an org contact:

- `leadbay_enrich_contacts` with the lead id + this candidate's id enriches exactly this person. `leadbay_enrich_titles` (or `leadbay_prepare_outreach` with `enrich: true`) does the same by job title. When the provider finds an email or phone, each writes a NEW org contact for that person (or merges into an existing one). It has a **different `id`** from the paid candidate, so re-read the contacts list afterwards and pin the `source: "org"` row. If nothing was found, no org contact exists and there is nothing to pin.
- Or add them directly with `leadbay_add_contact`, which returns the new org contact's `id` — that id is pinnable immediately.

**Pinning does not steer enrichment.** It only marks who the priority is on a company the user already has. "Enrich the Directeur Général rather than the Président" is `leadbay_enrich_contacts` with that person's id (or `leadbay_enrich_titles` with the wanted title) — not a pin. Pinning first and enriching after changes nothing about who gets enriched.
