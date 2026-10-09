(function () {
  const lb = window.LeadbayArtifacts
  const SERVER = "Leadbay"
  // Every write this page makes is a rep pressing one of its controls; this is
  // what those calls cite as their trigger. The same for every user, because
  // the page is.
  const ASK = "Route planner board"
  const ROUTE_STORAGE_KEY = "route-planner:stops"
  const GOOGLE_MAPS_STOP_LIMIT = 11

  // Every label the board shows, in English and French (lb.locale() picks:
  // the MCP Apps host's locale, else the browser's). English is the source;
  // a key missing in French falls back to it. Lead data is shown as Leadbay
  // returns it.
  const t = lb.i18n({
    en: {
      docTitle: "Leadbay Route Planner",
      heading: "Route Planner",
      connecting: "Connecting to Leadbay…",
      cityLabel: "City or area to prospect",
      cityPlaceholder: "City or area",
      cityPlaceholderExample: "City, e.g. {city}",
      showFollowups: "Show follow-ups",
      allAreas: "All areas",
      fitToLeads: "Fit to leads",
      cityHint: "Picking a city also sets the location filter on My leads in Leadbay.",
      legendAria: "Map legend",
      statusWanted: "Wanted",
      statusWon: "Won",
      statusLost: "Lost",
      statusUnwanted: "Unwanted",
      noStatus: "No status",
      workedToday: "Worked today",
      mapAria: "Map of follow-up leads",
      panelAria: "Lead and route panel",
      meetingPlanned: "Meeting planned",
      stillChasing: "Still chasing",
      couldNotReach: "Couldn't reach",
      notInterested: "Not interested",
      channelVisit: "In-person visit",
      channelCall: "Call",
      channelEmail: "Email",
      channelMessage: "Message",
      unavailableTally: "Leadbay isn't available here",
      unavailableNotice: "This planner needs the Leadbay connector. Open it in claude.ai with Leadbay connected under Settings → Connectors.",
      unreachable: "Leadbay isn't reachable from this view",
      needsReauth: "Your Leadbay connection has expired. Reconnect Leadbay in claude.ai Settings → Connectors, then reload.",
      notConnected: "Leadbay isn't connected for you. Add Leadbay in claude.ai Settings → Connectors, then reload.",
      notInManifest: "Leadbay is turned off for this page. Allow it from the page's connector prompt, then reload.",
      blocked: "Your organization's policy blocks this Leadbay action.",
      slowWrite: "Leadbay is slow to confirm — your change was most likely saved. Reload before retrying, or you may log it twice.",
      slowRead: "Leadbay took too long to answer. Try again in a moment.",
      genericError: "Leadbay couldn't complete the request.",
      loadingFollowups: "Loading follow-ups…",
      loadingMore: "Loading more follow-ups…",
      employeesRange: "{min}–{max} employees",
      employeesFrom: "{n}+ employees",
      unnamed: "Unnamed company",
      lead: "Lead",
      thisLead: "this lead",
      tally: "{loaded} of {total} follow-ups",
      tallyIn: " in {city}",
      tallyUnmapped: " · {n} without an address on the map",
      hintUs: "Add the state, e.g. \"Springfield, IL\".",
      hintFr: "Add the département or region, e.g. \"Valence, Drôme\".",
      severalMatch: "Several places match \"{city}\". {hint}",
      whichCity: "Which \"{city}\" do you mean?",
      todaysRoute: "Today's route",
      stops: "{n} stops",
      routeEmpty: "Click a pin, then Add to route. Stops keep their order here and on the map.",
      stopAria: "Stop {n}: {name}",
      start: "Start",
      moveUp: "Move up",
      moveDown: "Move down",
      removeFromRoute: "Remove from route",
      moveUpAria: "Move {name} up",
      moveDownAria: "Move {name} down",
      removeAria: "Remove {name} from route",
      crowFlies: "{km} as the crow flies",
      googleLimit: " · Google Maps takes the first {n} stops",
      driveIt: "Drive it in Google Maps",
      shortestOrder: "Shortest order",
      shortestOrderTitle: "Reorder by nearest next stop, keeping stop 1 as the start",
      clearRoute: "Clear route",
      followupsOnMap: "Follow-ups on the map",
      loadingYours: "Loading your follow-ups…",
      noFollowups: "No follow-ups match. Try another city, or All areas.",
      noAddress: "No address",
      stopN: "Stop {n}",
      notOnMap: "Not on map",
      loadMore: "Load {n} more",
      close: "Close",
      closeAria: "Close {name}",
      noAddressOnFile: "No address on file",
      contact: "Contact: ",
      onLinkedin: "{who} on LinkedIn",
      searchLinkedin: "No LinkedIn profile on file — search LinkedIn for {who}",
      noContact: "No contact yet — enrich to find one",
      companyLine: "Company line: {channels}",
      noCompanyChannel: "No company phone or email — enrich to look for them",
      locate: "Locate on map",
      openMapsAria: "Open {name} in Google Maps",
      googleMaps: "Google Maps ",
      openLeadbayAria: "Open {name} in Leadbay",
      openLeadbay: "Open in Leadbay ",
      removeStop: "Remove stop {n}",
      addToRoute: "Add to route",
      statusAria: "Lead status for {name}",
      saving: "Saving…",
      setFor: "Set to {status} for everyone in your org",
      status: "Status",
      actionAria: "{action} for {name}",
      actionsAria: "Prospecting actions for {name}",
      last: "Last: {action}",
      actionOn: "“{action}” on",
      actionOff: "“{action}” off",
      needsRelease: "Needs the next Leadbay release — set it in the web app for now.",
      prospectingAction: "Prospecting action",
      channelAria: "Outreach channel for {name}",
      notePlaceholder: "What happened? e.g. Met the store manager, wants a demo next week",
      noteAria: "Outreach note for {name}",
      logOutreach: "Log outreach",
      noStatusHint: "Sets no status — use Prospecting action above for that.",
      noteRequired: "Add a short note so your team knows what happened.",
      logging: "Logging…",
      logged: "{channel} logged",
      loggedOn: "{channel} logged on {name}",
      nearby: "Nearby follow-ups",
      noPosition: "This lead has no position, so nearby leads can't be measured.",
      noNearby: "No other loaded follow-ups have a position yet.",
      straightLine: "Straight-line distance, among the follow-ups loaded on the map.",
    },
    fr: {
      docTitle: "Planificateur de tournée Leadbay",
      heading: "Planificateur de tournée",
      connecting: "Connexion à Leadbay…",
      cityLabel: "Ville ou zone à prospecter",
      cityPlaceholder: "Ville ou zone",
      cityPlaceholderExample: "Ville, ex. {city}",
      showFollowups: "Afficher les relances",
      allAreas: "Toutes les zones",
      fitToLeads: "Cadrer sur les leads",
      cityHint: "Choisir une ville règle aussi le filtre de localisation de Mes leads dans Leadbay.",
      legendAria: "Légende de la carte",
      statusWanted: "En cours",
      statusWon: "Gagné",
      statusLost: "Perdu",
      statusUnwanted: "Non souhaité",
      noStatus: "Sans statut",
      workedToday: "Travaillé aujourd'hui",
      mapAria: "Carte des leads à relancer",
      panelAria: "Panneau du lead et de la tournée",
      meetingPlanned: "Rendez-vous planifié",
      stillChasing: "Toujours en cours",
      couldNotReach: "Injoignable",
      notInterested: "Pas intéressé",
      channelVisit: "Visite sur place",
      channelCall: "Appel",
      channelEmail: "E-mail",
      channelMessage: "Message",
      unavailableTally: "Leadbay n'est pas disponible ici",
      unavailableNotice: "Ce planificateur a besoin du connecteur Leadbay. Ouvrez-le dans claude.ai avec Leadbay connecté dans Paramètres → Connecteurs.",
      unreachable: "Leadbay n'est pas joignable depuis cette vue",
      needsReauth: "Votre connexion Leadbay a expiré. Reconnectez Leadbay dans claude.ai, Paramètres → Connecteurs, puis rechargez.",
      notConnected: "Leadbay n'est pas connecté pour vous. Ajoutez Leadbay dans claude.ai, Paramètres → Connecteurs, puis rechargez.",
      notInManifest: "Leadbay est désactivé pour cette page. Autorisez-le depuis l'invite de connecteur de la page, puis rechargez.",
      blocked: "La politique de votre organisation bloque cette action Leadbay.",
      slowWrite: "Leadbay tarde à confirmer — votre modification a très probablement été enregistrée. Rechargez avant de réessayer, sinon elle risque d'être enregistrée deux fois.",
      slowRead: "Leadbay a mis trop de temps à répondre. Réessayez dans un instant.",
      genericError: "Leadbay n'a pas pu traiter la demande.",
      loadingFollowups: "Chargement des relances…",
      loadingMore: "Chargement d'autres relances…",
      employeesRange: "{min}–{max} salariés",
      employeesFrom: "{n}+ salariés",
      unnamed: "Entreprise sans nom",
      lead: "Lead",
      thisLead: "ce lead",
      tally: "{loaded} sur {total} relances",
      tallyIn: " à {city}",
      tallyUnmapped: " · {n} sans adresse sur la carte",
      hintUs: "Ajoutez l'État, ex. « Springfield, IL ».",
      hintFr: "Ajoutez le département ou la région, ex. « Valence, Drôme ».",
      severalMatch: "Plusieurs lieux correspondent à « {city} ». {hint}",
      whichCity: "Quel « {city} » voulez-vous dire ?",
      todaysRoute: "Tournée du jour",
      stops: "{n} arrêts",
      routeEmpty: "Cliquez sur une épingle, puis Ajouter à la tournée. Les arrêts gardent leur ordre ici et sur la carte.",
      stopAria: "Arrêt {n} : {name}",
      start: "Départ",
      moveUp: "Monter",
      moveDown: "Descendre",
      removeFromRoute: "Retirer de la tournée",
      moveUpAria: "Monter {name}",
      moveDownAria: "Descendre {name}",
      removeAria: "Retirer {name} de la tournée",
      crowFlies: "{km} à vol d'oiseau",
      googleLimit: " · Google Maps prend les {n} premiers arrêts",
      driveIt: "Itinéraire dans Google Maps",
      shortestOrder: "Ordre le plus court",
      shortestOrderTitle: "Réordonner par arrêt le plus proche, en gardant l'arrêt 1 comme départ",
      clearRoute: "Vider la tournée",
      followupsOnMap: "Relances sur la carte",
      loadingYours: "Chargement de vos relances…",
      noFollowups: "Aucune relance ne correspond. Essayez une autre ville, ou Toutes les zones.",
      noAddress: "Sans adresse",
      stopN: "Arrêt {n}",
      notOnMap: "Hors carte",
      loadMore: "Charger {n} de plus",
      close: "Fermer",
      closeAria: "Fermer {name}",
      noAddressOnFile: "Aucune adresse enregistrée",
      contact: "Contact : ",
      onLinkedin: "{who} sur LinkedIn",
      searchLinkedin: "Aucun profil LinkedIn enregistré — rechercher {who} sur LinkedIn",
      noContact: "Pas encore de contact — enrichissez pour en trouver un",
      companyLine: "Ligne de l'entreprise : {channels}",
      noCompanyChannel: "Ni téléphone ni e-mail d'entreprise — enrichissez pour les chercher",
      locate: "Voir sur la carte",
      openMapsAria: "Ouvrir {name} dans Google Maps",
      googleMaps: "Google Maps ",
      openLeadbayAria: "Ouvrir {name} dans Leadbay",
      openLeadbay: "Ouvrir dans Leadbay ",
      removeStop: "Retirer l'arrêt {n}",
      addToRoute: "Ajouter à la tournée",
      statusAria: "Statut du lead {name}",
      saving: "Enregistrement…",
      setFor: "Passé à {status} pour toute votre organisation",
      status: "Statut",
      actionAria: "{action} pour {name}",
      actionsAria: "Actions de prospection pour {name}",
      last: "Dernière : {action}",
      actionOn: "« {action} » activé",
      actionOff: "« {action} » désactivé",
      needsRelease: "Nécessite la prochaine version de Leadbay — réglez-le dans l'application web pour l'instant.",
      prospectingAction: "Action de prospection",
      channelAria: "Canal de prise de contact pour {name}",
      notePlaceholder: "Que s'est-il passé ? ex. Rencontré le gérant, veut une démo la semaine prochaine",
      noteAria: "Note de prospection pour {name}",
      logOutreach: "Enregistrer la note",
      noStatusHint: "Ne change aucun statut — utilisez Action de prospection ci-dessus pour cela.",
      noteRequired: "Ajoutez une courte note pour que votre équipe sache ce qui s'est passé.",
      logging: "Enregistrement…",
      logged: "{channel} enregistré",
      loggedOn: "{channel} enregistré pour {name}",
      nearby: "Relances à proximité",
      noPosition: "Ce lead n'a pas de position, la distance aux autres leads ne peut pas être mesurée.",
      noNearby: "Aucune autre relance chargée n'a encore de position.",
      straightLine: "Distance à vol d'oiseau, parmi les relances chargées sur la carte.",
    },
  })

  // Codes → label keys. STATUS_KEYS also decides which statuses are "known".
  const STATUS_KEYS = { WANTED: "statusWanted", WON: "statusWon", LOST: "statusLost", UNWANTED: "statusUnwanted" }
  const statusName = (code) => (STATUS_KEYS[code] ? t(STATUS_KEYS[code]) : t("noStatus"))
  const PROSPECTING_ACTIONS = [
    { value: "INTEREST_VALIDATED_OR_MEETING_PLANED", key: "meetingPlanned" },
    { value: "STILL_CHASING", key: "stillChasing" },
    { value: "COULD_NOT_REACH_STILL_TRYING", key: "couldNotReach" },
    { value: "NOT_INTERESTED_LOST", key: "notInterested" },
  ]
  // The channel's label is also what the note says ("Call: met the manager"),
  // so a French rep's note reads in French.
  const CHANNELS = ["channelVisit", "channelCall", "channelEmail", "channelMessage"]

  const state = {
    leadsById: new Map(),
    leadOrder: [],
    total: 0,
    // The opening call's page size when the host hands it over (MCP Apps), so
    // "Load more" continues the agent's batch.
    pageSize: 100,
    page: -1,
    loading: false,
    city: "",
    cityId: "",
    activeCriteria: [],
    selectedId: null,
    route: readRoute(),
    workedToday: new Map(),
  }

  let mcp = null
  let lastConnectorError = null

  // On claude.ai the page reaches the viewer's connector through
  // window.claude.use("mcp") (callLeadbay below, which keeps that runtime's
  // error codes). Everywhere else — cowork, an MCP Apps host such as ChatGPT —
  // the kit picks the transport itself. Hard-wiring claude.ai made this board
  // dead on every other surface.
  const onClaude = Boolean(window.claude && typeof window.claude.use === "function")
  lb.configure(onClaude ? { call: callLeadbay, timeoutMs: 60000 } : { timeoutMs: 60000 })
  lb.styles()

  // MAP
  // zoomSnap 0.25: at whole zoom steps fitBounds settles one level short in the
  // half-width pane and leaves France small in a wide margin; quarter steps let
  // it fill the pane, centred.
  const map = L.map("map", { zoomControl: true, attributionControl: true, preferCanvas: false, zoomSnap: 0.25 })
  // A workspace serves exactly ONE country, and every Leadbay result says
  // which one in _meta.region. The map follows it: a US rep planning Austin
  // must not open on France with their pins floating over the Atlantic.
  //
  // Per region: the outline file published beside the page, the bounds the
  // opening view fits (the country's main landmass — Corsica included for
  // France; the lower 48 for the US, so Alaska and Hawaii sit off-screen
  // rather than shrinking the country to a strip), where to centre it, and
  // the outline's source.
  const REGIONS = {
    fr: {
      bounds: L.latLngBounds([41.3, -5.2], [51.1, 9.6]),          // Corsen→Italy, Bonifacio→Dunkerque
      center: [46.6, 2.5],
      cityExample: "Grenoble",
      attribution: 'Boundaries: <a href="https://github.com/gregoiredavid/france-geojson" target="_blank" rel="noopener">france-geojson</a>',
    },
    us: {
      bounds: L.latLngBounds([24.5, -124.8], [49.4, -66.9]),       // Key West→Maine, San Diego→Washington
      center: [37.0, -95.8],
      cityExample: "Austin",
      attribution: 'Boundaries: <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html" target="_blank" rel="noopener">US Census Bureau</a>',
    },
  }
  let region = null
  // Until the first answer says which country this is, hold a neutral view
  // rather than guess France and flash it at a US rep.
  map.setView([40, -30], 2)
  map.attributionControl.setPrefix(false)

  // The home view is the whole country, just fitting the pane. The zoom is
  // computed from the pane's size, and the host often sizes the artifact
  // frame a beat AFTER the page runs — so the first fit can be for a
  // near-empty box, and invalidateSize alone never re-zooms. While the map is
  // still on the home view, every resize re-frames it; the first move the
  // rep (or the page) makes ends that.
  let homeView = true
  let framing = false
  function showHome(options) {
    if (!region) return
    framing = true
    homeView = true
    map.setView(region.center, map.getBoundsZoom(region.bounds), options)
    framing = false
  }
  map.on("movestart", () => {
    if (!framing) homeView = false
  })

  // Called once, from the first answer. _meta.region is authoritative; a
  // lead's own country is the fallback; France is the last resort, as the
  // original tenant.
  function adoptRegion(result, leads) {
    if (region) return
    const fromMeta = result && result._meta && String(result._meta.region || "").toLowerCase()
    const fromLead = (leads.find((lead) => lead && lead.location && lead.location.country) || {}).location
    const key = REGIONS[fromMeta] ? fromMeta : fromLead && String(fromLead.country).toLowerCase() === "us" ? "us" : "fr"
    region = REGIONS[key]
    map.attributionControl.addAttribution(region.attribution)
    const cityInput = document.getElementById("city-input")
    if (cityInput) cityInput.placeholder = t("cityPlaceholderExample", { city: region.cityExample })
    showHome({ animate: false })
  }
  document.getElementById("fit-leads").addEventListener("click", fitToLeads)
  const markerLayer = L.layerGroup().addTo(map)
  const markersById = new Map()
  let routeLine = null

  let declutterFrame = 0
  map.on("moveend", scheduleLabelDeclutter)

  const mapFrameObserver = new ResizeObserver(handleMapResize)
  mapFrameObserver.observe(document.getElementById("map"))

  document.getElementById("city-form").addEventListener("submit", handleCitySubmit)
  document.getElementById("city-clear").addEventListener("click", handleCityClear)

  renderPanel()
  renderRouteLine()
  boot()

  // CONNECTOR

  async function boot() {
    translatePage()
    if (onClaude) {
      mcp = await window.claude.use("mcp")
      if (!mcp) {
        setTally(t("unavailableTally"))
        showNotice(t("unavailableNotice"), "error")
        return
      }
    }
    // As an MCP App view the host hands over the followups_map call that
    // opened the board: render it instead of calling again, and open on the
    // city the agent asked for. Everywhere else this is null.
    const opening = await lb.openingResult()
    translatePage() // the host's locale is known now
    loadBasemap()
    const args = (opening && opening.args) || {}
    const start = readBoardConfig()
    const city = typeof args.city === "string" && args.city.trim() ? args.city.trim() : start.city
    if (city) {
      state.city = city
      const input = document.getElementById("city-input")
      if (input) input.value = city
    }
    if (args.city_id != null && args.city_id !== "") state.cityId = String(args.city_id)
    if (Number(args.count) > 0) state.pageSize = Number(args.count)
    const res = opening && opening.result
    if (res && (Array.isArray(res.leads) || res.status === "ambiguous_locations")) {
      applyFollowups(res, Number(args.page) > 0 ? Number(args.page) : 0, true)
      setMapStatus(null)
      renderTally()
    } else {
      loadFollowups({ reset: true })
    }
  }

  // The page's fixed labels carry data-i18n="<key>" (text), data-i18n-aria
  // and data-i18n-placeholder; relabel them in the viewer's language.
  function translatePage() {
    document.title = t("docTitle")
    for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n)
    for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria))
    for (const el of document.querySelectorAll("[data-i18n-placeholder]")) el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder))
  }

  // The board's one editable part, set by the agent that published it. A
  // missing or malformed block is the same as an empty one.
  function readBoardConfig() {
    try {
      const raw = document.getElementById("lb-board-config")
      const parsed = raw ? JSON.parse(raw.textContent || "{}") : {}
      return { city: typeof parsed.city === "string" ? parsed.city.trim() : "" }
    } catch (_) {
      return { city: "" }
    }
  }

  async function callLeadbay(tool, args) {
    if (!mcp) {
      const unavailable = new Error(t("unreachable"))
      unavailable.code = "unavailable"
      throw unavailable
    }
    lastConnectorError = null
    try {
      const res = await mcp.callTool(SERVER, tool, { _origin: "artifact", ...args })
      // `payload` is the documented home of the answer (structuredContent, or
      // the text parsed as JSON) — the same unwrap the kit's own bridge does.
      return res && "payload" in res && res.payload !== undefined ? res.payload : res
    } catch (error) {
      lastConnectorError = error
      throw error
    }
  }

  function describeConnectorError(error, kind) {
    const code = (lastConnectorError && lastConnectorError.code) || (error && error.code)
    if (code === "needs_reauth") return t("needsReauth")
    if (code === "server_not_connected" || code === "selection_required") return t("notConnected")
    if (code === "not_in_manifest") return t("notInManifest")
    if (code === "blocked_by_policy" || code === "approval_required") return t("blocked")
    if (code === "timeout" || code === "server_unavailable") {
      // The call timeout (60s here, via lb.configure) is a Promise.race: it
      // abandons the call, it does not cancel it. The request carries on, reaches the backend, and a write
      // usually lands anyway — which is why a rep sees this message and then
      // finds the action applied in the app. "Try again" would write it twice.
      return kind === "write" ? t("slowWrite") : t("slowRead")
    }
    return (error && error.message) || t("genericError")
  }

  // DATA

  async function loadFollowups({ reset, setFilter }) {
    if (state.loading) return
    state.loading = true
    lastConnectorError = null
    const page = reset ? 0 : state.page + 1
    setMapStatus(reset ? t("loadingFollowups") : t("loadingMore"))
    const args = { count: state.pageSize, page, _triggered_by: ASK }
    if (setFilter) args.set_filter = setFilter
    else if (state.cityId) args.city_id = state.cityId
    else if (state.city) args.city = state.city

    try {
      applyFollowups(await lb.call("leadbay_followups_map", args), page, reset)
    } catch (error) {
      showNotice(describeConnectorError(error), "error")
    } finally {
      state.loading = false
      setMapStatus(null)
      renderTally()
    }
  }

  // One followups_map answer → the map and panel. Shared by the opening result
  // (MCP Apps) and every load the rep triggers, so both read it the same way.
  function applyFollowups(result, page, reset) {
    if (result && result.status === "ambiguous_locations") {
      adoptRegion(result, [])
      renderAmbiguousLocations(result.location_ambiguities)
      return
    }
    clearNotice()
    const leads = Array.isArray(result && result.leads) ? result.leads : []
    adoptRegion(result, leads)
    state.activeCriteria = (result && result.active_filters && result.active_filters.criteria) || []
    state.total = (result && result.pagination && result.pagination.total) || leads.length
    if (reset) {
      state.leadsById.clear()
      state.leadOrder = []
    }
    for (const lead of leads) {
      if (!lead || !lead.id) continue
      if (!state.leadsById.has(lead.id)) state.leadOrder.push(lead.id)
      state.leadsById.set(lead.id, lead)
    }
    state.page = page
    syncRouteWithLeads()
    renderMarkers()
    if (state.selectedId && !state.leadsById.has(state.selectedId)) state.selectedId = null
    renderPanel()
  }

  // The country outline comes from Leadbay (leadbay_get_basemap), for the
  // workspace's own region, so the page needs no file beside it. Without it
  // the pins still work; only the grey country shape is missing.
  async function loadBasemap() {
    try {
      const res = await lb.call("leadbay_get_basemap", {})
      if (!res || !res.geojson) throw new Error("no outline in the answer")
      adoptRegion({ _meta: { region: res.region } }, [])
      // Sent as a JSON string (see leadbay_get_basemap) — parse it here.
      const outline = typeof res.geojson === "string" ? JSON.parse(res.geojson) : res.geojson
      const basemap = L.geoJSON(outline, { style: { className: "dept" }, interactive: false }).addTo(map)
      basemap.bringToBack()
    } catch (error) {
      console.warn("Basemap unavailable", error)
    }
  }

  function readRoute() {
    try {
      const stored = JSON.parse(localStorage.getItem(ROUTE_STORAGE_KEY) || "[]")
      return Array.isArray(stored) ? stored.filter((stop) => stop && stop.id && isValidPosition(stop.pos)) : []
    } catch {
      return []
    }
  }

  function saveRoute() {
    try {
      localStorage.setItem(ROUTE_STORAGE_KEY, JSON.stringify(state.route))
    } catch {
      /* per-viewer convenience only */
    }
  }

  // Keep saved stops in step with fresh lead data (name, status) when the lead is loaded again.
  function syncRouteWithLeads() {
    for (const stop of state.route) {
      const lead = state.leadsById.get(stop.id)
      if (lead) Object.assign(stop, stopFromLead(lead))
    }
    saveRoute()
  }

  // HELPERS

  function h(tag, props, ...children) {
    const element = document.createElement(tag)
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue
      if (key === "class") element.className = value
      else if (key === "text") element.textContent = value
      else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value)
      else element.setAttribute(key, value === true ? "" : String(value))
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue
      element.append(child instanceof Node ? child : document.createTextNode(String(child)))
    }
    return element
  }

  function svgIcon(paths) {
    const wrapper = document.createElement("span")
    wrapper.setAttribute("aria-hidden", "true")
    wrapper.style.display = "contents"
    wrapper.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      paths +
      "</svg>"
    return wrapper
  }

  const ICONS = {
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    up: '<polyline points="18 15 12 9 6 15"/>',
    down: '<polyline points="6 9 12 15 18 9"/>',
    remove: '<line x1="5" y1="12" x2="19" y2="12"/>',
    out: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>',
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`)
  }

  function realValue(value) {
    return value && value !== "null" ? value : null
  }

  function isValidPosition(position) {
    return (
      Array.isArray(position) &&
      position.length >= 2 &&
      Number.isFinite(position[0]) &&
      Number.isFinite(position[1]) &&
      !(position[0] === 0 && position[1] === 0)
    )
  }

  function leadPosition(lead) {
    const position = lead && lead.location && lead.location.pos
    return isValidPosition(position) ? [position[0], position[1]] : null
  }

  function leadStatus(lead) {
    const status = String((lead && lead.state && lead.state.status) || "").toUpperCase()
    return STATUS_KEYS[status] ? status : "DEFAULT"
  }

  // Today's prospecting actions as the button values ("STILL_CHASING"...).
  // The field is absent on a lead nobody has actioned — that is an empty set.
  function todaysActions(lead) {
    const list = lead && Array.isArray(lead.epilogue_today_statuses) ? lead.epilogue_today_statuses : []
    return new Set(list.map((entry) => String(entry.type || "").replace(/^EPILOGUE_/, "")))
  }

  // The most recent action ever set, for the "Last:" line only. Not a
  // selection: a deselect does not clear it.
  function currentEpilogue(lead) {
    const raw = lead && lead.epilogue_status
    return typeof raw === "string" && raw ? raw.replace(/^EPILOGUE_/, "") : null
  }

  function shortDate(iso) {
    const date = new Date(iso)
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
  }

  function leadPlace(lead) {
    const location = (lead && lead.location) || {}
    return [realValue(location.city), realValue(location.state)].filter(Boolean).join(", ")
  }

  function leadSize(lead) {
    const size = lead && lead.size
    if (!size || (!size.min && !size.max)) return null
    if (size.min && size.max) return t("employeesRange", { min: size.min, max: size.max })
    return t("employeesFrom", { n: size.min || size.max })
  }

  function isToday(isoDate) {
    if (!isoDate) return false
    const date = new Date(isoDate)
    const now = new Date()
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  }

  function workedTodayLabel(lead) {
    const sessionAction = state.workedToday.get(lead.id)
    if (sessionAction) return sessionAction
    const todayStatuses = Array.isArray(lead.epilogue_today_statuses) ? lead.epilogue_today_statuses : []
    if (todayStatuses.length) {
      const latestType = String(todayStatuses[todayStatuses.length - 1].type || "").replace(/^EPILOGUE_/, "")
      const known = PROSPECTING_ACTIONS.find((action) => action.value === latestType)
      return known ? t(known.key) : t("workedToday")
    }
    if (isToday(lead.last_prospecting_action_at)) return t("workedToday")
    return null
  }

  function distanceKm(from, to) {
    const radians = Math.PI / 180
    const deltaLat = (to[0] - from[0]) * radians
    const deltaLng = (to[1] - from[1]) * radians
    const haversine =
      Math.sin(deltaLat / 2) ** 2 + Math.cos(from[0] * radians) * Math.cos(to[0] * radians) * Math.sin(deltaLng / 2) ** 2
    return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  }

  function formatKm(kilometres) {
    return kilometres < 10 ? `${kilometres.toFixed(1)} km` : `${Math.round(kilometres)} km`
  }

  function leadbayUrl(leadId) {
    return `https://leadbay.app/app/monitor?lead=${encodeURIComponent(leadId)}`
  }

  function googleMapsPlaceUrl(lead) {
    const address = realValue(lead.location && lead.location.full)
    const position = leadPosition(lead)
    const query = address ? `${lead.name || ""} ${address}`.trim() : position.join(",")
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
  }

  function googleMapsRouteUrl(stops) {
    const usable = stops.slice(0, GOOGLE_MAPS_STOP_LIMIT)
    const coordinates = usable.map((stop) => stop.pos.join(","))
    const params = new URLSearchParams({ api: "1", travelmode: "driving" })
    if (coordinates.length === 1) {
      params.set("destination", coordinates[0])
    } else {
      params.set("origin", coordinates[0])
      params.set("destination", coordinates[coordinates.length - 1])
      if (coordinates.length > 2) params.set("waypoints", coordinates.slice(1, -1).join("|"))
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`
  }

  function stopFromLead(lead) {
    return { id: lead.id, name: lead.name || t("unnamed"), place: leadPlace(lead), pos: leadPosition(lead), status: leadStatus(lead) }
  }

  function routeIndex(leadId) {
    return state.route.findIndex((stop) => stop.id === leadId)
  }

  // CHROME

  function setTally(text) {
    document.getElementById("tally").textContent = text
  }

  function renderTally() {
    const loaded = state.leadOrder.length
    if (!loaded && state.page < 0) return
    const unmapped = state.leadOrder.filter((leadId) => !leadPosition(state.leadsById.get(leadId))).length
    const scope = state.city ? t("tallyIn", { city: state.city }) : ""
    const unmappedText = unmapped ? t("tallyUnmapped", { n: unmapped }) : ""
    setTally(t("tally", { loaded: loaded.toLocaleString(), total: state.total.toLocaleString() }) + scope + unmappedText)
    document.getElementById("city-clear").hidden = !state.city
  }

  function setMapStatus(text) {
    const status = document.getElementById("map-status")
    status.hidden = !text
    if (text) document.getElementById("map-status-text").textContent = text
  }

  function showNotice(message, tone, ...extra) {
    const notice = document.getElementById("notice")
    notice.dataset.tone = tone || ""
    notice.replaceChildren(h("span", { text: message }), ...extra)
  }

  function clearNotice() {
    document.getElementById("notice").replaceChildren()
  }

  function renderAmbiguousLocations(candidates) {
    const options = (Array.isArray(candidates) ? candidates : [])
      .map((candidate) => ({
        id: candidate && (candidate.id ?? candidate.admin_area_id ?? candidate.city_id),
        label: candidate && (candidate.display_name || candidate.name || candidate.label || candidate.full_name),
      }))
      .filter((candidate) => candidate.id !== undefined && candidate.id !== null && candidate.label)

    if (!options.length) {
      const hint = region === REGIONS.us ? t("hintUs") : t("hintFr")
      showNotice(t("severalMatch", { city: state.city, hint }), "error")
      return
    }
    const buttons = options.map((option) =>
      h("button", { class: "lb-btn", type: "button", text: option.label, onClick: handleAmbiguityPick(option) }),
    )
    showNotice(t("whichCity", { city: state.city }), "", ...buttons)
  }

  function handleAmbiguityPick(option) {
    return function handlePick() {
      state.cityId = String(option.id)
      state.city = option.label
      clearNotice()
      loadFollowups({ reset: true })
    }
  }

  function handleCitySubmit(event) {
    event.preventDefault()
    const city = document.getElementById("city-input").value.trim()
    if (!city) {
      handleCityClear()
      return
    }
    state.city = city
    state.cityId = ""
    state.selectedId = null
    loadFollowups({ reset: true })
  }

  // Drop only the location criterion so the rest of the rep's Monitor filter survives.
  function handleCityClear() {
    state.city = ""
    state.cityId = ""
    state.selectedId = null
    document.getElementById("city-input").value = ""
    const remainingCriteria = state.activeCriteria.filter((criterion) => criterion && criterion.type !== "location_ids")
    loadFollowups({ reset: true, setFilter: { criteria: remainingCriteria } })
  }

  function handleMapResize() {
    // pan:false, so the resize itself does not count as the rep moving away.
    map.invalidateSize({ pan: false })
    if (homeView) showHome({ animate: false })
    scheduleLabelDeclutter()
  }

  // LABELS

  function scheduleLabelDeclutter() {
    cancelAnimationFrame(declutterFrame)
    declutterFrame = requestAnimationFrame(declutterLabels)
  }

  function labelPriority(leadId) {
    if (state.selectedId === leadId) return 0
    return routeIndex(leadId) >= 0 ? 1 : 2
  }

  // Show every label that fits; overlapping ones yield to the selected lead, then route stops, then list order.
  function declutterLabels() {
    const mapSize = map.getSize()
    const entries = []
    for (const leadId of state.leadOrder) {
      const marker = markersById.get(leadId)
      const label = marker && marker.getElement() && marker.getElement().querySelector(".pin-label")
      if (label) entries.push({ leadId, marker, label })
    }
    for (const entry of entries) entry.label.dataset.visible = "yes"
    for (const entry of entries) {
      const rect = entry.label.getBoundingClientRect()
      const origin = map.getContainer().getBoundingClientRect()
      entry.box = { left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top }
    }
    entries.sort((first, second) => labelPriority(first.leadId) - labelPriority(second.leadId))

    const placed = []
    for (const entry of entries) {
      const box = entry.box
      const onScreen = box.right > 0 && box.bottom > 0 && box.left < mapSize.x && box.top < mapSize.y
      const collides = placed.some(
        (other) => box.left < other.right + 2 && box.right + 2 > other.left && box.top < other.bottom + 1 && box.bottom + 1 > other.top,
      )
      const forced = labelPriority(entry.leadId) < 2
      const visible = onScreen && (forced || !collides)
      entry.label.dataset.visible = visible ? "yes" : "no"
      if (visible) placed.push(box)
    }
  }

  // MARKERS

  function pinIcon(lead) {
    const stopNumber = routeIndex(lead.id) + 1
    const isSelected = state.selectedId === lead.id
    const size = stopNumber ? 26 : isSelected ? 20 : 16
    const html =
      `<span class="pin" data-status="${leadStatus(lead)}" data-acted="${workedTodayLabel(lead) ? "yes" : "no"}"` +
      ` data-selected="${isSelected ? "yes" : "no"}" data-stop="${stopNumber ? "yes" : "no"}">${stopNumber || ""}</span>` +
      `<span class="pin-label">${escapeHtml(lead.name || t("unnamed"))}</span>`
    return L.divIcon({ className: "pin-wrap", html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  }

  function markerZIndex(lead) {
    if (state.selectedId === lead.id) return 1000
    return routeIndex(lead.id) >= 0 ? 500 : 0
  }

  function renderMarkers() {
    const seen = new Set()
    for (const leadId of state.leadOrder) {
      const lead = state.leadsById.get(leadId)
      const position = leadPosition(lead)
      if (!position) continue
      seen.add(leadId)
      const existing = markersById.get(leadId)
      if (existing) {
        existing.setIcon(pinIcon(lead))
        existing.setZIndexOffset(markerZIndex(lead))
        continue
      }
      const marker = L.marker(position, {
        icon: pinIcon(lead),
        title: lead.name || t("lead"),
        alt: lead.name || t("lead"),
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: markerZIndex(lead),
      })
      marker.on("click", handleMarkerClick(leadId))
      marker.addTo(markerLayer)
      markersById.set(leadId, marker)
    }
    for (const [leadId, marker] of markersById) {
      if (!seen.has(leadId)) {
        markerLayer.removeLayer(marker)
        markersById.delete(leadId)
      }
    }
    renderRouteLine()
    scheduleLabelDeclutter()
  }

  function handleMarkerClick(leadId) {
    return function handleClick() {
      selectLead(leadId, { fly: false })
    }
  }

  function refreshMarker(leadId) {
    const lead = state.leadsById.get(leadId)
    const marker = markersById.get(leadId)
    if (!lead || !marker) return
    marker.setIcon(pinIcon(lead))
    marker.setZIndexOffset(markerZIndex(lead))
    scheduleLabelDeclutter()
  }

  function renderRouteLine() {
    const positions = state.route.map((stop) => stop.pos)
    if (routeLine) {
      map.removeLayer(routeLine)
      routeLine = null
    }
    if (positions.length >= 2) {
      routeLine = L.polyline(positions, { className: "route-line", interactive: false }).addTo(map)
    }
  }

  // Framing the leads is now something the rep ASKS for, via "Fit to leads".
  // It used to run itself on first load, which meant the board opened on
  // whatever region the book clustered in rather than on France.
  function fitToLeads() {
    const positions = state.leadOrder.map((leadId) => leadPosition(state.leadsById.get(leadId))).filter(Boolean)
    if (!positions.length) {
      showHome()
      return
    }
    map.fitBounds(L.latLngBounds(positions).pad(0.15), { maxZoom: 11 })
  }

  // SELECTION

  function selectLead(leadId, { fly }) {
    const previous = state.selectedId
    state.selectedId = leadId
    if (previous) refreshMarker(previous)
    refreshMarker(leadId)
    renderPanel()
    const position = leadPosition(state.leadsById.get(leadId))
    if (fly && position) map.flyTo(position, Math.max(map.getZoom(), 11), { duration: prefersReducedMotion() ? 0 : 0.6 })
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }

  function handleClosePanel() {
    const previous = state.selectedId
    state.selectedId = null
    if (previous) refreshMarker(previous)
    renderPanel()
  }

  // PANEL

  function renderPanel() {
    const panel = document.getElementById("panel")
    const lead = state.selectedId && state.leadsById.get(state.selectedId)
    panel.replaceChildren(...(lead ? renderLeadDetail(lead) : renderOverview()))
    panel.scrollTop = 0
  }

  function renderOverview() {
    return [renderRouteSection(), renderLeadListSection()]
  }

  function renderRouteSection() {
    const stops = state.route
    let totalKm = 0
    for (let index = 1; index < stops.length; index++) totalKm += distanceKm(stops[index - 1].pos, stops[index].pos)

    const header = h(
      "div",
      { class: "section" },
      h("h2", { class: "section-title" }, h("span", { text: t("todaysRoute") }), h("span", { text: stops.length ? t("stops", { n: stops.length }) : "" })),
    )
    if (!stops.length) {
      header.append(h("div", { class: "empty", text: t("routeEmpty") }))
      return header
    }

    const list = h("div", { class: "rows" })
    stops.forEach((stop, index) => {
      const legKm = index ? distanceKm(stops[index - 1].pos, stop.pos) : null
      list.append(
        h(
          "div",
          { class: "stop" },
          h("span", { class: "stop-num", text: String(index + 1), "aria-hidden": "true" }),
          h(
            "div",
            { class: "row-main" },
            h("button", { class: "stop-name", type: "button", text: stop.name, onClick: handleStopOpen(stop.id), "aria-label": t("stopAria", { n: index + 1, name: stop.name }) }),
            h("span", { class: "row-sub", text: [stop.place, legKm !== null ? `+${formatKm(legKm)}` : t("start")].filter(Boolean).join(" · ") }),
          ),
          h(
            "div",
            { class: "stop-tools" },
            h("button", { class: "icon-btn", type: "button", title: t("moveUp"), "aria-label": t("moveUpAria", { name: stop.name }), disabled: index === 0, onClick: handleStopMove(index, -1) }, svgIcon(ICONS.up)),
            h("button", { class: "icon-btn", type: "button", title: t("moveDown"), "aria-label": t("moveDownAria", { name: stop.name }), disabled: index === stops.length - 1, onClick: handleStopMove(index, 1) }, svgIcon(ICONS.down)),
            h("button", { class: "icon-btn", type: "button", title: t("removeFromRoute"), "aria-label": t("removeAria", { name: stop.name }), onClick: handleStopRemove(stop.id) }, svgIcon(ICONS.remove)),
          ),
        ),
      )
    })

    const overLimit = stops.length > GOOGLE_MAPS_STOP_LIMIT
    header.append(
      list,
      h("div", { class: "summary", text: t("crowFlies", { km: formatKm(totalKm) }) + (overLimit ? t("googleLimit", { n: GOOGLE_MAPS_STOP_LIMIT }) : "") }),
      h(
        "div",
        { class: "actions" },
        h("a", { class: "lb-btn lb-btn-submit", href: googleMapsRouteUrl(stops), target: "_blank", rel: "noopener", text: t("driveIt") }),
        stops.length > 2 ? h("button", { class: "lb-btn", type: "button", text: t("shortestOrder"), title: t("shortestOrderTitle"), onClick: handleRouteOptimise }) : null,
        h("button", { class: "lb-btn", type: "button", text: t("clearRoute"), onClick: handleRouteClear }),
      ),
    )
    return header
  }

  function renderLeadListSection() {
    const section = h(
      "div",
      { class: "section" },
      h("h2", { class: "section-title" }, h("span", { text: t("followupsOnMap") }), h("span", { text: state.leadOrder.length ? String(state.leadOrder.length) : "" })),
    )
    if (!state.leadOrder.length) {
      section.append(h("div", { class: "empty", text: state.loading || state.page < 0 ? t("loadingYours") : t("noFollowups") }))
      return section
    }
    const list = h("div", { class: "rows" })
    for (const leadId of state.leadOrder) {
      const lead = state.leadsById.get(leadId)
      const onMap = Boolean(leadPosition(lead))
      const worked = workedTodayLabel(lead)
      const stopNumber = routeIndex(leadId) + 1
      list.append(
        h(
          "button",
          { class: "row-btn", type: "button", onClick: handleLeadRowClick(leadId) },
          h("span", { class: "dot", "data-status": leadStatus(lead), "data-acted": worked ? "yes" : "no", "aria-hidden": "true" }),
          h(
            "span",
            { class: "row-main" },
            h("span", { class: "row-name", text: lead.name || t("unnamed") }),
            h("span", { class: "row-sub", text: [leadPlace(lead) || t("noAddress"), worked].filter(Boolean).join(" · ") }),
          ),
          h("span", { class: "row-meta", text: stopNumber ? t("stopN", { n: stopNumber }) : onMap ? "" : t("notOnMap") }),
        ),
      )
    }
    section.append(list)
    if (state.leadOrder.length < state.total) {
      section.append(
        h("button", { class: "lb-btn", type: "button", disabled: state.loading, text: t("loadMore", { n: Math.min(state.pageSize, state.total - state.leadOrder.length) }), onClick: handleLoadMore }),
      )
    }
    return section
  }

  function renderLeadDetail(lead) {
    const name = lead.name || t("unnamed")
    const position = leadPosition(lead)
    const address = realValue(lead.location && lead.location.full)
    const contact = lead.recommended_contact
    const contactName = contact ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") : ""
    // The name links to LinkedIn, as in the agent's table and the triage board:
    // their profile, else a people search (lb.contactLinkedin).
    const contactLink = contactName ? lb.contactLinkedin(contact, lead.name) : null
    const phone = realValue((lead.phone_numbers || [])[0])
    const email = realValue(lead.email)
    const companyChannels = [phone && `☎ ${phone}`, email && `✉ ${email}`].filter(Boolean).join(" · ")

    const chips = h("div", { class: "chips", id: "lead-chips" })
    fillChips(chips, lead)

    const head = h(
      "div",
      { class: "section" },
      h(
        "div",
        { class: "panel-head" },
        h("h2", { text: name }),
        h("button", { class: "icon-btn", type: "button", title: t("close"), "aria-label": t("closeAria", { name }), onClick: handleClosePanel }, svgIcon(ICONS.close)),
      ),
      chips,
      h(
        "div",
        { class: "facts" },
        h("span", { class: "address", text: address || leadPlace(lead) || t("noAddressOnFile") }),
        leadSize(lead) ? h("span", { text: leadSize(lead) }) : null,
        contactName
          ? h("span", null,
              t("contact"),
              contactLink
                ? h("a", {
                    class: "lb-link", href: contactLink.url, target: "_blank", rel: "noopener",
                    title: contactLink.profile ? t("onLinkedin", { who: contactName }) : t("searchLinkedin", { who: contactName }),
                    text: contactName,
                  })
                : contactName,
              contact.job_title ? " · " + contact.job_title : null)
          : h("span", { text: t("noContact") }),
        h("span", { text: companyChannels ? t("companyLine", { channels: companyChannels }) : t("noCompanyChannel") }),
      ),
      h(
        "div",
        { class: "actions" },
        position ? h("button", { class: "lb-btn", type: "button", text: t("locate"), onClick: handleLocate(lead.id) }) : null,
        position ? renderRouteToggle(lead) : null,
      ),
      h(
        "div",
        { class: "links" },
        position ? h("a", { class: "lb-link-out", href: googleMapsPlaceUrl(lead), target: "_blank", rel: "noopener", "aria-label": t("openMapsAria", { name }) }, t("googleMaps"), svgIcon(ICONS.out)) : null,
        h("a", { class: "lb-link-out", href: leadbayUrl(lead.id), target: "_blank", rel: "noopener", "aria-label": t("openLeadbayAria", { name }) }, t("openLeadbay"), svgIcon(ICONS.out)),
      ),
    )

    return [head, renderStatusSection(lead), renderProspectingSection(lead), renderOutreachSection(lead), renderNearbySection(lead)]
  }

  function fillChips(container, lead) {
    const status = leadStatus(lead)
    const worked = workedTodayLabel(lead)
    // replaceChildren is NOT h(): its signature is (Node or DOMString)..., so a
    // null argument is stringified into the text node "null" rather than
    // skipped. Filter before passing, never pass a conditional straight in.
    const chips = [h("span", { class: "chip", "data-status": status }, h("i", { "aria-hidden": "true" }), statusName(status))]
    if (worked) chips.push(h("span", { class: "chip acted" }, h("i", { "aria-hidden": "true" }), worked))
    container.replaceChildren(...chips)
  }

  function refreshLeadViews(leadId) {
    refreshMarker(leadId)
    const lead = state.leadsById.get(leadId)
    const chips = document.getElementById("lead-chips")
    if (chips && state.selectedId === leadId && lead) fillChips(chips, lead)
    const stopIndex = routeIndex(leadId)
    if (stopIndex >= 0 && lead) {
      Object.assign(state.route[stopIndex], stopFromLead(lead))
      saveRoute()
    }
  }

  function renderRouteToggle(lead) {
    const inRoute = routeIndex(lead.id) >= 0
    return h("button", {
      class: inRoute ? "lb-btn" : "lb-btn lb-btn-submit",
      type: "button",
      text: inRoute ? t("removeStop", { n: routeIndex(lead.id) + 1 }) : t("addToRoute"),
      onClick: handleRouteToggle(lead.id),
    })
  }

  function renderStatusSection(lead) {
    const name = lead.name || t("thisLead")
    const select = h("select", { class: "lb-select", id: `status-${lead.id}`, "aria-label": t("statusAria", { name }) })
    const message = h("div", { class: "msg", role: "status", "aria-live": "polite" })
    const statusField = lb.leadStatus(leadStatus(lead) === "DEFAULT" ? "" : leadStatus(lead))
    const saveStatus = lb.setStatus({ leadId: lead.id, status: statusField, ask: ASK })
    let appliedResult = null

    lb.bindSelect(select, statusField)
    select.addEventListener("change", handleStatusChange)
    saveStatus.subscribe(handleStatusState)

    function handleStatusChange() {
      saveStatus.run()
    }

    function handleStatusState(action) {
      select.setAttribute("data-lb-state", action.loading ? "loading" : action.error ? "error" : action.lastResult ? "success" : "ready")
      message.dataset.tone = action.error ? "error" : action.lastResult ? "ok" : ""
      if (action.loading) {
        message.textContent = t("saving")
        return
      }
      if (action.error) {
        message.textContent = describeConnectorError(action.error, "write")
        return
      }
      if (action.lastResult && action.lastResult !== appliedResult) {
        appliedResult = action.lastResult
        lead.state = Object.assign({}, lead.state, { status: statusField.value })
        message.textContent = t("setFor", { status: STATUS_KEYS[statusField.value] ? statusName(statusField.value) : statusField.value })
        refreshLeadViews(lead.id)
      }
    }

    return h("div", { class: "section" }, h("h3", { class: "section-title", text: t("status") }), select, message)
  }

  function renderProspectingSection(lead) {
    // Same model as the web app's Prospection cell: the four actions are a
    // MULTI-select over the lead's `epilogue_today_statuses`. Several can be
    // on for one day, and each tap turns one on or off on its own. What is
    // selected comes from that list, never from `epilogue_status` — a
    // deselect takes the type out of today's list and leaves epilogue_status
    // untouched, so reading epilogue_status would bring a removed action back
    // on the next open.
    const name = lead.name || t("thisLead")
    const message = h("div", { class: "msg", role: "status", "aria-live": "polite" })
    const buttons = PROSPECTING_ACTIONS.map((prospectingAction) =>
      h("button", {
        class: "choice",
        type: "button",
        role: "checkbox",
        text: t(prospectingAction.key),
        "data-value": prospectingAction.value,
        "aria-label": t("actionAria", { action: t(prospectingAction.key), name }),
        onClick: handleProspectingToggle(lead, prospectingAction),
      }),
    )
    const grid = h("div", { class: "choices", role: "group", "aria-label": t("actionsAria", { name }) }, buttons)
    // With nothing on today, say what was last set and when — as the web app
    // does — so the rep is not left thinking the lead was never worked.
    const last = h("div", { class: "summary" })
    paint()

    function paint() {
      const today = todaysActions(lead)
      for (const button of buttons) button.setAttribute("aria-checked", today.has(button.dataset.value) ? "true" : "false")
      const previous = currentEpilogue(lead)
      const option = PROSPECTING_ACTIONS.find((action) => action.value === previous)
      last.textContent = !today.size && option ? t("last", { action: t(option.key) }) + (lead.epilogue_status_set_at ? " · " + shortDate(lead.epilogue_status_set_at) : "") : ""
      last.hidden = !last.textContent
    }

    function handleProspectingToggle(targetLead, prospectingAction) {
      return async function handleToggle() {
        const selected = !todaysActions(targetLead).has(prospectingAction.value)
        for (const button of buttons) button.disabled = true
        message.dataset.tone = ""
        message.textContent = t("saving")
        try {
          await lb.call("leadbay_set_prospecting_action", {
            lead_id: targetLead.id,
            action: prospectingAction.value,
            selected,
            _triggered_by: ASK,
          })
          applyToggle(targetLead, prospectingAction.value, selected)
          message.dataset.tone = "ok"
          message.textContent = t(selected ? "actionOn" : "actionOff", { action: t(prospectingAction.key) })
        } catch (error) {
          message.dataset.tone = "error"
          // Until the hosted server carries leadbay_set_prospecting_action (the
          // 0.41 release) the toggle cannot run. There is deliberately no
          // fallback through report_outreach: that path waits 60s on a
          // confirmation prompt a page cannot show.
          message.textContent = isToolMissing(error) ? t("needsRelease") : describeConnectorError(error, "write")
        } finally {
          for (const button of buttons) button.disabled = false
          paint()
        }
      }
    }

    return h("div", { class: "section" }, h("h3", { class: "section-title", text: t("prospectingAction") }), grid, last, message)
  }

  // Mirror the write onto the lead so every view that reads it — this panel on
  // reopen, the pin's ring, the list — agrees without a reload.
  function applyToggle(lead, value, selected) {
    const type = "EPILOGUE_" + value
    const list = Array.isArray(lead.epilogue_today_statuses) ? lead.epilogue_today_statuses : []
    if (selected) {
      lead.epilogue_today_statuses = list.concat({ type, added_at: new Date().toISOString() })
      lead.epilogue_status = type
      lead.epilogue_status_set_at = new Date().toISOString()
    } else {
      lead.epilogue_today_statuses = list.filter((entry) => entry.type !== type)
    }
    // The session label would otherwise outlive a deselect; let the chip and
    // the ring derive from the lead's own data from here on.
    state.workedToday.delete(lead.id)
    refreshLeadViews(lead.id)
  }

  // A tool the hosted server does not know yet arrives as a tool error naming
  // it; anything else is a real failure the rep should see.
  function isToolMissing(error) {
    const text = String((error && (error.message || error.code)) || "")
    return /unknown tool|tool[^.]*not found|not_in_manifest|no such tool/i.test(text)
  }

  function renderOutreachSection(lead) {
    const name = lead.name || t("thisLead")
    const channelSelect = h(
      "select",
      { class: "lb-select", id: `channel-${lead.id}`, "aria-label": t("channelAria", { name }) },
      CHANNELS.map((key) => h("option", { value: t(key), text: t(key) })),
    )
    const noteInput = h("textarea", { class: "lb-input", id: `note-${lead.id}`, placeholder: t("notePlaceholder"), "aria-label": t("noteAria", { name }) })
    const submit = h("button", { class: "lb-btn lb-btn-submit", type: "submit", text: t("logOutreach") })
    const message = h("div", { class: "msg", role: "status", "aria-live": "polite" })
    const hint = h("div", { class: "summary", text: t("noStatusHint") })
    const form = h("form", { class: "section", onSubmit: handleOutreachSubmit }, h("h3", { class: "section-title", text: t("logOutreach") }), channelSelect, noteInput, submit, hint, message)

    function handleOutreachSubmit(event) {
      event.preventDefault()
      const noteText = noteInput.value.trim()
      if (!noteText) {
        message.dataset.tone = "error"
        message.textContent = t("noteRequired")
        noteInput.focus()
        return
      }
      // A plain note, as the web app's note field writes one — not
      // report_outreach. That tool asks a human to confirm a user_confirmed
      // outreach, and a page cannot show the prompt: the call waited 60s and
      // wrote anyway. It must keep asking, because the server cannot tell a
      // page from an agent that claims to be one; so the page, which the rep
      // is operating directly, uses the web app's own path instead. No status
      // here either: the Prospecting action toggles own that.
      const write = lb.note({
        leadId: lead.id,
        note: lb.field({ value: `${channelSelect.value}: ${noteText}` }),
      })
      write.subscribe(handleWriteState)
      write.run()

      function handleWriteState(action) {
        submit.disabled = action.loading
        submit.setAttribute("data-lb-state", action.loading ? "loading" : action.error ? "error" : action.lastResult ? "success" : "ready")
        message.dataset.tone = action.error ? "error" : action.lastResult ? "ok" : ""
        if (action.loading) message.textContent = t("logging")
        else if (action.error) message.textContent = describeConnectorError(action.error, "write")
        else if (action.lastResult) {
          state.workedToday.set(lead.id, t("logged", { channel: channelSelect.value }))
          noteInput.value = ""
          message.textContent = t("loggedOn", { channel: channelSelect.value, name })
          refreshLeadViews(lead.id)
        }
      }
    }

    return form
  }

  function renderNearbySection(lead) {
    const origin = leadPosition(lead)
    const section = h("div", { class: "section" }, h("h3", { class: "section-title", text: t("nearby") }))
    if (!origin) {
      section.append(h("div", { class: "empty", text: t("noPosition") }))
      return section
    }
    const nearby = state.leadOrder
      .filter((leadId) => leadId !== lead.id)
      .map((leadId) => state.leadsById.get(leadId))
      .map((candidate) => ({ candidate, position: leadPosition(candidate) }))
      .filter((entry) => entry.position)
      .map((entry) => ({ candidate: entry.candidate, kilometres: distanceKm(origin, entry.position) }))
      .sort((first, second) => first.kilometres - second.kilometres)
      .slice(0, 6)

    if (!nearby.length) {
      section.append(h("div", { class: "empty", text: t("noNearby") }))
      return section
    }
    const list = h("div", { class: "rows" })
    for (const entry of nearby) {
      const worked = workedTodayLabel(entry.candidate)
      list.append(
        h(
          "button",
          { class: "row-btn", type: "button", onClick: handleLeadRowClick(entry.candidate.id) },
          h("span", { class: "dot", "data-status": leadStatus(entry.candidate), "data-acted": worked ? "yes" : "no", "aria-hidden": "true" }),
          h("span", { class: "row-main" }, h("span", { class: "row-name", text: entry.candidate.name || t("unnamed") }), h("span", { class: "row-sub", text: leadPlace(entry.candidate) })),
          h("span", { class: "row-meta", text: formatKm(entry.kilometres) }),
        ),
      )
    }
    section.append(list, h("div", { class: "summary", text: t("straightLine") }))
    return section
  }

  // HANDLERS

  function handleLeadRowClick(leadId) {
    return function handleClick() {
      selectLead(leadId, { fly: true })
    }
  }

  function handleStopOpen(leadId) {
    return function handleClick() {
      if (state.leadsById.has(leadId)) {
        selectLead(leadId, { fly: true })
        return
      }
      const stop = state.route.find((routeStop) => routeStop.id === leadId)
      if (stop) map.flyTo(stop.pos, Math.max(map.getZoom(), 11))
    }
  }

  function handleLocate(leadId) {
    return function handleClick() {
      const position = leadPosition(state.leadsById.get(leadId))
      if (position) map.flyTo(position, 14, { duration: prefersReducedMotion() ? 0 : 0.8 })
    }
  }

  function handleRouteToggle(leadId) {
    return function handleClick() {
      const index = routeIndex(leadId)
      if (index >= 0) state.route.splice(index, 1)
      else state.route.push(stopFromLead(state.leadsById.get(leadId)))
      afterRouteChange()
      renderPanel()
    }
  }

  function handleStopMove(index, direction) {
    return function handleClick() {
      const target = index + direction
      if (target < 0 || target >= state.route.length) return
      const [moved] = state.route.splice(index, 1)
      state.route.splice(target, 0, moved)
      afterRouteChange()
      renderPanel()
    }
  }

  function handleStopRemove(leadId) {
    return function handleClick() {
      const index = routeIndex(leadId)
      if (index >= 0) state.route.splice(index, 1)
      afterRouteChange()
      renderPanel()
    }
  }

  // Nearest-next-stop ordering from the first stop: good enough for a day of visits.
  function handleRouteOptimise() {
    const remaining = state.route.slice(1)
    const ordered = [state.route[0]]
    while (remaining.length) {
      const last = ordered[ordered.length - 1]
      let nearestIndex = 0
      for (let index = 1; index < remaining.length; index++) {
        if (distanceKm(last.pos, remaining[index].pos) < distanceKm(last.pos, remaining[nearestIndex].pos)) nearestIndex = index
      }
      ordered.push(remaining.splice(nearestIndex, 1)[0])
    }
    state.route = ordered
    afterRouteChange()
    renderPanel()
  }

  function handleRouteClear() {
    state.route = []
    afterRouteChange()
    renderPanel()
  }

  function afterRouteChange() {
    saveRoute()
    renderMarkers()
  }

  function handleLoadMore() {
    loadFollowups({ reset: false })
  }
})()
