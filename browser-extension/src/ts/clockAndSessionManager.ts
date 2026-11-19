/**
 * Monotonic Clock Defense, Time Controls & Session Pacing (`clockAndSessionManager.ts`).
 *
 * Implements:
 * 1. Authoritative `MonotonicClockTracker` reconstructing white/black clocks via
 *    high-resolution `performance.now()` anchored to move timestamps. Never uses DOM
 *    clock text strings for scheduling logic (stores DOM text strictly as display-only metadata).
 * 2. Effective time formula `remainingMs + incrementMs * 0.6` and separate time-trouble
 *    compression curves for increment vs non-increment time controls.
 * 3. `SessionPacingManager`:
 *    - Opening minimums: Move 1 [3,000–8,000 ms], Moves 2–5 [2,000–5,000 ms], natural taper after.
 *    - Opponent Elo correlation (longer vs higher rated) & local 00:00–06:00 circadian slowdown.
 *    - Think-time sufficiency model `minimumTime = f(depthRequired, positionComplexity)`
 *      flagging repeated `elapsedMs < minimumTime * 0.7` anomalies.
 *    - Time-control risk classification (bullet/blitz recommended; classical -300 Elo step-down).
 *    - Session/daily limits (max 30 games/day, max 4h session, mandatory 2h cooldown).
 *    - Post-game analysis review simulation (30–120s between games).
 *    - Optional rate-limited chat dispatcher ("gl hf", "gg", sparse mid-game), disabled by default.
 *
 * All components default to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type {
  ClockStatePort,
  ClockStateSnapshot,
  PieceColor,
} from "./autoPlayPorts.ts";

export interface MonotonicClockTrackerConfig {
  /** Explicit opt-in flag; defaults to false to preserve legacy ClockStatePort behavior. */
  readonly enabled: boolean;
  readonly initialWhiteMs: number;
  readonly initialBlackMs: number;
  readonly incrementMs: number;
  readonly activeTurn: PieceColor;
  /** Injectable high-res monotonic clock source (defaults to `performance.now()`). */
  readonly nowMonotonicMs?: () => number;
}

export interface DisplayClockLabels {
  readonly whiteDisplayText: string | null;
  readonly blackDisplayText: string | null;
}

export interface TimeTroubleCurveResult {
  readonly mode: "INCREMENT" | "NO_INCREMENT";
  readonly rawRemainingMs: number;
  readonly incrementMs: number;
  readonly effectiveTimeMs: number;
  readonly compressionFactor: number;
  readonly depthScaleFactor: number;
  readonly recommendedFloorMs: number;
}

/**
 * Computes effective remaining time factoring in increment regeneration:
 * `effectiveTime = remainingMs + incrementMs * 0.6`.
 */
export function computeEffectiveTimeMs(
  remainingMs: number,
  incrementMs: number
): number {
  const safeRemaining = Math.max(0, remainingMs);
  const safeInc = Math.max(0, incrementMs);
  return Math.round(safeRemaining + safeInc * 0.6);
}

/**
 * Applies distinct time-trouble compression curves for increment (`incrementMs > 0`)
 * vs sudden-death non-increment (`incrementMs === 0`) time controls.
 */
export function computeTimeControlTroubleCurve(
  remainingMs: number,
  incrementMs: number
): TimeTroubleCurveResult {
  const safeRemaining = Math.max(0, remainingMs);
  const safeInc = Math.max(0, incrementMs);
  const effectiveTimeMs = computeEffectiveTimeMs(safeRemaining, safeInc);

  if (safeInc > 0) {
    // Increment curve: relies smoothly on increment regeneration; softer asymptotic floor
    const pivotMs = 15_000 + safeInc * 2;
    const rawRatio = effectiveTimeMs / (effectiveTimeMs + pivotMs);
    const compressionFactor = clamp(0.28 + 0.72 * rawRatio, 0.28, 1.0);
    const depthScaleFactor = clamp(0.55 + 0.45 * rawRatio, 0.55, 1.0);
    const recommendedFloorMs = Math.max(
      180,
      Math.round(Math.min(900, safeInc * 0.35 + 140))
    );
    return {
      mode: "INCREMENT",
      rawRemainingMs: Math.round(safeRemaining),
      incrementMs: Math.round(safeInc),
      effectiveTimeMs,
      compressionFactor: Number(compressionFactor.toFixed(4)),
      depthScaleFactor: Number(depthScaleFactor.toFixed(4)),
      recommendedFloorMs,
    };
  }

  // Non-increment curve: steeper exponential decay below 45s / 15s to avoid flagging
  let compressionFactor = 1.0;
  let depthScaleFactor = 1.0;
  if (safeRemaining < 45_000) {
    if (safeRemaining < 15_000) {
      const ratio = clamp(safeRemaining / 15_000, 0, 1);
      compressionFactor = 0.12 + 0.24 * Math.pow(ratio, 1.35);
      depthScaleFactor = 0.38 + 0.27 * ratio;
    } else {
      const ratio = clamp((safeRemaining - 15_000) / 30_000, 0, 1);
      compressionFactor = 0.36 + 0.64 * Math.pow(ratio, 1.15);
      depthScaleFactor = 0.65 + 0.35 * ratio;
    }
  }

  return {
    mode: "NO_INCREMENT",
    rawRemainingMs: Math.round(safeRemaining),
    incrementMs: 0,
    effectiveTimeMs,
    compressionFactor: Number(compressionFactor.toFixed(4)),
    depthScaleFactor: Number(depthScaleFactor.toFixed(4)),
    recommendedFloorMs: 120,
  };
}

/**
 * Authoritative monotonic clock tracker anchored to move timestamps via `performance.now()`.
 * Strictly separates scheduling math from DOM display text.
 */
export class MonotonicClockTracker implements ClockStatePort {
  private enabled: boolean;
  private readonly nowMonotonicMs: () => number;
  private whiteBaseMs: number;
  private blackBaseMs: number;
  private incrementMs: number;
  private activeTurn: PieceColor;
  private turnAnchoredAtMs: number;
  private displayLabels: DisplayClockLabels = {
    whiteDisplayText: null,
    blackDisplayText: null,
  };

  constructor(config: Partial<MonotonicClockTrackerConfig> = {}) {
    this.enabled = config.enabled ?? false;
    this.nowMonotonicMs =
      config.nowMonotonicMs ??
      (() =>
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now());
    this.whiteBaseMs = Math.max(0, config.initialWhiteMs ?? 300_000);
    this.blackBaseMs = Math.max(0, config.initialBlackMs ?? 300_000);
    this.incrementMs = Math.max(0, config.incrementMs ?? 0);
    this.activeTurn = config.activeTurn ?? "w";
    this.turnAnchoredAtMs = this.nowMonotonicMs();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
  }

  /**
   * Re-initializes both clocks for a new game anchored to current monotonic timestamp.
   */
  initializeGame(params: {
    readonly initialTimeMs: number;
    readonly blackInitialTimeMs?: number;
    readonly incrementMs?: number;
    readonly activeTurn?: PieceColor;
    readonly displayLabels?: Partial<DisplayClockLabels>;
  }): void {
    this.whiteBaseMs = Math.max(0, params.initialTimeMs);
    this.blackBaseMs = Math.max(
      0,
      params.blackInitialTimeMs ?? params.initialTimeMs
    );
    this.incrementMs = Math.max(0, params.incrementMs ?? 0);
    this.activeTurn = params.activeTurn ?? "w";
    this.turnAnchoredAtMs = this.nowMonotonicMs();
    if (params.displayLabels) {
      this.setDisplayClockLabels(params.displayLabels);
    }
  }

  /**
   * Stores DOM clock text strictly as display-only metadata; never parsed for scheduling.
   */
  setDisplayClockLabels(labels: Partial<DisplayClockLabels>): void {
    this.displayLabels = {
      whiteDisplayText:
        labels.whiteDisplayText !== undefined
          ? labels.whiteDisplayText
          : this.displayLabels.whiteDisplayText,
      blackDisplayText:
        labels.blackDisplayText !== undefined
          ? labels.blackDisplayText
          : this.displayLabels.blackDisplayText,
    };
  }

  getDisplayClockLabels(): DisplayClockLabels {
    return this.displayLabels;
  }

  /**
   * Anchors a completed move transition cleanly using monotonic elapsed duration,
   * deducting active elapsed time from `moverSide`, adding `incrementMs`, and starting
   * the opponent's monotonic clock.
   */
  recordMoveTimestamp(
    moverSide: PieceColor,
    displayLabels?: Partial<DisplayClockLabels>
  ): {
    readonly elapsedMs: number;
    readonly snapshot: ClockStateSnapshot;
  } {
    const now = this.nowMonotonicMs();
    const elapsedMs = Math.max(0, now - this.turnAnchoredAtMs);

    if (moverSide === "w") {
      this.whiteBaseMs = Math.max(0, this.whiteBaseMs - elapsedMs) + this.incrementMs;
      this.activeTurn = "b";
    } else {
      this.blackBaseMs = Math.max(0, this.blackBaseMs - elapsedMs) + this.incrementMs;
      this.activeTurn = "w";
    }
    this.turnAnchoredAtMs = now;

    if (displayLabels) {
      this.setDisplayClockLabels(displayLabels);
    }

    return {
      elapsedMs: Math.round(elapsedMs),
      snapshot: this.readClockState(this.activeTurn),
    };
  }

  /**
   * Authoritative ClockStatePort implementation derived purely from `performance.now()`.
   */
  readClockState(turn: PieceColor): ClockStateSnapshot {
    const now = this.nowMonotonicMs();
    const runningElapsed = Math.max(0, now - this.turnAnchoredAtMs);

    const whiteRemainingMs = Math.round(
      this.activeTurn === "w"
        ? Math.max(0, this.whiteBaseMs - runningElapsed)
        : this.whiteBaseMs
    );
    const blackRemainingMs = Math.round(
      this.activeTurn === "b"
        ? Math.max(0, this.blackBaseMs - runningElapsed)
        : this.blackBaseMs
    );

    return {
      whiteRemainingMs,
      blackRemainingMs,
      activeRemainingMs: turn === "w" ? whiteRemainingMs : blackRemainingMs,
      incrementMs: this.incrementMs,
      capturedAtMs: Math.round(now),
    };
  }

  getEffectiveTimeMs(turn: PieceColor): number {
    const snap = this.readClockState(turn);
    return computeEffectiveTimeMs(
      snap.activeRemainingMs ?? 0,
      snap.incrementMs ?? this.incrementMs
    );
  }

  getTimeControlCurve(turn: PieceColor): TimeTroubleCurveResult {
    const snap = this.readClockState(turn);
    return computeTimeControlTroubleCurve(
      snap.activeRemainingMs ?? 0,
      snap.incrementMs ?? this.incrementMs
    );
  }
}

export type TimeControlCategory = "bullet" | "blitz" | "rapid" | "classical";

export interface TimeControlClassification {
  readonly category: TimeControlCategory;
  readonly estimatedTotalMs: number;
  readonly isRecommended: boolean;
  readonly eloStepDown: number;
  readonly warningReason: string | null;
}

export interface ThinkTimeSufficiencyCheck {
  readonly elapsedMs: number;
  readonly minimumRequiredMs: number;
  readonly warningThresholdMs: number;
  readonly isInsufficient: boolean;
  readonly consecutiveInsufficientCount: number;
  readonly totalInsufficientCount: number;
  readonly anomalyFlagged: boolean;
}

export interface SessionCapDecision {
  readonly allowed: boolean;
  readonly reason: "OK" | "DAILY_GAME_LIMIT" | "SESSION_DURATION_LIMIT" | "COOLDOWN_ACTIVE";
  readonly gamesPlayedToday: number;
  readonly maxGamesPerDay: number;
  readonly sessionElapsedMs: number;
  readonly cooldownRemainingMs: number;
}

export interface ChatDispatchConfig {
  /** Explicit opt-in flag; defaults to false. */
  readonly enabled: boolean;
  readonly maxMidGameMessagesPerGame: number;
  readonly minCooldownBetweenMessagesMs: number;
  readonly midGameTriggerProbability: number;
}

export interface ChatDispatchPlan {
  readonly send: boolean;
  readonly message: string | null;
  readonly trigger: "GAME_START" | "MID_GAME" | "GAME_END";
  readonly reason: string;
}

export interface SessionPacingConfig {
  /** Explicit opt-in flag; defaults to false to preserve backward compatibility. */
  readonly enabled: boolean;
  /** Maximum games permitted per 24h rolling day (default 30). */
  readonly maxGamesPerDay: number;
  /** Maximum continuous session duration in ms (default 4 hours = 14,400,000 ms). */
  readonly maxSessionDurationMs: number;
  /** Mandatory cooldown duration in ms after hitting session/daily limits (default 2 hours = 7,200,000 ms). */
  readonly mandatoryCooldownMs: number;
  /** Move 1 minimum pacing range in ms [3000, 8000]. */
  readonly move1MinMs: number;
  readonly move1MaxMs: number;
  /** Moves 2–5 minimum pacing range in ms [2000, 5000]. */
  readonly moves2To5MinMs: number;
  readonly moves2To5MaxMs: number;
  /** Post-game review wait range in ms [30000, 120000]. */
  readonly postGameReviewMinMs: number;
  readonly postGameReviewMaxMs: number;
  /** Repeated consecutive/total <0.7x sufficiency anomalies before flagging (default 3). */
  readonly repeatedSufficiencyAnomalyLimit: number;
  /** Elo step-down in classical time controls (default 300). */
  readonly classicalEloStepDown: number;
  /** Optional chat settings (defaults to enabled: false). */
  readonly chat: ChatDispatchConfig;
  /** Injectable time & RNG hooks for deterministic tests. */
  readonly nowWallMs?: () => number;
  readonly getLocalHour?: () => number;
  readonly randomFn?: () => number;
  readonly onSufficiencyAnomaly?: (check: ThinkTimeSufficiencyCheck) => void;
}

export const DEFAULT_SESSION_PACING_CONFIG: SessionPacingConfig = {
  enabled: false,
  maxGamesPerDay: 30,
  maxSessionDurationMs: 4 * 60 * 60 * 1000,
  mandatoryCooldownMs: 2 * 60 * 60 * 1000,
  move1MinMs: 3_000,
  move1MaxMs: 8_000,
  moves2To5MinMs: 2_000,
  moves2To5MaxMs: 5_000,
  postGameReviewMinMs: 30_000,
  postGameReviewMaxMs: 120_000,
  repeatedSufficiencyAnomalyLimit: 3,
  classicalEloStepDown: 300,
  chat: {
    enabled: false,
    maxMidGameMessagesPerGame: 1,
    minCooldownBetweenMessagesMs: 45_000,
    midGameTriggerProbability: 0.15,
  },
};

export class SessionPacingManager {
  private config: SessionPacingConfig;
  private readonly nowWallMs: () => number;
  private readonly getLocalHour: () => number;
  private readonly rng: () => number;

  private sessionStartedAtMs: number;
  private dayWindowStartedAtMs: number;
  private cooldownUntilMs = 0;
  private gamesPlayedToday = 0;
  private gamesPlayedInSession = 0;

  private consecutiveSufficiencyAnomalies = 0;
  private totalSufficiencyAnomalies = 0;

  private chatSentStartThisGame = false;
  private chatSentEndThisGame = false;
  private chatMidGameSentCount = 0;
  private lastChatSentAtMs = 0;

  constructor(config: Partial<SessionPacingConfig> = {}) {
    this.config = {
      ...DEFAULT_SESSION_PACING_CONFIG,
      ...config,
      chat: {
        ...DEFAULT_SESSION_PACING_CONFIG.chat,
        ...config.chat,
      },
    };
    this.nowWallMs = config.nowWallMs ?? (() => Date.now());
    this.getLocalHour =
      config.getLocalHour ?? (() => new Date(this.nowWallMs()).getHours());
    this.rng = config.randomFn ?? Math.random;

    const now = this.nowWallMs();
    this.sessionStartedAtMs = now;
    this.dayWindowStartedAtMs = now;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getConfig(): SessionPacingConfig {
    return this.config;
  }

  updateConfig(partial: Partial<SessionPacingConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      chat: partial.chat
        ? { ...this.config.chat, ...partial.chat }
        : this.config.chat,
    };
  }

  /**
   * Classifies time controls (`bullet`, `blitz`, `rapid`, `classical`):
   * Recommends `bullet`/`blitz`; steps down effective Elo by 300 points in `classical`.
   */
  classifyTimeControl(
    initialTimeMs: number,
    incrementMs: number
  ): TimeControlClassification {
    const estimatedTotalMs = Math.max(0, initialTimeMs) + Math.max(0, incrementMs) * 40;
    let category: TimeControlCategory;
    if (estimatedTotalMs < 180_000) {
      category = "bullet";
    } else if (estimatedTotalMs < 600_000) {
      category = "blitz";
    } else if (estimatedTotalMs < 1_800_000) {
      category = "rapid";
    } else {
      category = "classical";
    }

    const isRecommended = category === "bullet" || category === "blitz";
    const eloStepDown =
      this.config.enabled && category === "classical"
        ? this.config.classicalEloStepDown
        : 0;

    return {
      category,
      estimatedTotalMs: Math.round(estimatedTotalMs),
      isRecommended,
      eloStepDown,
      warningReason:
        category === "classical"
          ? `Classical time control detected; stepping down effective Elo by ${this.config.classicalEloStepDown} points`
          : category === "rapid"
          ? "Rapid time control carries moderate statistical scrutiny; bullet/blitz recommended"
          : null,
    };
  }

  /**
   * Opening move pacing floor:
   * - Move 1: 3,000–8,000 ms
   * - Moves 2–5: 2,000–5,000 ms
   * - Beyond move 5: tapers smoothly toward 0 ms additional floor.
   */
  sampleOpeningPacingFloorMs(moveNumber: number): number {
    if (!this.config.enabled) return 0;
    const u = clamp(this.rng(), 0, 1);
    if (moveNumber <= 1) {
      return Math.round(
        this.config.move1MinMs + u * (this.config.move1MaxMs - this.config.move1MinMs)
      );
    }
    if (moveNumber <= 5) {
      return Math.round(
        this.config.moves2To5MinMs +
          u * (this.config.moves2To5MaxMs - this.config.moves2To5MinMs)
      );
    }
    // Natural exponential taper after move 5 (e.g., move 6 ~1350ms, move 8 ~600ms, move 10+ <270ms)
    const taper = Math.exp(-(moveNumber - 5) * 0.42);
    return Math.round(2_000 * taper);
  }

  /**
   * Correlates think time with opponent Elo relative to player rating
   * (longer vs higher-rated opponents, slightly faster vs much lower-rated).
   */
  computeOpponentEloMultiplier(
    playerElo: number,
    opponentElo: number | null | undefined
  ): number {
    if (!this.config.enabled || opponentElo === null || opponentElo === undefined) {
      return 1.0;
    }
    const diff = clamp(opponentElo - playerElo, -600, 600);
    // +400 opponent -> ~1.22x; -400 opponent -> ~0.85x
    const raw = 1.0 + diff / 1800;
    return Number(clamp(raw, 0.82, 1.35).toFixed(4));
  }

  /**
   * Applies local time-of-day circadian scaling: slower during 00:00–06:00 local hours.
   */
  computeCircadianMultiplier(localHourOverride?: number): number {
    if (!this.config.enabled) return 1.0;
    const hour = localHourOverride ?? this.getLocalHour();
    if (hour >= 0 && hour < 6) {
      // Smooth bell curve peaking around 03:00 (+28% slower), +16% at 00:00/05:59
      const distFrom3 = Math.abs(hour - 3);
      const bump = 0.28 - (distFrom3 / 3) * 0.12;
      return Number((1 + Math.max(0.15, bump)).toFixed(4));
    }
    return 1.0;
  }

  /**
   * Think-time sufficiency model:
   * `minimumTime = f(depthRequired, positionComplexity)`
   */
  computeMinimumThinkTimeMs(
    depthRequired: number,
    positionComplexity: number
  ): number {
    const safeDepth = Math.max(1, depthRequired);
    const safeComplexity = clamp(positionComplexity, 0, 1);
    return Math.round(
      Math.max(450, 220 + safeDepth * 78 + Math.pow(safeComplexity, 1.15) * 2_200)
    );
  }

  /**
   * Audits elapsed think time against `minimumTime * 0.7`, flagging repeated anomalies.
   */
  recordThinkTimeObservation(
    elapsedMs: number,
    depthRequired: number,
    positionComplexity: number
  ): ThinkTimeSufficiencyCheck {
    const minimumRequiredMs = this.computeMinimumThinkTimeMs(
      depthRequired,
      positionComplexity
    );
    const warningThresholdMs = Math.round(minimumRequiredMs * 0.7);
    const isInsufficient = elapsedMs < warningThresholdMs;

    if (this.config.enabled) {
      if (isInsufficient) {
        this.consecutiveSufficiencyAnomalies++;
        this.totalSufficiencyAnomalies++;
      } else {
        this.consecutiveSufficiencyAnomalies = 0;
      }
    }

    const anomalyFlagged =
      this.config.enabled &&
      (this.consecutiveSufficiencyAnomalies >=
        this.config.repeatedSufficiencyAnomalyLimit ||
        this.totalSufficiencyAnomalies >=
          this.config.repeatedSufficiencyAnomalyLimit + 2);

    const check: ThinkTimeSufficiencyCheck = {
      elapsedMs: Math.round(elapsedMs),
      minimumRequiredMs,
      warningThresholdMs,
      isInsufficient,
      consecutiveInsufficientCount: this.consecutiveSufficiencyAnomalies,
      totalInsufficientCount: this.totalSufficiencyAnomalies,
      anomalyFlagged,
    };

    if (anomalyFlagged) {
      this.config.onSufficiencyAnomaly?.(check);
    }
    return check;
  }

  resetSufficiencyAnomalies(): void {
    this.consecutiveSufficiencyAnomalies = 0;
    this.totalSufficiencyAnomalies = 0;
  }

  /**
   * Evaluates session duration cap (4h), daily cap (30 games/day), and mandatory 2h cooldown.
   */
  canStartNewGame(): SessionCapDecision {
    const now = this.nowWallMs();
    if (!this.config.enabled) {
      return {
        allowed: true,
        reason: "OK",
        gamesPlayedToday: this.gamesPlayedToday,
        maxGamesPerDay: this.config.maxGamesPerDay,
        sessionElapsedMs: Math.max(0, now - this.sessionStartedAtMs),
        cooldownRemainingMs: 0,
      };
    }

    // Roll over 24h day window if elapsed
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (now - this.dayWindowStartedAtMs >= oneDayMs) {
      this.dayWindowStartedAtMs = now;
      this.gamesPlayedToday = 0;
    }

    // Check active mandatory cooldown first
    if (this.cooldownUntilMs > now) {
      return {
        allowed: false,
        reason: "COOLDOWN_ACTIVE",
        gamesPlayedToday: this.gamesPlayedToday,
        maxGamesPerDay: this.config.maxGamesPerDay,
        sessionElapsedMs: Math.max(0, now - this.sessionStartedAtMs),
        cooldownRemainingMs: this.cooldownUntilMs - now,
      };
    } else if (this.cooldownUntilMs > 0 && now >= this.cooldownUntilMs) {
      // Cooldown finished cleanly -> start fresh session window
      this.cooldownUntilMs = 0;
      this.sessionStartedAtMs = now;
      this.gamesPlayedInSession = 0;
    }

    const sessionElapsedMs = Math.max(0, now - this.sessionStartedAtMs);
    if (sessionElapsedMs >= this.config.maxSessionDurationMs) {
      this.cooldownUntilMs = now + this.config.mandatoryCooldownMs;
      return {
        allowed: false,
        reason: "SESSION_DURATION_LIMIT",
        gamesPlayedToday: this.gamesPlayedToday,
        maxGamesPerDay: this.config.maxGamesPerDay,
        sessionElapsedMs,
        cooldownRemainingMs: this.config.mandatoryCooldownMs,
      };
    }

    if (this.gamesPlayedToday >= this.config.maxGamesPerDay) {
      this.cooldownUntilMs = now + this.config.mandatoryCooldownMs;
      return {
        allowed: false,
        reason: "DAILY_GAME_LIMIT",
        gamesPlayedToday: this.gamesPlayedToday,
        maxGamesPerDay: this.config.maxGamesPerDay,
        sessionElapsedMs,
        cooldownRemainingMs: this.config.mandatoryCooldownMs,
      };
    }

    return {
      allowed: true,
      reason: "OK",
      gamesPlayedToday: this.gamesPlayedToday,
      maxGamesPerDay: this.config.maxGamesPerDay,
      sessionElapsedMs,
      cooldownRemainingMs: 0,
    };
  }

  /**
   * Records completion of a game, resetting per-game chat counters and enforcing caps if hit.
   */
  recordGameStarted(): SessionCapDecision {
    this.chatSentStartThisGame = false;
    this.chatSentEndThisGame = false;
    this.chatMidGameSentCount = 0;
    return this.canStartNewGame();
  }

  recordGameCompleted(): SessionCapDecision {
    if (this.config.enabled) {
      this.gamesPlayedToday++;
      this.gamesPlayedInSession++;
    }
    this.chatSentStartThisGame = false;
    this.chatSentEndThisGame = false;
    this.chatMidGameSentCount = 0;
    return this.canStartNewGame();
  }

  getGamesPlayedInSession(): number {
    return this.gamesPlayedInSession;
  }

  /**
   * Simulates post-game analysis review pause between games (30,000–120,000 ms).
   */
  samplePostGameReviewWaitMs(): number {
    if (!this.config.enabled) return 0;
    const min = Math.max(0, this.config.postGameReviewMinMs);
    const max = Math.max(min, this.config.postGameReviewMaxMs);
    const u = clamp(this.rng(), 0, 1);
    return Math.round(min + u * (max - min));
  }

  /**
   * Optional rate-limited chat message planner ("gl hf", "gg", sparse mid-game).
   * Defaults to disabled (`chat.enabled === false`).
   */
  planChatMessage(
    trigger: "GAME_START" | "MID_GAME" | "GAME_END"
  ): ChatDispatchPlan {
    if (!this.config.enabled || !this.config.chat.enabled) {
      return {
        send: false,
        message: null,
        trigger,
        reason: "CHAT_DISABLED",
      };
    }

    const now = this.nowWallMs();
    if (
      this.lastChatSentAtMs > 0 &&
      now - this.lastChatSentAtMs < this.config.chat.minCooldownBetweenMessagesMs
    ) {
      return {
        send: false,
        message: null,
        trigger,
        reason: "CHAT_COOLDOWN",
      };
    }

    if (trigger === "GAME_START") {
      if (this.chatSentStartThisGame) {
        return { send: false, message: null, trigger, reason: "ALREADY_SENT_START" };
      }
      this.chatSentStartThisGame = true;
      this.lastChatSentAtMs = now;
      return { send: true, message: "gl hf", trigger, reason: "GAME_START_GREETING" };
    }

    if (trigger === "GAME_END") {
      if (this.chatSentEndThisGame) {
        return { send: false, message: null, trigger, reason: "ALREADY_SENT_END" };
      }
      this.chatSentEndThisGame = true;
      this.lastChatSentAtMs = now;
      return { send: true, message: "gg", trigger, reason: "GAME_END_GREETING" };
    }

    // MID_GAME
    if (this.chatMidGameSentCount >= this.config.chat.maxMidGameMessagesPerGame) {
      return { send: false, message: null, trigger, reason: "MID_GAME_CAP_REACHED" };
    }
    if (this.rng() > this.config.chat.midGameTriggerProbability) {
      return { send: false, message: null, trigger, reason: "SPARSE_PROBABILITY_SKIP" };
    }

    const pool = ["nice move", "interesting position", "good game so far"];
    const idx = Math.floor(clamp(this.rng(), 0, 0.99999) * pool.length);
    this.chatMidGameSentCount++;
    this.lastChatSentAtMs = now;
    return {
      send: true,
      message: pool[idx],
      trigger,
      reason: "MID_GAME_SPARSE",
    };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
