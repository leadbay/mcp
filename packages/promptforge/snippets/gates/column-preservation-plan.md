Render this block VERBATIM as your byproduct:

```
COLUMN PRESERVATION PLAN
========================
| Source column      | Disposition                       | Reason                            |
|--------------------|-----------------------------------|-----------------------------------|
| <header from file> | standard:LEAD_NAME                | cleaned company name              |
| <header>           | standard:LEAD_WEBSITE             | domain agrees with brand          |
| <header>           | contact:CONTACT_EMAIL             | per-person mailbox                |
| <header>           | custom:HubSpot record (EXTERNAL_ID)| preserve link via url_template   |
| <header>           | note                              | meaningful per-lead context       |
| <header>           | derived:company_domain            | extracted from biz email          |
| <header>           | skip                              | blank placeholder / dup plumbing  |
========================
```

One row per meaningful source column. If you have 30+ columns, group blank/duplicate-plumbing columns under a single "skip" row with the count.
