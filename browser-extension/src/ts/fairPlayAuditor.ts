import {
  FAIR_PLAY_STORAGE_KEY,
  FAIR_PLAY_WINDOW_SIZE,
  SPIKE_THRESHOLD_LOCKOUT,
  Z_THRESHOLD_ELEVATED,
  Z_THRESHOLD_LOCKOUT,
  type CompletedMoveRecord,
  type DiagnosticCode,
  type FairPlayAdaptivePolicy,
  type FairPlayDiagnosticWarning,
  type FairPlayMetricsSnapshot,
  type FairPlayRiskLevel,
  type FairPlayStorageAdapter,
  type GameTelemetrySummary,
  type PersistedAuditorWindow,
} from "./fairPlayModels.ts";
import { comparableCp, type EngineAnalysis, type EngineLine } from "./ports.ts";
import {
  FAIR_PLAY_PRIVACY_WINDOW_SIZE,
  FairPlayEventBus,
} from "./fairPlayEventBus.ts";

export interface RecordMoveInput {
  readonly fenBefore: string;
  readonly playedUci: string;
  readonly analysisBefore: EngineAnalysis;
  readonly humanPrior: number;
  readonly elapsedMs: number;
  readonly remainingClockMs: number | null;
  readonly timestampMs?: number;
}

export interface PrivacyTelemetryOptions {
  /** Explicit opt-in flag; defaults to false to preserve legacy 20-game behavior. */
  readonly enabled: boolean;
  /** Rolling in-memory game window size when privacy mode is enabled (default 5). */
  readonly rollingWindowSize?: number;
}

export interface FairPlayAuditorOptions {
  readonly baselineElo?: number;
  readonly storage?: FairPlayStorageAdapter | null;
  readonly initialWindow?: readonly GameTelemetrySummary[];
  readonly eventBus?: FairPlayEventBus | null;
  readonly rollingWindowSize?: number;
  readonly privacyMode?: PrivacyTelemetryOptions;
}

export class InMemoryFairPlayStorage implements FairPlayStorageAdapter {
  private readonly store = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.store.get(key);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      this.store.set(k, v);
    }
  }
}

export class FairPlayAuditor {
  private baselineElo: number;
  private readonly storage: FairPlayStorageAdapter | null;
  private readonly eventBus: FairPlayEventBus | null;
  private readonly maxWindowSize: number;
  private readonly privacyModeEnabled: boolean;
  private windowGames: GameTelemetrySummary[];
  private currentMoves: CompletedMoveRecord[];
  private lockedOut = false;
  private lockoutReason: string | null = null;
  private cachedSnapshot: FairPlayMetricsSnapshot;
  private lastEmittedRiskLevel: FairPlayRiskLevel = "SAFE";

  constructor(options: FairPlayAuditorOptions = {}) {
    this.baselineElo = clamp(options.baselineElo ?? 1500, 400, 3000);
    this.storage = options.storage ?? null;
    this.eventBus = options.eventBus ?? null;
    this.privacyModeEnabled = options.privacyMode?.enabled === true;
    const configuredSize = this.privacyModeEnabled
      ? options.privacyMode?.rollingWindowSize ?? FAIR_PLAY_PRIVACY_WINDOW_SIZE
      : options.rollingWindowSize ?? FAIR_PLAY_WINDOW_SIZE;
    this.maxWindowSize = Math.max(1, Math.round(configuredSize));
    this.windowGames = (options.initialWindow ?? []).slice(-this.maxWindowSize);
    this.currentMoves = [];
    this.cachedSnapshot = this.computeSnapshot();
    this.lastEmittedRiskLevel = this.cachedSnapshot.riskLevel;
  }

  getEventBus(): FairPlayEventBus | null {
    return this.eventBus;
  }

  async loadPersistedWindow(): Promise<void> {
    if (!this.storage) return;
    try {
      const raw = await this.storage.get(FAIR_PLAY_STORAGE_KEY);
      if (!raw || typeof raw !== "object") return;
      const obj = raw as Partial<PersistedAuditorWindow>;
      if (Array.isArray(obj.games)) {
        this.windowGames = obj.games.slice(-this.maxWindowSize);
      }
      if (typeof obj.baselineElo === "number" && !Number.isNaN(obj.baselineElo)) {
        this.baselineElo = clamp(obj.baselineElo, 400, 3000);
      }
      this.refreshSnapshotAndEmit("LOADED_WINDOW");
    } catch {
      // Ignore corrupt storage entries safely
    }
  }

  async savePersistedWindow(): Promise<void> {
    if (!this.storage) return;
    const payload: PersistedAuditorWindow = {
      baselineElo: this.baselineElo,
      games: this.windowGames.slice(-this.maxWindowSize),
    };
    await this.storage.set({ [FAIR_PLAY_STORAGE_KEY]: payload });
  }

  setBaselineElo(targetElo: number): void {
    this.baselineElo = clamp(targetElo, 400, 3000);
    this.refreshSnapshotAndEmit("BASELINE_ELO_CHANGED");
  }

  getSnapshot(): FairPlayMetricsSnapshot {
    return this.cachedSnapshot;
  }

  getRiskPolicy(): FairPlayAdaptivePolicy {
    const snap = this.cachedSnapshot;
    if (snap.riskLevel === "LOCKOUT") {
      return {
        riskLevel: "LOCKOUT",
        blockAllOverlays: true,
        temperatureMultiplier: 3.0,
        criticalWdlDeltaAdd: 0.25,
        minDelayBoostMs: 0,
        badgeText: "FairPlay: LOCKOUT",
      };
    }
    if (snap.riskLevel === "ELEVATED") {
      return {
        riskLevel: "ELEVATED",
        blockAllOverlays: false,
        temperatureMultiplier: 2.0,
        criticalWdlDeltaAdd: 0.08,
        minDelayBoostMs: 1200,
        badgeText: "FairPlay: ELEVATED",
      };
    }
    return {
      riskLevel: "SAFE",
      blockAllOverlays: false,
      temperatureMultiplier: 1.0,
      criticalWdlDeltaAdd: 0,
      minDelayBoostMs: 0,
      badgeText: "FairPlay: SAFE",
    };
  }

  recordCompletedMove(input: RecordMoveInput): CompletedMoveRecord | null {
    const lines = input.analysisBefore.lines;
    if (!lines || lines.length === 0) return null;

    const top = lines[0];
    const playedUci4 = normalizeUci4(input.playedUci);
    const topUci4 = normalizeUci4(top.uci);
    const matchedLine = lines.find((l) => normalizeUci4(l.uci) === playedUci4) ?? null;

    const bestCp = comparableCp(top);
    let cpLoss = 0;
    let wdlLoss = 0;

    if (matchedLine) {
      cpLoss = Math.max(0, bestCp - comparableCp(matchedLine));
      wdlLoss = Math.max(0, expectedScoreFromLine(top) - expectedScoreFromLine(matchedLine));
    } else {
      const worstKnownLine = lines[lines.length - 1];
      const worstCpDrop = Math.max(40, bestCp - comparableCp(worstKnownLine));
      cpLoss = Math.min(600, worstCpDrop + 85);
      const worstWdlDrop = Math.max(
        0.04,
        expectedScoreFromLine(top) - expectedScoreFromLine(worstKnownLine)
      );
      wdlLoss = Math.min(0.65, worstWdlDrop + 0.06);
    }

    const matchedTop = playedUci4.length >= 4 && playedUci4 === topUci4;
    const cpCredit = Math.exp(-cpLoss / 70);
    const wdlCredit = clamp(1 - wdlLoss * 2.1, 0, 1);
    const partialCredit = matchedTop ? 1.0 : clamp(0.5 * cpCredit + 0.5 * wdlCredit, 0, 1);

    // Speed-Adjusted Criticality S_i detection
    const deltaE =
      lines.length >= 2
        ? Math.max(0, expectedScoreFromLine(lines[0]) - expectedScoreFromLine(lines[1]))
        : 0;
    const shallow = input.analysisBefore.shallowDepth6;
    const shallowDisagrees =
      shallow !== undefined && normalizeUci4(shallow.bestUci) !== topUci4;
    const isCriticalTrap =
      input.analysisBefore.depth >= 14 &&
      ((shallowDisagrees && deltaE >= 0.15) || deltaE >= 0.22);

    const matchedDeepOnlyWin = isCriticalTrap && matchedTop;
    const elapsedMs = Math.max(150, input.elapsedMs);
    const expectedHumanMs = Math.max(3800, 9200 - (this.baselineElo - 1000) * 1.6);
    const clampedPrior = clamp(input.humanPrior, 0.005, 1.0);

    let siScore = 0;
    let isSiSpike = false;
    if (matchedDeepOnlyWin) {
      const speedRatio = expectedHumanMs / elapsedMs;
      const noveltyWeight = 1 - Math.min(0.92, clampedPrior);
      siScore = Number((speedRatio * (0.45 + 1.45 * noveltyWeight)).toFixed(3));
      isSiSpike =
        clampedPrior <= 0.28 &&
        elapsedMs <= expectedHumanMs * 0.55 &&
        siScore >= 2.0;
    }

    const record: CompletedMoveRecord = {
      fenBefore: input.fenBefore,
      playedUci: input.playedUci,
      cpLoss: Math.round(cpLoss),
      wdlLoss: Number(wdlLoss.toFixed(4)),
      partialCredit: Number(partialCredit.toFixed(4)),
      humanPrior: Number(clampedPrior.toFixed(4)),
      elapsedMs: Math.round(elapsedMs),
      remainingClockMs: input.remainingClockMs,
      isCriticalTrap,
      matchedDeepOnlyWin,
      siScore,
      isSiSpike,
      timestampMs: input.timestampMs ?? Date.now(),
    };

    this.currentMoves.push(record);
    this.refreshSnapshotAndEmit(
      record.isSiSpike ? "SI_CRITICAL_SPIKE" : "MOVE_RECORDED"
    );
    return record;
  }

  async finishGame(gameId: string): Promise<GameTelemetrySummary | null> {
    if (this.currentMoves.length === 0) return null;
    const summary = summarizeMoves(
      gameId,
      this.baselineElo,
      this.currentMoves,
      this.cachedSnapshot.observedIpr
    );
    this.windowGames = [...this.windowGames, summary].slice(-this.maxWindowSize);
    this.currentMoves = [];
    this.refreshSnapshotAndEmit("GAME_FINISHED");
    await this.savePersistedWindow();
    return summary;
  }

  resetCurrentGame(): void {
    this.currentMoves = [];
    this.refreshSnapshotAndEmit("CURRENT_GAME_RESET");
  }

  resetSessionLockout(): void {
    this.lockedOut = false;
    this.lockoutReason = null;
    this.currentMoves = [];
    this.refreshSnapshotAndEmit("SESSION_LOCKOUT_RESET");
  }

  private refreshSnapshotAndEmit(reason: string | null): void {
    const previousLevel = this.lastEmittedRiskLevel;
    this.cachedSnapshot = this.computeSnapshot();
    const currentLevel = this.cachedSnapshot.riskLevel;
    if (currentLevel !== previousLevel) {
      this.lastEmittedRiskLevel = currentLevel;
      this.eventBus?.emitRiskLevelChanged({
        type: "RiskLevelChanged",
        previousLevel,
        currentLevel,
        snapshot: this.cachedSnapshot,
        reason: this.cachedSnapshot.lockoutReason ?? reason,
        timestampMs: Date.now(),
      });
    }
  }

  private computeSnapshot(): FairPlayMetricsSnapshot {
    const windowMovesWeight = this.windowGames.reduce((acc, g) => acc + g.moveCount, 0);
    const totalMoves = windowMovesWeight + this.currentMoves.length;

    const currentAcpl = mean(this.currentMoves.map((m) => m.cpLoss));
    const currentStdcpl = stdDev(this.currentMoves.map((m) => m.cpLoss));
    const currentCredit = mean(this.currentMoves.map((m) => m.partialCredit));
    const currentTimes = this.currentMoves.map((m) => m.elapsedMs);
    const moveTimeMeanMs = mean(currentTimes);
    const moveTimeCv =
      currentTimes.length >= 3 && moveTimeMeanMs > 0
        ? stdDev(currentTimes) / moveTimeMeanMs
        : 0.45;
    const currentSpikes = this.currentMoves.filter((m) => m.isSiSpike).length;

    const sub15 = this.currentMoves.filter(
      (m) => m.remainingClockMs !== null && m.remainingClockMs < 15_000
    );
    const sub15Acc = sub15.length > 0 ? mean(sub15.map((m) => m.partialCredit)) : 0;

    // Combine sliding window + current game telemetry
    let combinedAcpl = currentAcpl;
    let combinedCredit = currentCredit;
    if (totalMoves > 0) {
      const winAcplSum = this.windowGames.reduce((acc, g) => acc + g.acpl * g.moveCount, 0);
      const winCreditSum = this.windowGames.reduce(
        (acc, g) => acc + g.meanPartialCredit * g.moveCount,
        0
      );
      const curAcplSum = this.currentMoves.reduce((acc, m) => acc + m.cpLoss, 0);
      const curCreditSum = this.currentMoves.reduce((acc, m) => acc + m.partialCredit, 0);
      combinedAcpl = (winAcplSum + curAcplSum) / totalMoves;
      combinedCredit = (winCreditSum + curCreditSum) / totalMoves;
    } else {
      combinedAcpl = expectedAcplForElo(this.baselineElo);
      combinedCredit = expectedPartialCreditForElo(this.baselineElo);
    }

    const expectedCredit = expectedPartialCreditForElo(this.baselineElo);
    const expectedAcpl = expectedAcplForElo(this.baselineElo);

    // Bayesian-shrunk IPR estimator boosted slightly by anomalous S_i rapid tactical accuracy
    const sampleWeight = totalMoves / (totalMoves + 6);
    const creditDelta = (combinedCredit - expectedCredit) * 1450;
    const acplDelta = (expectedAcpl - combinedAcpl) * 5.2;
    const spikeAnomalyBoost = currentSpikes * 95;
    const observedIpr = clamp(
      this.baselineElo + sampleWeight * (creditDelta + acplDelta) + spikeAnomalyBoost,
      400,
      3200
    );

    const sigmaIpr = Math.max(42, 235 / Math.sqrt(Math.max(1, totalMoves)));
    const zScore = (observedIpr - this.baselineElo) / sigmaIpr;

    const warnings: FairPlayDiagnosticWarning[] = [];
    const now = Date.now();

    if (currentSpikes >= SPIKE_THRESHOLD_LOCKOUT) {
      warnings.push({
        code: "LOCKOUT_SPIKE_LIMIT",
        severity: "CRITICAL",
        message: `${currentSpikes} rapid critical deep-tactic matches (S_i spikes) in one game`,
        metricValue: currentSpikes,
        threshold: SPIKE_THRESHOLD_LOCKOUT,
        timestampMs: now,
      });
    } else if (currentSpikes === 1) {
      warnings.push({
        code: "RAPID_CRITICAL_MATCH",
        severity: "WARN",
        message: "1 rapid critical deep-tactic match detected (S_i spike)",
        metricValue: currentSpikes,
        threshold: 1,
        timestampMs: now,
      });
    }

    if (currentTimes.length >= 6 && moveTimeCv < 0.2) {
      warnings.push({
        code: "FLAT_MOVE_CADENCE",
        severity: "WARN",
        message: `Metronomic move-time CV (${moveTimeCv.toFixed(2)} < 0.20)`,
        metricValue: Number(moveTimeCv.toFixed(3)),
        threshold: 0.2,
        timestampMs: now,
      });
    }

    if (sub15.length >= 3 && sub15Acc >= 0.88) {
      warnings.push({
        code: "SUB_15S_ENGINE_PRECISION",
        severity: "CRITICAL",
        message: `Unusually high sub-15s scramble precision (${(sub15Acc * 100).toFixed(0)}%)`,
        metricValue: Number(sub15Acc.toFixed(3)),
        threshold: 0.88,
        timestampMs: now,
      });
    }

    if (zScore >= Z_THRESHOLD_LOCKOUT) {
      warnings.push({
        code: "CRITICAL_IPR_ZSCORE",
        severity: "CRITICAL",
        message: `Observed IPR ${Math.round(observedIpr)} exceeds +2.5σ threshold (Z=${zScore.toFixed(2)})`,
        metricValue: Number(zScore.toFixed(2)),
        threshold: Z_THRESHOLD_LOCKOUT,
        timestampMs: now,
      });
    } else if (zScore >= Z_THRESHOLD_ELEVATED) {
      warnings.push({
        code: "ELEVATED_IPR_ZSCORE",
        severity: "WARN",
        message: `Elevated IPR Z-score (${zScore.toFixed(2)} ≥ ${Z_THRESHOLD_ELEVATED})`,
        metricValue: Number(zScore.toFixed(2)),
        threshold: Z_THRESHOLD_ELEVATED,
        timestampMs: now,
      });
    }

    if (currentSpikes >= SPIKE_THRESHOLD_LOCKOUT || zScore >= Z_THRESHOLD_LOCKOUT) {
      this.lockedOut = true;
      if (!this.lockoutReason) {
        this.lockoutReason =
          currentSpikes >= SPIKE_THRESHOLD_LOCKOUT
            ? `Lockout: ${currentSpikes} S_i critical spikes in single game`
            : `Lockout: IPR Z-score ${zScore.toFixed(2)} >= ${Z_THRESHOLD_LOCKOUT}`;
      }
    }

    let riskLevel: FairPlayRiskLevel = "SAFE";
    if (this.lockedOut) {
      riskLevel = "LOCKOUT";
    } else if (zScore >= Z_THRESHOLD_ELEVATED || (currentSpikes >= 1 && zScore >= 1.25)) {
      riskLevel = "ELEVATED";
    }

    return {
      riskLevel,
      lockedOut: this.lockedOut,
      lockoutReason: this.lockoutReason,
      baselineElo: Math.round(this.baselineElo),
      observedIpr: Math.round(observedIpr),
      sigmaIpr: Number(sigmaIpr.toFixed(1)),
      zScore: Number(zScore.toFixed(2)),
      currentGameMoves: this.currentMoves.length,
      currentGameSiSpikes: currentSpikes,
      slidingWindowGames: this.windowGames.length,
      acpl: Number(combinedAcpl.toFixed(1)),
      stdcpl: Number(currentStdcpl.toFixed(1)),
      meanPartialCredit: Number(combinedCredit.toFixed(3)),
      moveTimeMeanMs: Math.round(moveTimeMeanMs),
      moveTimeCv: Number(moveTimeCv.toFixed(3)),
      sub15sMoves: sub15.length,
      sub15sAccuracy: Number(sub15Acc.toFixed(3)),
      warnings: dedupeWarnings(warnings),
    };
  }
}

export function expectedScoreFromLine(line: EngineLine): number {
  if (line.wdl && line.wdl.length === 3) {
    const total = line.wdl[0] + line.wdl[1] + line.wdl[2];
    if (total > 0) {
      return (line.wdl[0] + 0.5 * line.wdl[1]) / total;
    }
  }
  const cp = comparableCp(line);
  return 1 / (1 + Math.exp(-0.00368208 * cp));
}

function summarizeMoves(
  gameId: string,
  baselineElo: number,
  moves: readonly CompletedMoveRecord[],
  observedIpr: number
): GameTelemetrySummary {
  const times = moves.map((m) => m.elapsedMs);
  const tMean = mean(times);
  const moveTimeCv = times.length >= 2 && tMean > 0 ? stdDev(times) / tMean : 0.45;
  const sub15 = moves.filter((m) => m.remainingClockMs !== null && m.remainingClockMs < 15_000);
  return {
    gameId,
    completedAtMs: Date.now(),
    baselineElo: Math.round(baselineElo),
    observedIpr: Math.round(observedIpr),
    moveCount: moves.length,
    acpl: Number(mean(moves.map((m) => m.cpLoss)).toFixed(1)),
    stdcpl: Number(stdDev(moves.map((m) => m.cpLoss)).toFixed(1)),
    meanPartialCredit: Number(mean(moves.map((m) => m.partialCredit)).toFixed(3)),
    moveTimeCv: Number(moveTimeCv.toFixed(3)),
    siSpikes: moves.filter((m) => m.isSiSpike).length,
    sub15sMoves: sub15.length,
    sub15sAccuracy: sub15.length > 0 ? Number(mean(sub15.map((m) => m.partialCredit)).toFixed(3)) : 0,
  };
}

function dedupeWarnings(
  items: readonly FairPlayDiagnosticWarning[]
): FairPlayDiagnosticWarning[] {
  const seen = new Set<DiagnosticCode>();
  const out: FairPlayDiagnosticWarning[] = [];
  for (const w of items) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      out.push(w);
    }
  }
  return out;
}

function expectedPartialCreditForElo(elo: number): number {
  const norm = clamp((elo - 600) / 2200, 0, 1);
  return 0.42 + norm * 0.4;
}

function expectedAcplForElo(elo: number): number {
  const norm = clamp((elo - 600) / 2200, 0, 1);
  return 108 - norm * 86;
}

function normalizeUci4(uci: string): string {
  return (uci || "").trim().toLowerCase().slice(0, 4);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - avg) * (v - avg), 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
