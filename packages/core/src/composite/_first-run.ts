import type { UserMePayload } from "../types.js";

// Is this user taking their first steps in Leadbay? A GUESS, from what
// /users/me already carries — the backend has no "onboarded" flag and no
// account creation date to read. Either signal is enough:
//
//   - the user has never opened a lens (`last_requested_lens` is null): no
//     batch of leads has ever been pulled for them, in the web app or here;
//   - the org's signup wizard is not finished (`onboarding_step` is set and
//     is not "FINISHED"): its CRM import is still being processed.
//
// It turns itself off: the first lead pull sets the lens. When the backend
// grows a real flag, read it here and nothing else changes.
export function isFirstRun(me: UserMePayload): boolean {
  if (me.last_requested_lens == null || me.last_requested_lens === "") return true;
  const step = me.organization?.onboarding_step;
  return typeof step === "string" && step !== "" && step !== "FINISHED";
}
