/**
 * Behavioral State Machine: Tilt, Fatigue, Entropy & Panic Reset (`behavioralStateMachine.ts`).
 *
 * Models authentic human psychological & motor fluctuations during play:
 * 1. Per-session timing entropy seeded with `crypto.getRandomValues()` mixed with a
 *    slow-drifting sinusoidal fatigue wave.
 * 2. Per-session Stockfish hash randomization (±10%) derived from the session entropy seed.
 * 3. Blunder-driven Tilt state (2 blunders in a 5-move sliding window -> -200 Elo step-down
 *    for the next 10 moves) + slight confidence boost after winning material.
 * 4. Low-clock error probability thresholds (<10s: 5%, <5s: 12%).
 * 5. Hotkey & chat-keyword Panic/Reset mode: clears in-memory session telemetry immediately
 *    and switches for 10 moves to a high-temperature, suboptimal error profile with extended
 *    think times.
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { FairPlayAuditor } from "./fairPlayAuditor.ts";
import type { CompletedMoveRecord } from "./fairPlayModels.ts";

export interface SessionEntropySeed {
  readonly sessionSeedHex: string;
  readonly phaseOffsetRad: number;
  readonly delayJitterOffset: number;
  /** Session hash multiplier in [0.90, 1.10] (±10%). */
  readonly hashScaleFactor: number;
  readonly createdAtMs: number;
}

export interface PanicHotkeyConfig {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export interface BehavioralStateMachineConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing static behavior. */
  readonly enabled: boolean;
  /** Centipawn loss threshold classifying a move as a blunder (default 150). */
  readonly blunderCpThreshold: number;
  /** Sliding move window checked for consecutive tilt blunders (default 5). */
  readonly tiltWindowMoves: number;
  /** Number of blunders inside the sliding window required to trigger tilt (default 2). */
  readonly tiltBlunderTriggerCount: number;
  /** Elo step-down applied during tilt (default 200). */
  readonly tiltEloPenalty: number;
  /** Duration of tilt state in moves (default 10). */
  readonly tiltDurationMoves: number;
  /** Maximum slight positive Elo confidence offset after winning material (default 60). */
  readonly confidenceMaxBoostElo: number;
  /** Material gain (cp) or eval swing threshold for confidence boost (default 200). */
  readonly confidenceMaterialGainThresholdCp: number;
  /** Duration of confidence boost in moves (default 5). */
  readonly confidenceDurationMoves: number;
  /** Duration of Panic/Reset suboptimal mode in moves (default 10). */
  readonly panicDurationMoves: number;
  /** Temperature multiplier during Panic/Reset mode (default 2.15). */
  readonly panicTemperatureMultiplier: number;
  /** Think-time multiplier during Panic/Reset mode (default 1.7). */
  readonly panicThinkTimeMultiplier: number;
  /** Extra blunder cp allowance during Panic/Reset mode (default 140). */
  readonly panicBlunderCapAddCp: number;
  /** Elo penalty during Panic/Reset mode (default 350). */
  readonly panicEloPenalty: number;
  /** Amplitude of slow sinusoidal fatigue wave on think delays (default 0.22 -> +0..22%). */
  readonly fatigueWaveAmplitude: number;
  /** Move frequency constant of slow sinusoidal fatigue wave (default 0.16 rad/move). */
  readonly fatigueMoveFrequencyRad: number;
  /** Hotkey binding for manual panic/reset trigger (default Ctrl+Shift+X). */
  readonly panicHotkey: PanicHotkeyConfig;
  /** Chat keywords triggering panic/reset mode (case-insensitive substring match). */
  readonly panicChatKeywords: readonly string[];
  /** Injectable time provider for deterministic testing. */
  readonly nowMs?: () => number;
  /** Optional custom callback invoked immediately on panic telemetry clear. */
  readonly onClearTelemetry?: (reason: string) => void;
}

export const DEFAULT_BEHAVIORAL_STATE_CONFIG: BehavioralStateMachineConfig = {
  enabled: false,
  blunderCpThreshold: 150,
  tiltWindowMoves: 5,
  tiltBlunderTriggerCount: 2,
  tiltEloPenalty: 200,
  tiltDurationMoves: 10,
  confidenceMaxBoostElo: 60,
  confidenceMaterialGainThresholdCp: 200,
  confidenceDurationMoves: 5,
  panicDurationMoves: 10,
  panicTemperatureMultiplier: 2.15,
  panicThinkTimeMultiplier: 1.7,
  panicBlunderCapAddCp: 140,
  panicEloPenalty: 350,
  fatigueWaveAmplitude: 0.22,
  fatigueMoveFrequencyRad: 0.16,
  panicHotkey: {
    key: "X",
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
  },
  panicChatKeywords: ["panic", "reset mode", "panic mode", "/reset", "emergency reset"],
};

export interface MoveBehavioralOutcome {
  readonly cpLoss: number;
  /** Positive material gain or positive centipawn advantage gained over previous position. */
  readonly materialGainCp?: number;
  readonly evalSwingCp?: number;
  readonly elapsedMs?: number;
}

export interface BehavioralProfileState {
  readonly enabled: boolean;
  readonly baseElo: number;
  readonly effectiveElo: number;
  readonly isTilted: boolean;
  readonly tiltMovesRemaining: number;
  readonly isPanicMode: boolean;
  readonly panicMovesRemaining: number;
  readonly confidenceOffsetElo: number;
  readonly confidenceMovesRemaining: number;
  readonly temperatureMultiplier: number;
  readonly thinkTimeMultiplier: number;
  readonly fatigueMultiplier: number;
  readonly fatiguePhaseRad: number;
  readonly blunderCapAddCp: number;
  readonly sessionMovesObserved: number;
  readonly recentBlunderWindowCount: number;
  readonly entropySeed: SessionEntropySeed;
}

export class BehavioralStateMachine {
  private config: BehavioralStateMachineConfig;
  private readonly nowMs: () => number;
  private fairPlayAuditor: FairPlayAuditor | null = null;
  private entropySeed: SessionEntropySeed;

  private recentBlunderFlags: boolean[] = [];
  private tiltMovesRemaining = 0;
  private panicMovesRemaining = 0;
  private confidenceMovesRemaining = 0;
  private confidenceOffsetElo = 0;
  private sessionMovesObserved = 0;
  private sessionStartedAtMs: number;
  private panicResetCount = 0;

  constructor(config: Partial<BehavioralStateMachineConfig> = {}) {
    this.config = {
      ...DEFAULT_BEHAVIORAL_STATE_CONFIG,
      ...config,
      panicHotkey: {
        ...DEFAULT_BEHAVIORAL_STATE_CONFIG.panicHotkey,
        ...config.panicHotkey,
      },
    };
    this.nowMs = config.nowMs ?? (() => Date.now());
    this.sessionStartedAtMs = this.nowMs();
    this.entropySeed = generateCryptoSessionEntropy(this.sessionStartedAtMs);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getConfig(): BehavioralStateMachineConfig {
    return this.config;
  }

  updateConfig(partial: Partial<BehavioralStateMachineConfig>): void {
    this.config = {
      ...this.config,
      ...partial,
      panicHotkey: partial.panicHotkey
        ? { ...this.config.panicHotkey, ...partial.panicHotkey }
        : this.config.panicHotkey,
    };
  }

  attachFairPlayAuditor(auditor: FairPlayAuditor | null): void {
    this.fairPlayAuditor = auditor;
  }

  getSessionEntropy(): SessionEntropySeed {
    return this.entropySeed;
  }

  getPanicResetCount(): number {
    return this.panicResetCount;
  }

  /**
   * Re-seeds session timing entropy using `crypto.getRandomValues()`.
   */
  reseedSessionEntropy(): SessionEntropySeed {
    this.sessionStartedAtMs = this.nowMs();
    this.entropySeed = generateCryptoSessionEntropy(this.sessionStartedAtMs);
    return this.entropySeed;
  }

  /**
   * Randomizes Stockfish hash table allocation by ±10% per session when enabled.
   */
  getRandomizedStockfishHashMb(baseHashMb: number): number {
    const safeBase = Math.max(1, Math.round(baseHashMb));
    if (!this.config.enabled) {
      return safeBase;
    }
    return Math.max(1, Math.round(safeBase * this.entropySeed.hashScaleFactor));
  }

  /**
   * Records a completed move outcome (or FairPlayAuditor record) and updates
   * tilt, confidence, fatigue, and panic countdowns.
   */
  recordMoveOutcome(
    outcome: MoveBehavioralOutcome | CompletedMoveRecord
  ): BehavioralProfileState {
    if (!this.config.enabled) {
      return this.getEffectiveProfile(1600);
    }

    this.sessionMovesObserved++;

    if (this.panicMovesRemaining > 0) {
      this.panicMovesRemaining--;
    }
    if (this.tiltMovesRemaining > 0) {
      this.tiltMovesRemaining--;
    }
    if (this.confidenceMovesRemaining > 0) {
      this.confidenceMovesRemaining--;
      if (this.confidenceMovesRemaining === 0) {
        this.confidenceOffsetElo = 0;
      }
    }

    const cpLoss = Math.max(0, outcome.cpLoss);
    const isBlunder = cpLoss >= this.config.blunderCpThreshold;
    this.recentBlunderFlags = [
      ...this.recentBlunderFlags,
      isBlunder,
    ].slice(-Math.max(1, this.config.tiltWindowMoves));

    const blundersInWindow = this.recentBlunderFlags.filter(Boolean).length;
    if (blundersInWindow >= this.config.tiltBlunderTriggerCount) {
      this.tiltMovesRemaining = this.config.tiltDurationMoves;
      this.confidenceMovesRemaining = 0;
      this.confidenceOffsetElo = 0;
    } else if (
      this.tiltMovesRemaining === 0 &&
      this.panicMovesRemaining === 0 &&
      "materialGainCp" in outcome
    ) {
      const gain = Math.max(
        outcome.materialGainCp ?? 0,
        outcome.evalSwingCp ?? 0
      );
      if (gain >= this.config.confidenceMaterialGainThresholdCp) {
        const ratio = clamp(
          gain / (this.config.confidenceMaterialGainThresholdCp * 2),
          0.35,
          1.0
        );
        this.confidenceOffsetElo = Math.round(
          this.config.confidenceMaxBoostElo * ratio
        );
        this.confidenceMovesRemaining = this.config.confidenceDurationMoves;
      }
    }

    return this.getEffectiveProfile(1600);
  }

  /**
   * Low-clock error probability threshold:
   * - `< 10,000 ms`: 5%
   * - `< 5,000 ms`: 12%
   */
  getLowClockErrorProbability(remainingClockMs: number | null): number {
    if (!this.config.enabled || remainingClockMs === null) return 0;
    if (remainingClockMs < 5_000) return 0.12;
    if (remainingClockMs < 10_000) return 0.05;
    return 0;
  }

  /**
   * Immediately clears in-memory session telemetry and switches for 10 moves into
   * a high-temperature, suboptimal error profile with extended think times.
   */
  triggerPanicReset(reason: string = "MANUAL_PANIC_RESET"): void {
    this.panicResetCount++;
    this.recentBlunderFlags = [];
    this.tiltMovesRemaining = 0;
    this.confidenceMovesRemaining = 0;
    this.confidenceOffsetElo = 0;
    this.panicMovesRemaining = this.config.enabled
      ? this.config.panicDurationMoves
      : 0;

    this.fairPlayAuditor?.resetCurrentGame();
    this.config.onClearTelemetry?.(reason);
  }

  /**
   * Inspects incoming chat messages for configured panic/reset keywords.
   */
  inspectChatMessage(messageText: string): boolean {
    if (!this.config.enabled) return false;
    const normalized = (messageText || "").trim().toLowerCase();
    if (!normalized) return false;
    const matched = this.config.panicChatKeywords.some((kw) =>
      normalized.includes(kw.toLowerCase())
    );
    if (matched) {
      this.triggerPanicReset(`CHAT_KEYWORD:${normalized.slice(0, 32)}`);
      return true;
    }
    return false;
  }

  /**
   * Processes a keyboard event for the manual panic/reset hotkey.
   */
  handleKeyDown(event: {
    readonly key: string;
    readonly ctrlKey?: boolean;
    readonly shiftKey?: boolean;
    readonly altKey?: boolean;
  }): boolean {
    if (!this.config.enabled) return false;
    const hk = this.config.panicHotkey;
    const keyMatch =
      (event.key || "").toUpperCase() === hk.key.toUpperCase();
    const ctrlMatch = Boolean(event.ctrlKey) === hk.ctrlKey;
    const shiftMatch = Boolean(event.shiftKey) === hk.shiftKey;
    const altMatch = Boolean(event.altKey) === hk.altKey;
    if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
      this.triggerPanicReset("HOTKEY_PANIC_RESET");
      return true;
    }
    return false;
  }

  /**
   * Attaches a `keydown` listener cleanly and returns a detach callback.
   */
  attachKeyboardListener(target: {
    addEventListener(type: string, listener: (ev: any) => void): void;
    removeEventListener(type: string, listener: (ev: any) => void): void;
  }): () => void {
    const listener = (ev: {
      key: string;
      ctrlKey?: boolean;
      shiftKey?: boolean;
      altKey?: boolean;
    }) => {
      this.handleKeyDown(ev);
    };
    target.addEventListener("keydown", listener);
    return () => {
      target.removeEventListener("keydown", listener);
    };
  }

  /**
   * Computes current slow-drifting sinusoidal fatigue phase & delay multiplier.
   */
  computeSinusoidalFatigueState(): {
    readonly phaseRad: number;
    readonly delayMultiplier: number;
    readonly tempMultiplier: number;
  } {
    if (!this.config.enabled) {
      return {
        phaseRad: 0,
        delayMultiplier: 1.0,
        tempMultiplier: 1.0,
      };
    }

    const elapsedMinutes = Math.max(
      0,
      (this.nowMs() - this.sessionStartedAtMs) / 60_000
    );
    const phaseRad =
      this.entropySeed.phaseOffsetRad +
      this.sessionMovesObserved * this.config.fatigueMoveFrequencyRad +
      elapsedMinutes * 0.09;

    // Normalized wave in [0, 1] shifting think time & temperature gradually
    const normalizedWave = 0.5 * (1 + Math.sin(phaseRad));
    const amp = clamp(this.config.fatigueWaveAmplitude, 0, 0.5);
    const jitter = this.entropySeed.delayJitterOffset * 0.04;
    const delayMultiplier = Math.max(
      0.88,
      1 + amp * normalizedWave + jitter
    );
    const tempMultiplier = 1 + amp * 0.65 * normalizedWave;

    return {
      phaseRad: Number(phaseRad.toFixed(4)),
      delayMultiplier: Number(delayMultiplier.toFixed(4)),
      tempMultiplier: Number(tempMultiplier.toFixed(4)),
    };
  }

  /**
   * Returns consolidated behavioral Elo, temperature, think-time, and blunder adjustments.
   */
  getEffectiveProfile(baseElo: number): BehavioralProfileState {
    const safeBaseElo = clamp(Math.round(baseElo), 400, 3000);
    if (!this.config.enabled) {
      return {
        enabled: false,
        baseElo: safeBaseElo,
        effectiveElo: safeBaseElo,
        isTilted: false,
        tiltMovesRemaining: 0,
        isPanicMode: false,
        panicMovesRemaining: 0,
        confidenceOffsetElo: 0,
        confidenceMovesRemaining: 0,
        temperatureMultiplier: 1.0,
        thinkTimeMultiplier: 1.0,
        fatigueMultiplier: 1.0,
        fatiguePhaseRad: 0,
        blunderCapAddCp: 0,
        sessionMovesObserved: this.sessionMovesObserved,
        recentBlunderWindowCount: this.recentBlunderFlags.filter(Boolean).length,
        entropySeed: this.entropySeed,
      };
    }

    const isPanicMode = this.panicMovesRemaining > 0;
    const isTilted = !isPanicMode && this.tiltMovesRemaining > 0;
    const fatigue = this.computeSinusoidalFatigueState();

    let effectiveElo = safeBaseElo;
    let temperatureMultiplier = fatigue.tempMultiplier;
    let thinkTimeMultiplier = fatigue.delayMultiplier;
    let blunderCapAddCp = 0;

    if (isPanicMode) {
      effectiveElo = clamp(safeBaseElo - this.config.panicEloPenalty, 400, 3000);
      temperatureMultiplier *= this.config.panicTemperatureMultiplier;
      thinkTimeMultiplier *= this.config.panicThinkTimeMultiplier;
      blunderCapAddCp += this.config.panicBlunderCapAddCp;
    } else if (isTilted) {
      effectiveElo = clamp(safeBaseElo - this.config.tiltEloPenalty, 400, 3000);
      temperatureMultiplier *= 1.18;
      thinkTimeMultiplier *= 1.1;
      blunderCapAddCp += 35;
    } else if (this.confidenceMovesRemaining > 0 && this.confidenceOffsetElo > 0) {
      effectiveElo = clamp(safeBaseElo + this.confidenceOffsetElo, 400, 3000);
      thinkTimeMultiplier *= 0.94;
      temperatureMultiplier *= 0.96;
    }

    return {
      enabled: true,
      baseElo: safeBaseElo,
      effectiveElo: Math.round(effectiveElo),
      isTilted,
      tiltMovesRemaining: this.tiltMovesRemaining,
      isPanicMode,
      panicMovesRemaining: this.panicMovesRemaining,
      confidenceOffsetElo: this.confidenceOffsetElo,
      confidenceMovesRemaining: this.confidenceMovesRemaining,
      temperatureMultiplier: Number(temperatureMultiplier.toFixed(4)),
      thinkTimeMultiplier: Number(thinkTimeMultiplier.toFixed(4)),
      fatigueMultiplier: fatigue.delayMultiplier,
      fatiguePhaseRad: fatigue.phaseRad,
      blunderCapAddCp,
      sessionMovesObserved: this.sessionMovesObserved,
      recentBlunderWindowCount: this.recentBlunderFlags.filter(Boolean).length,
      entropySeed: this.entropySeed,
    };
  }
}

export function generateCryptoSessionEntropy(
  createdAtMs: number = Date.now()
): SessionEntropySeed {
  const words = new Uint32Array(4);
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    cryptoObj.getRandomValues(words);
  } else {
    for (let i = 0; i < words.length; i++) {
      words[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  const hex = Array.from(words, (w) => w.toString(16).padStart(8, "0")).join("");
  const phaseUnit = words[0] / 0xffffffff;
  const jitterUnit = words[1] / 0xffffffff;
  const hashUnit = words[2] / 0xffffffff;

  return {
    sessionSeedHex: hex,
    phaseOffsetRad: Number((phaseUnit * Math.PI * 2).toFixed(5)),
    delayJitterOffset: Number(((jitterUnit - 0.5) * 2).toFixed(5)),
    hashScaleFactor: Number((0.9 + hashUnit * 0.2).toFixed(5)),
    createdAtMs,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
