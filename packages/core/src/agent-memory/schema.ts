import { z } from "zod";

export const AgentMemorySourceSchema = z.enum([
  "observed",
  "user_stated",
  "inferred",
  "cross_model",
]);

export const AgentMemoryScopeSchema = z.enum(["user", "org"]);

export const AgentMemoryEntrySchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1).max(120),
  type: z.string().min(1).max(80),
  insight: z.string().min(1).max(500),
  normalized_insight: z.string().min(1).max(500),
  confidence: z.number().int().min(1).max(10),
  source: AgentMemorySourceSchema,
  scope: AgentMemoryScopeSchema.default("user"),
  ts: z.string().min(1),
  validations: z.number().int().min(0).default(0),
  contradictions: z.number().int().min(0).default(0),
  tool_context: z.string().max(160).optional(),
});

export const AgentMemoryTombstoneSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1).max(120),
  type: z.string().min(1).max(80),
  normalized_insight: z.string().min(1).max(500).optional(),
  reason: z.string().max(500).optional(),
  scope: AgentMemoryScopeSchema.default("user"),
  ts: z.string().min(1),
});

export const AgentMemoryCaptureInputSchema = z.object({
  key: z.string().min(1).max(120),
  type: z.string().min(1).max(80),
  insight: z.string().min(1).max(500),
  confidence: z.number().int().min(1).max(10),
  source: AgentMemorySourceSchema,
  scope: AgentMemoryScopeSchema.default("user"),
  tool_context: z.string().max(160).optional(),
});

export type AgentMemorySource = z.infer<typeof AgentMemorySourceSchema>;
export type AgentMemoryScope = z.infer<typeof AgentMemoryScopeSchema>;
export type AgentMemoryEntry = z.infer<typeof AgentMemoryEntrySchema>;
export type AgentMemoryTombstone = z.infer<typeof AgentMemoryTombstoneSchema>;
export type AgentMemoryCaptureInput = z.infer<typeof AgentMemoryCaptureInputSchema>;
