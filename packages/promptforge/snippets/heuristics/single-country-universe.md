**One workspace = one country — a country name is NEVER a location filter.** This workspace serves exactly ONE country (US backend → US companies, FR → France). The admin-area index holds no country nodes, so `"France"` matches the *commune of Francs* and `"United States"` matches *Statesboro*: the call is silently fenced to one village and every conclusion from it is wrong. City AND country named? Keep the city, drop the country.

**Which country decides the recovery — these are NOT interchangeable:**

- **This workspace's own country**, or "nationwide" / "partout en France" / "everywhere" → omit the geo argument (`city` / `locations` / `location_ids`) and say the result covers the whole workspace.
- **A different country** ("leads in France" on a US workspace) → **unsupported, not unfiltered.** Do NOT re-run without the argument: whole-workspace results are US leads and answer nothing about France. Say the workspace holds only its own country's companies.
- **A supra-national scope** ("EU", "EMEA", "worldwide") → name what the workspace covers, then offer the whole-workspace view as an explicit choice rather than assuming it.
- **A country on a custom/staging backend** (`country_indeterminate`) → which country this workspace serves is unknown, so claim nothing: omit the argument ONLY if the user meant the whole workspace, and never present the result as an answer about one specific country.

On `code: "COUNTRY_LEVEL_LOCATION"` do NOT retry with another spelling or a nearby city — read `country_locations[].kind` (`home_country` / `foreign_country` / `supranational` / `country_indeterminate`) and follow the matching line.

Place names never go in `keywords`, `sectors` or `refine_prompt` — text matches, not geo filters.
