/**
 * product#4046 — `POST /contacts/{id}/update` REPLACES the contact. Any field
 * absent from the body is erased, and the call still returns `updated: true`.
 *
 * Reproduced on production 2026-09-01: sending a contact's own current
 * `first_name` + `last_name` + `job_title`, changing nothing, deleted that
 * contact's email and the lead stopped being contactable.
 *
 * The fix is instructional — the agent must send every field — so these guard
 * the instruction. Without them the warning is one careless edit away from
 * being trimmed as verbose, and the tool goes back to deleting data silently.
 */

import { describe, it, expect } from "vitest";
import { updateContact } from "../../../src/tools/update-contact.js";

const OPTIONAL_FIELDS = ["job_title", "email", "phone_number", "linkedin_page"] as const;

describe("product#4046 — update_contact warns that an omitted field is deleted", () => {
  it("the description tells the agent to send every field, not just the changed one", () => {
    const d = updateContact.description;
    // The mechanism, so the agent knows this is not a patch endpoint.
    expect(d.toLowerCase()).toContain("replaces");
    // The consequence, in the word that matters.
    expect(d).toMatch(/absent from your call is erased|a field you leave out is DELETED/i);
    // The instruction itself.
    expect(d).toMatch(/send \*\*all\*\*|PASS EVERY FIELD/i);
  });

  it("every optional field's own description says omitting it deletes it", () => {
    const props = (updateContact.inputSchema as any).properties;
    for (const field of OPTIONAL_FIELDS) {
      expect(props[field], `${field} missing from schema`).toBeDefined();
      expect(
        props[field].description,
        `${field} does not warn that omitting deletes`
      ).toMatch(/omitting this field DELETES it/i);
    }
  });

  it("null still means clear, so a deliberate removal is still expressible", () => {
    const props = (updateContact.inputSchema as any).properties;
    for (const field of OPTIONAL_FIELDS) {
      // Both the type and the prose must keep null available — the warning
      // must not be read as "never pass null".
      expect(props[field].type).toContain("null");
      expect(props[field].description).toMatch(/pass null only to deliberately clear it/i);
    }
  });

  it("first_name and last_name stay required — they are the one loud failure", () => {
    const required = (updateContact.inputSchema as any).required;
    expect(required).toContain("first_name");
    expect(required).toContain("last_name");
  });
});
