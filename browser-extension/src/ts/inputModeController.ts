/**
 * Input Mode Controller & Lichess Premove Variance (`inputModeController.ts`).
 *
 * Implements:
 * 1. `inputMode: 'click' | 'drag' | 'premove'` sampled from a time-dependent distribution:
 *    - Normal time: 70% click / 30% drag
 *    - Low time: shifts smoothly toward clicks (up to ~92% click / 8% drag)
 * 2. Rating-calibrated Lichess premove scheduling & premove miss/fallback rates:
 *    - 1200 Elo: minimal premove frequency & 30% premove miss/fallback rate
 *    - 1600 Elo: moderate premove frequency & 10% premove miss/fallback rate
 *    - 2000 Elo: high premove readiness & 5% premove miss/fallback rate
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { EloPresetId, SquareName } from "./autoPlayPorts.ts";
import { parseUciMoveSquares } from "./autoPlayPorts.ts";
import type { KinematicPointerExecutor, PointerExecutionResult } from "./kinematicPointerExecutor.ts";

export type InputMode = "click" | "drag" | "premove";

export interface PremoveRatingCalibration {
  readonly elo: EloPresetId;
  /** Probability of attempting a premove when eligible during opponent turn. */
  readonly premoveAttemptRate: number;
  /** Probability of missing / falling back to regular move wait after opponent replies. */
  readonly premoveMissFallbackRate: number;
  /** Only premove obvious recaptures / forced lines at low rating when true. */
  readonly restrictToObviousLines: boolean;
}

export const PREMOVE_CALIBRATIONS: Readonly<Record<EloPresetId, PremoveRatingCalibration>> = {
  1200: {
    elo: 1200,
    premoveAttemptRate: 0.14,
    premoveMissFallbackRate: 0.30,
    restrictToObviousLines: true,
  },
  1600: {
    elo: 1600,
    premoveAttemptRate: 0.38,
    premoveMissFallbackRate: 0.10,
    restrictToObviousLines: false,
  },
  2000: {
    elo: 2000,
    premoveAttemptRate: 0.65,
    premoveMissFallbackRate: 0.05,
    restrictToObviousLines: false,
  },
};

export interface InputModeControllerConfig {
  /** Explicit opt-in flag; defaults to false to preserve static executor interactionMode. */
  readonly enabled: boolean;
  /** Baseline probability of choosing click over drag during normal clock time (default 0.70). */
  readonly normalClickRatio: number;
  /** Remaining clock threshold below which click ratio increases (default 25_000 ms). */
  readonly lowTimeShiftStartMs: number;
  /** Click ratio under severe low-clock conditions (default 0.92). */
  readonly lowTimeMaxClickRatio: number;
  /** Enables Lichess premove scheduling during opponent turns when enabled. */
  readonly premoveEnabled: boolean;
  /** Optional RNG hook for deterministic unit tests. */
  readonly randomFn?: () => number;
}

export const DEFAULT_INPUT_MODE_CONFIG: InputModeControllerConfig = {
  enabled: false,
  normalClickRatio: 0.70,
  lowTimeShiftStartMs: 25_000,
  lowTimeMaxClickRatio: 0.92,
  premoveEnabled: true,
};

export interface InputModeSelectionContext {
  readonly targetElo: number;
  readonly remainingClockMs: number | null;
  readonly isOpponentTurn?: boolean;
  readonly isObviousRecaptureOrForced?: boolean;
  readonly candidatePremoveUci?: string | null;
}

export interface InputModeDecision {
  readonly enabled: boolean;
  readonly inputMode: InputMode;
  readonly effectiveClickProbability: number;
  readonly effectiveDragProbability: number;
  readonly premoveMissFallbackRate: number;
  readonly premoveScheduled: boolean;
  readonly premoveMissFallbackApplied: boolean;
  readonly scheduledPremoveUci: string | null;
  readonly reason: string;
}

/**
 * Interpolates premove attempt & miss/fallback rates cleanly across Elo ratings.
 */
export function getPremoveCalibrationForElo(
  targetElo: number
): PremoveRatingCalibration {
  const clamped = clamp(targetElo, 1200, 2000);
  if (clamped <= 1200) return PREMOVE_CALIBRATIONS[1200];
  if (clamped === 1600) return PREMOVE_CALIBRATIONS[1600];
  if (clamped >= 2000) return PREMOVE_CALIBRATIONS[2000];

  const low = clamped < 1600 ? PREMOVE_CALIBRATIONS[1200] : PREMOVE_CALIBRATIONS[1600];
  const high = clamped < 1600 ? PREMOVE_CALIBRATIONS[1600] : PREMOVE_CALIBRATIONS[2000];
  const t = clamped < 1600 ? (clamped - 1200) / 400 : (clamped - 1600) / 400;

  return {
    elo: clamped < 1400 ? 1200 : clamped < 1800 ? 1600 : 2000,
    premoveAttemptRate: Number(
      (low.premoveAttemptRate + (high.premoveAttemptRate - low.premoveAttemptRate) * t).toFixed(4)
    ),
    premoveMissFallbackRate: Number(
      (
        low.premoveMissFallbackRate +
        (high.premoveMissFallbackRate - low.premoveMissFallbackRate) * t
      ).toFixed(4)
    ),
    restrictToObviousLines: clamped < 1400,
  };
}

export class InputModeController {
  private config: InputModeControllerConfig;

  constructor(config: Partial<InputModeControllerConfig> = {}) {
    this.config = {
      ...DEFAULT_INPUT_MODE_CONFIG,
      ...config,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getConfig(): InputModeControllerConfig {
    return this.config;
  }

  updateConfig(partial: Partial<InputModeControllerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Computes time-dependent click vs drag probability:
   * 70% click / 30% drag normally, shifting smoothly toward clicks in low time.
   */
  computeClickProbability(remainingClockMs: number | null): number {
    const base = clamp(this.config.normalClickRatio, 0.05, 0.95);
    if (remainingClockMs === null || remainingClockMs >= this.config.lowTimeShiftStartMs) {
      return base;
    }
    const urgency =
      1 -
      clamp(
        remainingClockMs / Math.max(1, this.config.lowTimeShiftStartMs),
        0,
        1
      );
    const maxClick = clamp(this.config.lowTimeMaxClickRatio, base, 0.98);
    return Number((base + (maxClick - base) * urgency).toFixed(4));
  }

  /**
   * Selects `'click' | 'drag' | 'premove'` conditioned on clock urgency and rating-calibrated premove variance.
   */
  selectInputMode(context: InputModeSelectionContext): InputModeDecision {
    const clickProb = this.computeClickProbability(context.remainingClockMs);
    const dragProb = Number((1 - clickProb).toFixed(4));
    const cal = getPremoveCalibrationForElo(context.targetElo);

    if (!this.config.enabled) {
      return {
        enabled: false,
        inputMode: "drag",
        effectiveClickProbability: clickProb,
        effectiveDragProbability: dragProb,
        premoveMissFallbackRate: cal.premoveMissFallbackRate,
        premoveScheduled: false,
        premoveMissFallbackApplied: false,
        scheduledPremoveUci: null,
        reason: "DISABLED_DEFAULT",
      };
    }

    const rng = this.config.randomFn ?? Math.random;

    // Premove evaluation during opponent's turn
    if (
      this.config.premoveEnabled &&
      context.isOpponentTurn &&
      context.candidatePremoveUci
    ) {
      if (cal.restrictToObviousLines && !context.isObviousRecaptureOrForced) {
        return {
          enabled: true,
          inputMode: rng() < clickProb ? "click" : "drag",
          effectiveClickProbability: clickProb,
          effectiveDragProbability: dragProb,
          premoveMissFallbackRate: cal.premoveMissFallbackRate,
          premoveScheduled: false,
          premoveMissFallbackApplied: false,
          scheduledPremoveUci: null,
          reason: "LOW_ELO_MINIMAL_PREMOVE_SKIPPED",
        };
      }

      if (rng() < cal.premoveAttemptRate) {
        // Apply rating-calibrated premove miss / fallback rate (1200: 30%, 1600: 10%, 2000: 5%)
        if (rng() < cal.premoveMissFallbackRate) {
          return {
            enabled: true,
            inputMode: rng() < clickProb ? "click" : "drag",
            effectiveClickProbability: clickProb,
            effectiveDragProbability: dragProb,
            premoveMissFallbackRate: cal.premoveMissFallbackRate,
            premoveScheduled: false,
            premoveMissFallbackApplied: true,
            scheduledPremoveUci: null,
            reason: "PREMOVE_MISS_FALLBACK",
          };
        }

        return {
          enabled: true,
          inputMode: "premove",
          effectiveClickProbability: clickProb,
          effectiveDragProbability: dragProb,
          premoveMissFallbackRate: cal.premoveMissFallbackRate,
          premoveScheduled: true,
          premoveMissFallbackApplied: false,
          scheduledPremoveUci: context.candidatePremoveUci,
          reason: "LICHESS_PREMOVE_SCHEDULED",
        };
      }
    }

    // Active turn input mode: click vs drag weighted by clock pressure
    const mode: InputMode = rng() < clickProb ? "click" : "drag";
    return {
      enabled: true,
      inputMode: mode,
      effectiveClickProbability: clickProb,
      effectiveDragProbability: dragProb,
      premoveMissFallbackRate: cal.premoveMissFallbackRate,
      premoveScheduled: false,
      premoveMissFallbackApplied: false,
      scheduledPremoveUci: null,
      reason:
        context.remainingClockMs !== null &&
        context.remainingClockMs < this.config.lowTimeShiftStartMs
          ? "LOW_TIME_CLICK_SHIFTED"
          : "NORMAL_TIME_WEIGHTED",
    };
  }
}

export interface ScheduledLichessPremove {
  readonly uci: string;
  readonly from: SquareName;
  readonly to: SquareName;
  readonly scheduledAtMs: number;
  readonly executedResult?: PointerExecutionResult;
}

export interface LichessPremoveTelemetry {
  readonly scheduledCount: number;
  readonly fallbackMissCount: number;
  readonly clearedCount: number;
  readonly activePremove: ScheduledLichessPremove | null;
}

/**
 * Coordinates speculative Lichess premove dispatch & cancellation via KinematicPointerExecutor.
 */
export class LichessPremoveScheduler {
  private readonly controller: InputModeController;
  private readonly executor: KinematicPointerExecutor;
  private activePremove: ScheduledLichessPremove | null = null;
  private scheduledCount = 0;
  private fallbackMissCount = 0;
  private clearedCount = 0;

  constructor(
    controller: InputModeController,
    executor: KinematicPointerExecutor
  ) {
    this.controller = controller;
    this.executor = executor;
  }

  getTelemetry(): LichessPremoveTelemetry {
    return {
      scheduledCount: this.scheduledCount,
      fallbackMissCount: this.fallbackMissCount,
      clearedCount: this.clearedCount,
      activePremove: this.activePremove,
    };
  }

  clearActivePremove(): void {
    if (this.activePremove) {
      this.activePremove = null;
      this.clearedCount++;
    }
  }

  /**
   * Attempts to queue a speculative Lichess premove during the opponent's turn
   * subject to rating-calibrated attempt & miss/fallback probabilities.
   */
  async trySchedulePremove(params: {
    readonly targetElo: number;
    readonly remainingClockMs: number | null;
    readonly candidateUci: string;
    readonly isObviousRecaptureOrForced?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly decision: InputModeDecision;
    readonly executed: PointerExecutionResult | null;
  }> {
    const decision = this.controller.selectInputMode({
      targetElo: params.targetElo,
      remainingClockMs: params.remainingClockMs,
      isOpponentTurn: true,
      isObviousRecaptureOrForced: params.isObviousRecaptureOrForced,
      candidatePremoveUci: params.candidateUci,
    });

    if (decision.premoveMissFallbackApplied) {
      this.fallbackMissCount++;
      this.activePremove = null;
      return { decision, executed: null };
    }

    if (!decision.premoveScheduled || !decision.scheduledPremoveUci) {
      return { decision, executed: null };
    }

    const squares = parseUciMoveSquares(decision.scheduledPremoveUci);
    if (!squares) {
      return { decision, executed: null };
    }

    // Lichess accepts queued premoves via fast click or drag across the board during opponent's turn
    const modeForQueue = decision.effectiveClickProbability >= 0.5 ? "click" : "drag";
    const result = await this.executor.executeMove(squares.from, squares.to, {
      signal: params.signal,
      interactionModeOverride: modeForQueue,
    });

    if (result.executed && !result.aborted) {
      this.scheduledCount++;
      this.activePremove = {
        uci: decision.scheduledPremoveUci,
        from: squares.from,
        to: squares.to,
        scheduledAtMs: Date.now(),
        executedResult: result,
      };
    }

    return { decision, executed: result };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
