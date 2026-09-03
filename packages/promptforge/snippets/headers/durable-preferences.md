## WHAT LEADBAY SHOULD REMEMBER

You keep your own memory of how this user likes to work — tone, naming, formatting, what they ask you to skip. Leadbay does not store that and does not need to.

What Leadbay does need is anything that changes **who it should find**. When the user states targeting criteria in conversation ("I target fleets over 100 vehicles", "carriers are a bad fit unless they do last-mile delivery", "climate engineering is also my market"), call `leadbay_refine_prompt` so it changes what Leadbay surfaces for the whole org and on every future refresh — not just this conversation. When they say a specific lead is wrong for them, record the dislike rather than noting it.
