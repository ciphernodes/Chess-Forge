import {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  HUMANIZED_AUTOPLAY_PRESETS,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EloPresetId,
  type EngineMultiPvPort,
  type EngineMultiPvQuery,
  type EngineMultiPvResult,
  type MoveSelectorConfig,
  type MultiPvCandidateLine,
  type PieceColor,
} from "./autoPlayPorts.ts";

export {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  HUMANIZED_AUTOPLAY_PRESETS,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EloPresetId,
  type EngineMultiPvPort,
  type EngineMultiPvQuery,
  type EngineMultiPvResult,
  type MoveSelectorConfig,
  type MultiPvCandidateLine,
};

export type HumanPriorsInput =
  | ReadonlyMap<string, number>
  | Readonly<Record<string, number>>;

export type SelectionRegime =
  | "QUIET_NATURAL_HUMAN"
  | "CRITICAL_BOLTZMANN_TOP3"
  | "FORCED_RECAPTURE_EXCEPTION"
  | "NO_CANDIDATE";

export interface SearchBudgetRecommendation {
  readonly timeTroubleActive: boolean;
  readonly remainingClockMs: number | null;
  readonly recommendedDepth: number;
  readonly recommendedThinkTimeMs: number;
  readonly temperatureMultiplier: number;
}

export interface MoveCandidateProbability {
  readonly line: MultiPvCandidateLine;
  readonly wdl: readonly [number, number, number];
  readonly expectedScore: number;
  readonly cpLoss: number;
  readonly humanPrior: number;
  readonly utility: number;
  readonly probability: number;
}

export interface MoveSelectionRequest {
  readonly fen: string;
  readonly turn: PieceColor;
  readonly lines: readonly MultiPvCandidateLine[];
  readonly humanPriors?: HumanPriorsInput;
  readonly clockPort?: ClockStatePort;
  readonly clockSnapshot?: ClockStateSnapshot;
  /** Optional square of the immediately preceding opponent move (e.g., "d5") to detect recaptures. */
  readonly lastOpponentDestinationSquare?: string | null;
}

export interface MoveSelectionResult {
  readonly selected: MoveCandidateProbability | null;
  readonly distribution: readonly MoveCandidateProbability[];
  readonly excludedBlunderMoves: readonly string[];
  readonly excludedComputerTactics: readonly string[];
  readonly recaptureExceptionApplied: boolean;
  readonly expectedScoreDelta: number;
  readonly isCriticalPosition: boolean;
  readonly regime: SelectionRegime;
  readonly temperatureUsed: number;
  readonly lambdaUsed: number;
  readonly effectiveBlunderCapCp: number;
  readonly searchBudget: SearchBudgetRecommendation;
}

export const DEFAULT_MOVE_SELECTOR_CONFIG: MoveSelectorConfig =
  ELO_1600_PRESET.selector;

/**
 * Scales Boltzmann temperature T inversely with targetElo.
 * Lower ratings yield higher T (broader rotation across top-1/2/3),
 * higher ratings yield lower T (tighter concentration on top-utility lines).
 */
export function computeInverseEloTemperature(targetElo: number): number {
  const clamped = clamp(targetElo, 600, 2800);
  // 1200 -> 1.08, 1600 -> 0.79, 2000 -> 0.50, 2400 -> 0.28
  const raw = 1.08 - ((clamped - 1200) / 400) * 0.29;
  return clamp(raw, 0.25, 1.55);
}

/**
 * Computes centipawn loss sensitivity lambda(targetElo).
 */
export function computeEloCpLambda(targetElo: number): number {
  const clamped = clamp(targetElo, 600, 2800);
  // 1200 -> ~0.011, 1600 -> ~0.019, 2000 -> ~0.028
  return 0.004 + ((clamped - 600) / 2200) * 0.029;
}

/**
 * Computes effective centipawn blunder tolerance calibrated by targetElo.
 */
export function computeBlunderCeilingCp(config: MoveSelectorConfig): number {
  if (config.maxAllowedBlunderCp > 0) {
    return clamp(Math.round(config.maxAllowedBlunderCp), 25, 600);
  }
  const normalized = (clamp(config.targetElo, 800, 2400) - 800) / 1600;
  return Math.round(200 - normalized * 150);
}

/**
 * Converts mate/centipawn evaluation into a single comparable centipawn scalar.
 */
export function lineToComparableCp(line: MultiPvCandidateLine): number {
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0
      ? 10_000 - Math.abs(line.mate) * 10
      : -10_000 + Math.abs(line.mate) * 10;
  }
  return line.centipawns ?? 0;
}

/**
 * Normalizes a Stockfish WDL triple (either permille [W, D, L] or probabilities) into [W, D, L] summing to 1.0.
 * Falls back to a calibrated logistic model from centipawns when WDL is omitted.
 */
export function normalizeWdlTriple(
  line: MultiPvCandidateLine
): readonly [number, number, number] {
  if (line.wdl && line.wdl.length === 3) {
    const wRaw = Math.max(0, line.wdl[0]);
    const dRaw = Math.max(0, line.wdl[1]);
    const lRaw = Math.max(0, line.wdl[2]);
    const sum = wRaw + dRaw + lRaw;
    if (sum > 0) {
      return [wRaw / sum, dRaw / sum, lRaw / sum];
    }
  }

  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0 ? [1, 0, 0] : [0, 0, 1];
  }

  const cp = line.centipawns ?? 0;
  const decisiveProb = 1 / (1 + Math.exp(-0.00368208 * cp));
  const drawPeak = 0.36 * Math.exp(-Math.pow(cp / 240, 2));
  const w = clamp(decisiveProb - drawPeak * 0.5, 0, 1);
  const l = clamp(1 - decisiveProb - drawPeak * 0.5, 0, 1);
  const d = Math.max(0, 1 - w - l);
  const norm = w + d + l || 1;
  return [w / norm, d / norm, l / norm];
}

/**
 * Computes WDL expected score E = W + 0.5 * D.
 */
export function computeExpectedScore(
  wdl: readonly [number, number, number]
): number {
  return clamp(wdl[0] + 0.5 * wdl[1], 0, 1);
}

/**
 * Computes Delta_E = (W1 + 0.5 * D1) - (W2 + 0.5 * D2) between PV1 and PV2.
 */
export function computeWdlExpectedScoreDelta(
  lines: readonly MultiPvCandidateLine[]
): number {
  if (lines.length === 0) return 0;
  if (lines.length === 1) return 0.5;
  const e1 = computeExpectedScore(normalizeWdlTriple(lines[0]));
  const e2 = computeExpectedScore(normalizeWdlTriple(lines[1]));
  return Math.max(0, e1 - e2);
}

/**
 * Determines time-trouble state (< 15,000 ms remaining) and scales search depth,
 * think time, and temperature multiplier accordingly.
 */
export function computeSearchBudgetRecommendation(
  clockSnapshot: ClockStateSnapshot | null | undefined,
  config: MoveSelectorConfig
): SearchBudgetRecommendation {
  const remaining = clockSnapshot?.activeRemainingMs ?? null;
  if (remaining === null || remaining >= config.timeTroubleThresholdMs) {
    return {
      timeTroubleActive: false,
      remainingClockMs: remaining,
      recommendedDepth: config.standardSearchDepth,
      recommendedThinkTimeMs: config.standardThinkTimeMs,
      temperatureMultiplier: 1.0,
    };
  }

  // Remaining time below 15,000 ms: proportionally compress depth & think budget, elevate temperature T
  const ratio = clamp(remaining / Math.max(1, config.timeTroubleThresholdMs), 0.15, 1.0);
  const recommendedDepth = Math.max(
    4,
    Math.round(4 + ratio * Math.max(1, config.timeTroubleDepth - 4))
  );
  const recommendedThinkTimeMs = Math.max(
    60,
    Math.round(config.timeTroubleThinkTimeMs * (0.45 + 0.55 * ratio))
  );
  const extraPanicHeat = remaining < 5_000 ? 1.2 : 1.0;

  return {
    timeTroubleActive: true,
    remainingClockMs: remaining,
    recommendedDepth,
    recommendedThinkTimeMs,
    temperatureMultiplier: config.timeTroubleTempMultiplier * extraPanicHeat,
  };
}

/**
 * Synthesizes plausible human move priors P_human(move | fen) when external
 * policy predictions (e.g. Maia-2 ONNX) are unavailable or incomplete.
 */
export function deriveFallbackHumanPriors(
  fen: string,
  lines: readonly MultiPvCandidateLine[],
  targetElo: number,
  lastOpponentDestSquare?: string | null
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  if (lines.length === 0) return out;

  const boardPieces = parseFenPieceMap(fen);
  const bestCp = lineToComparableCp(lines[0]);
  const eloNorm = clamp((targetElo - 600) / 2000, 0, 1);

  const weights = lines.map((line, index) => {
    const cpLoss = Math.max(0, bestCp - lineToComparableCp(line));
    const toSq = line.move.slice(2, 4).toLowerCase();
    const isCapture =
      Boolean(line.isCapture) ||
      Boolean(line.isRecapture) ||
      boardPieces.has(toSq) ||
      Boolean(line.san?.includes("x"));
    const isRecapture =
      Boolean(line.isRecapture) ||
      (Boolean(lastOpponentDestSquare) &&
        toSq === lastOpponentDestSquare?.toLowerCase());
    const isCheck =
      Boolean(line.isCheck) ||
      Boolean(line.san?.includes("+") || line.san?.includes("#"));
    const isCentral = /^(c|d|e|f)[3-6]$/.test(toSq);

    let naturalness = 1.0;
    if (isRecapture) naturalness *= 1.55;
    else if (isCapture) naturalness *= 1.25;
    if (isCheck) naturalness *= 1.22;
    if (isCentral) naturalness *= 1.12;

    const evalWeight = Math.exp(-cpLoss / (95 + (1 - eloNorm) * 145));
    const rankWeight = Math.exp(-index * (0.35 + eloNorm * 0.38));
    return Math.max(1e-4, evalWeight * rankWeight * naturalness);
  });

  const total = weights.reduce((acc, w) => acc + w, 0) || 1;
  lines.forEach((line, idx) => {
    out.set(line.move, weights[idx] / total);
  });
  return out;
}

/**
 * Rating-calibrated, WDL-criticality-gated, Boltzmann move selector.
 */
export class HumanizerMoveSelector {
  private config: MoveSelectorConfig;

  constructor(config: Partial<MoveSelectorConfig> = {}) {
    this.config = mergeSelectorConfig(DEFAULT_MOVE_SELECTOR_CONFIG, config);
  }

  getConfig(): MoveSelectorConfig {
    return this.config;
  }

  updateConfig(partial: Partial<MoveSelectorConfig>): void {
    this.config = mergeSelectorConfig(this.config, partial);
  }

  /**
   * Computes time-trouble adjusted engine query parameters from current ClockStatePort.
   */
  getRecommendedSearchBudget(
    turn: PieceColor,
    clockPort?: ClockStatePort
  ): SearchBudgetRecommendation {
    const snap = clockPort ? clockPort.readClockState(turn) : null;
    return computeSearchBudgetRecommendation(snap, this.config);
  }

  /**
   * Selects a move from Stockfish MultiPV 4 lines and optional human priors P_human(move | fen).
   */
  selectMove(request: MoveSelectionRequest): MoveSelectionResult {
    const rawLines = [...request.lines]
      .slice(0, 4)
      .sort((a, b) => lineToComparableCp(b) - lineToComparableCp(a));

    const clockSnap =
      request.clockSnapshot ??
      (request.clockPort ? request.clockPort.readClockState(request.turn) : null);
    const searchBudget = computeSearchBudgetRecommendation(clockSnap, this.config);
    const baseTemp =
      this.config.baseTemperature > 0
        ? this.config.baseTemperature
        : computeInverseEloTemperature(this.config.targetElo);
    const temperature = Math.max(
      0.08,
      baseTemp * searchBudget.temperatureMultiplier
    );
    const lambda =
      this.config.lambdaCp > 0
        ? this.config.lambdaCp
        : computeEloCpLambda(this.config.targetElo);
    const blunderCap = computeBlunderCeilingCp(this.config);

    if (rawLines.length === 0) {
      return {
        selected: null,
        distribution: [],
        excludedBlunderMoves: [],
        excludedComputerTactics: [],
        recaptureExceptionApplied: false,
        expectedScoreDelta: 0,
        isCriticalPosition: false,
        regime: "NO_CANDIDATE",
        temperatureUsed: temperature,
        lambdaUsed: lambda,
        effectiveBlunderCapCp: blunderCap,
        searchBudget,
      };
    }

    const bestCp = lineToComparableCp(rawLines[0]);
    const expectedScoreDelta = computeWdlExpectedScoreDelta(rawLines);
    const isCritical = expectedScoreDelta >= this.config.criticalWdlThreshold;

    const suppliedPriors = toPriorMap(request.humanPriors);
    const fallbackPriors = deriveFallbackHumanPriors(
      request.fen,
      rawLines,
      this.config.targetElo,
      request.lastOpponentDestinationSquare
    );
    const resolvedPrior = (move: string): number => {
      if (suppliedPriors && suppliedPriors.has(move)) {
        return clamp(suppliedPriors.get(move) ?? 0, 0, 1);
      }
      return clamp(fallbackPriors.get(move) ?? 0, 0, 1);
    };

    const boardPieces = parseFenPieceMap(request.fen);
    const isRecaptureMove = (line: MultiPvCandidateLine): boolean => {
      if (line.isRecapture === true) return true;
      const toSq = line.move.slice(2, 4).toLowerCase();
      if (
        request.lastOpponentDestinationSquare &&
        toSq === request.lastOpponentDestinationSquare.toLowerCase()
      ) {
        return true;
      }
      return Boolean(
        line.san?.includes("x") && boardPieces.has(toSq)
      );
    };

    const excludedBlunderMoves: string[] = [];
    const excludedComputerTactics: string[] = [];

    const nonBlunders = rawLines.filter((line) => {
      const cpLoss = Math.max(0, bestCp - lineToComparableCp(line));
      if (cpLoss > blunderCap) {
        excludedBlunderMoves.push(line.move);
        return false;
      }
      return true;
    });

    const nonLosingRecaptures = nonBlunders.filter(isRecaptureMove);
    const onlyOneNonLosingRecapture =
      nonLosingRecaptures.length === 1 && nonBlunders.length === 1;

    let recaptureExceptionApplied = false;
    const survivors = nonBlunders.filter((line) => {
      const prior = resolvedPrior(line.move);
      if (prior < this.config.minHumanPriorProb) {
        if (onlyOneNonLosingRecapture && isRecaptureMove(line)) {
          recaptureExceptionApplied = true;
          return true;
        }
        excludedComputerTactics.push(line.move);
        return false;
      }
      return true;
    });

    if (survivors.length === 0) {
      return {
        selected: null,
        distribution: [],
        excludedBlunderMoves,
        excludedComputerTactics,
        recaptureExceptionApplied: false,
        expectedScoreDelta,
        isCriticalPosition: isCritical,
        regime: "NO_CANDIDATE",
        temperatureUsed: temperature,
        lambdaUsed: lambda,
        effectiveBlunderCapCp: blunderCap,
        searchBudget,
      };
    }

    // In critical positions (Delta_E >= criticalWdlThreshold), rotate across top-1, top-2, top-3
    // using P(move) proportional to exp((log(P_human) - lambda * cpLoss) / T).
    // In quiet/non-critical positions (Delta_E < criticalWdlThreshold), favor natural high-prior human moves.
    const candidatePool = isCritical ? survivors.slice(0, 3) : survivors;

    const unnormalized = candidatePool.map((line) => {
      const wdl = normalizeWdlTriple(line);
      const expectedScore = computeExpectedScore(wdl);
      const cpLoss = Math.max(0, bestCp - lineToComparableCp(line));
      const prior = Math.max(1e-5, resolvedPrior(line.move));

      if (isCritical) {
        const utility = Math.log(prior) - lambda * cpLoss;
        return {
          line,
          wdl,
          expectedScore,
          cpLoss,
          humanPrior: prior,
          utility,
          logit: utility / temperature,
        };
      }

      // Quiet position: amplify human prior naturalness & mild evaluation preference
      const naturalTemp = Math.max(0.18, temperature * 0.65);
      const utility = 1.45 * Math.log(prior) - 0.35 * lambda * cpLoss;
      return {
        line,
        wdl,
        expectedScore,
        cpLoss,
        humanPrior: prior,
        utility,
        logit: utility / naturalTemp,
      };
    });

    const maxLogit = Math.max(...unnormalized.map((item) => item.logit));
    const weights = unnormalized.map((item) => Math.exp(item.logit - maxLogit));
    const sumWeights = weights.reduce((acc, w) => acc + w, 0) || 1;

    const distribution: MoveCandidateProbability[] = unnormalized
      .map((item, idx) => ({
        line: item.line,
        wdl: item.wdl,
        expectedScore: item.expectedScore,
        cpLoss: item.cpLoss,
        humanPrior: item.humanPrior,
        utility: item.utility,
        probability: weights[idx] / sumWeights,
      }))
      .sort((a, b) => b.probability - a.probability);

    const rng = this.config.randomFn ?? Math.random;
    const selected = sampleFromDistribution(distribution, rng);

    const regime: SelectionRegime = recaptureExceptionApplied
      ? "FORCED_RECAPTURE_EXCEPTION"
      : isCritical
      ? "CRITICAL_BOLTZMANN_TOP3"
      : "QUIET_NATURAL_HUMAN";

    return {
      selected,
      distribution,
      excludedBlunderMoves,
      excludedComputerTactics,
      recaptureExceptionApplied,
      expectedScoreDelta: Number(expectedScoreDelta.toFixed(4)),
      isCriticalPosition: isCritical,
      regime,
      temperatureUsed: Number(temperature.toFixed(4)),
      lambdaUsed: Number(lambda.toFixed(5)),
      effectiveBlunderCapCp: blunderCap,
      searchBudget,
    };
  }
}

function sampleFromDistribution(
  distribution: readonly MoveCandidateProbability[],
  rng: () => number
): MoveCandidateProbability | null {
  if (distribution.length === 0) return null;
  const roll = clamp(rng(), 0, 0.9999999);
  let cumulative = 0;
  for (const candidate of distribution) {
    cumulative += candidate.probability;
    if (roll <= cumulative) {
      return candidate;
    }
  }
  return distribution[distribution.length - 1];
}

function toPriorMap(input?: HumanPriorsInput): ReadonlyMap<string, number> | null {
  if (!input) return null;
  if (input instanceof Map) return input;
  return new Map<string, number>(Object.entries(input));
}

function mergeSelectorConfig(
  base: MoveSelectorConfig,
  overrides: Partial<MoveSelectorConfig>
): MoveSelectorConfig {
  const mergedTargetElo = clamp(overrides.targetElo ?? base.targetElo, 400, 3000);
  const autoBaseTemp =
    overrides.baseTemperature ??
    (overrides.targetElo !== undefined
      ? computeInverseEloTemperature(mergedTargetElo)
      : base.baseTemperature);
  const autoLambda =
    overrides.lambdaCp ??
    (overrides.targetElo !== undefined
      ? computeEloCpLambda(mergedTargetElo)
      : base.lambdaCp);

  return {
    targetElo: mergedTargetElo,
    maxAllowedBlunderCp: clamp(
      overrides.maxAllowedBlunderCp ?? base.maxAllowedBlunderCp,
      20,
      600
    ),
    minHumanPriorProb: clamp(
      overrides.minHumanPriorProb ?? base.minHumanPriorProb,
      0.001,
      0.5
    ),
    criticalWdlThreshold: clamp(
      overrides.criticalWdlThreshold ?? base.criticalWdlThreshold,
      0.01,
      0.6
    ),
    baseTemperature: clamp(autoBaseTemp, 0.15, 2.5),
    lambdaCp: clamp(autoLambda, 0.001, 0.1),
    standardSearchDepth: Math.max(
      4,
      Math.round(overrides.standardSearchDepth ?? base.standardSearchDepth)
    ),
    standardThinkTimeMs: Math.max(
      80,
      Math.round(overrides.standardThinkTimeMs ?? base.standardThinkTimeMs)
    ),
    timeTroubleThresholdMs: Math.max(
      1_000,
      Math.round(overrides.timeTroubleThresholdMs ?? base.timeTroubleThresholdMs)
    ),
    timeTroubleDepth: Math.max(
      2,
      Math.round(overrides.timeTroubleDepth ?? base.timeTroubleDepth)
    ),
    timeTroubleThinkTimeMs: Math.max(
      40,
      Math.round(overrides.timeTroubleThinkTimeMs ?? base.timeTroubleThinkTimeMs)
    ),
    timeTroubleTempMultiplier: clamp(
      overrides.timeTroubleTempMultiplier ?? base.timeTroubleTempMultiplier,
      1.0,
      3.0
    ),
    randomFn: overrides.randomFn ?? base.randomFn,
  };
}

function parseFenPieceMap(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  const placement = fen.trim().split(/\s+/)[0] || "";
  const ranks = placement.split("/");
  if (ranks.length !== 8) return map;
  const files = "abcdefgh";
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (ch >= "1" && ch <= "8") {
        f += parseInt(ch, 10);
      } else if (f < 8) {
        map.set(`${files[f]}${8 - r}`, ch);
        f++;
      }
    }
  }
  return map;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
