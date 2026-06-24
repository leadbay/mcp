# Leadbay MCP docs — rewrite drafts

Ready-to-paste content for the public GitBook at `docs.leadbay.app/doc/leadbay-mcp/`.
Addresses Milan's review: drop lens/score vocabulary from the first-touch page,
point installation straight at the file, and turn the bare-menu homepage into a
teaser that funnels to Quickstart.

These pages live in GitBook, not in this repo — this file is a handoff so the
copy is reviewed alongside the real install mechanics (`README.md`,
`packages/dxt/`). Apply it in the GitBook editing session, then this file can be
removed.

> **Prerequisite — stable direct-download link.** GitHub's `.dxt` asset URL is
> versioned (`…/releases/download/mcp-v0.23.2/leadbay-0.23.2.dxt`) and changes
> every release, so it can't be hardcoded as "always latest". The install copy
> below uses `{{DXT_DIRECT_URL}}` — a short stable redirect (e.g.
> `https://get.leadbay.app/leadbay.dxt`) that 302s to the newest `.dxt`. Set
> this redirect up (Cloudflare/Vercel rule, or a CI step that updates a `latest`
> alias) before publishing. Fallback if it's never built: hardcode the current
> versioned URL and bump it per release.

---

## Page 1 — "What is Leadbay MCP?"

Remove the entire **Key concepts** table (Lens / Score / AI score / Taste
profile / Read vs write). Those are runtime concepts the assistant handles, not
onboarding concepts. Replace the page with:

# What is Leadbay MCP?

Leadbay MCP connects your AI assistant to your Leadbay account, so you can find,
research, and reach out to the right companies — just by asking, in plain
language.

### Why connect Leadbay to your assistant?

Ask your assistant things like:

- *"Pull my best new prospects for today."*
- *"Research how well Acme fits what I sell."*
- *"Draft an intro email to their VP of Sales."*
- *"Log that I just emailed them."*

It pulls qualified companies, researches them, drafts outreach, and tracks what
you've sent — without you leaving the chat.

### Where it works

Claude Desktop · Claude Cowork · Claude Code · Cursor · Codex

### Next step

**→ [Quickstart](../quickstart)** — connect it in about two minutes, no coding.

---

## Page 2 — Installation (direct file first, CLI as fallback)

## Install in Claude (one click)

**1. Download the extension** — **[⬇ Download Leadbay for Claude (.dxt)]({{DXT_DIRECT_URL}})** (this downloads the file directly).

**2. Open it** — double-click the downloaded `.dxt`. Claude opens an install
dialog → click **Install**.
*Doesn't open Claude? In Claude go to Settings → Extensions → Advanced → Install
extension… and pick the file.*

**3. Sign in** — Claude prompts you to connect Leadbay. Sign in and you're ready.

---

### Other assistants (Cursor, Codex, Claude Code)

Run the universal installer — it signs you in and connects whichever assistants
you pick (needs [Node 22+](https://nodejs.org)):

```bash
npx -y -p @leadbay/mcp@latest installer
```

To remove later:

```bash
npx -y -p @leadbay/mcp@latest installer --uninstall
```

Keep this copy in sync with the repo `README.md` install section so the two
don't drift.

---

## Page 3 — Leadbay MCP homepage (teaser, not a menu)

# Leadbay MCP

**Your AI assistant, now plugged into your leads.** Ask for prospects, research,
and outreach in plain language — Leadbay MCP does the rest.

**[→ Get started in 2 minutes (Quickstart)](./quickstart)**
*(render as a prominent primary button, above the fold)*

`[ TEASER SCREENSHOT 1 ]` — assistant returning a batch of qualified leads in chat
`[ TEASER SCREENSHOT 2 ]` — assistant drafting a personalized outreach email
`[ TEASER SCREENSHOT 3 ]` — a research card / company deep-dive

Below the teaser, secondary links as cards: **Installation · Tools reference ·
[Example prompts](./example-prompts)**.

### Screenshot capture guidance (3 hero shots — real product, dark-mode chat)

1. A `leadbay_pull_leads` result rendered in chat (the markdown lead table) —
   the core "ask → get leads" loop.
2. A `message_compose_v1` / outreach draft — shows it doesn't just list, it
   *acts*.
3. A research card (`leadbay_research_lead_by_id`) or the followups map — shows
   depth.

These mirror the product's three rendering surfaces (see the rendering section
of `CLAUDE.md`).

---

## Editorial checklist before publishing

- [ ] "What is" page has no remaining "lens", "score", "AI score", or "taste profile".
- [ ] Install download link downloads the `.dxt` directly (no intermediate page);
      `{{DXT_DIRECT_URL}}` redirect resolves to the current release asset.
- [ ] `npx -y -p @leadbay/mcp@latest installer` still matches the published package.
- [ ] Homepage shows the Quickstart CTA and at least one screenshot above the fold.
