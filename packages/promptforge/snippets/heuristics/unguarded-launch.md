## A launched job cannot be stopped, and this tool has no retry guard

Leadbay has no cancel. Once this call returns, the work is queued on Leadbay and
runs to completion, and the quota it costs is already committed. The user
cancelling in the chat, a request timeout, or a closed stream stops YOUR waiting,
never the job.

Unlike the composite launchers, this tool has **no double-launch guard**: calling
it again always issues a new paid launch, even seconds later with identical
arguments. So when a call returns nothing at all, do not simply retry. Read the
record back first — `leadbay_research_lead_by_id` or `leadbay_get_contacts` for a
lead, `leadbay_account_status` for background work that has since finished — to
see whether the launch already landed, and tell the user what you are about to
spend before spending it again.
