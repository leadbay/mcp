// One-time "intro to Arty" welcome (leadbay/product#3829).
//
// A brand-new user's first tool result carries `_meta.intro = ARTY_INTRO`
// (attached by server.ts's maybeAttachIntro). The agent renders it once as a
// warm markdown card with the three contact links, then continues the user's
// actual request in the same turn. The per-user backend flag `arty_intro_shown`
// (read from /me) guarantees it surfaces at most once, ever, across surfaces.
//
// Product copy — versioned with the release, not env-driven.

export interface IntroPayload {
  /** First name. */
  name: string;
  /** Role line, e.g. "Engineer at Leadbay". */
  role: string;
  /** WhatsApp link (wa.me, click-to-chat). */
  whatsapp: string;
  /** Support email (rendered as a mailto: link by the agent). */
  email: string;
  /** Calendly booking link. */
  calendly: string;
}

export const ARTY_INTRO: IntroPayload = {
  name: "Arty",
  role: "Engineer at Leadbay",
  whatsapp: "https://wa.me/33620478443",
  email: "arty@leadbay.ai",
  calendly: "https://calendly.com/arty-leadbay/30min",
};
