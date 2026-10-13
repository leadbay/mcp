(function () {
  const lb = window.LeadbayArtifacts
  lb.styles()

  const ASK = "Welcome board"
  // Every label the board shows, in English and French (lb.locale() picks:
  // the MCP Apps host's locale, else the browser's). The welcome card's copy
  // is the web app's own (frontend `leadpass_*` / `tour_*` keys), so a user
  // who met Leadbay there reads the same words here.
  const t = lb.i18n({
    en: {
      docTitle: "Welcome to Leadbay",
      welcome: "Welcome to Leadbay!",
      welcomeName: "Welcome to Leadbay, {name}!",
      subtitleLoading: "Loading what Leadbay knows about your business…",
      subtitleLearned: "Here's what our AI learned about {company}.",
      subtitlePlain: "Here's what you can ask Leadbay to do, right from this chat.",
      subtitleFailed: "Your account could not be read just now — everything below still works.",
      computing: "Leadbay is still learning about your business — your first leads are being scored and will land shortly.",
      tagsLabel: "Intent signals",
      tagsTip: "Topics your ideal buyers are actively researching and signaling intent around.",
      qqLabel: "Qualification questions",
      qqTip: "Questions to quickly assess whether a prospect matches your ideal profile during outreach.",
      ibpLabel: "Ideal buyer profile",
      ibpTip: "AI-learned profile of your ideal customer, built from your CRM data.",
      summaryLead: "Summary:",
      signals: "Strong signals",
      disqualifiers: "Disqualifiers",
      editAnytime: "You can edit your preferences anytime",
      editTaste: "Edit your taste profile",
      newTab: " (opens in a new tab)",
      asksLabel: "What you can ask Leadbay",
      chatHint: "To start right away, pick one of the suggestions in the chat. Or copy any phrase below and paste it.",
      ctaLabel: "Want to get the most out of Leadbay?",
      live: "Join the next live onboarding",
      ask: "Ask Leadbay",
      copy: "Copy the phrase",
      sent: "Sent to the chat.",
      staged: "Ready in your chat: press Enter to send it.",
      copied: "Copied — paste it in the chat.",
      selectIt: "The phrase is selected: copy it and paste it in the chat.",
      // The cards. `say` is what lands in the chat (MCP Apps) or is copied.
      leadsTitle: "See today's leads",
      leadsText: "New companies that fit your ideal buyer, picked and scored by the AI every day.",
      leadsSay: "Show me today's leads",
      refineTitle: "Refine your targeting",
      refineText: "Say in your own words what makes a good lead, or add, remove and rewrite the questions Leadbay checks on every lead. The next batch follows it.",
      refineSay: "I want to refine my targeting and qualification questions",
      researchTitle: "Research a company",
      researchText: "A one-page brief on any lead: what they do and their buying signals.",
      researchSay: "Research my top lead",
      outreachTitle: "Find contacts, draft an email",
      outreachText: "Find the decision-makers' emails and phones, then get a first email drafted for you.",
      outreachSay: "Draft a first email to my top lead",
      followTitle: "Follow up",
      followText: "The leads you already know or have worked, ranked so you know who to call next.",
      followSay: "Which leads should I follow up with?",
      mapTitle: "Plan a trip",
      mapText: "Going somewhere? See your leads on a map and plan the day's route.",
      mapSay: "Show my follow-ups on a map",
      campaignTitle: "Run a campaign",
      campaignText: "Group leads into a campaign and work them as a call list, with progress tracked.",
      campaignSay: "Build a campaign from my best leads",
      importTitle: "Import your CRM",
      importText: "Upload a file of accounts. Leadbay matches, scores and qualifies them.",
      importSay: "Import my CRM file",
    },
    fr: {
      docTitle: "Bienvenue sur Leadbay",
      welcome: "Bienvenue sur Leadbay !",
      welcomeName: "Bienvenue sur Leadbay, {name} !",
      subtitleLoading: "Chargement de ce que Leadbay sait de votre entreprise…",
      subtitleLearned: "Voici ce que notre IA a appris sur {company}.",
      subtitlePlain: "Voici ce que vous pouvez demander à Leadbay, directement depuis ce chat.",
      subtitleFailed: "Votre compte n'a pas pu être lu pour l'instant — tout ce qui suit fonctionne quand même.",
      computing: "Leadbay apprend encore à connaître votre entreprise — vos premiers leads sont en cours de scoring et arrivent bientôt.",
      tagsLabel: "Signaux d'intention",
      tagsTip: "Sujets sur lesquels vos acheteurs idéaux font activement des recherches et manifestent leur intérêt.",
      qqLabel: "Questions de qualification",
      qqTip: "Questions permettant d'évaluer rapidement si un prospect correspond à votre profil idéal lors de la prise de contact.",
      ibpLabel: "Profil de l'acheteur idéal",
      ibpTip: "Profil de votre client idéal établi par l'IA à partir des données de votre CRM.",
      // French puts a non-breaking space before the colon.
      summaryLead: "Résumé :",
      signals: "Signaux forts",
      disqualifiers: "Motifs d'exclusion",
      editAnytime: "Vous pouvez éditer vos préférences à tout moment",
      editTaste: "Modifier votre profil caractéristique",
      newTab: " (s'ouvre dans un nouvel onglet)",
      asksLabel: "Ce que vous pouvez demander à Leadbay",
      chatHint: "Pour commencer tout de suite, choisissez l'une des suggestions dans le chat. Ou copiez une phrase ci-dessous et collez-la.",
      ctaLabel: "Vous souhaitez tirer le meilleur parti de Leadbay ?",
      live: "Participer au prochain live onboarding",
      ask: "Demander à Leadbay",
      copy: "Copier la phrase",
      sent: "Envoyé dans le chat.",
      staged: "Prêt dans votre chat : appuyez sur Entrée pour l'envoyer.",
      copied: "Copié — collez-le dans le chat.",
      selectIt: "La phrase est sélectionnée : copiez-la et collez-la dans le chat.",
      leadsTitle: "Voir les leads du jour",
      leadsText: "De nouvelles entreprises qui correspondent à votre acheteur idéal, choisies et scorées chaque jour par l'IA.",
      leadsSay: "Montre-moi les leads du jour",
      refineTitle: "Affiner votre ciblage",
      refineText: "Dites avec vos mots ce qui fait un bon lead, ou ajoutez, supprimez et reformulez les questions que Leadbay vérifie sur chaque lead. Le prochain lot en tient compte.",
      refineSay: "Je veux affiner mon ciblage et mes questions de qualification",
      researchTitle: "Analyser une entreprise",
      researchText: "Une fiche d'une page sur n'importe quel lead : son activité et ses signaux d'achat.",
      researchSay: "Analyse mon meilleur lead",
      outreachTitle: "Trouver des contacts, rédiger un e-mail",
      outreachText: "Trouvez l'e-mail et le téléphone des décideurs, puis obtenez un premier e-mail rédigé pour vous.",
      outreachSay: "Rédige un premier e-mail pour mon meilleur lead",
      followTitle: "Relancer",
      followText: "Les leads que vous connaissez déjà ou avez travaillés, classés pour savoir qui appeler ensuite.",
      followSay: "Quels leads dois-je relancer ?",
      mapTitle: "Préparer un déplacement",
      mapText: "Vous partez en déplacement ? Voyez vos leads sur une carte et préparez l'itinéraire de la journée.",
      mapSay: "Montre mes relances sur une carte",
      campaignTitle: "Lancer une campagne",
      campaignText: "Regroupez des leads dans une campagne et travaillez-les comme une liste d'appels, avec le suivi de l'avancement.",
      campaignSay: "Crée une campagne avec mes meilleurs leads",
      importTitle: "Importer votre CRM",
      importText: "Importez un fichier de comptes. Leadbay les rapproche, les score et les qualifie.",
      importSay: "Importe mon fichier CRM",
    },
  })

  // Order follows the web app's tour: Discover, the taste profile, a lead's
  // profile, the selection actions (contacts), Monitor, the map, Campaign —
  // then the CRM import that feeds Monitor.
  const ASKS = [
    { key: "leads", icon: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>' },
    // One card for the two parts of the taste profile the chat can change:
    // the targeting prompt (leadbay_refine_lead_targeting) and the
    // qualification questions (leadbay_set_qualification_questions). The
    // assistant asks which the user means.
    { key: "refine", icon: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>' },
    { key: "research", icon: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>' },
    { key: "outreach", icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>' },
    { key: "follow", icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>' },
    { key: "map", icon: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>' },
    { key: "campaign", icon: '<path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z"/><path d="M16 9a3 3 0 0 1 0 6"/><path d="M19 6a7 7 0 0 1 0 12"/>' },
    { key: "import", icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>' },
  ]

  let data = null
  let failed = false
  // Whether the surface is known yet (after lb.openingResult()): until then
  // the board cannot tell if its buttons will send or copy.
  let booted = false

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
  const svg = (paths) => {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor")
    s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round")
    s.setAttribute("aria-hidden", "true"); s.innerHTML = paths; return s
  }
  const $ = (id) => document.getElementById(id)
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : [])
  function say(msg, text, tone) { msg.textContent = text; msg.dataset.tone = tone || "" }

  function translatePage() {
    document.title = t("docTitle")
    // The page's language follows its labels, for hyphenation, quotes and
    // screen-reader pronunciation.
    document.documentElement.lang = lb.locale()
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n)
  }

  // ---- the phrase buttons ----
  // Where the host takes it, the request goes straight into the chat and the
  // assistant acts on it: an MCP Apps host (ui/message), or a claude.ai
  // artifact through the `room` capability, where Claude asks the viewer to
  // confirm the send. lb.sendToChat must be called straight from the click
  // (nothing awaited first), or claude.ai refuses it. Elsewhere (cowork) the
  // button copies the phrase for the user to paste.
  async function deliver(phrase, label, msg, source) {
    if (lb.canSendToChat()) {
      const how = await lb.sendToChat(phrase, { label })
      if (how) return say(msg, how === "staged" ? t("staged") : t("sent"), "ok")
    }
    try {
      await navigator.clipboard.writeText(phrase)
      return say(msg, t("copied"), "ok")
    } catch {
      // Clipboard blocked by the frame: select the phrase so one Ctrl+C does it.
      if (source) {
        const range = document.createRange()
        range.selectNodeContents(source)
        const sel = window.getSelection()
        sel.removeAllRanges(); sel.addRange(range)
      }
      say(msg, t("selectIt"), "")
    }
  }
  const buttonLabel = () => (lb.canSendToChat() ? t("ask") : t("copy"))

  // ---- render ----
  function renderHeader() {
    const first = data && data.user && (data.user.first_name || data.user.name)
    $("title").textContent = first ? t("welcomeName", { name: first }) : t("welcome")
    const company = data && data.organization && data.organization.name
    $("subtitle").textContent = failed
      ? t("subtitleFailed")
      : !data
        ? t("subtitleLoading")
        : learnedAnything() && company
          ? t("subtitleLearned", { company })
          : t("subtitlePlain")
    $("computing").hidden = !(data && data.organization && data.organization.computing_intelligence)
  }

  function learnedAnything() {
    const lp = (data && data.leadpass) || {}
    const ibp = lp.ideal_buyer_profile
    return list(lp.purchase_intent_tags).length > 0 || list(lp.qualification_questions).length > 0 || !!(ibp && ibp.summary)
  }

  // Each section hides itself when Leadbay has nothing for it, as in the web
  // app's welcome card; the card hides when every section is empty.
  function renderLearned() {
    const lp = (data && data.leadpass) || {}
    const tags = list(lp.purchase_intent_tags)
    $("sec-tags").hidden = tags.length === 0
    $("tags").replaceChildren(...tags.map((tag) => h("span", { text: tag })))

    const qs = list(lp.qualification_questions)
    $("sec-questions").hidden = qs.length === 0
    // The <ol> already numbers them for screen readers; the "01" is visual.
    $("questions").replaceChildren(...qs.map((q, i) => h("li", {}, h("span", { class: "n", "aria-hidden": "true", text: String(i + 1).padStart(2, "0") }), h("span", { text: q }))))

    const ibp = lp.ideal_buyer_profile || null
    const yes = list(ibp && ibp.key_characteristics)
    const no = list(ibp && ibp.anti_patterns)
    $("sec-ibp").hidden = !(ibp && (ibp.summary || yes.length || no.length))
    // A bold "Summary:" lead-in introduces the summary text, so a summary
    // Leadbay wrote as a fragment ("pour les équipes commerciales B2B …")
    // still reads as a labelled line.
    const summary = ((ibp && ibp.summary) || "").trim()
    $("ibp-summary").replaceChildren(...(summary ? [h("strong", { text: t("summaryLead") }), " " + summary] : []))
    $("ibp-summary").hidden = !summary
    $("ibp-yes").replaceChildren(...yes.map((s) => h("li", { text: s })))
    $("ibp-no").replaceChildren(...no.map((s) => h("li", { text: s })))
    $("ibp-yes-col").hidden = yes.length === 0
    $("ibp-no-col").hidden = no.length === 0

    $("learned").hidden = !learnedAnything()
  }

  function renderAsks() {
    // Where the buttons only copy, send the user to the suggestions the
    // assistant offers in the chat: those are the one-click start there.
    $("chat-hint").hidden = !booted || lb.canSendToChat()
    if (booted) $("asks").setAttribute("data-ready", "")
    $("asks").replaceChildren(
      ...ASKS.map((a) => {
        const phrase = t(a.key + "Say")
        const titleId = "ask-" + a.key + "-title"
        const quote = h("p", { class: "say", text: "“" + phrase + "”" })
        const msg = h("div", { class: "lb-msg", role: "status", "aria-live": "polite" })
        // Eight buttons share one label; the card's title tells them apart.
        const btn = h("button", { class: "lb-btn", type: "button", "data-ask": a.key, "aria-describedby": titleId, text: buttonLabel(), onclick: () => deliver(phrase, t(a.key + "Title"), msg, quote) })
        return h("article", { class: "lb-card ask" },
          h("h3", {}, svg(a.icon), h("span", { id: titleId, text: t(a.key + "Title") })),
          h("p", { text: t(a.key + "Text") }),
          quote, h("div", { class: "ask-act" }, btn, msg),
        )
      }),
    )
  }

  function render() {
    translatePage()
    renderHeader()
    renderLearned()
    renderAsks()
  }

  // ---- start ----
  // As an MCP App view the host hands over the leadbay_welcome call that
  // opened the board: render it, no second call. Everywhere else
  // lb.openingResult() is null and the board reads the account itself.
  async function boot() {
    render()
    // The host decides whether the buttons send or copy: an MCP Apps host
    // says so in its handshake, claude.ai through the `room` capability.
    const [opening] = await Promise.all([lb.openingResult(), lb.chatSendReady()])
    booted = true
    const res = opening && opening.result
    if (res && res.user) {
      data = res
    } else {
      try {
        data = await lb.call("leadbay_welcome", { _triggered_by: ASK })
      } catch {
        failed = true
      }
    }
    render() // the host's locale and send capability are known now
  }
  boot()
})()
