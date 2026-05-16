## Status / scalar — single-sentence shape

The response is a status confirmation or scalar — render exactly one sentence inline. Do NOT emit a card or a table. Do NOT enumerate the affected records (that's the next tool's job).

Template patterns to follow:

- Job kicked off → `"✓ <Verb> N <noun(s)> — typically ~M minutes. I'll refresh when it's done."`
- No work needed → `"All N <noun(s)> already <state> — no work to do."`
- Long-running → `"⏳ <Verb> still running — N% complete; check back in ~M minutes."`
- Failure → `"⚠ <Verb> failed: <error>. <recovery hint>"`

After the status line, propose the obvious refresh / progress-check / recovery action in the NEXT STEPS block. Never expand the status into a card.
