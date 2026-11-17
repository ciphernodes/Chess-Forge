/**
 * Configuration schema, rating-calibrated parameter curves, and validation helpers
 * for HumanizerController.
 */

export interface HumanizerConfig {
  readonly enabled: boolean;
  /** Target player rating used to scale blunder tolerance, lambda(Elo), and temperature T. */
  readonly targetElo: number;
  /** Maximum centipawn loss allowed for surviving candidate hints. */
  readonly maxAllowedBlunderCp: number;
  /** Minimum Maia-2 / heuristic human prior probability unless move is a forced recapture. */
  readonly minHumanPriorProb: number;
  /** Minimum WDL expected score delta (E1 - E2) required to activate an overlay hint. */
  readonly criticalWdlThreshold: number;
  /** Per-game hint budget (default 3). */
  readonly maxHintsPerGame: number;
  /** Margin above PV2 to consider a move a single forced recapture (default 150 cp). */
  readonly forcedRecaptureMarginCp: number;
  /** Suppress overlay hints when board piece count <= cutoff (default 6). */
  readonly endgamePieceCutoff: number;
  /** Remaining clock cutoff in ms below which hint probability decays to zero (default 15,000 ms). */
  readonly lowClockCutoffMs: number;
  /** Soft taper window start above lowClockCutoffMs for smooth decay (default 25,000 ms). */
  readonly lowClockTaperStartMs: number;
  /** Quiet-position log-normal delay bounds (ms). */
  readonly quietDelayMinMs: number;
  readonly quietDelayMaxMs: number;
  /** Sharp-tactical-position log-normal delay bounds (ms). */
  readonly sharpDelayMinMs: number;
  readonly sharpDelayMaxMs: number;
  /** Optional deterministic PRNG override [0, 1) for reproducible testing. */
  readonly randomFn?: () => number;
}

export const DEFAULT_HUMANIZER_CONFIG: HumanizerConfig = {
  enabled: true,
  targetElo: 1500,
  maxAllowedBlunderCp: 130,
  minHumanPriorProb: 0.03,
  criticalWdlThreshold: 0.14,
  maxHintsPerGame: 3,
  forcedRecaptureMarginCp: 150,
  endgamePieceCutoff: 6,
  lowClockCutoffMs: 15_000,
  lowClockTaperStartMs: 25_000,
  quietDelayMinMs: 800,
  quietDelayMaxMs: 1_500,
  sharpDelayMinMs: 4_000,
  sharpDelayMaxMs: 9_500,
};

export function createHumanizerConfig(
  overrides: Partial<HumanizerConfig> = {}
): HumanizerConfig {
  const merged: HumanizerConfig = {
    ...DEFAULT_HUMANIZER_CONFIG,
    ...overrides,
  };
  return {
    ...merged,
    targetElo: clamp(merged.targetElo, 400, 3000),
    maxAllowedBlunderCp: clamp(merged.maxAllowedBlunderCp, 20, 600),
    minHumanPriorProb: clamp(merged.minHumanPriorProb, 0.001, 0.5),
    criticalWdlThreshold: clamp(merged.criticalWdlThreshold, 0.01, 0.6),
    maxHintsPerGame: Math.max(0, Math.round(merged.maxHintsPerGame)),
    forcedRecaptureMarginCp: clamp(merged.forcedRecaptureMarginCp, 50, 500),
    endgamePieceCutoff: Math.max(2, Math.round(merged.endgamePieceCutoff)),
    lowClockCutoffMs: Math.max(0, Math.round(merged.lowClockCutoffMs)),
    lowClockTaperStartMs: Math.max(
      Math.round(merged.lowClockCutoffMs),
      Math.round(merged.lowClockTaperStartMs)
    ),
    quietDelayMinMs: Math.max(50, Math.round(merged.quietDelayMinMs)),
    quietDelayMaxMs: Math.max(
      Math.round(merged.quietDelayMinMs),
      Math.round(merged.quietDelayMaxMs)
    ),
    sharpDelayMinMs: Math.max(100, Math.round(merged.sharpDelayMinMs)),
    sharpDelayMaxMs: Math.max(
      Math.round(merged.sharpDelayMinMs),
      Math.round(merged.sharpDelayMaxMs)
    ),
  };
}

/**
 * Computes centipawn sensitivity lambda(targetElo).
 * Higher-rated players penalize centipawn loss more steeply than lower-rated players.
 */
export function computeEloLambda(targetElo: number): number {
  const clamped = clamp(targetElo, 600, 2800);
  // 800 Elo -> ~0.008, 1500 Elo -> ~0.017, 2400 Elo -> ~0.030
  return 0.004 + ((clamped - 600) / 2200) * 0.028;
}

/**
 * Computes Boltzmann softmax temperature T(targetElo).
 * Scales inversely with rating so stronger target ratings concentrate more tightly on top human-plausible choices,
 * while weaker ratings rotate more broadly across top-1, top-2, and top-3 lines.
 */
export function computeEloTemperature(targetElo: number): number {
  const clamped = clamp(targetElo, 600, 2800);
  const normalized = (clamped - 600) / 2200; // 0..1
  return 1.35 - normalized * 0.95; // 1.35 at 600 Elo -> 0.40 at 2800 Elo
}

/**
 * Computes rating-adjusted blunder ceiling in centipawns.
 */
export function computeEffectiveBlunderCapCp(config: HumanizerConfig): number {
  const eloAdjustment = ((2200 - clamp(config.targetElo, 600, 2600)) / 1600) * 60;
  return Math.max(25, config.maxAllowedBlunderCp + Math.round(eloAdjustment));
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
