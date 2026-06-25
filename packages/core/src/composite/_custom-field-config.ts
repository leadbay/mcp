import type { CustomCrmFieldConfig, CustomCrmFieldKind } from "../types.js";

// The backend's per-type config models are STRICT: PriceFieldConfig is exactly
// `{currency: String}`, Date/DateTimeFieldConfig is `{format: String?}`,
// ExternalIdFieldConfig is `{urlTemplate}`, and TEXT/NUMBER accept NO config.
// Any extra key (e.g. a stale `format` left over from a previous type, or our
// over-broad CustomCrmFieldConfig carrying both `url_template` and `urlTemplate`)
// makes the backend deserializer throw a 500 / "JSON deserialization error".
//
// sanitizeConfigForType narrows an arbitrary config object down to ONLY the
// key(s) the target type accepts, so create/update never send a shape the
// backend rejects. Returns null when the type takes no config (TEXT, NUMBER,
// or unknown), which the caller omits from the request body.
export function sanitizeConfigForType(
  type: CustomCrmFieldKind,
  rawConfig: CustomCrmFieldConfig | string | null | undefined
): CustomCrmFieldConfig | null {
  if (!rawConfig) return null;
  // LLMs frequently pass nested JSON as a STRING (e.g. config:'{"currency":"EUR"}')
  // rather than an object. Parse it so the per-type narrowing below still works —
  // otherwise PRICE/EXTERNAL_ID lose their required key and the backend 400s with
  // "PRICE requires a currency config". Observed live.
  let config: CustomCrmFieldConfig;
  if (typeof rawConfig === "string") {
    try {
      const parsed = JSON.parse(rawConfig);
      if (!parsed || typeof parsed !== "object") return null;
      config = parsed as CustomCrmFieldConfig;
    } catch {
      return null; // unparseable string — no usable config
    }
  } else {
    config = rawConfig;
  }
  switch (type) {
    case "PRICE":
      // PriceFieldConfig(val currency: String) — currency only.
      return config.currency != null ? { currency: config.currency } : null;
    case "DATE":
    case "DATETIME":
      // Date/DateTimeFieldConfig(val format: String?) — format only (nullable).
      return "format" in config ? { format: config.format ?? null } : null;
    case "EXTERNAL_ID": {
      // ExternalIdFieldConfig — the backend wire key is url_template. We accept
      // either casing from callers and normalize to the snake_case wire form.
      const url = config.url_template ?? config.urlTemplate;
      return url != null ? { url_template: url } : null;
    }
    default:
      // TEXT, NUMBER, or any unknown kind — no config accepted.
      return null;
  }
}
