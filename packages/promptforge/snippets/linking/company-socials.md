## Linking the company

Use the lead's `website` as the company-name link target — prefix `https://` if the value is a bare hostname.

Separately, the lead's own page in the Leadbay app IS linkable: `https://leadbay.app/app/<view>?lead=<lead.id>`, where `<view>` is `discover`, `monitor`, or `campaign`. Pick the view the lead lives in — `in_monitor` / `in_discover` are booleans on the `pull_followups` payload (every follow-up is `in_monitor: true`); `pull_leads` omits both flags and its leads are the Discover batch, so default to `discover` there. Linking a Monitor lead to `/app/discover` opens a list that does not contain it. A CAMPAIGN card needs two params — `https://leadbay.app/app/campaign?campaign=<campaign.id>&lead=<lead.id>` — the campaign selects the list and the lead opens the panel inside it; omitting `campaign=` opens an empty campaign view. The `lead` query param (`LEAD_QUERY_PARAM` in the web app) is read on load and opens the lead panel as an overlay. Use it for an explicit "Open in Leadbay" affordance — never as the company-name target, which stays `website`.

When the response carries `social_urls` (the post-fix multi-platform URL block on rich-lead responses), render every non-null platform as a pill chip in the company-info row. Iterate over `social_urls`'s keys — never hardcode a fixed list — and emit each as `[<platform-label>](<url>)`. Skip platforms whose URL is null.

`social_presence` carries booleans for the same 6 platforms (crunchbase, facebook, instagram, linkedin, tiktok, twitter) — useful when you only care that the company has a profile somewhere. Use it as the °-flag signal in the contact people-search fallback (see linking/contact-linkedin).
