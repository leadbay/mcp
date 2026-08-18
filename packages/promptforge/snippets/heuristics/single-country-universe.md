**One workspace = one country — a country name is NEVER a location filter.** The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**On `code: "COUNTRY_LEVEL_LOCATION"` read `country_locations[].axis` and `[].kind` — the recovery differs per case and they are NOT interchangeable, and do NOT retry with another spelling or a nearby city.**

`axis: "include"`:

- `home_country`, or "nationwide" / "everywhere" → omit the geo argument (`city` / `locations` / `location_ids`) and say the result covers the whole workspace.
- `foreign_country` ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- `supranational` ("EU", "EMEA") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- `country_indeterminate` (custom/staging backend) → its country is unknown, so claim nothing about what it holds.

`axis: "exclude"` reverses all of that — **never "omit the argument"**, which returns the very companies the user asked to remove. Excluding this workspace's own country would empty it; excluding any other country is a harmless no-op. Either way drop the value and ask what to carve out instead.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.
