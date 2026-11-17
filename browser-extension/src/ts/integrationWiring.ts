import { FairPlayAuditor, type RecordMoveInput } from "./fairPlayAuditor.ts";
import type {
  FairPlayAdaptivePolicy,
  FairPlayMetricsSnapshot,
  FairPlayStorageAdapter,
} from "./fairPlayModels.ts";
import type { HumanizerConfig } from "./humanizerConfig.ts";
import {
  HumanizerController,
  type HumanizerDecision,
} from "./humanizerController.ts";
import type {
  ClockTelemetryPort,
  EngineAnalysis,
  EngineAnalyzeOptions,
  EnginePort,
  OverlayRenderPort,
  PolicyPort,
} from "./ports.ts";

export interface PipelineDependencies {
  readonly enginePort: EnginePort;
  readonly policyPort: PolicyPort;
  readonly clockPort: ClockTelemetryPort;
  readonly overlayPort: OverlayRenderPort;
  readonly storage?: FairPlayStorageAdapter | null;
  readonly config?: Partial<HumanizerConfig>;
}

/**
 * Coordinates the live board-to-engine-to-overlay pipeline:
 * 1. Cancels pending overlay timers immediately on board mutation.
 * 2. Audits completed player moves against the prior position's MultiPV + WDL + shallow depth 6 data.
 * 3. Runs HumanizerController before dispatching any draw command to the existing Shadow DOM / SVG overlay renderer.
 */
export class ChessForgeHumanizedPipeline {
  private readonly enginePort: EnginePort;
  private readonly policyPort: PolicyPort;
  private readonly clockPort: ClockTelemetryPort;
  private readonly overlayPort: OverlayRenderPort;
  private readonly auditor: FairPlayAuditor;
  private readonly controller: HumanizerController;

  private lastAnalyzedState: {
    fen: string;
    analysis: EngineAnalysis;
    capturedAtMs: number;
  } | null = null;

  constructor(deps: PipelineDependencies) {
    this.enginePort = deps.enginePort;
    this.policyPort = deps.policyPort;
    this.clockPort = deps.clockPort;
    this.overlayPort = deps.overlayPort;
    this.auditor = new FairPlayAuditor({
      baselineElo: deps.config?.targetElo ?? 1500,
      storage: deps.storage ?? null,
    });
    this.controller = new HumanizerController(
      deps.config ?? {},
      this.policyPort,
      this.clockPort,
      this.overlayPort,
      this.auditor
    );
  }

  async initialize(): Promise<void> {
    await this.auditor.loadPersistedWindow();
    this.overlayPort.updateFairPlayBadge(this.auditor.getSnapshot());
  }

  getAuditor(): FairPlayAuditor {
    return this.auditor;
  }

  getController(): HumanizerController {
    return this.controller;
  }

  getFairPlaySnapshot(): FairPlayMetricsSnapshot {
    return this.auditor.getSnapshot();
  }

  getRiskPolicy(): FairPlayAdaptivePolicy {
    return this.auditor.getRiskPolicy();
  }

  updateConfig(partial: Partial<HumanizerConfig>): void {
    this.controller.updateConfig(partial);
    this.overlayPort.updateFairPlayBadge(this.auditor.getSnapshot());
  }

  async onBoardStateObserved(
    fen: string,
    playedUciFromPrev: string | null,
    analyzeOptions: EngineAnalyzeOptions,
    options: { readonly isHumanTurn?: boolean; readonly immediateForTest?: boolean } = {}
  ): Promise<HumanizerDecision> {
    this.controller.onBoardMutated(fen);
    const now = Date.now();

    // If a move was just completed from the previously analyzed state, audit it first
    if (
      this.lastAnalyzedState &&
      this.lastAnalyzedState.fen !== fen &&
      playedUciFromPrev
    ) {
      const prev = this.lastAnalyzedState;
      const priors = await this.policyPort.predictHumanPriors(
        prev.fen,
        prev.analysis.lines,
        this.controller.getConfig().targetElo
      );
      const clockSnap = this.clockPort.readClocks(prev.analysis.turn);
      const recordInput: RecordMoveInput = {
        fenBefore: prev.fen,
        playedUci: playedUciFromPrev,
        analysisBefore: prev.analysis,
        humanPrior: priors.get(playedUciFromPrev) ?? 0.05,
        elapsedMs: Math.max(250, now - prev.capturedAtMs),
        remainingClockMs: clockSnap.activeRemainingMs,
        timestampMs: now,
      };
      this.auditor.recordCompletedMove(recordInput);
      this.overlayPort.updateFairPlayBadge(this.auditor.getSnapshot());
    }

    const analysis = await this.enginePort.analyze(fen, {
      ...analyzeOptions,
      multiPv: Math.max(4, analyzeOptions.multiPv),
    });
    this.lastAnalyzedState = { fen, analysis, capturedAtMs: Date.now() };

    if (options.isHumanTurn === false) {
      this.overlayPort.clearOverlay("OPPONENT_TURN");
      return {
        status: "SUPPRESSED",
        reason: "DISABLED",
        expectedScoreDelta: 0,
        complexityScore: 0,
        delayMs: 0,
      };
    }

    return this.controller.evaluateAndScheduleDraw(analysis, {
      immediateForTest: options.immediateForTest,
    });
  }

  async endGame(gameId: string): Promise<void> {
    await this.auditor.finishGame(gameId);
    this.controller.resetGame();
    this.lastAnalyzedState = null;
    this.overlayPort.updateFairPlayBadge(this.auditor.getSnapshot());
  }

  dispose(): void {
    this.controller.cancelPending("DISPOSED");
  }
}
