## Status / scalar — single-sentence shape

The response is a status confirmation or scalar — render exactly one sentence inline. Do NOT emit a card or a table. Do NOT enumerate the affected records (that's the next tool's job).

Template patterns to follow:

- Job kicked off → `"⏳ <Verb> N <noun(s)> — usually ~M minutes."`, then check it in this turn
- No work needed → `"All N <noun(s)> already <state> — no work to do."`
- Still running at a check → `"⏳ <Verb> still running — N% complete."`, then check again
- Failure → `"⚠ <Verb> failed: <error>. <recovery hint>"`

After a failure, propose the recovery action in the NEXT STEPS block. Never expand the status into a card.
