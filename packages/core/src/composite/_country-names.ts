/**
 * Country-name data for the single-country-universe guard (product#3951).
 *
 * Each Leadbay backend serves exactly ONE country: the US backend IS the US
 * universe, the FR backend IS France. A country name is therefore never a
 * meaningful location criterion — whole-country intent means OMITTING the
 * location filter. Worse, the backend's admin-area search deliberately
 * excludes country nodes (product#3885), so a country label trigram-falls
 * through to the nearest same-named town ("France" -> the commune of Francs,
 * "United States" -> Statesboro) and silently fences the whole search to one
 * village. See _country-guard.ts for the detector built on this data.
 *
 * Data only — this module imports NOTHING, so it can never take part in an
 * import cycle. Vendored rather than pulled from `i18n-iso-countries` /
 * `world-countries`: those ship hundreds of KB of locale JSON into a package
 * whose only dependency is zod, and packages/mcp bundles into a single
 * dist/bin.js that also ships as a .dxt/.mcpb. The ISO 3166-1 list changes
 * about once a decade.
 */

export interface CountryEntry {
  /** ISO 3166-1 alpha-2, uppercase. Canonical identity. */
  iso2: string;
  /** ISO 3166-1 alpha-3, uppercase. */
  iso3: string;
  /** English short name — used verbatim in the error message. */
  name: string;
  /** French short name — the FR-backend user's spelling. */
  nameFr: string;
  /**
   * Sovereign state's iso2 when this entry is a DEPENDENT TERRITORY.
   * Undefined for sovereign states.
   *
   * This field is load-bearing, not documentation. A raw ISO 3166-1 list
   * contains Guadeloupe, Martinique, Réunion, Mayotte, Guyane, Saint-Martin,
   * Saint-Barthélemy, Nouvelle-Calédonie, Polynésie française, Wallis-et-
   * Futuna and Saint-Pierre-et-Miquelon — every one a LEGITIMATE in-universe
   * French admin area — and Puerto Rico, Guam, the US Virgin Islands,
   * American Samoa and the Northern Mariana Islands on the US side.
   * Rejecting those would be a strictly worse failure than the bug this
   * guard exists to fix, so a territory whose sovereign IS the backend's
   * home country is exempt (and still rejected on the other backend, where
   * it really is out of universe).
   */
  sovereign?: string;
  /**
   * Extra accepted labels, raw spelling. Official long forms, endonyms,
   * colloquials, and "and"-less spellings — `Bosnia & Herzegovina` folds to
   * a DIFFERENT key than `Bosnia and Herzegovina`, so the variant is data,
   * not logic.
   */
  aliases?: string[];
}

/**
 * Fold a location label to a comparison key so spelling variants collapse.
 *
 * Two deliberate differences from the earlier US/FR-only guard on the
 * MCP-first-delivery branch, both of which are bugs there:
 *
 *  1. Apostrophes map to a SPACE, not to nothing. Deleting them ran before
 *     the article strip, so "l'Allemagne" folded to "lallemagne" and the
 *     leading-article branch was dead for every elided French form
 *     (l'Allemagne, l'Espagne, l'Italie, l'Inde, l'Irlande). Harmless with a
 *     US/FR-only value list; silently fatal with a full country list.
 *  2. The combining-diacritical range is written as an escape (̀-ͯ)
 *     rather than with raw combining marks inside the character class, which
 *     are invisible in most editors and are silently destroyed by a
 *     reformat — that would disable accent folding entirely.
 *
 * Matching is on the WHOLE normalized string, never a substring: that is what
 * keeps `Île-de-France` ("ile de france") distinct from France, and it is also
 * the user's override path — a qualified `"China, ME"` ("china me") is a
 * different key from the country and passes straight through.
 */
export function countryKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Dots close up so initialisms fold tight: "U.S" and "U.S.A." -> "us"/"usa".
    .replace(/\./g, "")
    // Apostrophes SEPARATE (see note 1 above): "l'Allemagne" -> "l allemagne".
    .replace(/['’`]/g, " ")
    // Anything else non-alphanumeric is a separator, so "France?", "(France)"
    // and "Bosnia & Herzegovina" all fold predictably.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Longest article first, so "les" is never matched as "le" + leftover.
    .replace(/^(les|the|la|le|l|el|los)\s+/, "")
    .trim();
}

/**
 * ISO 3166-1, alphabetical by alpha-2.
 *
 * Deliberately NOT included:
 *  - England / Scotland / Wales / Northern Ireland — not ISO 3166-1, and they
 *    would be legitimate admin areas if a UK universe ever exists.
 *  - Historical names (USSR, Yugoslavia, Zaire) — no upside, only
 *    false-positive surface.
 */
export const COUNTRIES: readonly CountryEntry[] = [
  { iso2: "AD", iso3: "AND", name: "Andorra", nameFr: "Andorre" },
  { iso2: "AE", iso3: "ARE", name: "United Arab Emirates", nameFr: "Émirats arabes unis", aliases: ["UAE"] },
  { iso2: "AF", iso3: "AFG", name: "Afghanistan", nameFr: "Afghanistan" },
  { iso2: "AG", iso3: "ATG", name: "Antigua and Barbuda", nameFr: "Antigua-et-Barbuda", aliases: ["Antigua & Barbuda", "Antigua"] },
  { iso2: "AI", iso3: "AIA", name: "Anguilla", nameFr: "Anguilla", sovereign: "GB" },
  { iso2: "AL", iso3: "ALB", name: "Albania", nameFr: "Albanie" },
  { iso2: "AM", iso3: "ARM", name: "Armenia", nameFr: "Arménie" },
  { iso2: "AO", iso3: "AGO", name: "Angola", nameFr: "Angola" },
  { iso2: "AQ", iso3: "ATA", name: "Antarctica", nameFr: "Antarctique" },
  { iso2: "AR", iso3: "ARG", name: "Argentina", nameFr: "Argentine" },
  { iso2: "AS", iso3: "ASM", name: "American Samoa", nameFr: "Samoa américaines", sovereign: "US" },
  { iso2: "AT", iso3: "AUT", name: "Austria", nameFr: "Autriche" },
  { iso2: "AU", iso3: "AUS", name: "Australia", nameFr: "Australie" },
  { iso2: "AW", iso3: "ABW", name: "Aruba", nameFr: "Aruba", sovereign: "NL" },
  { iso2: "AX", iso3: "ALA", name: "Åland Islands", nameFr: "Îles Åland", sovereign: "FI" },
  { iso2: "AZ", iso3: "AZE", name: "Azerbaijan", nameFr: "Azerbaïdjan" },
  { iso2: "BA", iso3: "BIH", name: "Bosnia and Herzegovina", nameFr: "Bosnie-Herzégovine", aliases: ["Bosnia & Herzegovina", "Bosnia"] },
  { iso2: "BB", iso3: "BRB", name: "Barbados", nameFr: "Barbade" },
  { iso2: "BD", iso3: "BGD", name: "Bangladesh", nameFr: "Bangladesh" },
  { iso2: "BE", iso3: "BEL", name: "Belgium", nameFr: "Belgique" },
  { iso2: "BF", iso3: "BFA", name: "Burkina Faso", nameFr: "Burkina Faso" },
  { iso2: "BG", iso3: "BGR", name: "Bulgaria", nameFr: "Bulgarie" },
  { iso2: "BH", iso3: "BHR", name: "Bahrain", nameFr: "Bahreïn" },
  { iso2: "BI", iso3: "BDI", name: "Burundi", nameFr: "Burundi" },
  { iso2: "BJ", iso3: "BEN", name: "Benin", nameFr: "Bénin" },
  { iso2: "BL", iso3: "BLM", name: "Saint Barthélemy", nameFr: "Saint-Barthélemy", sovereign: "FR" },
  { iso2: "BM", iso3: "BMU", name: "Bermuda", nameFr: "Bermudes", sovereign: "GB" },
  { iso2: "BN", iso3: "BRN", name: "Brunei Darussalam", nameFr: "Brunéi", aliases: ["Brunei"] },
  { iso2: "BO", iso3: "BOL", name: "Bolivia", nameFr: "Bolivie" },
  { iso2: "BQ", iso3: "BES", name: "Bonaire, Sint Eustatius and Saba", nameFr: "Pays-Bas caribéens", sovereign: "NL" },
  { iso2: "BR", iso3: "BRA", name: "Brazil", nameFr: "Brésil" },
  { iso2: "BS", iso3: "BHS", name: "Bahamas", nameFr: "Bahamas" },
  { iso2: "BT", iso3: "BTN", name: "Bhutan", nameFr: "Bhoutan" },
  { iso2: "BV", iso3: "BVT", name: "Bouvet Island", nameFr: "Île Bouvet", sovereign: "NO" },
  { iso2: "BW", iso3: "BWA", name: "Botswana", nameFr: "Botswana" },
  { iso2: "BY", iso3: "BLR", name: "Belarus", nameFr: "Biélorussie" },
  { iso2: "BZ", iso3: "BLZ", name: "Belize", nameFr: "Belize" },
  { iso2: "CA", iso3: "CAN", name: "Canada", nameFr: "Canada" },
  { iso2: "CC", iso3: "CCK", name: "Cocos (Keeling) Islands", nameFr: "Îles Cocos", sovereign: "AU" },
  { iso2: "CD", iso3: "COD", name: "Democratic Republic of the Congo", nameFr: "République démocratique du Congo", aliases: ["DR Congo", "DRC", "Congo-Kinshasa"] },
  { iso2: "CF", iso3: "CAF", name: "Central African Republic", nameFr: "République centrafricaine" },
  { iso2: "CG", iso3: "COG", name: "Congo", nameFr: "Congo", aliases: ["Republic of the Congo", "Congo-Brazzaville"] },
  { iso2: "CH", iso3: "CHE", name: "Switzerland", nameFr: "Suisse" },
  { iso2: "CI", iso3: "CIV", name: "Côte d'Ivoire", nameFr: "Côte d'Ivoire", aliases: ["Ivory Coast"] },
  { iso2: "CK", iso3: "COK", name: "Cook Islands", nameFr: "Îles Cook", sovereign: "NZ" },
  { iso2: "CL", iso3: "CHL", name: "Chile", nameFr: "Chili" },
  { iso2: "CM", iso3: "CMR", name: "Cameroon", nameFr: "Cameroun" },
  { iso2: "CN", iso3: "CHN", name: "China", nameFr: "Chine" },
  { iso2: "CO", iso3: "COL", name: "Colombia", nameFr: "Colombie" },
  { iso2: "CR", iso3: "CRI", name: "Costa Rica", nameFr: "Costa Rica" },
  { iso2: "CU", iso3: "CUB", name: "Cuba", nameFr: "Cuba" },
  { iso2: "CV", iso3: "CPV", name: "Cabo Verde", nameFr: "Cap-Vert", aliases: ["Cape Verde"] },
  { iso2: "CW", iso3: "CUW", name: "Curaçao", nameFr: "Curaçao", sovereign: "NL" },
  { iso2: "CX", iso3: "CXR", name: "Christmas Island", nameFr: "Île Christmas", sovereign: "AU" },
  { iso2: "CY", iso3: "CYP", name: "Cyprus", nameFr: "Chypre" },
  { iso2: "CZ", iso3: "CZE", name: "Czechia", nameFr: "Tchéquie", aliases: ["Czech Republic"] },
  { iso2: "DE", iso3: "DEU", name: "Germany", nameFr: "Allemagne", aliases: ["Deutschland"] },
  { iso2: "DJ", iso3: "DJI", name: "Djibouti", nameFr: "Djibouti" },
  { iso2: "DK", iso3: "DNK", name: "Denmark", nameFr: "Danemark" },
  { iso2: "DM", iso3: "DMA", name: "Dominica", nameFr: "Dominique" },
  { iso2: "DO", iso3: "DOM", name: "Dominican Republic", nameFr: "République dominicaine" },
  { iso2: "DZ", iso3: "DZA", name: "Algeria", nameFr: "Algérie" },
  { iso2: "EC", iso3: "ECU", name: "Ecuador", nameFr: "Équateur" },
  { iso2: "EE", iso3: "EST", name: "Estonia", nameFr: "Estonie" },
  { iso2: "EG", iso3: "EGY", name: "Egypt", nameFr: "Égypte" },
  { iso2: "EH", iso3: "ESH", name: "Western Sahara", nameFr: "Sahara occidental" },
  { iso2: "ER", iso3: "ERI", name: "Eritrea", nameFr: "Érythrée" },
  { iso2: "ES", iso3: "ESP", name: "Spain", nameFr: "Espagne", aliases: ["España"] },
  { iso2: "ET", iso3: "ETH", name: "Ethiopia", nameFr: "Éthiopie" },
  { iso2: "FI", iso3: "FIN", name: "Finland", nameFr: "Finlande" },
  { iso2: "FJ", iso3: "FJI", name: "Fiji", nameFr: "Fidji" },
  { iso2: "FK", iso3: "FLK", name: "Falkland Islands", nameFr: "Îles Malouines", sovereign: "GB" },
  { iso2: "FM", iso3: "FSM", name: "Micronesia", nameFr: "Micronésie" },
  { iso2: "FO", iso3: "FRO", name: "Faroe Islands", nameFr: "Îles Féroé", sovereign: "DK" },
  { iso2: "FR", iso3: "FRA", name: "France", nameFr: "France", aliases: ["French Republic", "République française"] },
  { iso2: "GA", iso3: "GAB", name: "Gabon", nameFr: "Gabon" },
  { iso2: "GB", iso3: "GBR", name: "United Kingdom", nameFr: "Royaume-Uni", aliases: ["UK", "Great Britain", "Britain", "United Kingdom of Great Britain and Northern Ireland"] },
  { iso2: "GD", iso3: "GRD", name: "Grenada", nameFr: "Grenade" },
  { iso2: "GE", iso3: "GEO", name: "Georgia", nameFr: "Géorgie" },
  { iso2: "GF", iso3: "GUF", name: "French Guiana", nameFr: "Guyane française", sovereign: "FR", aliases: ["Guyane"] },
  { iso2: "GG", iso3: "GGY", name: "Guernsey", nameFr: "Guernesey", sovereign: "GB" },
  { iso2: "GH", iso3: "GHA", name: "Ghana", nameFr: "Ghana" },
  { iso2: "GI", iso3: "GIB", name: "Gibraltar", nameFr: "Gibraltar", sovereign: "GB" },
  { iso2: "GL", iso3: "GRL", name: "Greenland", nameFr: "Groenland", sovereign: "DK" },
  { iso2: "GM", iso3: "GMB", name: "Gambia", nameFr: "Gambie" },
  { iso2: "GN", iso3: "GIN", name: "Guinea", nameFr: "Guinée" },
  { iso2: "GP", iso3: "GLP", name: "Guadeloupe", nameFr: "Guadeloupe", sovereign: "FR" },
  { iso2: "GQ", iso3: "GNQ", name: "Equatorial Guinea", nameFr: "Guinée équatoriale" },
  { iso2: "GR", iso3: "GRC", name: "Greece", nameFr: "Grèce" },
  { iso2: "GS", iso3: "SGS", name: "South Georgia and the South Sandwich Islands", nameFr: "Géorgie du Sud-et-les Îles Sandwich du Sud", sovereign: "GB" },
  { iso2: "GT", iso3: "GTM", name: "Guatemala", nameFr: "Guatemala" },
  { iso2: "GU", iso3: "GUM", name: "Guam", nameFr: "Guam", sovereign: "US" },
  { iso2: "GW", iso3: "GNB", name: "Guinea-Bissau", nameFr: "Guinée-Bissau" },
  { iso2: "GY", iso3: "GUY", name: "Guyana", nameFr: "Guyana" },
  { iso2: "HK", iso3: "HKG", name: "Hong Kong", nameFr: "Hong Kong", sovereign: "CN" },
  { iso2: "HM", iso3: "HMD", name: "Heard Island and McDonald Islands", nameFr: "Îles Heard-et-MacDonald", sovereign: "AU" },
  { iso2: "HN", iso3: "HND", name: "Honduras", nameFr: "Honduras" },
  { iso2: "HR", iso3: "HRV", name: "Croatia", nameFr: "Croatie" },
  { iso2: "HT", iso3: "HTI", name: "Haiti", nameFr: "Haïti" },
  { iso2: "HU", iso3: "HUN", name: "Hungary", nameFr: "Hongrie" },
  { iso2: "ID", iso3: "IDN", name: "Indonesia", nameFr: "Indonésie" },
  { iso2: "IE", iso3: "IRL", name: "Ireland", nameFr: "Irlande" },
  { iso2: "IL", iso3: "ISR", name: "Israel", nameFr: "Israël" },
  { iso2: "IM", iso3: "IMN", name: "Isle of Man", nameFr: "Île de Man", sovereign: "GB" },
  { iso2: "IN", iso3: "IND", name: "India", nameFr: "Inde" },
  { iso2: "IO", iso3: "IOT", name: "British Indian Ocean Territory", nameFr: "Territoire britannique de l'océan Indien", sovereign: "GB" },
  { iso2: "IQ", iso3: "IRQ", name: "Iraq", nameFr: "Irak" },
  { iso2: "IR", iso3: "IRN", name: "Iran", nameFr: "Iran" },
  { iso2: "IS", iso3: "ISL", name: "Iceland", nameFr: "Islande" },
  { iso2: "IT", iso3: "ITA", name: "Italy", nameFr: "Italie" },
  { iso2: "JE", iso3: "JEY", name: "Jersey", nameFr: "Jersey", sovereign: "GB" },
  { iso2: "JM", iso3: "JAM", name: "Jamaica", nameFr: "Jamaïque" },
  { iso2: "JO", iso3: "JOR", name: "Jordan", nameFr: "Jordanie" },
  { iso2: "JP", iso3: "JPN", name: "Japan", nameFr: "Japon" },
  { iso2: "KE", iso3: "KEN", name: "Kenya", nameFr: "Kenya" },
  { iso2: "KG", iso3: "KGZ", name: "Kyrgyzstan", nameFr: "Kirghizistan" },
  { iso2: "KH", iso3: "KHM", name: "Cambodia", nameFr: "Cambodge" },
  { iso2: "KI", iso3: "KIR", name: "Kiribati", nameFr: "Kiribati" },
  { iso2: "KM", iso3: "COM", name: "Comoros", nameFr: "Comores" },
  { iso2: "KN", iso3: "KNA", name: "Saint Kitts and Nevis", nameFr: "Saint-Christophe-et-Niévès" },
  { iso2: "KP", iso3: "PRK", name: "North Korea", nameFr: "Corée du Nord" },
  { iso2: "KR", iso3: "KOR", name: "South Korea", nameFr: "Corée du Sud" },
  { iso2: "KW", iso3: "KWT", name: "Kuwait", nameFr: "Koweït" },
  { iso2: "KY", iso3: "CYM", name: "Cayman Islands", nameFr: "Îles Caïmans", sovereign: "GB" },
  { iso2: "KZ", iso3: "KAZ", name: "Kazakhstan", nameFr: "Kazakhstan" },
  { iso2: "LA", iso3: "LAO", name: "Laos", nameFr: "Laos" },
  { iso2: "LB", iso3: "LBN", name: "Lebanon", nameFr: "Liban" },
  { iso2: "LC", iso3: "LCA", name: "Saint Lucia", nameFr: "Sainte-Lucie" },
  { iso2: "LI", iso3: "LIE", name: "Liechtenstein", nameFr: "Liechtenstein" },
  { iso2: "LK", iso3: "LKA", name: "Sri Lanka", nameFr: "Sri Lanka" },
  { iso2: "LR", iso3: "LBR", name: "Liberia", nameFr: "Liberia" },
  { iso2: "LS", iso3: "LSO", name: "Lesotho", nameFr: "Lesotho" },
  { iso2: "LT", iso3: "LTU", name: "Lithuania", nameFr: "Lituanie" },
  { iso2: "LU", iso3: "LUX", name: "Luxembourg", nameFr: "Luxembourg" },
  { iso2: "LV", iso3: "LVA", name: "Latvia", nameFr: "Lettonie" },
  { iso2: "LY", iso3: "LBY", name: "Libya", nameFr: "Libye" },
  { iso2: "MA", iso3: "MAR", name: "Morocco", nameFr: "Maroc" },
  { iso2: "MC", iso3: "MCO", name: "Monaco", nameFr: "Monaco" },
  { iso2: "MD", iso3: "MDA", name: "Moldova", nameFr: "Moldavie" },
  { iso2: "ME", iso3: "MNE", name: "Montenegro", nameFr: "Monténégro" },
  { iso2: "MF", iso3: "MAF", name: "Saint Martin", nameFr: "Saint-Martin", sovereign: "FR" },
  { iso2: "MG", iso3: "MDG", name: "Madagascar", nameFr: "Madagascar" },
  { iso2: "MH", iso3: "MHL", name: "Marshall Islands", nameFr: "Îles Marshall" },
  { iso2: "MK", iso3: "MKD", name: "North Macedonia", nameFr: "Macédoine du Nord" },
  { iso2: "ML", iso3: "MLI", name: "Mali", nameFr: "Mali" },
  { iso2: "MM", iso3: "MMR", name: "Myanmar", nameFr: "Birmanie", aliases: ["Burma"] },
  { iso2: "MN", iso3: "MNG", name: "Mongolia", nameFr: "Mongolie" },
  { iso2: "MO", iso3: "MAC", name: "Macao", nameFr: "Macao", sovereign: "CN" },
  { iso2: "MP", iso3: "MNP", name: "Northern Mariana Islands", nameFr: "Îles Mariannes du Nord", sovereign: "US" },
  { iso2: "MQ", iso3: "MTQ", name: "Martinique", nameFr: "Martinique", sovereign: "FR" },
  { iso2: "MR", iso3: "MRT", name: "Mauritania", nameFr: "Mauritanie" },
  { iso2: "MS", iso3: "MSR", name: "Montserrat", nameFr: "Montserrat", sovereign: "GB" },
  { iso2: "MT", iso3: "MLT", name: "Malta", nameFr: "Malte" },
  { iso2: "MU", iso3: "MUS", name: "Mauritius", nameFr: "Maurice" },
  { iso2: "MV", iso3: "MDV", name: "Maldives", nameFr: "Maldives" },
  { iso2: "MW", iso3: "MWI", name: "Malawi", nameFr: "Malawi" },
  { iso2: "MX", iso3: "MEX", name: "Mexico", nameFr: "Mexique" },
  { iso2: "MY", iso3: "MYS", name: "Malaysia", nameFr: "Malaisie" },
  { iso2: "MZ", iso3: "MOZ", name: "Mozambique", nameFr: "Mozambique" },
  { iso2: "NA", iso3: "NAM", name: "Namibia", nameFr: "Namibie" },
  { iso2: "NC", iso3: "NCL", name: "New Caledonia", nameFr: "Nouvelle-Calédonie", sovereign: "FR" },
  { iso2: "NE", iso3: "NER", name: "Niger", nameFr: "Niger" },
  { iso2: "NF", iso3: "NFK", name: "Norfolk Island", nameFr: "Île Norfolk", sovereign: "AU" },
  { iso2: "NG", iso3: "NGA", name: "Nigeria", nameFr: "Nigéria" },
  { iso2: "NI", iso3: "NIC", name: "Nicaragua", nameFr: "Nicaragua" },
  { iso2: "NL", iso3: "NLD", name: "Netherlands", nameFr: "Pays-Bas", aliases: ["Holland"] },
  { iso2: "NO", iso3: "NOR", name: "Norway", nameFr: "Norvège" },
  { iso2: "NP", iso3: "NPL", name: "Nepal", nameFr: "Népal" },
  { iso2: "NR", iso3: "NRU", name: "Nauru", nameFr: "Nauru" },
  { iso2: "NU", iso3: "NIU", name: "Niue", nameFr: "Niue", sovereign: "NZ" },
  { iso2: "NZ", iso3: "NZL", name: "New Zealand", nameFr: "Nouvelle-Zélande" },
  { iso2: "OM", iso3: "OMN", name: "Oman", nameFr: "Oman" },
  { iso2: "PA", iso3: "PAN", name: "Panama", nameFr: "Panama" },
  { iso2: "PE", iso3: "PER", name: "Peru", nameFr: "Pérou" },
  { iso2: "PF", iso3: "PYF", name: "French Polynesia", nameFr: "Polynésie française", sovereign: "FR" },
  { iso2: "PG", iso3: "PNG", name: "Papua New Guinea", nameFr: "Papouasie-Nouvelle-Guinée" },
  { iso2: "PH", iso3: "PHL", name: "Philippines", nameFr: "Philippines" },
  { iso2: "PK", iso3: "PAK", name: "Pakistan", nameFr: "Pakistan" },
  { iso2: "PL", iso3: "POL", name: "Poland", nameFr: "Pologne" },
  { iso2: "PM", iso3: "SPM", name: "Saint Pierre and Miquelon", nameFr: "Saint-Pierre-et-Miquelon", sovereign: "FR" },
  { iso2: "PN", iso3: "PCN", name: "Pitcairn", nameFr: "Pitcairn", sovereign: "GB" },
  { iso2: "PR", iso3: "PRI", name: "Puerto Rico", nameFr: "Porto Rico", sovereign: "US" },
  { iso2: "PS", iso3: "PSE", name: "Palestine", nameFr: "Palestine" },
  { iso2: "PT", iso3: "PRT", name: "Portugal", nameFr: "Portugal" },
  { iso2: "PW", iso3: "PLW", name: "Palau", nameFr: "Palaos" },
  { iso2: "PY", iso3: "PRY", name: "Paraguay", nameFr: "Paraguay" },
  { iso2: "QA", iso3: "QAT", name: "Qatar", nameFr: "Qatar" },
  { iso2: "RE", iso3: "REU", name: "Réunion", nameFr: "La Réunion", sovereign: "FR" },
  { iso2: "RO", iso3: "ROU", name: "Romania", nameFr: "Roumanie" },
  { iso2: "RS", iso3: "SRB", name: "Serbia", nameFr: "Serbie" },
  { iso2: "RU", iso3: "RUS", name: "Russia", nameFr: "Russie", aliases: ["Russian Federation"] },
  { iso2: "RW", iso3: "RWA", name: "Rwanda", nameFr: "Rwanda" },
  { iso2: "SA", iso3: "SAU", name: "Saudi Arabia", nameFr: "Arabie saoudite" },
  { iso2: "SB", iso3: "SLB", name: "Solomon Islands", nameFr: "Îles Salomon" },
  { iso2: "SC", iso3: "SYC", name: "Seychelles", nameFr: "Seychelles" },
  { iso2: "SD", iso3: "SDN", name: "Sudan", nameFr: "Soudan" },
  { iso2: "SE", iso3: "SWE", name: "Sweden", nameFr: "Suède" },
  { iso2: "SG", iso3: "SGP", name: "Singapore", nameFr: "Singapour" },
  { iso2: "SH", iso3: "SHN", name: "Saint Helena", nameFr: "Sainte-Hélène", sovereign: "GB" },
  { iso2: "SI", iso3: "SVN", name: "Slovenia", nameFr: "Slovénie" },
  { iso2: "SJ", iso3: "SJM", name: "Svalbard and Jan Mayen", nameFr: "Svalbard et Jan Mayen", sovereign: "NO" },
  { iso2: "SK", iso3: "SVK", name: "Slovakia", nameFr: "Slovaquie" },
  { iso2: "SL", iso3: "SLE", name: "Sierra Leone", nameFr: "Sierra Leone" },
  { iso2: "SM", iso3: "SMR", name: "San Marino", nameFr: "Saint-Marin" },
  { iso2: "SN", iso3: "SEN", name: "Senegal", nameFr: "Sénégal" },
  { iso2: "SO", iso3: "SOM", name: "Somalia", nameFr: "Somalie" },
  { iso2: "SR", iso3: "SUR", name: "Suriname", nameFr: "Suriname" },
  { iso2: "SS", iso3: "SSD", name: "South Sudan", nameFr: "Soudan du Sud" },
  { iso2: "ST", iso3: "STP", name: "Sao Tome and Principe", nameFr: "Sao Tomé-et-Principe" },
  { iso2: "SV", iso3: "SLV", name: "El Salvador", nameFr: "Salvador" },
  { iso2: "SX", iso3: "SXM", name: "Sint Maarten", nameFr: "Saint-Martin (partie néerlandaise)", sovereign: "NL" },
  { iso2: "SY", iso3: "SYR", name: "Syria", nameFr: "Syrie" },
  { iso2: "SZ", iso3: "SWZ", name: "Eswatini", nameFr: "Eswatini", aliases: ["Swaziland"] },
  { iso2: "TC", iso3: "TCA", name: "Turks and Caicos Islands", nameFr: "Îles Turques-et-Caïques", sovereign: "GB" },
  { iso2: "TD", iso3: "TCD", name: "Chad", nameFr: "Tchad" },
  { iso2: "TF", iso3: "ATF", name: "French Southern Territories", nameFr: "Terres australes et antarctiques françaises", sovereign: "FR" },
  { iso2: "TG", iso3: "TGO", name: "Togo", nameFr: "Togo" },
  { iso2: "TH", iso3: "THA", name: "Thailand", nameFr: "Thaïlande" },
  { iso2: "TJ", iso3: "TJK", name: "Tajikistan", nameFr: "Tadjikistan" },
  { iso2: "TK", iso3: "TKL", name: "Tokelau", nameFr: "Tokelau", sovereign: "NZ" },
  { iso2: "TL", iso3: "TLS", name: "Timor-Leste", nameFr: "Timor oriental", aliases: ["East Timor"] },
  { iso2: "TM", iso3: "TKM", name: "Turkmenistan", nameFr: "Turkménistan" },
  { iso2: "TN", iso3: "TUN", name: "Tunisia", nameFr: "Tunisie" },
  { iso2: "TO", iso3: "TON", name: "Tonga", nameFr: "Tonga" },
  { iso2: "TR", iso3: "TUR", name: "Türkiye", nameFr: "Turquie", aliases: ["Turkey"] },
  { iso2: "TT", iso3: "TTO", name: "Trinidad and Tobago", nameFr: "Trinité-et-Tobago", aliases: ["Trinidad & Tobago"] },
  { iso2: "TV", iso3: "TUV", name: "Tuvalu", nameFr: "Tuvalu" },
  { iso2: "TW", iso3: "TWN", name: "Taiwan", nameFr: "Taïwan" },
  { iso2: "TZ", iso3: "TZA", name: "Tanzania", nameFr: "Tanzanie" },
  { iso2: "UA", iso3: "UKR", name: "Ukraine", nameFr: "Ukraine" },
  { iso2: "UG", iso3: "UGA", name: "Uganda", nameFr: "Ouganda" },
  { iso2: "UM", iso3: "UMI", name: "United States Minor Outlying Islands", nameFr: "Îles mineures éloignées des États-Unis", sovereign: "US" },
  {
    iso2: "US",
    iso3: "USA",
    name: "United States",
    nameFr: "États-Unis",
    aliases: [
      "United States of America",
      "America",
      "U.S.A.",
      "États-Unis d'Amérique",
      "Etats-Unis",
    ],
  },
  { iso2: "UY", iso3: "URY", name: "Uruguay", nameFr: "Uruguay" },
  { iso2: "UZ", iso3: "UZB", name: "Uzbekistan", nameFr: "Ouzbékistan" },
  { iso2: "VA", iso3: "VAT", name: "Holy See", nameFr: "Saint-Siège", aliases: ["Vatican", "Vatican City"] },
  { iso2: "VC", iso3: "VCT", name: "Saint Vincent and the Grenadines", nameFr: "Saint-Vincent-et-les-Grenadines" },
  { iso2: "VE", iso3: "VEN", name: "Venezuela", nameFr: "Venezuela" },
  { iso2: "VG", iso3: "VGB", name: "British Virgin Islands", nameFr: "Îles Vierges britanniques", sovereign: "GB" },
  { iso2: "VI", iso3: "VIR", name: "United States Virgin Islands", nameFr: "Îles Vierges des États-Unis", sovereign: "US", aliases: ["US Virgin Islands"] },
  { iso2: "VN", iso3: "VNM", name: "Vietnam", nameFr: "Viêt Nam", aliases: ["Viet Nam"] },
  { iso2: "VU", iso3: "VUT", name: "Vanuatu", nameFr: "Vanuatu" },
  { iso2: "WF", iso3: "WLF", name: "Wallis and Futuna", nameFr: "Wallis-et-Futuna", sovereign: "FR" },
  { iso2: "WS", iso3: "WSM", name: "Samoa", nameFr: "Samoa" },
  { iso2: "YE", iso3: "YEM", name: "Yemen", nameFr: "Yémen" },
  { iso2: "YT", iso3: "MYT", name: "Mayotte", nameFr: "Mayotte", sovereign: "FR" },
  { iso2: "ZA", iso3: "ZAF", name: "South Africa", nameFr: "Afrique du Sud" },
  { iso2: "ZM", iso3: "ZMB", name: "Zambia", nameFr: "Zambie" },
  { iso2: "ZW", iso3: "ZWE", name: "Zimbabwe", nameFr: "Zimbabwe" },
];

/**
 * "The whole of my own country" phrasings.
 *
 * These are NOT supra-national: on a single-country workspace "nationwide" or
 * "partout en France" means exactly the home country, so the recovery is the
 * same as naming the home country outright — omit the geo argument and say the
 * result covers everything. Keeping them in the supra-national bucket produced
 * the wrong advice (report the scope instead of just answering).
 */
export const WHOLE_WORKSPACE_LABELS: readonly string[] = [
  "Nationwide",
  "Nation-wide",
  "Countrywide",
  "Whole country",
  "Entire country",
  "The whole country",
  "Everywhere",
  "Anywhere",
  "All regions",
  "Tout le pays",
  "Toute la France",
  "Partout",
  "Partout en France",
  "Échelle nationale",
  "National",
  "Nationale",
];

/**
 * Genuinely MULTI-country scopes. Not admin areas, and — unlike the labels
 * above — not satisfiable by this workspace either: a request for "EMEA" or
 * "APAC" is not answered by handing back one country's leads. The recovery is
 * to name what the workspace covers, never to silently re-run unfiltered.
 */
export const SUPRANATIONAL_LABELS: readonly string[] = [
  "EU",
  "European Union",
  "Europe",
  "EMEA",
  "DACH",
  "Benelux",
  "Scandinavia",
  "Nordics",
  "North America",
  "South America",
  "Latin America",
  "LATAM",
  "APAC",
  "Asia",
  "Africa",
  "Middle East",
  "Worldwide",
  "Global",
  "Globally",
  "International",
  "All countries",
  "Monde",
  "Monde entier",
  "Le monde entier",
];

/** Which country each backend region IS. `custom` has no home country. */
export const HOME_COUNTRY_BY_REGION: Readonly<Record<"us" | "fr", string>> = {
  us: "US",
  fr: "FR",
};

/**
 * Bare labels that ARE a legitimate in-universe admin area on that region and
 * must therefore survive the guard. Keys are countryKey()-normalized.
 *
 * Kept deliberately minimal — every entry here is a country a user can no
 * longer be warned about, so it earns its place by being the overwhelmingly
 * more likely reading of the bare word on that backend.
 */
export const REGION_EXEMPT_KEYS: Readonly<Record<"us" | "fr", ReadonlySet<string>>> = {
  // "Georgia": a US rep prospecting the STATE writes exactly this, and would
  // never write "Georgia, US". "Jersey": colloquial New Jersey.
  us: new Set(["georgia", "jersey"]),
  // Empty by design: no French région or département shares a bare country
  // name. Every FR homonym is a dependent territory (Guadeloupe, Martinique,
  // La Réunion, Mayotte, Guyane…), which the `sovereign` rule already exempts.
  fr: new Set<string>(),
};

/**
 * US state + DC postal codes. These collide with ~25 ISO alpha-2 country
 * codes (CA Canada/California, IN India/Indiana, LA Laos/Louisiana — and
 * _geo-helpers.ts already expands `la` to Los Angeles — plus ID, MO, MD, ME,
 * AL, AR, MS, MT, NE, PA, SC, VA, DE, IE/…), and a two-letter code is the
 * single most common way a US rep names a state. So on a US universe an
 * alpha-2 that is also a state code is never treated as a foreign country.
 *
 * The HOME country's own alpha-2 still rejects: neither "US" nor "FR" is a
 * state postal code, and French département codes are numeric.
 */
export const US_STATE_POSTAL_CODES: ReadonlySet<string> = new Set([
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "dc", "fl", "ga", "hi",
  "id", "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn",
  "ms", "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh",
  "ok", "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa",
  "wv", "wi", "wy",
]);

function buildKeyIndex(): {
  byKey: Map<string, CountryEntry>;
  collisions: string[];
} {
  const byKey = new Map<string, CountryEntry>();
  const collisions: string[] = [];
  for (const entry of COUNTRIES) {
    const labels = [
      entry.name,
      entry.nameFr,
      entry.iso2,
      entry.iso3,
      ...(entry.aliases ?? []),
    ];
    for (const label of labels) {
      const key = countryKey(label);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing && existing.iso2 !== entry.iso2) {
        collisions.push(`${key}: ${existing.iso2} vs ${entry.iso2}`);
        continue; // first writer wins; the collision is surfaced for the audit
      }
      byKey.set(key, entry);
    }
  }
  return { byKey, collisions };
}

const KEY_INDEX = buildKeyIndex();

/** Normalized label -> country. Built from name, nameFr, iso2, iso3, aliases. */
export const COUNTRY_BY_KEY: ReadonlyMap<string, CountryEntry> = KEY_INDEX.byKey;

/**
 * Any two distinct countries that fold to the SAME key. Must stay empty — a
 * collision means one country silently shadows another. Asserted by
 * test/unit/composite/country-guard-helpers.test.ts rather than thrown at
 * import time, so a data slip fails a test instead of breaking the server.
 */
export const COUNTRY_KEY_COLLISIONS: readonly string[] = KEY_INDEX.collisions;

export const SUPRANATIONAL_KEYS: ReadonlySet<string> = new Set(
  SUPRANATIONAL_LABELS.map((label) => countryKey(label)).filter(Boolean)
);

/**
 * Generic "the whole of somewhere" wrappers, applied to an already-normalized
 * key. Stripping these is what lets a NAMED country inside a scope phrase be
 * classified by that country rather than by the generic phrase:
 *
 *   "all of France"            -> "france"        -> classified as France
 *   "across the United States" -> "united states" -> classified as the US
 *   "partout en France"        -> "france"        -> France, even on a US
 *                                                    workspace (where it is
 *                                                    FOREIGN, not "everything
 *                                                    here")
 *
 * A phrase that leaves no country behind ("nationwide", "partout",
 * "everywhere") falls through to WHOLE_WORKSPACE_KEYS and means this workspace.
 *
 * Kept deliberately narrow, and only ever applied when the remainder is a
 * recognized country: "Whole Foods" -> "foods" and "across the Bay" -> "bay"
 * match nothing, so ordinary place names are untouched.
 */
export const SCOPE_WRAPPERS: readonly RegExp[] = [
  // ORDER MATTERS: the stripper takes the FIRST wrapper that matches, so every
  // longer form must precede the shorter one it contains. "the whole of France"
  // hit the bare /^whole\s+/ first and was left as "of france", which matches no
  // country — so the guard returned no hit and the caller went on to /geo/search
  // and the same-named-town fence this module exists to prevent. There is no
  // generic "of " strip: it belongs to this phrase, not to place names.
  /^whole\s+of\s+/,
  /^whole\s+/,
  /^all\s+of\s+/,
  /^all\s+/,
  /^across\s+/,
  /^entire\s+/,
  /^anywhere\s+in\s+/,
  /^everywhere\s+in\s+/,
  /^nationwide\s+in\s+/,
  /^throughout\s+/,
  /^partout\s+en\s+/,
  /^partout\s+dans\s+/,
  /^toute\s+la\s+/,
  /^tout\s+le\s+/,
  /^toute\s+l\s+/,
  /^dans\s+toute\s+la\s+/,
  /^dans\s+tout\s+le\s+/,
  /\s+wide$/,
  /\s+entier$/,
  /\s+entiere$/,
];

/** Leading articles, re-stripped after a wrapper is removed ("across the US"). */
const LEADING_ARTICLE = /^(les|the|la|le|l|el|los|du|de|d)\s+/;

/**
 * Peel generic scope wrappers off a normalized key and return the embedded
 * country key, or undefined when nothing recognizable is left.
 */
function embeddedKey(
  key: string,
  known: { has(candidate: string): boolean }
): string | undefined {
  let current = key;
  // Bounded loop: each pass must shorten the string, so it cannot spin.
  for (let pass = 0; pass < 4; pass += 1) {
    if (known.has(current)) return current;
    let next = current;
    for (const wrapper of SCOPE_WRAPPERS) {
      const stripped = next.replace(wrapper, "").trim();
      if (stripped !== next && stripped.length > 0) {
        next = stripped;
        break;
      }
    }
    next = next.replace(LEADING_ARTICLE, "").trim();
    if (next === current || next.length === 0) return undefined;
    current = next;
  }
  return known.has(current) ? current : undefined;
}

export function embeddedCountryKey(key: string): string | undefined {
  return embeddedKey(key, COUNTRY_BY_KEY);
}

/**
 * The same wrapper strip, against the supra-national labels.
 *
 * "EU-wide", "all of Europe" and "across EMEA" are the phrasings a rep types,
 * and an exact-key check saw none of them: the wrappers were only ever applied
 * while looking for a COUNTRY, so these fell through to /geo/search and the
 * same-named-town fence — the one outcome this module exists to prevent. Only
 * consulted after `embeddedCountryKey` comes up empty, so a named country
 * inside a scope phrase still decides the verdict ("all of France" is France,
 * not a region).
 */
export function embeddedSupranationalKey(key: string): string | undefined {
  return embeddedKey(key, SUPRANATIONAL_KEYS);
}

export const WHOLE_WORKSPACE_KEYS: ReadonlySet<string> = new Set(
  WHOLE_WORKSPACE_LABELS.map((label) => countryKey(label)).filter(Boolean)
);
