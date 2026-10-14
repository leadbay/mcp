(function () {
  // The recipe pins the light theme, set before the skin.
  document.documentElement.setAttribute("data-lb-theme", "light")
  const lb = window.LeadbayArtifacts
  lb.styles()

  const ASK = "Triage board"
  // When the page's own entrance started (page.html), to sequence the cards after it.
  const bootedAt = performance.now()
  // Every label the board shows, in English and French (lb.locale() picks:
  // the MCP Apps host's locale, else the browser's). English is the source;
  // a key missing in French falls back to it. Lead data is shown as Leadbay
  // returns it.
  const t = lb.i18n({
    en: {
      docTitle: "Lead Triage Board",
      heading: "Today’s leads",
      subheading: "From your active lens. Like, set a status, tick a prospecting action — every control writes to Leadbay.",
      taste: "Taste",
      tasteAria: "Filter by taste",
      all: "All",
      liked: "Liked",
      disliked: "Disliked",
      likedChip: "Liked",
      dislikedChip: "Disliked",
      notRated: "Not rated",
      verdict: "AI adjustment",
      verdictAria: "Filter by AI adjustment",
      boostedOpt: "AI boost",
      neutralOpt: "No AI adjustment",
      penalisedOpt: "AI penalty",
      selectAll: "Select all on this page",
      bulkStatusAria: "Status for selected leads",
      applySelected: "Apply to selected",
      selectedOne: "{n} selected",
      selectedMany: "{n} selected",
      previous: "Previous",
      next: "Next",
      pagination: "Pagination",
      pageAria: "Page {n}",
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
      loadFailed: "Could not load that page. Check your connection, then choose the page again.",
      loadFailedFirst: "Could not load today’s leads",
      loadFailedHint: "Check your connection, then try again.",
      retry: "Try again",
      showMore: "Show more",
      showLess: "Show less",
      range: "{from}–{to} of {total}",
      loading: "Loading today’s leads…",
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
      saveFailed: "Could not save. Try again.",
      notePlaceholder: "What happened?",
      noteAria: "Note for {name}",
      noteRequired: "Add a note first",
      logOutreach: "Save note",
      savingNote: "Saving note…",
      outreachLogged: "Note saved",
      Qualify: "Qualify",
      Requalify: "Requalify",
      queueing: "Queueing…",
      qualifying: "Qualification started. Reopen the board in a few minutes to see the verdict.",
      fit: "Fit",
      fitAria: "Fit {score} out of 10",
      boosted: "boosted",
      penalised: "penalised",
      neutral: "neutral",
      aiBoost: "AI boost +{n}",
      aiPenalty: "AI penalty −{n}",
      noAiAdjustment: "No AI adjustment",
      intentTags: "Intent tags",
      noIntent: "None — the qualifier found no buying signal",
      data: "Data",
      contactTitle: "Recommended contact",
      companyTitle: "Company",
      callAria: "Call the company switchboard, {phone}",
      socialAria: "{name} on {platform}",
      onLinkedin: "{who} on LinkedIn",
      searchLinkedin: "No LinkedIn profile on file — search LinkedIn for {who}",
      noContact: "No contact yet. Open in Leadbay to enrich this lead.",
      switchboard: "Company switchboard: ",
      noChannel: "No phone or email yet. Open in Leadbay to enrich this lead.",
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
      likedChip: "Aimé",
      dislikedChip: "Écarté",
      notRated: "Sans avis",
      verdict: "Ajustement IA",
      verdictAria: "Filtrer par ajustement IA",
      boostedOpt: "Bonus IA",
      neutralOpt: "Aucun ajustement IA",
      penalisedOpt: "Malus IA",
      selectAll: "Tout sélectionner sur cette page",
      bulkStatusAria: "Statut des leads sélectionnés",
      applySelected: "Appliquer à la sélection",
      selectedOne: "{n} sélectionné",
      selectedMany: "{n} sélectionnés",
      previous: "Précédent",
      next: "Suivant",
      pagination: "Pagination",
      pageAria: "Page {n}",
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
      loadFailed: "Impossible de charger cette page. Vérifiez votre connexion, puis choisissez à nouveau la page.",
      loadFailedFirst: "Impossible de charger les leads du jour",
      loadFailedHint: "Vérifiez votre connexion, puis réessayez.",
      retry: "Réessayer",
      showMore: "Voir plus",
      showLess: "Voir moins",
      range: "{from}–{to} sur {total}",
      loading: "Chargement des leads du jour…",
      tallyOne: "{n} lead",
      tallyMany: "{n} leads",
      tallyOf: " sur {total}",
      noMatch: "Aucun lead ne correspond à ces filtres",
      noMatchHint: "Remettez Avis et Verdict sur Tous.",
      unnamed: "Entreprise sans nom",
      like: "Aimer",
      dislike: "Écarter",
      likeAria: "Aimer {name}",
      dislikeAria: "Écarter {name}",
      selectAria: "Sélectionner {name} pour l’action groupée",
      statusAria: "Statut du lead {name}",
      saving: "Enregistrement…",
      saved: "Enregistré",
      actionAria: "{action} pour {name}",
      actionOn: "«\u202f{action}\u202f» activé",
      actionOff: "«\u202f{action}\u202f» désactivé",
      needsRelease: "Nécessite la prochaine version de Leadbay — réglez-le dans l’application web pour l’instant.",
      saveFailed: "Impossible d’enregistrer. Réessayez.",
      notePlaceholder: "Que s’est-il passé\u202f?",
      noteAria: "Note pour {name}",
      noteRequired: "Ajoutez d’abord une note",
      logOutreach: "Enregistrer la note",
      savingNote: "Enregistrement de la note…",
      outreachLogged: "Note enregistrée",
      Qualify: "Qualifier",
      Requalify: "Requalifier",
      queueing: "Mise en file…",
      qualifying: "Qualification lancée. Rouvrez le tableau dans quelques minutes pour voir le verdict.",
      fit: "Adéquation",
      fitAria: "Adéquation {score} sur 10",
      boosted: "boostée",
      penalised: "pénalisée",
      neutral: "neutre",
      aiBoost: "Bonus IA +{n}",
      aiPenalty: "Malus IA −{n}",
      noAiAdjustment: "Aucun ajustement IA",
      intentTags: "Signaux d’intention",
      noIntent: "Aucun — le qualificateur n’a trouvé aucun signal d’achat",
      data: "Données",
      contactTitle: "Contact recommandé",
      companyTitle: "Entreprise",
      callAria: "Appeler le standard de l’entreprise, {phone}",
      socialAria: "{name} sur {platform}",
      onLinkedin: "{who} sur LinkedIn",
      searchLinkedin: "Aucun profil LinkedIn enregistré — rechercher {who} sur LinkedIn",
      noContact: "Pas encore de contact. Ouvrez dans Leadbay pour enrichir ce lead.",
      switchboard: "Standard de l’entreprise\u202f: ",
      noChannel: "Ni téléphone ni e-mail pour l’instant. Ouvrez dans Leadbay pour enrichir ce lead.",
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
  const state = { page: 0, pageSize: 10, lensId: null, leads: [], total: 0, loaded: false, failed: false, selected: new Set(), taste: "all", verdict: "all" }

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
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
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
  const messageAnimations = new WeakMap()
  function say(msg, text, tone) {
    // Retarget an interrupted fade from its current opacity. Text and live
    // announcements update immediately, including under reduced motion.
    const previous = messageAnimations.get(msg)
    const opacity = previous && previous.playState === "running" ? getComputedStyle(msg).opacity : .75
    if (previous) previous.cancel()
    msg.textContent = text; msg.dataset.tone = tone || ""
    if (text && msg.animate) messageAnimations.set(msg, msg.animate([{ opacity }, { opacity: 1 }], { duration: 120, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }))
  }

  // The page's fixed labels carry data-i18n="<key>" (text) and
  // data-i18n-aria / data-i18n-placeholder; relabel them in the viewer's
  // language. Run again once an MCP Apps host has reported its locale.
  function translatePage() {
    document.title = t("docTitle")
    // For hyphenation, quotes and screen-reader pronunciation of the labels.
    document.documentElement.lang = lb.locale()
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
  // "Select all" ticks the cards in view without rebuilding them, so a note
  // being typed on a card survives it, and it follows the cards back: checked
  // when every visible card is, mixed when only some are.
  const selectAll = document.getElementById("select-all")
  selectAll.addEventListener("change", () => {
    for (const lead of visible()) selectAll.checked ? state.selected.add(lead.id) : state.selected.delete(lead.id)
    for (const box of deck.querySelectorAll("input[data-pick]")) box.checked = state.selected.has(box.dataset.pick)
    syncSelectAll()
  })
  function syncSelectAll() {
    const rows = visible()
    const picked = rows.filter((lead) => state.selected.has(lead.id)).length
    selectAll.checked = rows.length > 0 && picked === rows.length
    selectAll.indeterminate = picked > 0 && picked < rows.length
    // The status picker and Apply only mean something with a selection, so
    // they appear with one, led by how many leads they will write to.
    const n = state.selected.size
    document.getElementById("bulk-act").hidden = n === 0
    document.getElementById("bulk-count").textContent = t(n === 1 ? "selectedOne" : "selectedMany", { n })
  }

  prev.addEventListener("click", () => loadPage(state.page - 1))
  next.addEventListener("click", () => loadPage(state.page + 1))

  // One pull_leads answer → the deck. Shared by the opening result and every
  // page the rep loads, so both read the answer the same way.
  let firstPageRendered = false
  function applyPage(res, page) {
    state.leads = (res && res.leads) || []
    state.total = (res && res.pagination && res.pagination.total) || state.leads.length
    // Pin the lens the answer came from: the active lens can change between
    // calls, and "next page" must continue THIS batch.
    if (!state.lensId && res && res.lens && res.lens.id) state.lensId = res.lens.id
    state.page = page
    state.loaded = true
    state.failed = false
    render(!firstPageRendered)
    firstPageRendered = true
  }

  async function loadPage(page) {
    // Dim the cards being replaced; the first load has only its "Loading…"
    // line, which must stay readable.
    if (state.loaded) deck.setAttribute("data-lb-state", "loading")
    // Noted before the buttons are disabled, which drops their focus.
    numsHadFocus = document.getElementById("page-nums").contains(document.activeElement)
    const pressed = document.activeElement === prev || document.activeElement === next ? document.activeElement : null
    // The old cards are dimmed for the pointer (the skin's .lb-deck); inert
    // locks them for the keyboard too, and aria-busy says why.
    if (state.loaded) { deck.inert = true; deck.setAttribute("aria-busy", "true") }
    // A flip is asked for from the pager, under the last card: bring the
    // board's top back into view while the page loads, so the rep starts the
    // new page at its first card. Only when the top is off-screen; smooth
    // unless reduced motion. Where the host scrolls the frame (an MCP Apps
    // view), scrollIntoView asks it to; a host may decline.
    const top = document.querySelector(".page")
    if (state.loaded && top.getBoundingClientRect().top < 0) {
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      top.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" })
    }
    prev.disabled = next.disabled = true
    for (const b of document.querySelectorAll("#page-nums button")) b.disabled = true
    try {
      const args = { page, count: state.pageSize, _triggered_by: ASK }
      if (state.lensId) args.lensId = state.lensId
      applyPage(await lb.call("leadbay_pull_leads", args), page)
    } catch (err) {
      // With cards already on the deck (a page flip failed) they stay, and
      // the line under the toolbar says to choose the page again — the pager
      // is re-enabled below. With nothing loaded yet, the deck itself says
      // the load failed and offers Try again: "no lead matches these
      // filters" would be false, and the pager has no page to offer.
      const reason = err && err.message ? ` (${err.message})` : ""
      state.loaded = true
      state.failed = !state.leads.length
      render()
      if (!state.failed) say(bulkMsg, t("loadFailed") + reason, "error")
    } finally {
      deck.setAttribute("data-lb-state", "ready")
      deck.inert = false
      deck.removeAttribute("aria-busy")
      renderPager()
      // Disabling Previous / Next while loading dropped their focus: give it
      // back, or to the current page number when that end is now disabled.
      if (pressed) {
        const back = !pressed.disabled ? pressed : document.querySelector('#page-nums [aria-current="page"]')
        if (back) back.focus({ preventScroll: true })
      }
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

  let numsHadFocus = false

  // Which page numbers to show: all of them up to seven pages; past that the
  // first, the last, and the current one with its neighbours, gaps as "…".
  function pageList(current, count) {
    if (count <= 7) return Array.from({ length: count }, (_, i) => i)
    const keep = new Set([0, count - 1, current - 1, current, current + 1].filter((i) => i >= 0 && i < count))
    // Near an end, show the first or last five so the row keeps its width.
    if (current < 4) [1, 2, 3, 4].forEach((i) => keep.add(i))
    if (current > count - 5) [count - 5, count - 4, count - 3, count - 2].forEach((i) => keep.add(i))
    const pages = [...keep].sort((a, b) => a - b)
    return pages.flatMap((p, i) => (i && p - pages[i - 1] > 1 ? ["gap", p] : [p]))
  }

  function renderPager() {
    const from = state.page * state.pageSize + 1
    range.textContent = state.leads.length ? t("range", { from, to: Math.min(from + state.leads.length - 1, state.total), total: state.total }) : ""
    prev.disabled = state.page === 0
    next.disabled = (state.page + 1) * state.pageSize >= state.total

    // Rebuilt on every flip: a keyboard user who chose a number stays on the
    // number row, on the page they are now reading.
    const nums = document.getElementById("page-nums")
    const hadFocus = numsHadFocus || nums.contains(document.activeElement)
    numsHadFocus = false
    const count = Math.ceil(state.total / state.pageSize)
    nums.replaceChildren(...(count > 1 ? pageList(state.page, count) : []).map((p) =>
      p === "gap"
        ? h("span", { class: "page-gap", "aria-hidden": "true", text: "…" })
        : h("button", {
            class: "lb-btn page-num", type: "button", text: String(p + 1),
            "aria-label": t("pageAria", { n: p + 1 }),
            "aria-current": p === state.page ? "page" : null,
            onClick: () => { if (p !== state.page) loadPage(p) },
          }),
    ))
    // preventScroll: the flip has just scrolled to the top; focusing the
    // number row must not pull the view back down to it.
    if (hadFocus) { const current = nums.querySelector('[aria-current="page"]'); if (current) current.focus({ preventScroll: true }) }
  }

  function render(enter = false) {
    if (!state.loaded) {
      // The deck's centred line says it; repeating it here also pushed the
      // filters ~135px right until the leads landed.
      tally.textContent = ""
      // Skeleton cards in the lead card's shape (page.html), and the words
      // for screen readers in a hidden live line.
      deck.replaceChildren(h("span", { class: "lb-vh", role: "status", text: t("loading") }), ...[0, 1, 2].map(skeletonCard))
      skeletonAt = performance.now()
      return
    }
    if (state.failed) {
      tally.textContent = ""
      const retry = h("button", { class: "lb-btn", type: "button", text: t("retry"), onClick: () => {
        state.failed = false
        state.loaded = false
        render()
        loadPage(state.page)
      } })
      deck.replaceChildren(h("div", { class: "lb-empty", role: "alert" },
        h("div", { class: "lb-empty-title", text: t("loadFailedFirst") }),
        h("div", { class: "lb-empty-hint", text: t("loadFailedHint") }),
        retry))
      return
    }
    const rows = visible()
    // French takes the singular for zero ("0 lead"), English the plural.
    const one = rows.length === 1 || (rows.length === 0 && lb.locale() === "fr")
    tally.textContent = t(one ? "tallyOne" : "tallyMany", { n: rows.length }) + (rows.length !== state.leads.length ? t("tallyOf", { total: state.leads.length }) : "")
    deck.replaceChildren(...(rows.length ? rows.map(card) : [h("div", { class: "lb-empty" }, h("div", { class: "lb-empty-title", text: t("noMatch") }), h("div", { class: "lb-empty-hint", text: t("noMatchHint") }))]))
    // The cards follow the toolbar's groups (page.html): while the header is
    // still entering they wait for it, and a batch that lands later starts at
    // once rather than after an empty pause.
    // 250ms = the five header pieces × --enter-step (50ms, page.html); the
    // cards then go 60ms apart, a touch wider so they read as their own wave.
    const base = Math.max(0, 250 - (performance.now() - bootedAt))
    // The skeletons already made the entrance: when they are settled on
    // screen, each card takes its skeleton's place where it stands and only
    // its contents fade in (180ms; the card's surface does not move or
    // flash). Cards past the third had no skeleton and enter as usual. Data
    // that lands while the skeletons are still entering gets the plain
    // entrance instead, so nothing pops in over a half-faded placeholder.
    const swap = enter && skeletonAt != null && performance.now() - skeletonAt > SKELETON_SETTLED_MS
    skeletonAt = null
    if (enter) Array.from(deck.children).forEach((el, i) => {
      if (swap && i < 3) { el.classList.add("triage-swap"); return }
      el.classList.add("triage-enter")
      el.style.animationDelay = (swap ? (i - 3) * 60 : base + Math.min(i, 5) * 60) + "ms"
    })
    syncSelectAll()
    renderPager()
  }

  // When the skeletons went up, and how long their own entrance takes to
  // settle (300ms after the toolbar, the third 120ms later, 280ms each).
  let skeletonAt = null
  const SKELETON_SETTLED_MS = 700

  // A lead card's silhouette while the first batch loads: decorative grey
  // bars in the real card's order and proportions.
  function skeletonCard(i) {
    const sk = (cls) => h("span", { class: "sk " + cls })
    // Not .lb-card: code that waits for the first lead card must not take a
    // skeleton for one. .sk-card copies the card surface instead.
    return h("div", { class: "sk-card", "aria-hidden": "true", style: "--i: " + i },
      h("div", { class: "sk-row" }, sk("sk-box"), sk("sk-name"), sk("sk-icon"), sk("sk-icon")),
      h("div", { class: "sk-row" }, sk("sk-pill"), sk("sk-pill")),
      sk("sk-line"), sk("sk-line short"),
      sk("sk-title"), sk("sk-line short"),
      sk("sk-title"), h("div", { class: "sk-row" }, sk("sk-pill"), sk("sk-pill")),
      sk("sk-title"), sk("sk-line short"),
      sk("sk-title"), sk("sk-line short"), sk("sk-line short"),
      sk("sk-title"), sk("sk-field"),
      sk("sk-title"), h("div", { class: "sk-tiles" }, sk(""), sk(""), sk(""), sk("")),
      h("div", { class: "sk-row" }, sk("sk-field sk-grow"), sk("sk-btn")),
      h("div", { class: "sk-foot" }, sk("sk-qualify"), sk("sk-open")),
    )
  }

  // The ↗ beside the 12px regular "Open in Leadbay": a 1.5px stroke, matched
  // to the weight of the words it sits with (2px reads heavier than them).
  function outIcon() {
    const s = svg(ICON.out)
    s.setAttribute("stroke-width", "1.5")
    return s
  }

  // The LinkedIn mark beside a contact's name, which links to LinkedIn (their
  // profile, or a people search). Filled with the link's own colour;
  // decorative, since the name and its title already say where it goes.
  function linkedinIcon() {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "currentColor"); s.setAttribute("aria-hidden", "true")
    s.setAttribute("class", "li-icon")
    s.innerHTML = '<path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z"/>'
    return s
  }

  // A company line's glyph: the line icon at 14px, its stroke matched to
  // the 13px regular text beside it (1.5px).
  function factIcon(paths) {
    const s = svg(paths)
    s.setAttribute("stroke-width", "1.5")
    s.setAttribute("class", "fact-icon")
    return s
  }

  // Social marks for the company's profiles: filled brand glyphs, 24px
  // grid, painted with currentColor so they follow the theme. A platform
  // without one gets the outline globe.
  const SOCIAL_MARKS = {
    "linkedin": "M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z",
    "facebook": "M9.1 23.69v-7.98H6.63v-3.67H9.1v-1.58c0-4.09 1.85-5.98 5.86-5.98.4 0 .95.04 1.47.1.39.04.77.11 1.14.2v3.32a8.6 8.6 0 0 0-.65-.03 26.8 26.8 0 0 0-.73-.01c-.71 0-1.26.1-1.68.31-.28.14-.51.35-.68.62-.26.42-.37 1-.37 1.75v1.3h3.92l-.39 2.1-.29 1.56h-3.24v8.25C19.4 23.24 24 18.18 24 12.04c0-6.63-5.37-12-12-12S0 5.42 0 12.04c0 5.63 3.87 10.35 9.1 11.65Z",
    "twitter": "M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.59-6.64 7.59H.47l8.6-9.83L0 1.15h7.59l5.25 6.93ZM17.61 20.64h2.04L6.49 3.24H4.3Z",
    "instagram": "M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41 1.27-.06 1.65-.07 4.85-.07ZM12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63c-.79.3-1.46.72-2.12 1.38A5.9 5.9 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.27.26 2.15.56 2.91.3.79.72 1.46 1.38 2.12a5.9 5.9 0 0 0 2.13 1.38c.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.27-.06 2.15-.26 2.91-.56a5.9 5.9 0 0 0 2.12-1.38 5.9 5.9 0 0 0 1.38-2.12c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.27-.26-2.15-.56-2.91a5.9 5.9 0 0 0-1.38-2.13A5.9 5.9 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0Zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.41-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88Z",
    "tiktok": "M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07Z",
    "crunchbase": "M21.6 0H2.4A2.4 2.4 0 0 0 0 2.4v19.2A2.4 2.4 0 0 0 2.4 24h19.2a2.4 2.4 0 0 0 2.4-2.4V2.4A2.4 2.4 0 0 0 21.6 0ZM7.05 14.47a2.11 2.11 0 0 0 2.79-1.05h1.66a3.69 3.69 0 1 1 0-1.75H9.84a2.11 2.11 0 1 0-2.79 2.8Zm11.34.84c-.32.27-.68.48-1.06.63a3.68 3.68 0 0 1-3.39-.38v.38h-1.51V5.37h1.5v4.11a3.74 3.74 0 0 1 1.8-.63H16a3.67 3.67 0 0 1 2.39 6.46Zm-.22-2.77a2.1 2.1 0 1 1-4.21 0 2.1 2.1 0 0 1 4.21 0Z"
  }
  function socialIcon(key) {
    if (!SOCIAL_MARKS[key]) return factIcon(ICON.globe)
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "currentColor"); s.setAttribute("aria-hidden", "true")
    s.innerHTML = '<path d="' + SOCIAL_MARKS[key] + '"/>'
    return s
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
    // The row hides with its chip: left empty in the card's grid it added a
    // second gap under the title on every card (the skin's .lb-chips[hidden]).
    const chipsRow = h("div", { class: "lb-chips", hidden: true }, tasteChip)
    // A like or dislike the rep just made fades its chip in (120ms, opacity
    // only), so the chip reads as the answer to the click rather than popping.
    // The first paint, from the lead's saved taste, stays instant.
    let tastePainted = false
    function paintTaste() {
      likeBtn.setAttribute("aria-pressed", lead.liked ? "true" : "false")
      dislikeBtn.setAttribute("aria-pressed", lead.disliked ? "true" : "false")
      const before = tasteChip.textContent
      tasteChip.hidden = !lead.liked && !lead.disliked
      chipsRow.hidden = tasteChip.hidden
      tasteChip.textContent = lead.liked ? t("likedChip") : lead.disliked ? t("dislikedChip") : ""
      if (tastePainted && !tasteChip.hidden && tasteChip.textContent !== before && tasteChip.animate) {
        tasteChip.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: "cubic-bezier(0.23, 1, 0.32, 1)" })
      }
      tastePainted = true
    }
    paintTaste()

    // selection for the bulk apply
    // In a 34px label (the skin's .lb-pick): the bare 16px box was the
    // smallest target on the card.
    const pick = h("input", { type: "checkbox", "data-pick": lead.id, "aria-label": t("selectAria", { name }) })
    pick.checked = state.selected.has(lead.id)
    pick.addEventListener("change", () => { pick.checked ? state.selected.add(lead.id) : state.selected.delete(lead.id); syncSelectAll() })
    const pickTarget = h("label", { class: "lb-pick" }, pick)

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
    // The company's social profiles, when Leadbay sends them (social_urls):
    // every platform with a URL, never a fixed list, as small link pills.
    const SOCIAL_LABELS = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", twitter: "X", tiktok: "TikTok", crunchbase: "Crunchbase" }
    // Icon only: each platform's own mark, the title for a tooltip and the
    // aria-label for a screen reader.
    const socials = Object.entries((lead.social_urls && typeof lead.social_urls === "object") ? lead.social_urls : {})
      .filter(([, href]) => typeof href === "string" && /^https?:\/\//.test(href))
      .map(([key, href]) => {
        const label = SOCIAL_LABELS[key] || key
        return h("a", { class: "social", href, target: "_blank", rel: "noopener", title: label,
          "aria-label": t("socialAria", { platform: label, name }) }, socialIcon(key))
      })

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
    const actMsg = h("div", { class: "lb-msg", id: `act-msg-${lead.id}`, role: "status", "aria-live": "polite" })
    const toggles = ACTIONS.map((a) =>
      h("button", { class: "lb-action", type: "button", role: "checkbox", "data-value": a.value, "aria-label": t("actionAria", { action: t(a.key), name }), text: t(a.key), onClick: () => toggle(a) }),
    )
    // Pointer-only feedback: keyboard activation remains immediate.
    for (const b of toggles) {
      b.addEventListener("pointerdown", (e) => {
        if (e.isPrimary && e.button === 0 && b.getAttribute("aria-disabled") !== "true") b.setAttribute("data-pressed", "")
      })
      for (const event of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture", "blur"]) {
        b.addEventListener(event, () => b.removeAttribute("data-pressed"))
      }
    }
    function paintToggles() { const on = today(lead); for (const b of toggles) b.setAttribute("aria-checked", on.has(b.dataset.value) ? "true" : "false") }
    paintToggles()
    // While one saves, the four are aria-disabled rather than disabled: a
    // disabled button drops keyboard focus, sending the rep back to the top.
    async function toggle(a) {
      if (toggles[0].getAttribute("aria-disabled") === "true") return
      const selected = !today(lead).has(a.value)
      for (const b of toggles) b.setAttribute("aria-disabled", "true")
      say(actMsg, t("saving"))
      try {
        await lb.call("leadbay_set_prospecting_action", { lead_id: lead.id, action: a.value, selected, _triggered_by: ASK })
        const type = "EPILOGUE_" + a.value
        const list = lead.epilogue_today_statuses || []
        lead.epilogue_today_statuses = selected ? list.concat({ type, added_at: new Date().toISOString() }) : list.filter((e) => e.type !== type)
        say(actMsg, t(selected ? "actionOn" : "actionOff", { action: t(a.key) }), "ok")
      } catch (err) {
        say(actMsg, toolMissing(err) ? t("needsRelease") : t("saveFailed") + (err && err.message ? ` (${err.message})` : ""), "error")
      } finally {
        for (const b of toggles) b.removeAttribute("aria-disabled")
        paintToggles()
      }
    }

    // note — the web app's note field, never report_outreach
    const noteInput = h("input", { class: "lb-input", type: "text", placeholder: t("notePlaceholder"), "aria-label": t("noteAria", { name }), "aria-describedby": `act-msg-${lead.id}` })
    noteInput.addEventListener("input", () => noteInput.removeAttribute("aria-invalid"))
    const noteField = lb.field({ validate: (v) => (v && String(v).trim() ? null : t("noteRequired")) })
    lb.bindValue(noteInput, noteField)
    const noteBtn = h("button", { class: "lb-btn lb-btn-submit", type: "button", text: t("logOutreach") })
    const noteWrite = lb.note({ leadId: lead.id, note: noteField })
    lb.bindAction(noteBtn, noteWrite)
    noteWrite.subscribe((a) => {
      if (a.loading) say(actMsg, t("savingNote"))
      else if (a.error) {
        say(actMsg, a.error.message, "error")
        // An empty note: mark the field and put the rep back in it.
        if (!String(noteInput.value || "").trim()) { noteInput.setAttribute("aria-invalid", "true"); noteInput.focus() }
      }
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
    // The excerpt is clamped to 3 lines (page.html). "Show more" appears only
    // when the clamp actually cuts it, measured once the card is laid out and
    // again when its width changes, so the full text is always reachable.
    let excerptEl = null, excerptToggle = null
    if (excerpt) {
      excerptEl = h("div", { class: "lb-sub excerpt", text: excerpt })
      excerptToggle = h("button", { class: "excerpt-toggle", type: "button", hidden: true, "aria-expanded": "false", text: t("showMore"), onClick: () => {
        const open = !excerptEl.hasAttribute("data-open")
        excerptEl.toggleAttribute("data-open", open)
        excerptToggle.setAttribute("aria-expanded", String(open))
        excerptToggle.textContent = t(open ? "showLess" : "showMore")
      } })
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          if (!excerptEl.hasAttribute("data-open")) excerptToggle.hidden = excerptEl.scrollHeight <= excerptEl.clientHeight + 1
        }).observe(excerptEl)
      }
    }
    const boost = (lead.qualification_summary && lead.qualification_summary.avg_qualification_boost) || 0
    const tags = (lead.tags || []).map((tag) => h("span", { text: tag.display_name }))

    return h("article", { class: "lb-card" },
      h("div", { class: "lb-card-top" },
        pickTarget,
        // A heading, so a screen reader can jump from lead to lead.
        h("h2", { class: "lb-lead-title" }, lead.website ? h("a", { href: url(lead.website), target: "_blank", rel: "noopener", text: name }) : name),
        h("span", { class: "lb-group" }, likeBtn, dislikeBtn),
      ),
      chipsRow,
      h("div", { class: "lb-sections" },
        h("div", { class: "lb-section" },
          facts.length ? h("div", { class: "lb-tags-plain" }, facts.map((f) => h("span", { text: f }))) : null,
          h("div", { class: "lb-sub", text: whyFits(lead) }),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("fit") }),
          h("div", { class: "fit" },
            h("code", { class: "bar", "aria-hidden": "true", text: bar(lead) }),
            // The bar is hidden from screen readers; this says its score. The
            // verdict text beside it is read as it is.
            h("span", { class: "lb-vh", text: t("fitAria", { score: Math.max(0, Math.min(10, Math.round((lead.score || 0) / 10))) }) }),
            h("span", { class: "verdict", "data-v": verdictOf(lead), text: boost > 0 ? t("aiBoost", { n: Math.round(boost) }) : boost < 0 ? t("aiPenalty", { n: Math.abs(Math.round(boost)) }) : t("noAiAdjustment") }),
          ),
          excerptEl, excerptToggle,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("intentTags") }),
          tags.length ? h("div", { class: "lb-tags-intent" }, tags) : h("div", { class: "lb-tags-empty", text: t("noIntent") }),
        ),
        // Two sections, not one "Data" block: the person to reach, and the
        // company's own lines. The phone and email are the company's
        // switchboard, never the contact's direct line, so they sit under
        // the company, not under the name. The skin's fact rows put each
        // glyph in its own column, so a wrapped line hangs under its text.
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("contactTitle") }),
          // No glyph: the section title and the LinkedIn mark before the name
          // already say this is a person.
          h("div", { class: "lb-sub contact" },
            h("span", null,
              who
                ? [
                    li
                      ? h("a", {
                          class: "lb-link li-link", href: li.url, target: "_blank", rel: "noopener",
                          title: li.profile ? t("onLinkedin", { who }) : t("searchLinkedin", { who }),
                        }, linkedinIcon(), h("span", { text: who }))
                      : who,
                    rc.job_title ? " · " + rc.job_title : null,
                  ]
                : t("noContact"))),
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("companyTitle") }),
          // Two columns: the company's lines, and its social profiles beside
          // them (page.html .company-row); the profiles wrap under the lines
          // when the card is too narrow for both.
          h("div", { class: "company-row" },
          h("div", { class: "lb-facts company" },
            phone ? h("div", { class: "lb-sub lb-fact" }, factIcon(ICON.phone),
              h("a", { class: "lb-link nowrap", href: "tel:" + phone.replace(/[^\d+]/g, ""), "aria-label": t("callAria", { phone }), text: phone })) : null,
            email ? h("div", { class: "lb-sub lb-fact" }, factIcon(ICON.mail),
              h("a", { class: "lb-link", href: "mailto:" + email, text: email })) : null,
            !phone && !email ? h("div", { class: "lb-sub lb-fact" }, factIcon(ICON.building), h("span", { text: t("noChannel") })) : null,
            lead.website ? h("div", { class: "lb-sub lb-fact" }, factIcon(ICON.globe),
              h("a", { class: "lb-link", href: url(lead.website), target: "_blank", rel: "noopener", text: String(lead.website).replace(/^https?:\/\//, "").replace(/\/$/, "") })) : null,
          ),
            socials.length ? h("div", { class: "socials" }, socials) : null,
          ),
        ),
        // Status opens the card's second group, what the rep does about the
        // lead, set apart from what they read above it (page.html .act-start).
        h("div", { class: "lb-section act-start" },
          h("div", { class: "lb-sec-title", text: t("status") }),
          statusSel, statusMsg,
        ),
        h("div", { class: "lb-section" },
          h("div", { class: "lb-sec-title", text: t("outreach") }),
          h("div", { class: "lb-stack" },
            h("div", { class: "actions", role: "group", "aria-label": t("actionsAria", { name }) }, toggles),
            // The note and its button on one row: the full-width black button
            // under the field was the heaviest thing on the card.
            h("div", { class: "lb-row note-row" }, noteInput, noteBtn),
          ),
          actMsg,
        ),
        h("div", { class: "lb-card-foot" },
          qBtn,
          h("span", { class: "lb-spacer" }),
          h("a", { class: "lb-link-out", href: leadUrl(lead), target: "_blank", rel: "noopener", "aria-label": t("openAria", { name }) }, t("open"), outIcon()),
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
