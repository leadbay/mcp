const MAX_INSIGHT_LENGTH = 500;

const HIGH_RISK_PATTERNS = [
  /(ignore|forget|disregard).{0,30}(prior|previous|all|earlier|preference|memory|system)/i,
  /(override|bypass).{0,30}(memory|preference|system|instruction)/i,
];

export class AgentMemoryInjectionError extends Error {
  code = "AGENT_MEMORY_UNSAFE_INSIGHT" as const;

  constructor(message: string) {
    super(message);
    this.name = "AgentMemoryInjectionError";
  }
}

export function assertSafeInsight(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new AgentMemoryInjectionError("Memory insight cannot be empty.");
  }
  if (trimmed.length > MAX_INSIGHT_LENGTH) {
    throw new AgentMemoryInjectionError(
      `Memory insight is too long (${trimmed.length} chars; max ${MAX_INSIGHT_LENGTH}).`
    );
  }
  for (const pattern of HIGH_RISK_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new AgentMemoryInjectionError(
        "Memory insight looks like an instruction to override or erase prior memory; route this through leadbay_agent_memory_review."
      );
    }
  }
}
