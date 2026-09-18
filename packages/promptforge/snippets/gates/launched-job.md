## A LAUNCHED JOB — its first result is a receipt, not the answer

A result saying the job is still working (`still_running`, `next_poll`, a
`running` status) holds only ids to check it with. If the user's request needs
the output:

1. Say in one line what is running and roughly how long it takes, so the wait
   does not look broken.
2. In this same turn, check it with the tool named here until it reports
   finished: `wait_seconds: 45` where accepted, else every 15–30 s. A
   `stop_reason` or an early flat count is not finished.
3. Answer from the finished result.

Calling the launcher again is not a check: it can charge twice. Stop early
only if the user said not to wait or the check tool says the job stalled. Then
say it is not ready, show what landed, and that asking again fetches the rest.
