import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { addContact } from "../../../src/tools/add-contact.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_add_contact", () => {
  it("happy path — creates a contact via POST /leads/{id}/contacts", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-1/contacts",
        status: 200,
        body: {
          id: "c-new",
          first_name: "Jane",
          last_name: "Doe",
          email: null,
          phone_number: null,
          linkedin_page: "https://www.linkedin.com/in/janedoe",
          job_title: "VP Eng",
          can_enrich: true,
          recommended: false,
          pinned: false,
        },
      },
    ]);

    const result = await addContact.execute(newClient(), {
      lead_id: "lead-1",
      first_name: "Jane",
      last_name: "Doe",
      job_title: "VP Eng",
      linkedin_page: "https://www.linkedin.com/in/janedoe",
    });

    expect(result.added).toBe(true);
    expect(result.lead_id).toBe("lead-1");
    expect(result.contact.id).toBe("c-new");
    expect(result.contact.linkedin_page).toBe(
      "https://www.linkedin.com/in/janedoe",
    );

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe("POST");
    expect(reqs[0].path).toBe("/1.5/leads/lead-1/contacts");
    // Only provided optional fields are sent (no email/phone here).
    const sent = JSON.parse(reqs[0].body as string);
    expect(sent).toMatchObject({
      first_name: "Jane",
      last_name: "Doe",
      job_title: "VP Eng",
      linkedin_page: "https://www.linkedin.com/in/janedoe",
    });
    expect(sent).not.toHaveProperty("email");
    expect(sent).not.toHaveProperty("phone_number");
  });

  it("minimal input — only name is required", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-2/contacts",
        status: 200,
        body: {
          id: "c-2",
          first_name: "John",
          last_name: "Smith",
          email: null,
          phone_number: null,
          linkedin_page: null,
          job_title: null,
        },
      },
    ]);

    const result = await addContact.execute(newClient(), {
      lead_id: "lead-2",
      first_name: "John",
      last_name: "Smith",
    });

    expect(result.added).toBe(true);
    const reqs = getHttpRequests();
    expect(JSON.parse(reqs[0].body as string)).toEqual({
      first_name: "John",
      last_name: "Smith",
    });
  });

  it("propagates a write error (e.g. 401 on the endpoint)", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/lead-3/contacts",
        status: 401,
        body: { message: "unauthorized" },
      },
    ]);

    await expect(
      addContact.execute(newClient(), {
        lead_id: "lead-3",
        first_name: "A",
        last_name: "B",
      }),
    ).rejects.toThrow();
  });

  it("is registered as a write tool", () => {
    expect(addContact.write).toBe(true);
    expect(addContact.name).toBe("leadbay_add_contact");
  });
});
