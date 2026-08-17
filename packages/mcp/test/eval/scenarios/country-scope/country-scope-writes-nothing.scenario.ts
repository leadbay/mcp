// Eval scenario — UNDER-DELIVER guard for the single-country rule
// (product#3951), the twin of us-wide-followups-omits-geo.
//
// Here the user explicitly asks for a country-wide LENS scope. The right answer
// writes nothing: the workspace is already country-scoped, so there is no
// territory to set. The two ways to get this wrong are opposite, and this
// scenario pins both:
//
//   over-deliver → create or edit a lens to express "the whole US", which
//     persists a location_ids criterion fenced to a same-named commune and
//     poisons every later pull from that lens;
//   under-deliver → stall on a clarifying question, or refuse, instead of
//     explaining the scope and naming the axes that actually narrow.
//
// `forbidden_calls` does the first half MECHANICALLY (no judge needed), which
// also means this scenario cannot mutate the real test tenant — the live runner
// ignores backendFixtures and uses a real token. The judge guards the second
// half, where the failure is a tone/completeness one rather than a call.

export const SCENARIO = {
  name: "country-scope-writes-nothing",
  // The audience-editing prompt: this is where a "scope my lens" ask lands.
  prompt: "leadbay_refine_audience",
  tier: "gate",
  args: {},
  backendFixtures: [],
  mission: {
    user_intent: "Scope my lens to the whole US — I sell nationwide.",
    success_criteria: [
      "explained that the workspace already serves exactly ONE country, so a country-wide scope is not a filter it can or should set",
      "did NOT pass a country value to locations, location_ids, city, or a set_filter location_ids criterion on any call",
      "did NOT create a lens or edit the audience merely to express a country-wide scope",
      "offered the axes that actually narrow an audience — sector, company size, or a sub-country region (state / county / city) — instead of leaving the user with only a question",
      "did NOT claim to have applied, saved or changed a territory",
    ],
    required_calls: [],
    required_byproducts: [],
    // Mechanically enforced: nothing may be written to express a country scope.
    forbidden_calls: [
      "leadbay_new_lens",
      "leadbay_adjust_audience",
      "leadbay_update_lens_filter",
      // PHASE 0 of leadbay_refine_audience terminates for a country-only ask:
      // rewriting the audience prompt would overwrite the user's qualitative
      // refinement and kick off an intelligence recompute to express a scope the
      // workspace already has.
      "leadbay_refine_prompt",
      "leadbay_report_outreach",
    ],
  },
};
