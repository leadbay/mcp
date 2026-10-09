(function () {
  // The recipe pins the light theme, set before the skin.
  document.documentElement.setAttribute("data-lb-theme", "light")
  const lb = window.LeadbayArtifacts
  lb.styles()

  const ASK = "Triage board"
  // Every label the board shows, in English and French (lb.locale() picks:
  // the MCP Apps host's locale, else the browser's). English is the source;
  // a key missing in French falls back to it. Lead data is shown as Leadbay
  // returns it.
  const t = lb.i18n({
    en: {
      docTitle: "Lead Triage Board",
      heading: "Today's leads",
      subheading: "From your active lens. Like, set a status, tick a prospecting action — every control writes to Leadbay.",
      taste: "Taste",
      tasteAria: "Filter by taste",
      all: "All",
      liked: "Liked",
      disliked: "Disliked",
      notRated: "Not rated",
      verdict: "Verdict",
      verdictAria: "Filter by qualifier verdict",
      boostedOpt: "AI boosted",
      neutralOpt: "No adjustment",
      penalisedOpt: "AI penalised",
      selectAll: "Select all",
      bulkStatusAria: "Status for selected leads",
      applySelected: "Apply to selected",
      previous: "Previous",
      next: "Next",
      stillChasing: "Still chasing",
      meetingPlanned: "Meeting planned",
      couldNotReach: "Could not reach",
      notInterested: "Not interested",
      employeesRange: "{min}–{max} employees",
      employeesFrom: "{n}+ employees",
      noDescription: "No description yet — qualify to add one",
      applying: "Applying…",
      appliedOne: "Status applied to {n} lead.",
      appliedMany: "Status applied to {n} leads.",
      loadFailed: "Could not load that page.",
      range: "{from}–{to} of {total}",
      loading: "Loading today's leads…",
      tallyOne: "{n} lead",
      tallyMany: "{n} leads",
      tallyOf: " of {total}",
      noMatch: "No lead matches these filters",
      noMatchHint: "Reset Taste and Verdict to All.",
      unnamed: "Unnamed company",
      like: "Like",
      dislike: "Dislike",
      likeAria: "Like {name}",
      dislikeAria: "Dislike {name}",
      selectAria: "Select {name} for bulk apply",
      statusAria: "Lead status for {name}",
      saving: "Saving…",
      saved: "Saved",
      actionAria: "{action} for {name}",
      actionOn: "“{action}” on",
      actionOff: "“{action}” off",
      needsRelease: "Needs the next Leadbay release — set it in the web app for now.",
      saveFailed: "Could not save.",
      notePlaceholder: "What happened?",
      noteAria: "Outreach note for {name}",
      noteRequired: "Add a note first",
      logOutreach: "Log outreach",
      savingNote: "Saving note…",
      outreachLogged: "Outreach logged",
      Qualify: "Qualify",
      Requalify: "Requalify",
      queueing: "Queueing…",
      qualifying: "Qualifying — the verdict lands shortly.",
      fit: "Fit",
      fitAria: "Fit: {verdict}",
      boosted: "boosted",
      penalised: "penalised",
      neutral: "neutral",
      aiBoost: "AI boost +{n}",
      aiPenalty: "AI penalty {n}",
      noAiAdjustment: "No AI adjustment",
      intentTags: "Intent tags",
      noIntent: "None — the qualifier found no buying signal",
      data: "Data",
      onLinkedin: "{who} on LinkedIn",
      searchLinkedin: "No LinkedIn profile on file — search LinkedIn for {who}",
      noContact: "No contact yet — enrich to find one",
      switchboard: "Company switchboard: ",
      companyLine: " (company line)",
      noChannel: "No phone or email — enrich to look for them",
      status: "Status",
      outreach: "Outreach",
      actionsAria: "Prospecting actions for {name}",
      openAria: "Open {name} in Leadbay",
      open: "Open in Leadbay ",
    },
    fr: {
      docTitle: "Tableau de tri des leads",
      heading: "Leads du jour",
      subheading: "Depuis votre lens active. Aimez, donnez un statut, cochez une action de prospection — chaque action est enregistrée dans Leadbay.",
      taste: "Avis",
      tasteAria: "Filtrer par avis",
      all: "Tous",
      liked: "Aimés",
      disliked: "Écartés",
      notRated: "Sans avis",
      verdict: "Verdict",
      verdictAria: "Filtrer par verdict de qualification",
      boostedOpt: "Boostés par l'IA",
      neutralOpt: "Sans ajustement",
      penalisedOpt: "Pénalisés par l'IA",
      selectAll: "Tout sélectionner",
      bulkStatusAria: "Statut des leads sélectionnés",
      applySelected: "Appliquer à la sélection",
      previous: "Précédent",
      next: "Suivant",
      stillChasing: "Toujours en cours",
      meetingPlanned: "Rendez-vous planifié",
      couldNotReach: "Injoignable",
      notInterested: "Pas intéressé",
      employeesRange: "{min}–{max} salariés",
      employeesFrom: "{n}+ salariés",
      noDescription: "Pas encore de description — qualifiez pour en ajouter une",
      applying: "Application…",
      appliedOne: "Statut appliqué à {n} lead.",
      appliedMany: "Statut appliqué à {n} leads.",
      loadFailed: "Impossible de charger cette page.",
      range: "{from}–{to} sur {total}",
      loading: "Chargement des leads du jour…",
      tallyOne: "{n} lead",
      tallyMany: "{n} leads",
      tallyOf: " sur {total}",
      noMatch: "Aucun lead ne correspond à ces filtres",
      noMatchHint: "Remettez Avis et Verdict sur Tous.",
      unnamed: "Entreprise sans nom",
      like: "J'aime",
      dislike: "Je n'aime pas",
      likeAria: "Aimer {name}",
      dislikeAria: "Écarter {name}",
      selectAria: "Sélectionner {name} pour l'action groupée",
      statusAria: "Statut du lead {name}",
      saving: "Enregistrement…",
      saved: "Enregistré",
      actionAria: "{action} pour {name}",
      actionOn: "« {action} » activé",
      actionOff: "« {action} » désactivé",
      needsRelease: "Nécessite la prochaine version de Leadbay — réglez-le dans l'application web pour l'instant.",
      saveFailed: "Impossible d'enregistrer.",
      notePlaceholder: "Que s'est-il passé ?",
      noteAria: "Note de prospection pour {name}",
      noteRequired: "Ajoutez d'abord une note",
      logOutreach: "Enregistrer la note",
      savingNote: "Enregistrement de la note…",
      outreachLogged: "Note enregistrée",
      Qualify: "Qualifier",
      Requalify: "Requalifier",
      queueing: "Mise en file…",
      qualifying: "Qualification en cours — le verdict arrive sous peu.",
      fit: "Adéquation",
      fitAria: "Adéquation : {verdict}",
      boosted: "boostée",
      penalised: "pénalisée",
      neutral: "neutre",
      aiBoost: "Bonus IA +{n}",
      aiPenalty: "Malus IA {n}",
      noAiAdjustment: "Aucun ajustement IA",
      intentTags: "Signaux d'intention",
      noIntent: "Aucun — le qualificateur n'a trouvé aucun signal d'achat",
      data: "Données",
      onLinkedin: "{who} sur LinkedIn",
      searchLinkedin: "Aucun profil LinkedIn enregistré — rechercher {who} sur LinkedIn",
      noContact: "Pas encore de contact — enrichissez pour en trouver un",
      switchboard: "Standard de l'entreprise : ",
      companyLine: " (ligne de l'entreprise)",
      noChannel: "Ni téléphone ni e-mail — enrichissez pour les chercher",
      status: "Statut",
      outreach: "Prospection",
      actionsAria: "Actions de prospection pour {name}",
      openAria: "Ouvrir {name} dans Leadbay",
      open: "Ouvrir dans Leadbay ",
    },
  })
  const ACTIONS = [
    { value: "STILL_CHASING", key: "stillChasing" },
    { value: "INTEREST_VALIDATED_OR_MEETING_PLANED", key: "meetingPlanned" },
    { value: "COULD_NOT_REACH_STILL_TRYING", key: "couldNotReach" },
    { value: "NOT_INTERESTED_LOST", key: "notInterested" },
  ]

  // pageSize and lensId are the opening call's when the host hands it over
  // (MCP Apps), so "next page" continues the agent's batch on the same lens.
  const state = { page: 0, pageSize: 10, lensId: null, leads: [], total: 0, loaded: false, selected: new Set(), taste: "all", verdict: "all" }

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
    return size.min && size.max ? t("employeesRange", { min: size.min, max: size.max }) : t("employeesFrom", { n: size.min || size.max })
  }
  function whyFits(lead) {
    return (
      real(lead.short_description) ||
      (lead.tags || []).slice(0, 2).map((tag) => tag.display_name).join(" · ") ||
      (lead.qualification_summary && lead.qualification_summary.best_response_excerpt) ||
      t("noDescription")
    )
  }
  const url = (host) => (/^https?:\/\//.test(host) ? host : "https://" + host)
  const leadUrl = (lead) => `https://leadbay.app/app/discover?lead=${encodeURIComponent(lead.id)}`
  const today = (lead) => new Set((lead.epilogue_today_statuses || []).map((e) => String(e.type).replace(/^EPILOGUE_/, "")))
  function toolMissing(err) {
    return /unknown tool|\btool\b[^.]*\bnot found|not_in_manifest|no such tool/i.test(String((err && (err.message || err.code)) || ""))
  }
  function say(msg, text, tone) { msg.textContent = text; msg.dataset.tone = tone || "" }

  // The page's fixed labels carry data-i18n="<key>" (text) and
  // data-i18n-aria / data-i18n-placeholder; relabel them in the viewer's
  // language. Run again once an MCP Apps host has reported its locale.
  function translatePage() {
    document.title = t("docTitle")
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n)
    for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria))
  }

  // ---- toolbar ----
  const tally = document.getElementById("tally")
  const deck = document.getElementById("deck")
  const range = document.getElementById("range")
  const prev = document.getElementById("prev")
  const next = document.getElementById("next")
  const bulkMsg = document.getElementById("bulk-msg")
  document.getElementById("f-taste").addEventListener("change", (e) => { state.taste = e.target.value; render() })
  document.getElementById("f-verdict").addEventListener("change", (e) => { state.verdict = e.target.value; render() })

  // Bound after the opening is known, so the status labels use the host's
  // language when it reports one.
  function bindBulk() {
    const bulkStatus = lb.leadStatus("")
    lb.bindSelect(document.getElementById("bulk-status"), bulkStatus)
    const bulkWrite = lb.setStatus({ leadIds: () => [...state.selected], status: bulkStatus, ask: ASK })
    lb.bindAction(document.getElementById("bulk-apply"), bulkWrite)
    bulkWrite.subscribe((a) => {
      if (a.loading) say(bulkMsg, t("applying"))
      else if (a.error) say(bulkMsg, a.error.message, "error")
      else if (a.lastResult) say(bulkMsg, t(state.selected.size === 1 ? "appliedOne" : "appliedMany", { n: state.selected.size }), "ok")
    })
  }
  document.getElementById("select-all").addEventListener("change", (e) => {
    for (const lead of visible()) e.target.checked ? state.selected.add(lead.id) : state.selected.delete(lead.id)
    render()
  })

  prev.addEventListener("click", () => loadPage(state.page - 1))
  next.addEventListener("click", () => loadPage(state.page + 1))

  // One pull_leads answer → the deck. Shared by the opening result and every
  // page the rep loads, so both read the answer the same way.
  function applyPage(res, page) {
    state.leads = (res && res.leads) || []
    state.total = (res && res.pagination && res.pagination.total) || state.leads.length
    // Pin the lens the answer came from: the active lens can change between
    // calls, and "next page" must continue THIS batch.
    if (!state.lensId && res && res.lens && res.lens.id) state.lensId = res.lens.id
    state.page = page
    state.loaded = true
    render()
  }

  async function loadPage(page) {
    deck.setAttribute("data-lb-state", "loading")
    prev.disabled = next.disabled = true
    try {
      const args = { page, count: state.pageSize, _triggered_by: ASK }
      if (state.lensId) args.lensId = state.lensId
      applyPage(await lb.call("leadbay_pull_leads", args), page)
    } catch (err) {
      state.loaded = true
      render()
      say(bulkMsg, err.message || t("loadFailed"), "error")
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
    const from = state.page * state.pageSize + 1
    range.textContent = state.leads.length ? t("range", { from, to: Math.min(from + state.leads.length - 1, state.total), total: state.total }) : ""
    prev.disabled = state.page === 0
    next.disabled = (state.page + 1) * state.pageSize >= state.total
  }

  function render() {
    if (!state.loaded) {
      tally.textContent = t("loading")
      deck.replaceChildren(h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title", text: t("loading") })))
      return
    }
    const rows = visible()
    tally.textContent = t(rows.length === 1 ? "tallyOne" : "tallyMany", { n: rows.length }) + (rows.length !== state.leads.length ? t("tallyOf", { total: state.leads.length }) : "")
    deck.replaceChildren(...(rows.length ? rows.map(card) : [h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title", text: t("noMatch") }), h("div", { class: "lb-empty-hint", text: t("noMatchHint") }))]))
    renderPager()
  }

  // ---- one card ----
  function card(lead) {
    const name = lead.name || t("unnamed")
    const msg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })

    // taste
    const likeBtn = h("button", { class: "lb-btn lb-btn-icon", type: "button", title: t("like"), "aria-label": t("likeAria", { name }), "aria-pressed": lead.liked ? "true" : "false" }, svg(ICON.like))
    const dislikeBtn = h("button", { class: "lb-btn lb-btn-icon", type: "button", title: t("dislike"), "data-taste": "disliked", "aria-label": t("dislikeAria", { name }), "aria-pressed": lead.disliked ? "true" : "false" }, svg(ICON.dislike))
    const like = lb.like(lead.id), dislike = lb.dislike(lead.id)
    lb.bindAction(likeBtn, like); lb.bindAction(dislikeBtn, dislike)
    like.subscribe((a) => { if (a.lastResult) { lead.liked = true; lead.disliked = false; paintTaste() } if (a.error) say(msg, a.error.message, "error") })
    dislike.subscribe((a) => { if (a.lastResult) { lead.disliked = true; lead.liked = false; paintTaste() } if (a.error) say(msg, a.error.message, "error") })
    const tasteChip = h("span", { class: "lb-chip", "data-taste": "", hidden: true })
    function paintTaste() {
      likeBtn.setAttribute("aria-pressed", lead.liked ? "true" : "false")
      dislikeBtn.setAttribute("aria-pressed", lead.disliked ? "true" : "false")
      tasteChip.hidden = !lead.liked && !lead.disliked
      tasteChip.textContent = lead.liked ? t("liked") : lead.disliked ? t("disliked") : ""
    }
    paintTaste()

    // selection for the bulk apply
    const pick = h("input", { type: "checkbox", "aria-label": t("selectAria", { name }) })
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
    const channels = [phone && "☎ " + phone, email && "✉ " + email].filter(Boolean).join(" · ")

    // status — saves on change, no button
    const statusMsg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })
    const statusSel = h("select", { class: "lb-select", "aria-label": t("statusAria", { name }) })
    const statusField = lb.leadStatus("")
    lb.bindSelect(statusSel, statusField)
    const statusWrite = lb.setStatus({ leadId: lead.id, status: statusField, ask: ASK })
    statusSel.addEventListener("change", () => statusWrite.run())
    statusWrite.subscribe((a) => {
      if (a.loading) say(statusMsg, t("saving"))
      else if (a.error) say(statusMsg, a.error.message, "error")
      else if (a.lastResult) say(statusMsg, t("saved"), "ok")
    })

    // prospecting actions — toggles over today's list, as in the web app
    const actMsg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })
    const toggles = ACTIONS.map((a) =>
      h("button", { class: "lb-action", type: "button", role: "checkbox", "data-value": a.value, "aria-label": t("actionAria", { action: t(a.key), name }), text: t(a.key), onClick: () => toggle(a) }),
    )
    function paintToggles() { const on = today(lead); for (const b of toggles) b.setAttribute("aria-checked", on.has(b.dataset.value) ? "true" : "false") }
    paintToggles()
    async function toggle(a) {
      const selected = !today(lead).has(a.value)
      for (const b of toggles) b.disabled = true
      say(actMsg, t("saving"))
      try {
        await lb.call("leadbay_set_prospecting_action", { lead_id: lead.id, action: a.value, selected, _triggered_by: ASK })
        const type = "EPILOGUE_" + a.value
        const list = lead.epilogue_today_statuses || []
        lead.epilogue_today_statuses = selected ? list.concat({ type, added_at: new Date().toISOString() }) : list.filter((e) => e.type !== type)
        say(actMsg, t(selected ? "actionOn" : "actionOff", { action: t(a.key) }), "ok")
      } catch (err) {
        say(actMsg, toolMissing(err) ? t("needsRelease") : err.message || t("saveFailed"), "error")
      } finally {
        for (const b of toggles) b.disabled = false
        paintToggles()
      }
    }

    // note — the web app's note field, never report_outreach
    const noteInput = h("input", { class: "lb-input", type: "text", placeholder: t("notePlaceholder"), "aria-label": t("noteAria", { name }) })
    const noteField = lb.field({ validate: (v) => (v && String(v).trim() ? null : t("noteRequired")) })
    lb.bindValue(noteInput, noteField)
    const noteBtn = h("button", { class: "lb-btn lb-btn-submit", type: "button", text: t("logOutreach") })
    const noteWrite = lb.note({ leadId: lead.id, note: noteField })
    lb.bindAction(noteBtn, noteWrite)
    noteWrite.subscribe((a) => {
      if (a.loading) say(actMsg, t("savingNote"))
      else if (a.error) say(actMsg, a.error.message, "error")
      else if (a.lastResult) { say(actMsg, t("outreachLogged"), "ok"); noteInput.value = ""; noteField.setValue("") }
    })

    // qualify — mandatory on every card. lb.qualifyLabel(lead) is the KEY
    // ("Qualify" | "Requalify"); t() turns it into the viewer's word.
    const qLabel = t(lb.qualifyLabel(lead))
    const qBtn = h("button", { class: "lb-btn lb-btn-ai", type: "button", text: qLabel, "aria-label": `${qLabel} ${name}` })
    const q = lb.qualify({ leadId: lead.id, ask: ASK, scored: lb.qualifyLabel(lead) === "Requalify" })
    lb.bindAction(qBtn, q)
    q.subscribe((a) => {
      if (a.loading) say(msg, t("queueing"))
      else if (a.error) say(msg, a.error.message, "error")
      else if (a.lastResult) say(msg, t("qualifying"), "ok")
    })

    const excerpt = lead.qualification_summary && lead.qualification_summary.best_response_excerpt
    const boost = (lead.qualification_summary && lead.qualification_summary.avg_qualification_boost) || 0
    const tags = (lead.tags || []).map((tag) => h("span", { text: tag.display_name }))

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
          h("div", { class: "lb-sec-title", text: t("fit") }),
          h("div", { class: "fit" },
            h("code", { class: "bar", "aria-hidden": "true", text: bar(lead) }),
            h("span", { class: "lb-vh", text: t("fitAria", { verdict: t(verdictOf(lead)) }) }),
            h("span", { class: "verdict", "data-v": verdictOf(lead), text: boost > 0 ? t("aiBoost", { n: Math.round(boost) }) : boost < 0 ? t("aiPenalty", { n: Math.round(boost) }) : t("noAiAdjustment") }),
          ),
          excerpt ? h("div", { class: "lb-sub excerpt", text: excerpt }) : null,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("intentTags") }),
          tags.length ? h("div", { class: "lb-tags-intent" }, tags) : h("div", { class: "lb-tags-empty", text: t("noIntent") }),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("data") }),
          h("div", { class: "lb-sub" }, h("span", { "aria-hidden": "true", text: "👤 " }),
            who
              ? [
                  li
                    ? h("a", {
                        class: "lb-link", href: li.url, target: "_blank", rel: "noopener",
                        title: li.profile ? t("onLinkedin", { who }) : t("searchLinkedin", { who }),
                        text: who,
                      })
                    : who,
                  rc.job_title ? " · " + rc.job_title : null,
                ]
              : t("noContact")),
          h("div", { class: "lb-sub" }, h("span", { class: "lb-vh", text: t("switchboard") }), h("span", { "aria-hidden": "true", text: "🏢 " }),
            channels ? channels + t("companyLine") : t("noChannel")),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("status") }),
          statusSel, statusMsg,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("outreach") }),
          h("div", { class: "lb-stack" },
            h("div", { class: "actions", role: "group", "aria-label": t("actionsAria", { name }) }, toggles),
            noteInput, noteBtn,
          ),
          actMsg,
        ),
        h("div", { class: "lb-card-foot" },
          qBtn,
          h("span", { class: "lb-spacer" }),
          h("a", { class: "lb-link-out", href: leadUrl(lead), target: "_blank", rel: "noopener", "aria-label": t("openAria", { name }) }, t("open"), svg(ICON.out)),
        ),
      ),
      msg,
    )
  }

  // ---- start ----
  // As an MCP App view the host hands over the pull_leads call that opened
  // the board: render it instead of pulling again (one call, one "seen"
  // receipt). Everywhere else lb.openingResult() is null and the board loads
  // its own first page, as it always has.
  async function boot() {
    translatePage()
    render()
    const opening = await lb.openingResult()
    translatePage() // the host's locale is known now
    bindBulk()
    const res = opening && opening.result
    if (res && Array.isArray(res.leads)) {
      const args = opening.args || {}
      if (Number(args.count) > 0) state.pageSize = Number(args.count)
      if (typeof args.lensId === "string" && args.lensId) state.lensId = args.lensId
      applyPage(res, Number(args.page) > 0 ? Number(args.page) : 0)
      renderPager()
    } else {
      loadPage(0)
    }
  }
  boot()
})()
