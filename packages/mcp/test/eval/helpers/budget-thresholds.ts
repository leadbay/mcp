/**
 * Named budget thresholds and assertion floors for the eval suite.
 *
 * Per eng-review §helpers/budget-thresholds.ts decision: no hard ceilings,
 * but the >2× regression rule still applies. The "soft caps" below are
 * informational — they're recorded in `EvalEntry` for budget-regression
 * comparison but don't fail tests directly. The mission-match floor IS
 * an assertion floor: tests fail below it.
 */

// Mission-match floor: gate-tier tests fail below this.
export const MISSION_MATCH_FLOOR = 4;
export const INSTRUCTION_ADHERENCE_FLOOR = 4;
export const NO_FABRICATION_FLOOR = 5; // fabrication is unforgivable
export const TOOL_SELECTION_FIT_FLOOR = 4;

// Soft caps for budget-regression context (no test failure on exceed).
export const SOFT_TURN_BUDGET = 25;
export const SOFT_TOOL_CALL_BUDGET = 15;
export const SOFT_SHAPE_RATIO_MIN = 0.4;
export const SOFT_SHAPE_RATIO_MAX = 1.5;
export const SOFT_INTER_TURN_LATENCY_P95_MS = 30_000;
export const SOFT_SESSION_COST_USD = 0.4;
export const SOFT_JUDGE_COST_USD = 0.1;

// Judge retry policy (eng-review T2 decision).
export const JUDGE_RETRY_DELAYS_MS = [4_000, 8_000];

// Budget-regression threshold: any axis growing >this factor vs the
// last-known-good fails the suite. Sane floor of 5 to avoid noise on
// near-zero numbers.
export const BUDGET_REGRESSION_FACTOR = 2;
export const BUDGET_REGRESSION_MIN_FLOOR = 5;
