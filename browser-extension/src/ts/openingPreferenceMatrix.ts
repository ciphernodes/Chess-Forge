/**
 * Opening Preference Matrices & Gradual Rating Calibration (`openingPreferenceMatrix.ts`).
 *
 * Implements:
 * 1. Rating-conditioned opening repertoire preference matrices for 1200, 1600, and 2000 profiles:
 *    - 1200: Italian Game (C50), Scotch Game (C45), classical straightforward development.
 *    - 1600: Queen's Gambit Declined (D30/D06), Sicilian Najdorf (B90), classical/sharp mainlines.
 *    - 2000: Berlin Defense (C65/C67), Grünfeld Defense (D80), master-tier dynamic/positional systems.
 * 2. Gradual rating calibrator starting at `userCurrentRating + 50`, ramping smoothly over 100 games,
 *    and strictly clamping single-session rating jumps below 300 Elo points.
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { EloPresetId, PieceColor } from "./autoPlayPorts.ts";
import type { BookMoveCandidate } from "./bookAndTablebaseRouter.ts";

export interface RepertoireAffinityRule {
  readonly id: string;
  readonly label: string;
  readonly side: PieceColor;
  readonly ecoPrefixes: readonly string[];
  readonly openingKeywords: readonly string[];
  readonly preferredMoveUcis: readonly string[];
  /** Optional move prefix context (sequence of prior UCI moves) to identify opening transitions cleanly. */
  readonly requiredHistoryPrefixes?: readonly (readonly string[])[];
  /** Multiplicative weight applied when position/move matches this repertoire entry. */
  readonly weightMultiplier: number;
}

export interface RatingRepertoireProfile {
  readonly elo: EloPresetId;
  readonly name: string;
  readonly rules: readonly RepertoireAffinityRule[];
}

export const RATING_REPERTOIRE_MATRICES: Readonly<Record<EloPresetId, RatingRepertoireProfile>> = {
  1200: {
    elo: 1200,
    name: "Club Novice Opening Repertoire (Italian, Scotch)",
    rules: [
      {
        id: "1200_white_e4_start",
        label: "Open Game (1.e4)",
        side: "w",
        ecoPrefixes: ["A00", "C20", "C40", "C44", "C45", "C50"],
        openingKeywords: ["starting", "italian", "scotch", "open game"],
        preferredMoveUcis: ["e2e4"],
        weightMultiplier: 1.55,
      },
      {
        id: "1200_white_italian",
        label: "Italian Game (3.Bc4)",
        side: "w",
        ecoPrefixes: ["C50", "C51", "C52", "C53", "C54", "C44", "C20"],
        openingKeywords: ["italian", "king's knight"],
        preferredMoveUcis: ["f1c4"],
        requiredHistoryPrefixes: [["e2e4", "e7e5", "g1f3", "b8c6"]],
        weightMultiplier: 2.35,
      },
      {
        id: "1200_white_scotch",
        label: "Scotch Game (3.d4)",
        side: "w",
        ecoPrefixes: ["C45", "C44"],
        openingKeywords: ["scotch", "king's knight"],
        preferredMoveUcis: ["d2d4"],
        requiredHistoryPrefixes: [["e2e4", "e7e5", "g1f3", "b8c6"]],
        weightMultiplier: 2.1,
      },
      {
        id: "1200_black_e5_solid",
        label: "Double King's Pawn (1...e5 & 3...Bc5)",
        side: "b",
        ecoPrefixes: ["B00", "C50"],
        openingKeywords: ["king's pawn", "italian"],
        preferredMoveUcis: ["e7e5", "f8c5"],
        weightMultiplier: 1.85,
      },
      {
        id: "1200_black_d5_solid",
        label: "Symmetrical Queen's Pawn (1...d5)",
        side: "b",
        ecoPrefixes: ["A40", "D06"],
        openingKeywords: ["queen's pawn", "queen's gambit"],
        preferredMoveUcis: ["d7d5", "e7e6"],
        weightMultiplier: 1.45,
      },
    ],
  },
  1600: {
    elo: 1600,
    name: "Intermediate Repertoire (QGD, Sicilian Najdorf)",
    rules: [
      {
        id: "1600_white_qgd_setup",
        label: "Queen's Gambit Setup (1.d4 / 2.c4)",
        side: "w",
        ecoPrefixes: ["A00", "A40", "D06", "D30", "D35", "D37"],
        openingKeywords: ["starting", "queen's gambit", "queen's pawn"],
        preferredMoveUcis: ["d2d4", "c2c4"],
        weightMultiplier: 1.95,
      },
      {
        id: "1600_black_qgd",
        label: "Queen's Gambit Declined (2...e6 / ...Nf6 / ...d5)",
        side: "b",
        ecoPrefixes: ["A40", "D06", "D30", "D31", "D35", "D37"],
        openingKeywords: ["queen's gambit", "queen's pawn"],
        preferredMoveUcis: ["d7d5", "e7e6", "g8f6"],
        weightMultiplier: 2.1,
      },
      {
        id: "1600_black_najdorf",
        label: "Sicilian Najdorf (1...c5 / 2...d6 / 5...a6)",
        side: "b",
        ecoPrefixes: ["B00", "B20", "B27", "B90", "B92", "B96"],
        openingKeywords: ["king's pawn", "sicilian", "najdorf"],
        preferredMoveUcis: ["c7c5", "d7d6", "a7a6"],
        weightMultiplier: 2.4,
      },
      {
        id: "1600_white_open_sicilian",
        label: "Open Sicilian (2.Nf3 / 3.d4)",
        side: "w",
        ecoPrefixes: ["B20", "B27", "B90"],
        openingKeywords: ["sicilian", "najdorf"],
        preferredMoveUcis: ["g1f3", "d2d4"],
        weightMultiplier: 1.75,
      },
    ],
  },
  2000: {
    elo: 2000,
    name: "Expert Repertoire (Berlin, Grünfeld)",
    rules: [
      {
        id: "2000_black_berlin",
        label: "Berlin Defense (3...Nf6 vs Bb5)",
        side: "b",
        ecoPrefixes: ["C60", "C65", "C67"],
        openingKeywords: ["ruy lopez", "berlin"],
        preferredMoveUcis: ["g8f6", "f6e4"],
        requiredHistoryPrefixes: [["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"]],
        weightMultiplier: 2.75,
      },
      {
        id: "2000_white_spanish_or_d4",
        label: "Ruy Lopez / Queen's Gambit (3.Bb5 / 1.d4)",
        side: "w",
        ecoPrefixes: ["A00", "C44", "C60", "C65", "C67", "D06", "D80"],
        openingKeywords: ["starting", "ruy lopez", "berlin", "grünfeld", "grunfeld", "king's knight"],
        preferredMoveUcis: ["f1b5", "d2d4", "c2c4"],
        weightMultiplier: 2.05,
      },
      {
        id: "2000_black_grunfeld",
        label: "Grünfeld Defense (1...Nf6 / 2...g6 / 3...d5)",
        side: "b",
        ecoPrefixes: ["A40", "D80", "D85", "D87", "D90"],
        openingKeywords: ["queen's pawn", "grünfeld", "grunfeld", "indian"],
        preferredMoveUcis: ["g8f6", "g7g6", "d7d5"],
        weightMultiplier: 2.6,
      },
      {
        id: "2000_black_e5_or_c5",
        label: "Berlin / Najdorf Preparation (1...e5 or 1...c5)",
        side: "b",
        ecoPrefixes: ["B00", "C40"],
        openingKeywords: ["king's pawn", "king's knight"],
        preferredMoveUcis: ["e7e5", "b8c6", "c7c5"],
        weightMultiplier: 1.65,
      },
    ],
  },
};

export interface OpeningPreferenceConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing behavior. */
  readonly enabled: boolean;
  /** Number of top weighted book candidates to consider when sampling (default 3). */
  readonly topK: number;
  /** Weight blending strength in [0, 1] (default 1.0 = full matrix scaling when enabled). */
  readonly blendStrength: number;
  /** Deterministic RNG hook for testing. */
  readonly randomFn?: () => number;
}

export const DEFAULT_OPENING_PREFERENCE_CONFIG: OpeningPreferenceConfig = {
  enabled: false,
  topK: 3,
  blendStrength: 1.0,
};

export interface OpeningWeightContext {
  readonly targetElo: number;
  readonly turn: PieceColor;
  readonly eco?: string;
  readonly openingName?: string;
  readonly historyUcis?: readonly string[];
}

export interface WeightedBookMove {
  readonly candidate: BookMoveCandidate;
  readonly baseWeight: number;
  readonly repertoireMultiplier: number;
  readonly matchedRuleIds: readonly string[];
  readonly finalWeight: number;
  readonly probability: number;
}

export interface OpeningSamplingResult {
  readonly selected: BookMoveCandidate | null;
  readonly weightedCandidates: readonly WeightedBookMove[];
  readonly weights: ReadonlyMap<string, number>;
}

/**
 * Selects opening preference profile multipliers conditioned on target rating (1200, 1600, 2000).
 * Defaults to `enabled: false` (identity multiplier 1.0).
 */
export class OpeningPreferenceEngine {
  private config: OpeningPreferenceConfig;

  constructor(config: Partial<OpeningPreferenceConfig> = {}) {
    this.config = {
      ...DEFAULT_OPENING_PREFERENCE_CONFIG,
      ...config,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getConfig(): OpeningPreferenceConfig {
    return this.config;
  }

  updateConfig(partial: Partial<OpeningPreferenceConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Resolves the closest canonical rating profile (or interpolated weights between adjacent brackets).
   */
  getProfileBracket(targetElo: number): RatingRepertoireProfile {
    if (targetElo < 1400) return RATING_REPERTOIRE_MATRICES[1200];
    if (targetElo < 1800) return RATING_REPERTOIRE_MATRICES[1600];
    return RATING_REPERTOIRE_MATRICES[2000];
  }

  /**
   * Weights book candidates using W/D/B win-rate + game frequency modulated by
   * rating-conditioned opening preference matrices.
   */
  weightBookCandidates(
    moves: readonly BookMoveCandidate[],
    context: OpeningWeightContext
  ): readonly WeightedBookMove[] {
    const pool = moves.slice(0, Math.max(1, Math.min(4, this.config.topK)));
    if (pool.length === 0) return [];

    const maxGames = Math.max(1, ...pool.map((m) => Math.max(1, m.games)));
    const ecoUpper = (context.eco ?? "").trim().toUpperCase();
    const openingLower = (context.openingName ?? "").trim().toLowerCase();
    const historyNorm = (context.historyUcis ?? []).map((u) => u.trim().toLowerCase());

    const raw = pool.map((m) => {
      const total = Math.max(1, m.white + m.draws + m.black);
      const winScore = context.turn === "w" ? m.white : m.black;
      const wdbExpectedRate = (winScore + 0.5 * m.draws) / total;
      const freqFactor = Math.sqrt(Math.max(1, m.games) / maxGames);
      const baseWeight = Math.max(
        0.01,
        Math.pow(wdbExpectedRate, 2) * (0.45 + 0.55 * freqFactor)
      );

      if (!this.config.enabled) {
        return {
          candidate: m,
          baseWeight,
          repertoireMultiplier: 1.0,
          matchedRuleIds: [] as string[],
          finalWeight: baseWeight,
        };
      }

      const { multiplier, matchedIds } = this.computeInterpolatedMultiplier(
        m.uci,
        context.targetElo,
        context.turn,
        ecoUpper,
        openingLower,
        historyNorm
      );

      const strength = clamp(this.config.blendStrength, 0, 1);
      const effectiveMultiplier = 1 + (multiplier - 1) * strength;
      const finalWeight = Math.max(1e-4, baseWeight * effectiveMultiplier);

      return {
        candidate: m,
        baseWeight,
        repertoireMultiplier: Number(effectiveMultiplier.toFixed(4)),
        matchedRuleIds: matchedIds,
        finalWeight,
      };
    });

    const sum = raw.reduce((acc, r) => acc + r.finalWeight, 0) || 1;
    return raw.map((r) => ({
      ...r,
      probability: r.finalWeight / sum,
    }));
  }

  samplePreferredBookMove(
    moves: readonly BookMoveCandidate[],
    context: OpeningWeightContext,
    rngOverride?: () => number
  ): OpeningSamplingResult {
    const weightedCandidates = this.weightBookCandidates(moves, context);
    const weights = new Map<string, number>();
    if (weightedCandidates.length === 0) {
      return { selected: null, weightedCandidates: [], weights };
    }

    for (const item of weightedCandidates) {
      weights.set(item.candidate.uci, item.probability);
    }

    const rng = rngOverride ?? this.config.randomFn ?? Math.random;
    const roll = clamp(rng(), 0, 0.9999999);
    let cum = 0;
    let chosen = weightedCandidates[0].candidate;
    for (const item of weightedCandidates) {
      cum += item.probability;
      if (roll <= cum) {
        chosen = item.candidate;
        break;
      }
    }

    return {
      selected: chosen,
      weightedCandidates,
      weights,
    };
  }

  private computeInterpolatedMultiplier(
    moveUci: string,
    targetElo: number,
    turn: PieceColor,
    ecoUpper: string,
    openingLower: string,
    historyNorm: readonly string[]
  ): { readonly multiplier: number; readonly matchedIds: readonly string[] } {
    const clampedElo = clamp(targetElo, 1200, 2000);
    if (clampedElo <= 1200) {
      return evalBracketMultiplier(
        RATING_REPERTOIRE_MATRICES[1200],
        moveUci,
        turn,
        ecoUpper,
        openingLower,
        historyNorm
      );
    }
    if (clampedElo === 1600) {
      return evalBracketMultiplier(
        RATING_REPERTOIRE_MATRICES[1600],
        moveUci,
        turn,
        ecoUpper,
        openingLower,
        historyNorm
      );
    }
    if (clampedElo >= 2000) {
      return evalBracketMultiplier(
        RATING_REPERTOIRE_MATRICES[2000],
        moveUci,
        turn,
        ecoUpper,
        openingLower,
        historyNorm
      );
    }

    const lowBracket =
      clampedElo < 1600
        ? RATING_REPERTOIRE_MATRICES[1200]
        : RATING_REPERTOIRE_MATRICES[1600];
    const highBracket =
      clampedElo < 1600
        ? RATING_REPERTOIRE_MATRICES[1600]
        : RATING_REPERTOIRE_MATRICES[2000];
    const alpha =
      clampedElo < 1600 ? (clampedElo - 1200) / 400 : (clampedElo - 1600) / 400;

    const lowRes = evalBracketMultiplier(
      lowBracket,
      moveUci,
      turn,
      ecoUpper,
      openingLower,
      historyNorm
    );
    const highRes = evalBracketMultiplier(
      highBracket,
      moveUci,
      turn,
      ecoUpper,
      openingLower,
      historyNorm
    );

    const blended = lowRes.multiplier * (1 - alpha) + highRes.multiplier * alpha;
    const ids = Array.from(new Set([...lowRes.matchedIds, ...highRes.matchedIds]));
    return { multiplier: blended, matchedIds: ids };
  }
}

function evalBracketMultiplier(
  profile: RatingRepertoireProfile,
  moveUci: string,
  turn: PieceColor,
  ecoUpper: string,
  openingLower: string,
  historyNorm: readonly string[]
): { readonly multiplier: number; readonly matchedIds: readonly string[] } {
  const normUci = moveUci.trim().toLowerCase();
  let bestMultiplier = 1.0;
  const matchedIds: string[] = [];

  for (const rule of profile.rules) {
    if (rule.side !== turn) continue;
    if (!rule.preferredMoveUcis.includes(normUci)) continue;

    let contextMatches = false;

    if (rule.requiredHistoryPrefixes && rule.requiredHistoryPrefixes.length > 0) {
      const historyMatched = rule.requiredHistoryPrefixes.some((prefix) =>
        matchesHistoryPrefix(historyNorm, prefix)
      );
      if (historyMatched) {
        contextMatches = true;
      }
    }

    if (!contextMatches && ecoUpper) {
      if (rule.ecoPrefixes.some((prefix) => ecoUpper.startsWith(prefix))) {
        contextMatches = true;
      }
    }

    if (!contextMatches && openingLower) {
      if (rule.openingKeywords.some((kw) => openingLower.includes(kw))) {
        contextMatches = true;
      }
    }

    if (!contextMatches && !ecoUpper && !openingLower && historyNorm.length === 0) {
      // Starting position or bare FEN without ECO metadata: match general opening rule
      if (rule.ecoPrefixes.includes("A00") || rule.ecoPrefixes.includes("B00") || rule.ecoPrefixes.includes("A40")) {
        contextMatches = true;
      }
    }

    if (contextMatches) {
      matchedIds.push(rule.id);
      if (rule.weightMultiplier > bestMultiplier) {
        bestMultiplier = rule.weightMultiplier;
      }
    }
  }

  return { multiplier: bestMultiplier, matchedIds };
}

function matchesHistoryPrefix(
  history: readonly string[],
  prefix: readonly string[]
): boolean {
  if (history.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (history[i] !== prefix[i]) return false;
  }
  return true;
}

/**
 * Gradual Rating Calibrator:
 * - Starts effective rating at `userCurrentRating + 50`
 * - Smoothly ramps over `100` games toward `targetElo`
 * - Strictly clamps single-session rating jumps below `300` points (`<= 299`).
 *
 * Defaults to `enabled: false` (explicit opt-in).
 */
export interface GradualRatingCalibratorConfig {
  /** Explicit opt-in flag; defaults to false to preserve static targetElo presets. */
  readonly enabled: boolean;
  readonly userCurrentRating: number;
  readonly targetElo: number;
  readonly initialOffset: number;
  readonly rampGames: number;
  /** Strictly enforced < 300 (capped at 299). */
  readonly maxSingleSessionJump: number;
  readonly initialGamesCompleted?: number;
}

export const DEFAULT_GRADUAL_CALIBRATOR_CONFIG: GradualRatingCalibratorConfig = {
  enabled: false,
  userCurrentRating: 1200,
  targetElo: 1600,
  initialOffset: 50,
  rampGames: 100,
  maxSingleSessionJump: 299,
};

export interface RatingCalibrationSnapshot {
  readonly enabled: boolean;
  readonly userCurrentRating: number;
  readonly targetElo: number;
  readonly sessionAnchorRating: number;
  readonly effectiveRating: number;
  readonly gamesCompleted: number;
  readonly rampGames: number;
  readonly progressRatio: number;
  readonly clampedBySessionLimit: boolean;
}

export class GradualRatingCalibrator {
  private config: GradualRatingCalibratorConfig;
  private gamesCompleted: number;
  private sessionAnchorRating: number;
  private lastClamped = false;

  constructor(config: Partial<GradualRatingCalibratorConfig> = {}) {
    const mergedJump = Math.min(299, Math.max(1, Math.round(config.maxSingleSessionJump ?? 299)));
    this.config = {
      ...DEFAULT_GRADUAL_CALIBRATOR_CONFIG,
      ...config,
      maxSingleSessionJump: mergedJump,
    };
    this.gamesCompleted = Math.max(0, Math.round(config.initialGamesCompleted ?? 0));
    this.sessionAnchorRating = this.computeStartAnchor();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  startNewSession(updatedUserRating?: number): void {
    const currentEffective = this.getEffectiveRating();
    if (typeof updatedUserRating === "number" && Number.isFinite(updatedUserRating)) {
      this.config = {
        ...this.config,
        userCurrentRating: clamp(Math.round(updatedUserRating), 400, 3000),
      };
      this.sessionAnchorRating = currentEffective;
    } else {
      this.sessionAnchorRating = currentEffective;
    }
  }

  updateTargetElo(targetElo: number): void {
    this.config = {
      ...this.config,
      targetElo: clamp(Math.round(targetElo), 400, 3000),
    };
  }

  recordGamesCompleted(count: number = 1): RatingCalibrationSnapshot {
    if (count > 0) {
      this.gamesCompleted += Math.round(count);
    }
    return this.getSnapshot();
  }

  getEffectiveRating(): number {
    if (!this.config.enabled) {
      return this.config.targetElo;
    }

    const startRating = this.computeStartAnchor();
    const ramp = Math.max(1, this.config.rampGames);
    const t = clamp(this.gamesCompleted / ramp, 0, 1);
    // Smoothstep interpolation: starts exactly at userCurrentRating + 50 (at t=0) and reaches targetElo at t=1
    const smoothT = t * t * (3 - 2 * t);
    const uncapped = startRating + (this.config.targetElo - startRating) * smoothT;

    const maxJump = Math.min(299, Math.max(1, this.config.maxSingleSessionJump));
    const deltaFromAnchor = uncapped - this.sessionAnchorRating;
    let clampedRating = uncapped;
    if (Math.abs(deltaFromAnchor) > maxJump) {
      this.lastClamped = true;
      clampedRating =
        this.sessionAnchorRating + Math.sign(deltaFromAnchor) * maxJump;
    } else {
      this.lastClamped = false;
    }

    return Math.round(clamp(clampedRating, 400, 3000));
  }

  getSnapshot(): RatingCalibrationSnapshot {
    const ramp = Math.max(1, this.config.rampGames);
    const effectiveRating = this.getEffectiveRating();
    return {
      enabled: this.config.enabled,
      userCurrentRating: this.config.userCurrentRating,
      targetElo: this.config.targetElo,
      sessionAnchorRating: this.sessionAnchorRating,
      effectiveRating,
      gamesCompleted: this.gamesCompleted,
      rampGames: ramp,
      progressRatio: Number(clamp(this.gamesCompleted / ramp, 0, 1).toFixed(4)),
      clampedBySessionLimit: this.lastClamped,
    };
  }

  private computeStartAnchor(): number {
    return clamp(
      Math.round(this.config.userCurrentRating + this.config.initialOffset),
      400,
      3000
    );
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
