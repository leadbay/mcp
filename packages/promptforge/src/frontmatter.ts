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
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
export type PromptArgument = z.infer<typeof PromptArgumentSchema>;

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
