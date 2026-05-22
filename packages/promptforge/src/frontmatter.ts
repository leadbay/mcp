import matter from "gray-matter";
import { z } from "zod";

export const PromptArgumentSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  required: z.boolean().default(false),
});

export const AnnotationsSchema = z.object({
  readOnlyHint: z.boolean().optional(),
  destructiveHint: z.boolean().optional(),
  idempotentHint: z.boolean().optional(),
  openWorldHint: z.boolean().optional(),
});

// Routing rules let templates declare WHEN this tool should be invoked
// vs when the agent should pivot to a different tool. Promptforge
// auto-emits a `## WHEN TO USE` block at the head of the description
// from these fields — guaranteed to land within the first ~600 chars
// (the chunk every host loads even when truncating). See /CLAUDE.md
// "Tool-description structure".
export const RoutingAntiTriggerSchema = z.object({
  phrase: z.string().min(2),
  route_to: z.string().regex(/^leadbay_[a-z0-9_]+$/, {
    message: "route_to must be a leadbay_* tool name",
  }),
});

// Full-sentence examples — community best practice (Anthropic
// skill-author guide, mgechev/skills-best-practices, writing-tools-for-
// agents) converges on "give 2-3 positive AND 2-3 negative full-sentence
// user prompts." Positives are realistic phrasings that SHOULD invoke
// the tool; negatives are phrasings that *sound similar* but should
// route elsewhere. Negatives are the load-bearing half — they prevent
// false positives.
export const RoutingExamplesSchema = z.object({
  positive: z.array(z.string().min(8)).optional(),
  negative: z.array(z.string().min(8)).optional(),
});

export const RoutingSchema = z.object({
  // User phrasings that should invoke this tool. Be exhaustive — list
  // the natural phrases users actually employ.
  triggers: z.array(z.string().min(2)).min(1).optional(),
  // Phrasings that route ELSEWHERE. Each names the alternative tool
  // so the agent picks correctly. Equally important as triggers —
  // without anti-triggers the routing only adds, never narrows.
  anti_triggers: z.array(RoutingAntiTriggerSchema).optional(),
  // One-sentence note about preferences ("Prefer when X / pass Y").
  prefer_when: z.string().max(240).optional(),
  // Concrete realistic example user messages — positives should invoke
  // this tool, negatives sound similar but should NOT. Each at least
  // 8 chars (forces real sentences, not labels).
  examples: RoutingExamplesSchema.optional(),
});

export const FrontmatterSchema = z.object({
  name: z.string().regex(/^leadbay_[a-z0-9_]+$/, {
    message: "name must match /^leadbay_[a-z0-9_]+$/",
  }),
  kind: z.enum(["prompt", "tool-description"]),
  short_description: z.string().min(20).max(500),
  arguments: z.array(PromptArgumentSchema).optional(),
  expected_calls: z.array(z.string()).optional(),
  failure_modes: z.array(z.string()).optional(),
  mission_match_rubric: z.string().optional(),
  annotations: AnnotationsSchema.optional(),
  // Structured routing rules — promptforge auto-emits a `## WHEN TO
  // USE` block at the head of the description from this data.
  routing: RoutingSchema.optional(),
  // Agent-memory routing/prompt protocol. Defaults to "enabled" for tools
  // with routing, "disabled" otherwise; explicit disabled is for tools whose
  // first-600-char window cannot carry the shared pointer.
  memory_protocol: z.enum(["enabled", "disabled"]).optional(),
  // Compact rendering recipe (1–3 sentences). Promptforge auto-emits
  // a `## RENDER (quick)` block. The detailed RENDERING block stays
  // in the body via {{include:rendering/...}}.
  rendering_hint: z.string().max(500).optional(),
  // Snippet stem under `snippets/next-steps/` — when set, the body
  // SHOULD also `{{include:next-steps/<stem>}}` so the detailed table
  // appears. The frontmatter field exists for audit cross-checks
  // (every tool that emits NEXT STEPS in body declares it here, and
  // vice versa).
  next_steps: z
    .string()
    .regex(/^[a-z0-9-]+$/, { message: "next_steps must be a snippet stem (a-z0-9-)" })
    .optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
export type PromptArgument = z.infer<typeof PromptArgumentSchema>;
export type Routing = z.infer<typeof RoutingSchema>;

export interface ParsedTemplate {
  frontmatter: Frontmatter;
  body: string;
  sourcePath: string;
}

export class FrontmatterError extends Error {
  constructor(message: string, public readonly sourcePath: string) {
    super(`${sourcePath}: ${message}`);
    this.name = "FrontmatterError";
  }
}

export function parseTemplate(source: string, sourcePath: string): ParsedTemplate {
  const parsed = matter(source);
  const result = FrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new FrontmatterError(`invalid frontmatter:\n${issues}`, sourcePath);
  }
  return { frontmatter: result.data, body: parsed.content, sourcePath };
}
