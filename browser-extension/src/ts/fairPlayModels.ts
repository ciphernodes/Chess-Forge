/**
 * Strictly typed telemetry, diagnostic, and circuit-breaker models
 * for FairPlayAuditor across a 20-game sliding window.
 */

export type FairPlayRiskLevel = "SAFE" | "ELEVATED" | "LOCKOUT";

export type DiagnosticSeverity = "INFO" | "WARN" | "CRITICAL";

export type DiagnosticCode =
  | "RAPID_CRITICAL_MATCH"
  | "FLAT_MOVE_CADENCE"
  | "ELEVATED_IPR_ZSCORE"
  | "CRITICAL_IPR_ZSCORE"
  | "SUB_15S_ENGINE_PRECISION"
  | "LOCKOUT_SPIKE_LIMIT";

export interface FairPlayDiagnosticWarning {
  readonly code: DiagnosticCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly metricValue: number;
  readonly threshold: number;
  readonly timestampMs: number;
}

export interface CompletedMoveRecord {
  readonly fenBefore: string;
  readonly playedUci: string;
  readonly cpLoss: number;
  readonly wdlLoss: number;
  readonly partialCredit: number; // [0, 1]
  readonly humanPrior: number; // [0, 1]
  readonly elapsedMs: number;
  readonly remainingClockMs: number | null;
  readonly isCriticalTrap: boolean;
  readonly matchedDeepOnlyWin: boolean;
  readonly siScore: number;
  readonly isSiSpike: boolean;
  readonly timestampMs: number;
}

export interface GameTelemetrySummary {
  readonly gameId: string;
  readonly completedAtMs: number;
  readonly baselineElo: number;
  readonly observedIpr: number;
  readonly moveCount: number;
  readonly acpl: number;
  readonly stdcpl: number;
  readonly meanPartialCredit: number;
  readonly moveTimeCv: number;
  readonly siSpikes: number;
  readonly sub15sMoves: number;
  readonly sub15sAccuracy: number;
}

export interface PersistedAuditorWindow {
  readonly baselineElo: number;
  readonly games: GameTelemetrySummary[];
}

export interface FairPlayMetricsSnapshot {
  readonly riskLevel: FairPlayRiskLevel;
  readonly lockedOut: boolean;
  readonly lockoutReason: string | null;
  readonly baselineElo: number;
  readonly observedIpr: number;
  readonly sigmaIpr: number;
  readonly zScore: number;
  readonly currentGameMoves: number;
  readonly currentGameSiSpikes: number;
  readonly slidingWindowGames: number;
  readonly acpl: number;
  readonly stdcpl: number;
  readonly meanPartialCredit: number;
  readonly moveTimeMeanMs: number;
  readonly moveTimeCv: number;
  readonly sub15sMoves: number;
  readonly sub15sAccuracy: number;
  readonly warnings: FairPlayDiagnosticWarning[];
}

export interface FairPlayAdaptivePolicy {
  readonly riskLevel: FairPlayRiskLevel;
  readonly blockAllOverlays: boolean;
  readonly temperatureMultiplier: number;
  readonly criticalWdlDeltaAdd: number;
  readonly minDelayBoostMs: number;
  readonly badgeText: string;
}

export interface FairPlayStorageAdapter {
  get(key: string): Promise<unknown>;
  set(items: Record<string, unknown>): Promise<void>;
}

export const FAIR_PLAY_STORAGE_KEY = "chessForgeFairPlayWindowV1";
export const FAIR_PLAY_WINDOW_SIZE = 20;
export const Z_THRESHOLD_ELEVATED = 1.8;
export const Z_THRESHOLD_LOCKOUT = 2.5;
export const SPIKE_THRESHOLD_LOCKOUT = 2;
