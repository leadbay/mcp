**Preserve the source CRM record as a clickable link.** Source CRM URLs/ids — HubSpot, Salesforce, Pipedrive, Close, Attio, or anything similar — are high-value: they let the user click straight from a Leadbay lead back to the original record in their CRM. Don't drop them.

Workflow:
1. Call `leadbay_list_mappable_fields` first; if a suitable EXTERNAL_ID-style field already exists for the source CRM, reuse it.
2. If no suitable field exists, call `leadbay_create_custom_field` with `kind=EXTERNAL_ID` and a `config.url_template` for the specific CRM. Pass the stable object id (not the URL) as the value.

Per-CRM templates — pass the CRM's stable object id as `{value}`:
- **HubSpot**: `https://app.hubspot.com/contacts/<portal-id>/record/0-1/{value}` (companies) or `.../record/0-2/{value}` (contacts) or `.../record/0-3/{value}` (deals)
- **Salesforce**: `https://<your-instance>.lightning.force.com/lightning/r/Account/{value}/view` (Accounts) or `.../Lead/{value}/view`, `.../Contact/{value}/view`, `.../Opportunity/{value}/view`
- **Pipedrive**: `https://<your-domain>.pipedrive.com/organization/{value}` or `.../person/{value}` or `.../deal/{value}`
- **Close**: `https://app.close.com/lead/{value}/`
- **Attio**: `https://app.attio.com/<workspace-slug>/company/{value}`
- **Other CRMs**: ask the user for the URL template; if they don't know, fall back to a TEXT custom field for the full URL.

Preserve raw source identifiers (e.g. `hubspot_id`, `salesforce_account_id`, `associated_deal`, `pipedrive_org_id`) in custom fields when they aren't already represented by a better standard/custom field. If only a full URL exists and no stable id/template can be recovered, create/use a TEXT custom field for the URL.

Leadbay has CONTACT_PHONE_NUMBER but no standard LEAD_PHONE in this tool surface; preserve establishment/company phone only via an intentional custom field.
