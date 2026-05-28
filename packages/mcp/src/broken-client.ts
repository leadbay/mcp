import { LeadbayClient, type LeadbayError } from "@leadbay/core";

export type AuthState = "ok" | "missing" | "expired" | "probe_failed";

export interface ResolvedClient {
  client: LeadbayClient;
  authState: AuthState;
}

// LeadbayClient subclass whose every request method rejects with a pre-baked
// LeadbayError. This lets MCP entrypoints finish initialization and surface auth
// failures on the first tool call instead of disconnecting the host.
class BrokenLeadbayClient extends LeadbayClient {
  private readonly stubError: LeadbayError;

  constructor(stubError: LeadbayError, baseUrl: string, region: "us" | "fr") {
    super(baseUrl, "broken-token-startup-auth-failure", region);
    this.stubError = stubError;
  }

  override async request<T>(): Promise<T> {
    throw this.stubError;
  }

  override async requestVoid(): Promise<void> {
    throw this.stubError;
  }

  override async requestRawBinary<T>(): Promise<T> {
    throw this.stubError;
  }
}

export function makeBrokenClient(stubError: LeadbayError, region: "us" | "fr"): LeadbayClient {
  const baseUrl =
    region === "fr" ? "https://api-fr.leadbay.app" : "https://api-us.leadbay.app";
  return new BrokenLeadbayClient(stubError, baseUrl, region);
}
