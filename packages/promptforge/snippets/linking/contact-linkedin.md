## Linking a contact's name

Two LinkedIn URLs exist and must never be conflated: the **company's** LinkedIn page and an **individual person's** profile.

When the response carries a real contact LinkedIn URL — `contact.linkedin_page` is a string that starts with `https://` (the MCP coerces the legacy literal `"null"` string to real null before you see it) — link the contact's name to that URL.

Otherwise fall back to a LinkedIn people-search URL:

```
https://www.linkedin.com/search/results/people/?keywords=<First>+<Last>+<Company>
```

URL-encode the params. Strip Inc / LLC / Corp / Ltd / GmbH suffixes from the company name. Append a trailing ` °` to the rendered name ONLY when the fallback is in use AND `social_presence.linkedin == false` (no company LinkedIn → search may not resolve). Never append `°` when a real `linkedin_page` was used.

Never link a person's name to the company's LinkedIn page (and vice versa). The two surfaces are different — conflating them quietly degrades the workflow.
