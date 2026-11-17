import { expectedScoreFromLine, type FairPlayAuditor } from "./fairPlayAuditor.ts";
import {
  computeEffectiveBlunderCapCp,
  computeEloLambda,
  computeEloTemperature,
  createHumanizerConfig,
  type HumanizerConfig,
} from "./humanizerConfig.ts";
import {
  comparableCp,
  type ClockTelemetryPort,
  type EngineAnalysis,
  type EngineLine,
  type OverlayDrawCommand,
  type OverlayRenderPort,
  type PolicyPort,
} from "./ports.ts";

export type SuppressionReason =
  | "DISABLED"
  | "LOCKOUT"
  | "NO_LINES"
  | "OPENING_BOOK"
  | "FORCED_RECAPTURE"
  | "SIMPLIFIED_ENDGAME"
  | "LOW_CRITICALITY_WDL"
  | "HINT_BUDGET_EXHAUSTED"
  | "LOW_CLOCK_CUTOFF"
  | "LOW_CLOCK_TAPER_SKIP"
  | "NO_PLAUSIBLE_HUMAN_CANDIDATES"
  | "FEN_MUTATED_BEFORE_DRAW";

export interface HumanizerDecision {
  readonly status: "SCHEDULED" | "DRAWN" | "SUPPRESSED";
  readonly reason?: SuppressionReason;
  readonly command?: OverlayDrawCommand;
  readonly expectedScoreDelta: number;
  readonly complexityScore: number;
  readonly delayMs: number;
}

export interface WeightedCandidate {
  readonly line: EngineLine;
  readonly cpLoss: number;
  readonly humanPrior: number;
  readonly utility: number;
  readonly probability: number;
}

export class HumanizerController {
  private config: HumanizerConfig;
  private readonly policyPort: PolicyPort;
  private readonly clockPort: ClockTelemetryPort;
  private readonly overlayPort: OverlayRenderPort;
  private readonly auditor: FairPlayAuditor;

  private hintsUsedInGame = 0;
  private activeFen = "";
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDrawTimestampByFen = new Map<string, number>();

  constructor(
    config: Partial<HumanizerConfig> = {},
    policyPort: PolicyPort,
    clockPort: ClockTelemetryPort,
    overlayPort: OverlayRenderPort,
    auditor: FairPlayAuditor
  ) {
    this.config = createHumanizerConfig(config);
    this.policyPort = policyPort;
    this.clockPort = clockPort;
    this.overlayPort = overlayPort;
    this.auditor = auditor;
  }

  getConfig(): HumanizerConfig {
    return this.config;
  }

  updateConfig(partial: Partial<HumanizerConfig>): void {
    this.config = createHumanizerConfig({ ...this.config, ...partial });
    this.auditor.setBaselineElo(this.config.targetElo);
  }

  getHintsUsedInGame(): number {
    return this.hintsUsedInGame;
  }

  resetGame(): void {
    this.cancelPending("FEN_MUTATED_BEFORE_DRAW");
    this.hintsUsedInGame = 0;
    this.activeFen = "";
    this.lastDrawTimestampByFen.clear();
  }

  cancelPending(_reason: string = "FEN_MUTATED_BEFORE_DRAW"): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  onBoardMutated(newFen: string): void {
    if (newFen !== this.activeFen) {
      this.cancelPending("FEN_MUTATED_BEFORE_DRAW");
      this.activeFen = newFen;
      this.overlayPort.clearOverlay("BOARD_MUTATION");
    }
  }

  /**
   * Evaluates all humanizer gates, samples a rating-calibrated move candidate,
   * and schedules the complexity-scaled overlay draw (or suppresses cleanly).
   */
  async evaluateAndScheduleDraw(
    analysis: EngineAnalysis,
    options: { readonly immediateForTest?: boolean } = {}
  ): Promise<HumanizerDecision> {
    this.activeFen = analysis.fen;
    this.cancelPending("SUPERSEDED");

    const snapshot = this.auditor.getSnapshot();
    this.overlayPort.updateFairPlayBadge(snapshot);

    const policy = this.auditor.getRiskPolicy();
    if (policy.blockAllOverlays) {
      this.overlayPort.clearOverlay("LOCKOUT");
      return suppressedDecision("LOCKOUT", 0, 0);
    }

    if (!this.config.enabled) {
      this.overlayPort.clearOverlay("DISABLED");
      return suppressedDecision("DISABLED", 0, 0);
    }

    if (!analysis.lines || analysis.lines.length === 0) {
      this.overlayPort.clearOverlay("NO_LINES");
      return suppressedDecision("NO_LINES", 0, 0);
    }

    if (isBookMove(analysis)) {
      this.overlayPort.clearOverlay("OPENING_BOOK");
      return suppressedDecision("OPENING_BOOK", 0, 0);
    }

    const pieceCount = countPiecesFromFen(analysis.fen);
    if (pieceCount <= this.config.endgamePieceCutoff) {
      this.overlayPort.clearOverlay("SIMPLIFIED_ENDGAME");
      return suppressedDecision("SIMPLIFIED_ENDGAME", 0, 0);
    }

    const isForced = isForcedRecapturePosition(
      analysis,
      this.config.forcedRecaptureMarginCp
    );
    if (isForced) {
      this.overlayPort.clearOverlay("FORCED_RECAPTURE");
      return suppressedDecision("FORCED_RECAPTURE", 0, 0);
    }

    if (this.hintsUsedInGame >= this.config.maxHintsPerGame) {
      this.overlayPort.clearOverlay("HINT_BUDGET_EXHAUSTED");
      return suppressedDecision("HINT_BUDGET_EXHAUSTED", 0, 0);
    }

    const expectedScoreDelta = computeExpectedScoreDelta(analysis.lines);
    const effectiveWdlThreshold =
      this.config.criticalWdlThreshold + policy.criticalWdlDeltaAdd;
    if (expectedScoreDelta < effectiveWdlThreshold) {
      this.overlayPort.clearOverlay("LOW_CRITICALITY_WDL");
      return suppressedDecision("LOW_CRITICALITY_WDL", expectedScoreDelta, 0);
    }

    const clocks = this.clockPort.readClocks(analysis.turn);
    const activeRemainingMs = clocks.activeRemainingMs;
    const rng = this.config.randomFn ?? Math.random;

    if (activeRemainingMs !== null) {
      const hintProb = computeClockHintProbability(
        activeRemainingMs,
        this.config.lowClockCutoffMs,
        this.config.lowClockTaperStartMs
      );
      if (activeRemainingMs < this.config.lowClockCutoffMs || hintProb <= 0) {
        this.overlayPort.clearOverlay("LOW_CLOCK_CUTOFF");
        return suppressedDecision("LOW_CLOCK_CUTOFF", expectedScoreDelta, 0);
      }
      if (hintProb < 1 && rng() > hintProb) {
        this.overlayPort.clearOverlay("LOW_CLOCK_TAPER_SKIP");
        return suppressedDecision("LOW_CLOCK_TAPER_SKIP", expectedScoreDelta, 0);
      }
    }

    const priors = await this.policyPort.predictHumanPriors(
      analysis.fen,
      analysis.lines,
      this.config.targetElo
    );

    const temperature =
      computeEloTemperature(this.config.targetElo) * policy.temperatureMultiplier;

    const { selected, distribution } = selectHumanizedCandidate(
      analysis.lines,
      priors,
      this.config,
      temperature,
      isForced,
      rng
    );

    if (!selected) {
      this.overlayPort.clearOverlay("NO_PLAUSIBLE_HUMAN_CANDIDATES");
      return suppressedDecision("NO_PLAUSIBLE_HUMAN_CANDIDATES", expectedScoreDelta, 0);
    }

    const complexityScore = computePositionComplexity(analysis, expectedScoreDelta);
    const baseDelayMs = sampleLogNormalDelayMs(
      complexityScore,
      this.config,
      rng
    );
    const delayMs = Math.max(baseDelayMs, policy.minDelayBoostMs);

    const command: OverlayDrawCommand = {
      fen: analysis.fen,
      turn: analysis.turn,
      selectedLine: selected.line,
      candidatePool: distribution.map((d) => d.line),
      expectedScoreDelta: Number(expectedScoreDelta.toFixed(4)),
      complexityScore: Number(complexityScore.toFixed(3)),
      humanPrior: Number(selected.humanPrior.toFixed(4)),
      temperatureUsed: Number(temperature.toFixed(3)),
      delayMs,
      hintsUsedInGame: this.hintsUsedInGame + 1,
      maxHintsPerGame: this.config.maxHintsPerGame,
    };

    const executeDraw = (): void => {
      this.pendingTimer = null;
      if (this.activeFen !== analysis.fen) return;
      if (this.auditor.getRiskPolicy().blockAllOverlays) {
        this.overlayPort.clearOverlay("LOCKOUT");
        return;
      }
      if (!this.lastDrawTimestampByFen.has(analysis.fen)) {
        this.hintsUsedInGame++;
        this.lastDrawTimestampByFen.set(analysis.fen, Date.now());
      }
      this.overlayPort.drawOverlay({
        ...command,
        hintsUsedInGame: this.hintsUsedInGame,
      });
    };

    if (options.immediateForTest) {
      executeDraw();
      return {
        status: "DRAWN",
        command: { ...command, hintsUsedInGame: this.hintsUsedInGame },
        expectedScoreDelta,
        complexityScore,
        delayMs,
      };
    }

    this.pendingTimer = setTimeout(executeDraw, delayMs);
    return {
      status: "SCHEDULED",
      command,
      expectedScoreDelta,
      complexityScore,
      delayMs,
    };
  }
}

/**
 * Computes WDL Expected Score Delta between PV1 and PV2:
 * Delta_E = (W1 + 0.5 * D1) - (W2 + 0.5 * D2).
 */
export function computeExpectedScoreDelta(lines: readonly EngineLine[]): number {
  if (!lines || lines.length < 2) return lines.length === 1 ? 0.5 : 0;
  const e1 = expectedScoreFromLine(lines[0]);
  const e2 = expectedScoreFromLine(lines[1]);
  return Math.max(0, e1 - e2);
}

/**
 * Smoothly decays hint probability to 0 below lowClockCutoffMs (default 15,000 ms).
 */
export function computeClockHintProbability(
  remainingMs: number | null,
  lowClockCutoffMs: number = 15_000,
  taperStartMs: number = 25_000
): number {
  if (remainingMs === null || remainingMs === undefined) return 1;
  if (remainingMs < lowClockCutoffMs) return 0;
  if (remainingMs >= taperStartMs || taperStartMs <= lowClockCutoffMs) return 1;
  const progress =
    (remainingMs - lowClockCutoffMs) / (taperStartMs - lowClockCutoffMs);
  // Smoothstep curve for natural probability taper
  return progress * progress * (3 - 2 * progress);
}

/**
 * Prunes blunder moves and alien tactics (P_human < minHumanPriorProb),
 * scores candidates with U(m) = log(P_human) - lambda(Elo) * cpLoss(m),
 * and samples via Boltzmann softmax with temperature T.
 */
export function selectHumanizedCandidate(
  lines: readonly EngineLine[],
  priors: ReadonlyMap<string, number>,
  config: HumanizerConfig,
  temperature: number,
  isForcedRecapture: boolean,
  rng: () => number = Math.random
): {
  readonly selected: WeightedCandidate | null;
  readonly distribution: readonly WeightedCandidate[];
} {
  if (lines.length === 0) {
    return { selected: null, distribution: [] };
  }

  const bestCp = comparableCp(lines[0]);
  const effectiveBlunderCap = computeEffectiveBlunderCapCp(config);
  const lambda = computeEloLambda(config.targetElo);

  const survivors: Array<{
    line: EngineLine;
    cpLoss: number;
    humanPrior: number;
    utility: number;
  }> = [];

  for (const line of lines) {
    const cpLoss = Math.max(0, bestCp - comparableCp(line));
    if (cpLoss > effectiveBlunderCap) continue;

    const prior = priors.get(line.uci) ?? 0;
    if (prior < config.minHumanPriorProb && !isForcedRecapture) {
      // Discard alien engine-only tactics that humans almost never consider
      continue;
    }

    const safePrior = Math.max(1e-5, prior);
    const utility = Math.log(safePrior) - lambda * cpLoss;
    survivors.push({ line, cpLoss, humanPrior: prior, utility });
  }

  if (survivors.length === 0) {
    return { selected: null, distribution: [] };
  }

  const safeTemp = Math.max(0.08, temperature);
  const maxU = Math.max(...survivors.map((s) => s.utility / safeTemp));
  const expWeights = survivors.map((s) => Math.exp(s.utility / safeTemp - maxU));
  const sumExp = expWeights.reduce((a, b) => a + b, 0) || 1;

  const distribution: WeightedCandidate[] = survivors.map((s, idx) => ({
    ...s,
    probability: expWeights[idx] / sumExp,
  }));

  const roll = Math.max(0, Math.min(0.999999, rng()));
  let cum = 0;
  let chosen = distribution[0];
  for (const item of distribution) {
    cum += item.probability;
    if (roll <= cum) {
      chosen = item;
      break;
    }
  }

  return { selected: chosen, distribution };
}

/**
 * Computes position complexity in [0, 1] from legal branching,
 * tactical captures/checks, WDL criticality, and depth-6 vs deep search divergence.
 */
export function computePositionComplexity(
  analysis: EngineAnalysis,
  expectedScoreDelta: number
): number {
  const branching = clamp((analysis.legalMoveCount ?? 30) / 48, 0, 1);
  const tacticalDensity = clamp((analysis.tacticalMoveCount ?? 4) / 14, 0, 1);
  const wdlSharpness = clamp(expectedScoreDelta / 0.35, 0, 1);

  let shallowDivergence = 0;
  if (analysis.shallowDepth6 && analysis.lines.length > 0) {
    const top = analysis.lines[0];
    const diffMove =
      analysis.shallowDepth6.bestUci.slice(0, 4) !== top.uci.slice(0, 4);
    const deepCp = comparableCp(top);
    const shallowCp =
      analysis.shallowDepth6.mate !== null
        ? analysis.shallowDepth6.mate > 0
          ? 10_000
          : -10_000
        : (analysis.shallowDepth6.centipawns ?? deepCp);
    const swing = clamp(Math.abs(deepCp - shallowCp) / 250, 0, 1);
    shallowDivergence = diffMove ? Math.max(0.65, swing) : swing * 0.5;
  }

  return clamp(
    0.22 * branching +
      0.28 * tacticalDensity +
      0.25 * wdlSharpness +
      0.25 * shallowDivergence,
    0,
    1
  );
}

/**
 * Samples a human-like display delay using a log-normal distribution anchored
 * between quiet (0.8s-1.5s) and sharp tactical (4.0s-9.5s) regimes.
 */
export function sampleLogNormalDelayMs(
  complexityScore: number,
  config: HumanizerConfig,
  rng: () => number = Math.random
): number {
  const c = clamp(complexityScore, 0, 1);
  const minBound =
    config.quietDelayMinMs +
    c * (config.sharpDelayMinMs - config.quietDelayMinMs);
  const maxBound =
    config.quietDelayMaxMs +
    c * (config.sharpDelayMaxMs - config.quietDelayMaxMs);

  const mid = Math.sqrt(minBound * maxBound);
  const mu = Math.log(Math.max(1, mid));
  const sigma = 0.16 + c * 0.12;

  // Box-Muller normal sample clipped safely to [minBound, maxBound]
  const u1 = Math.max(1e-6, Math.min(0.999999, rng()));
  const u2 = Math.max(1e-6, Math.min(0.999999, rng()));
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = Math.exp(mu + sigma * clamp(z, -1.6, 1.6));
  return Math.round(clamp(raw, minBound, maxBound));
}

export function countPiecesFromFen(fen: string): number {
  const placement = fen.trim().split(/\s+/)[0] || "";
  let count = 0;
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i];
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
      count++;
    }
  }
  return count;
}

function isBookMove(analysis: EngineAnalysis): boolean {
  if (analysis.isOpeningBook) return true;
  if (
    analysis.openingBookUcis &&
    analysis.lines.length > 0 &&
    analysis.openingBookUcis.some(
      (u) => u.slice(0, 4) === analysis.lines[0].uci.slice(0, 4)
    )
  ) {
    return true;
  }
  return false;
}

function isForcedRecapturePosition(
  analysis: EngineAnalysis,
  marginCp: number
): boolean {
  if (analysis.legalMoveCount !== undefined && analysis.legalMoveCount <= 1) {
    return true;
  }
  if (!analysis.isRecaptureOpportunity || analysis.lines.length === 0) {
    return false;
  }
  if (analysis.lines.length === 1) return true;
  const gap = comparableCp(analysis.lines[0]) - comparableCp(analysis.lines[1]);
  return gap >= marginCp;
}

function suppressedDecision(
  reason: SuppressionReason,
  expectedScoreDelta: number,
  complexityScore: number
): HumanizerDecision {
  return {
    status: "SUPPRESSED",
    reason,
    expectedScoreDelta,
    complexityScore,
    delayMs: 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
