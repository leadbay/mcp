// Library entry: callers (tests, eval framework) import the parser, schemas,
// and assembler so they can read frontmatter rubrics and failure_modes at runtime
// without re-implementing parsing.

export {
  FrontmatterSchema,
  PromptArgumentSchema,
  AnnotationsSchema,
  parseTemplate,
  FrontmatterError,
} from "./frontmatter.js";
export type { Frontmatter, PromptArgument, ParsedTemplate } from "./frontmatter.js";

export { resolveSnippets, listSnippetsReferenced, SnippetError } from "./snippets.js";
export { assemble, AssemblyError } from "./assembler.js";
export type { AssembledArtifact, AssembleResult, AssembleOptions } from "./assembler.js";

export { emit, writeIfDifferent, diff } from "./emit.js";
export type { EmitOptions, EmitOutput } from "./emit.js";

export { buildSkillMarkdown, buildSkillFiles } from "./skills.js";
export type { SkillFile } from "./skills.js";

export { discoverRegisteredTools } from "./registry.js";
