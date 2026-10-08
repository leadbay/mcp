(function () {
  // The recipe pins the light theme, set before the skin.
  document.documentElement.setAttribute("data-lb-theme", "light")
  const lb = window.LeadbayArtifacts
  lb.styles()

  const ASK = "Triage board"
  const PAGE_SIZE = 10
  const ACTIONS = [
    { value: "STILL_CHASING", label: "Still chasing" },
    { value: "INTEREST_VALIDATED_OR_MEETING_PLANED", label: "Meeting planned" },
    { value: "COULD_NOT_REACH_STILL_TRYING", label: "Could not reach" },
    { value: "NOT_INTERESTED_LOST", label: "Not interested" },
  ]

  const state = { page: 0, leads: [], total: 0, loaded: false, selected: new Set(), taste: "all", verdict: "all" }

  // ---- small helpers ----
  function h(tag, props, ...kids) {
    const el = document.createElement(tag)
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue
      if (k === "class") el.className = v
      else if (k === "text") el.textContent = v
      else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v)
      else el.setAttribute(k, v === true ? "" : String(v))
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid))
    return el
  }
  const real = (v) => (v && v !== "null" ? v : null)
  const svg = (paths) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor")
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round")
    s.setAttribute("aria-hidden", "true"); s.innerHTML = paths; return s
  }
  const ICON = {
    like: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    dislike: '<path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/>',
    out: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  }
  // 10-segment fit bar: ▰ profile fit, ❖ AI boost at the end of the run, ▱ empty.
  function bar(lead) {
    const filled = Math.max(0, Math.min(10, Math.round((lead.score || 0) / 10)))
    const boost = (lead.qualification_summary && lead.qualification_summary.avg_qualification_boost) || 0
    const ai = Math.max(0, Math.min(filled, Math.round(boost / 3.3)))
    return "▰".repeat(filled - ai) + "❖".repeat(ai) + "▱".repeat(10 - filled)
  }
  function verdictOf(lead) {
    const b = (lead.qualification_summary && lead.qualification_summary.avg_qualification_boost) || 0
    return b > 0 ? "boosted" : b < 0 ? "penalised" : "neutral"
  }
  function sizeText(size) {
    if (!size || (!size.min && !size.max)) return null
    return size.min && size.max ? `${size.min}–${size.max} employees` : `${size.min || size.max}+ employees`
  }
  function whyFits(lead) {
    return (
      real(lead.short_description) ||
      (lead.tags || []).slice(0, 2).map((t) => t.display_name).join(" · ") ||
      (lead.qualification_summary && lead.qualification_summary.best_response_excerpt) ||
      "No description yet — qualify to add one"
    )
  }
  const url = (host) => (/^https?:\/\//.test(host) ? host : "https://" + host)
  const leadUrl = (lead) => `https://leadbay.app/app/discover?lead=${encodeURIComponent(lead.id)}`
  const today = (lead) => new Set((lead.epilogue_today_statuses || []).map((e) => String(e.type).replace(/^EPILOGUE_/, "")))
  function toolMissing(err) {
    return /unknown tool|\btool\b[^.]*\bnot found|not_in_manifest|no such tool/i.test(String((err && (err.message || err.code)) || ""))
  }
  function say(msg, text, tone) { msg.textContent = text; msg.dataset.tone = tone || "" }

  // ---- toolbar ----
  const tally = document.getElementById("tally")
  const deck = document.getElementById("deck")
  const range = document.getElementById("range")
  const prev = document.getElementById("prev")
  const next = document.getElementById("next")
  const bulkMsg = document.getElementById("bulk-msg")
  document.getElementById("f-taste").addEventListener("change", (e) => { state.taste = e.target.value; render() })
  document.getElementById("f-verdict").addEventListener("change", (e) => { state.verdict = e.target.value; render() })

  const bulkStatus = lb.leadStatus("")
  lb.bindSelect(document.getElementById("bulk-status"), bulkStatus)
  const bulkWrite = lb.setStatus({ leadIds: () => [...state.selected], status: bulkStatus, ask: ASK })
  lb.bindAction(document.getElementById("bulk-apply"), bulkWrite)
  bulkWrite.subscribe((a) => {
    if (a.loading) say(bulkMsg, "Applying…")
    else if (a.error) say(bulkMsg, a.error.message, "error")
    else if (a.lastResult) say(bulkMsg, `Status applied to ${state.selected.size} lead${state.selected.size === 1 ? "" : "s"}.`, "ok")
  })
  document.getElementById("select-all").addEventListener("change", (e) => {
    for (const lead of visible()) e.target.checked ? state.selected.add(lead.id) : state.selected.delete(lead.id)
    render()
  })

  prev.addEventListener("click", () => loadPage(state.page - 1))
  next.addEventListener("click", () => loadPage(state.page + 1))

  async function loadPage(page) {
    deck.setAttribute("data-lb-state", "loading")
    prev.disabled = next.disabled = true
    try {
      const res = await lb.call("leadbay_pull_leads", { page, count: PAGE_SIZE, _triggered_by: ASK })
      state.leads = (res && res.leads) || []
      state.total = (res && res.pagination && res.pagination.total) || state.leads.length
      state.page = page
      state.loaded = true
      render()
    } catch (err) {
      state.loaded = true
      render()
      say(bulkMsg, err.message || "Could not load that page.", "error")
    } finally {
      deck.setAttribute("data-lb-state", "ready")
      renderPager()
    }
  }

  function visible() {
    return state.leads.filter((lead) => {
      if (state.taste === "liked" && !lead.liked) return false
      if (state.taste === "disliked" && !lead.disliked) return false
      if (state.taste === "none" && (lead.liked || lead.disliked)) return false
      if (state.verdict !== "all" && verdictOf(lead) !== state.verdict) return false
      return true
    })
  }

  function renderPager() {
    const from = state.page * PAGE_SIZE + 1
    range.textContent = state.leads.length ? `${from}–${Math.min(from + state.leads.length - 1, state.total)} of ${state.total}` : ""
    prev.disabled = state.page === 0
    next.disabled = (state.page + 1) * PAGE_SIZE >= state.total
  }

  function render() {
    if (!state.loaded) {
      tally.textContent = "Loading today's leads…"
      deck.replaceChildren(h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title", text: "Loading today's leads…" })))
      return
    }
    const rows = visible()
    tally.textContent = `${rows.length} lead${rows.length === 1 ? "" : "s"}${rows.length !== state.leads.length ? ` of ${state.leads.length}` : ""}`
    deck.replaceChildren(...(rows.length ? rows.map(card) : [h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title", text: "No lead matches these filters" }), h("div", { class: "lb-empty-hint", text: "Reset Taste and Verdict to All." }))]))
    renderPager()
  }

  // ---- one card ----
  function card(lead) {
    const name = lead.name || "Unnamed company"
    const msg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })

    // taste
    const likeBtn = h("button", { class: "lb-btn lb-btn-icon", type: "button", title: "Like", "aria-label": `Like ${name}`, "aria-pressed": lead.liked ? "true" : "false" }, svg(ICON.like))
    const dislikeBtn = h("button", { class: "lb-btn lb-btn-icon", type: "button", title: "Dislike", "data-taste": "disliked", "aria-label": `Dislike ${name}`, "aria-pressed": lead.disliked ? "true" : "false" }, svg(ICON.dislike))
    const like = lb.like(lead.id), dislike = lb.dislike(lead.id)
    lb.bindAction(likeBtn, like); lb.bindAction(dislikeBtn, dislike)
    like.subscribe((a) => { if (a.lastResult) { lead.liked = true; lead.disliked = false; paintTaste() } if (a.error) say(msg, a.error.message, "error") })
    dislike.subscribe((a) => { if (a.lastResult) { lead.disliked = true; lead.liked = false; paintTaste() } if (a.error) say(msg, a.error.message, "error") })
    const tasteChip = h("span", { class: "lb-chip", "data-taste": "", hidden: true })
    function paintTaste() {
      likeBtn.setAttribute("aria-pressed", lead.liked ? "true" : "false")
      dislikeBtn.setAttribute("aria-pressed", lead.disliked ? "true" : "false")
      tasteChip.hidden = !lead.liked && !lead.disliked
      tasteChip.textContent = lead.liked ? "Liked" : lead.disliked ? "Disliked" : ""
    }
    paintTaste()

    // selection for the bulk apply
    const pick = h("input", { type: "checkbox", "aria-label": `Select ${name} for bulk apply` })
    pick.checked = state.selected.has(lead.id)
    pick.addEventListener("change", () => { pick.checked ? state.selected.add(lead.id) : state.selected.delete(lead.id) })

    // what it is
    const rc = lead.recommended_contact
    const who = rc ? [rc.first_name, rc.last_name].filter(Boolean).join(" ") : null
    // The contact's name links to LinkedIn, as it does in the agent's table:
    // their profile, else a people search (lb.contactLinkedin).
    const li = who ? lb.contactLinkedin(rc, lead.name) : null
    const phone = real((lead.phone_numbers || [])[0])
    const email = real(lead.email)
    const place = [lead.location && lead.location.city, lead.location && lead.location.state].filter(Boolean).join(", ")
    const facts = [place, sizeText(lead.size)].filter(Boolean)

    // status — saves on change, no button
    const statusMsg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })
    const statusSel = h("select", { class: "lb-select", "aria-label": `Lead status for ${name}` })
    const statusField = lb.leadStatus("")
    lb.bindSelect(statusSel, statusField)
    const statusWrite = lb.setStatus({ leadId: lead.id, status: statusField, ask: ASK })
    statusSel.addEventListener("change", () => statusWrite.run())
    statusWrite.subscribe((a) => {
      if (a.loading) say(statusMsg, "Saving…")
      else if (a.error) say(statusMsg, a.error.message, "error")
      else if (a.lastResult) say(statusMsg, "Saved", "ok")
    })

    // prospecting actions — toggles over today's list, as in the web app
    const actMsg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })
    const toggles = ACTIONS.map((a) =>
      h("button", { class: "lb-action", type: "button", role: "checkbox", "data-value": a.value, "aria-label": `${a.label} for ${name}`, text: a.label, onClick: () => toggle(a) }),
    )
    function paintToggles() { const on = today(lead); for (const b of toggles) b.setAttribute("aria-checked", on.has(b.dataset.value) ? "true" : "false") }
    paintToggles()
    async function toggle(a) {
      const selected = !today(lead).has(a.value)
      for (const b of toggles) b.disabled = true
      say(actMsg, "Saving…")
      try {
        await lb.call("leadbay_set_prospecting_action", { lead_id: lead.id, action: a.value, selected, _triggered_by: ASK })
        const type = "EPILOGUE_" + a.value
        const list = lead.epilogue_today_statuses || []
        lead.epilogue_today_statuses = selected ? list.concat({ type, added_at: new Date().toISOString() }) : list.filter((e) => e.type !== type)
        say(actMsg, `“${a.label}” ${selected ? "on" : "off"}`, "ok")
      } catch (err) {
        say(actMsg, toolMissing(err) ? "Needs the next Leadbay release — set it in the web app for now." : err.message || "Could not save.", "error")
      } finally {
        for (const b of toggles) b.disabled = false
        paintToggles()
      }
    }

    // note — the web app's note field, never report_outreach
    const noteInput = h("input", { class: "lb-input", type: "text", placeholder: "What happened?", "aria-label": `Outreach note for ${name}` })
    const noteField = lb.field({ validate: (v) => (v && String(v).trim() ? null : "Add a note first") })
    lb.bindValue(noteInput, noteField)
    const noteBtn = h("button", { class: "lb-btn lb-btn-submit", type: "button", text: "Log outreach" })
    const noteWrite = lb.note({ leadId: lead.id, note: noteField })
    lb.bindAction(noteBtn, noteWrite)
    noteWrite.subscribe((a) => {
      if (a.loading) say(actMsg, "Saving note…")
      else if (a.error) say(actMsg, a.error.message, "error")
      else if (a.lastResult) { say(actMsg, "Outreach logged", "ok"); noteInput.value = ""; noteField.setValue("") }
    })

    // qualify — mandatory on every card
    const qBtn = h("button", { class: "lb-btn lb-btn-ai", type: "button", text: lb.qualifyLabel(lead), "aria-label": `${lb.qualifyLabel(lead)} ${name}` })
    const q = lb.qualify({ leadId: lead.id, ask: ASK, scored: lb.qualifyLabel(lead) === "Requalify" })
    lb.bindAction(qBtn, q)
    q.subscribe((a) => {
      if (a.loading) say(msg, "Queueing…")
      else if (a.error) say(msg, a.error.message, "error")
      else if (a.lastResult) say(msg, "Qualifying — the verdict lands shortly.", "ok")
    })

    const excerpt = lead.qualification_summary && lead.qualification_summary.best_response_excerpt
    const boost = (lead.qualification_summary && lead.qualification_summary.avg_qualification_boost) || 0
    const tags = (lead.tags || []).map((t) => h("span", { text: t.display_name }))

    return h("article", { class: "lb-card" },
      h("div", { class: "lb-card-top" },
        pick,
        h("div", { class: "lb-lead-title" }, lead.website ? h("a", { href: url(lead.website), target: "_blank", rel: "noopener", text: name }) : name),
        h("span", { class: "lb-group" }, likeBtn, dislikeBtn),
      ),
      h("div", { class: "lb-chips" }, tasteChip),
      h("div", { class: "lb-sections" },
        h("div", { class: "lb-section" },
          facts.length ? h("div", { class: "lb-tags-plain" }, facts.map((f) => h("span", { text: f }))) : null,
          h("div", { class: "lb-sub", text: whyFits(lead) }),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: "Fit" }),
          h("div", { class: "fit" },
            h("code", { class: "bar", "aria-hidden": "true", text: bar(lead) }),
            h("span", { class: "lb-vh", text: `Fit: ${verdictOf(lead)}` }),
            h("span", { class: "verdict", "data-v": verdictOf(lead), text: boost > 0 ? `AI boost +${Math.round(boost)}` : boost < 0 ? `AI penalty ${Math.round(boost)}` : "No AI adjustment" }),
          ),
          excerpt ? h("div", { class: "lb-sub excerpt", text: excerpt }) : null,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: "Intent tags" }),
          tags.length ? h("div", { class: "lb-tags-intent" }, tags) : h("div", { class: "lb-tags-empty", text: "None — the qualifier found no buying signal" }),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: "Data" }),
          h("div", { class: "lb-sub" }, h("span", { "aria-hidden": "true", text: "👤 " }),
            who
              ? [
                  li
                    ? h("a", {
                        class: "lb-link", href: li.url, target: "_blank", rel: "noopener",
                        title: li.profile ? `${who} on LinkedIn` : `No LinkedIn profile on file — search LinkedIn for ${who}`,
                        text: who,
                      })
                    : who,
                  rc.job_title ? " · " + rc.job_title : null,
                ]
              : "No contact yet — enrich to find one"),
          h("div", { class: "lb-sub" }, h("span", { class: "lb-vh", text: "Company switchboard: " }), h("span", { "aria-hidden": "true", text: "🏢 " }),
            [phone && "☎ " + phone, email && "✉ " + email].filter(Boolean).join(" · ") ? [phone && "☎ " + phone, email && "✉ " + email].filter(Boolean).join(" · ") + " (company line)" : "No phone or email — enrich to look for them"),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: "Status" }),
          statusSel, statusMsg,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: "Outreach" }),
          h("div", { class: "lb-stack" },
            h("div", { class: "actions", role: "group", "aria-label": `Prospecting actions for ${name}` }, toggles),
            noteInput, noteBtn,
          ),
          actMsg,
        ),
        h("div", { class: "lb-card-foot" },
          qBtn,
          h("span", { class: "lb-spacer" }),
          h("a", { class: "lb-link-out", href: leadUrl(lead), target: "_blank", rel: "noopener", "aria-label": `Open ${name} in Leadbay` }, "Open in Leadbay ", svg(ICON.out)),
        ),
      ),
      msg,
    )
  }

  render()
  loadPage(0)
})()
