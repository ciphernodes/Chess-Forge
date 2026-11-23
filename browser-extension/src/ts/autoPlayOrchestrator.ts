import {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  HUMANIZED_AUTOPLAY_PRESETS,
  getAutoPlayPreset,
  parseUciMoveSquares,
  type BoardGeometryPort,
  type BoardStateObserverPort,
  type BoardStateSnapshot,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EloPresetId,
  type EngineMultiPvPort,
  type EngineMultiPvResult,
  type HumanizedAutoPlayPreset,
  type KinematicExecutorConfig,
  type MoveSelectorConfig,
  type OrchestratorTimingConfig,
  type PieceColor,
} from "./autoPlayPorts.ts";
import {
  HumanizerMoveSelector,
  lineToComparableCp,
  type HumanPriorsInput,
  type MoveSelectionResult,
} from "./humanizerMoveSelector.ts";
import {
  AbortExecutionError,
  KinematicPointerExecutor,
  sampleGaussian2D,
  type FrameScheduler,
  type PointerExecutionResult,
} from "./kinematicPointerExecutor.ts";
import {
  BookAndTablebaseRouter,
  type BookAndTablebaseRouterConfig,
  type OpeningBookPort,
  type TablebasePort,
} from "./bookAndTablebaseRouter.ts";
import type { DualStateReconciler } from "./dualStateReconciler.ts";
import type {
  FairPlayEventBus,
  RiskLevelChangedEvent,
} from "./fairPlayEventBus.ts";
import type { OverlayRenderPort } from "./ports.ts";
import type { BehavioralStateMachine } from "./behavioralStateMachine.ts";
import type {
  MonotonicClockTracker,
  SessionPacingManager,
} from "./clockAndSessionManager.ts";
import type { GradualRatingCalibrator } from "./openingPreferenceMatrix.ts";
import type {
  InputModeDecision,
  InputModeController,
} from "./inputModeController.ts";
import type {
  PromotionHandler,
  PromotionResolutionResult,
} from "./promotionHandler.ts";

export {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  HUMANIZED_AUTOPLAY_PRESETS,
  getAutoPlayPreset,
  type BoardGeometryPort,
  type BoardStateObserverPort,
  type BoardStateSnapshot,
  type ClockStatePort,
  type EloPresetId,
  type EngineMultiPvPort,
  type HumanizedAutoPlayPreset,
  type OrchestratorTimingConfig,
};

export interface ComplexityMetrics {
  readonly complexityScore: number;
  readonly isObviousRecapture: boolean;
  readonly branchingComponent: number;
  readonly tacticalComponent: number;
  readonly depthDivergenceComponent: number;
}

export interface ThinkDelayCalculation {
  readonly delayMs: number;
  readonly baseLogNormalMs: number;
  readonly clockCompressionFactor: number;
  readonly remainingClockMs: number | null;
  readonly complexity: ComplexityMetrics;
}

export type OrchestratorAbortReason =
  | "DISABLED_OR_PAUSED"
  | "NOT_CONTROLLED_TURN"
  | "FEN_CHANGED_DURING_ANALYSIS"
  | "FEN_CHANGED_BEFORE_EXECUTION"
  | "USER_MOUSE_MOVEMENT"
  | "CONTROLLER_PAUSED"
  | "NO_PLAUSIBLE_MOVE"
  | "INVALID_UCI_MOVE"
  | "EXECUTION_ABORTED"
  | "DEGRADED_READ_ONLY_MODE"
  | "FAIR_PLAY_RISK_HALT"
  | "SESSION_COOLDOWN_ACTIVE"
  | "DISPOSED";

export interface AutoPlayCycleResult {
  readonly status: "EXECUTED" | "ABORTED" | "SKIPPED" | "NO_MOVE";
  readonly fen: string;
  readonly reason?: OrchestratorAbortReason;
  readonly selectedMoveUci?: string;
  readonly source?: "OPENING_BOOK" | "TABLEBASE" | "ENGINE";
  readonly selection?: MoveSelectionResult;
  readonly delayCalculation?: ThinkDelayCalculation;
  readonly pointerResult?: PointerExecutionResult;
  readonly inputModeDecision?: InputModeDecision;
  readonly promotionResult?: PromotionResolutionResult;
  readonly thinkWaitCompletedAtMs?: number;
}

export interface OrchestratorRiskReactionConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing behavior. */
  readonly enabled: boolean;
  /** Action taken when FairPlayAuditor transitions to ELEVATED (default "PAUSE"). */
  readonly onElevated?: "PAUSE" | "STEP_DOWN_ELO";
  /** Optional OverlayRenderPort cleared immediately upon LOCKOUT. */
  readonly overlayPort?: OverlayRenderPort | null;
}

export interface AutoPlayOrchestratorOptions {
  readonly controlledSide: PieceColor | "both";
  readonly enabled?: boolean;
  readonly activeEloPreset?: EloPresetId;
  readonly timingConfig?: Partial<OrchestratorTimingConfig>;
  readonly bookAndTablebaseConfig?: Partial<BookAndTablebaseRouterConfig>;
  readonly riskReactionConfig?: Partial<OrchestratorRiskReactionConfig>;
  readonly humanPriorsProvider?: (
    fen: string,
    analysis: EngineMultiPvResult
  ) => Promise<HumanPriorsInput | undefined> | HumanPriorsInput | undefined;
  readonly onCycleComplete?: (result: AutoPlayCycleResult) => void;
  readonly delayWaiter?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Phase 2 opt-in extensions (disabled by default unless collaborator `.isEnabled()` is true). */
  readonly opponentElo?: number;
  readonly useOnnxPolicy?: boolean;
  readonly timeControl?: {
    readonly initialTimeMs: number;
    readonly incrementMs: number;
  };
}

export const DEFAULT_ORCHESTRATOR_TIMING_CONFIG: OrchestratorTimingConfig =
  ELO_1600_PRESET.orchestrator;

/**
 * Computes normalized position complexity in [0, 1] from legal move count,
 * available checks/captures, and depth-6 vs depth-16 evaluation divergence.
 */
export function computePositionComplexityMetrics(
  board: BoardStateSnapshot,
  analysis: EngineMultiPvResult,
  selection: MoveSelectionResult
): ComplexityMetrics {
  const legalMoves = analysis.legalMoveCount ?? board.legalMoveCount ?? 26;
  const checks = analysis.availableChecksCount ?? board.availableChecksCount ?? 1;
  const captures =
    analysis.availableCapturesCount ?? board.availableCapturesCount ?? 2;

  const branchingComponent = clamp((legalMoves - 6) / 38, 0, 1);
  const tacticalComponent = clamp((checks + captures) / 10, 0, 1);

  let depthDivergenceComponent = 0;
  const shallow = analysis.shallowDepth6;
  const deepLine = analysis.deepDepth16
    ? {
        move: analysis.deepDepth16.bestMove,
        centipawns: analysis.deepDepth16.centipawns,
        mate: analysis.deepDepth16.mate ?? null,
        rank: 1,
        depth: analysis.deepDepth16.depth,
      }
    : analysis.lines[0];

  if (shallow && deepLine) {
    const shallowCp =
      shallow.mate !== null && shallow.mate !== undefined
        ? shallow.mate > 0
          ? 10_000
          : -10_000
        : shallow.centipawns ?? 0;
    const deepCp = lineToComparableCp(deepLine);
    const cpSwing = clamp(Math.abs(deepCp - shallowCp) / 220, 0, 1);
    const moveMismatch =
      shallow.bestMove.slice(0, 4).toLowerCase() !==
      deepLine.move.slice(0, 4).toLowerCase();
    depthDivergenceComponent = moveMismatch
      ? Math.max(0.65, cpSwing)
      : cpSwing * 0.55;
  }

  const isObviousRecapture = Boolean(
    board.isRecaptureOpportunity ||
      analysis.isRecaptureOpportunity ||
      selection.recaptureExceptionApplied ||
      (selection.selected?.line.isRecapture &&
        selection.expectedScoreDelta >= 0.14 &&
        depthDivergenceComponent < 0.35)
  );

  if (isObviousRecapture) {
    const damped = clamp(
      0.08 * branchingComponent + 0.1 * tacticalComponent,
      0,
      0.16
    );
    return {
      complexityScore: Number(damped.toFixed(4)),
      isObviousRecapture: true,
      branchingComponent,
      tacticalComponent,
      depthDivergenceComponent,
    };
  }

  const complexityScore = clamp(
    0.32 * branchingComponent +
      0.33 * tacticalComponent +
      0.35 * depthDivergenceComponent,
    0,
    1
  );

  return {
    complexityScore: Number(complexityScore.toFixed(4)),
    isObviousRecapture: false,
    branchingComponent,
    tacticalComponent,
    depthDivergenceComponent,
  };
}

/**
 * Samples a thinking delay from a log-normal distribution scaled by position complexity
 * (0.9s-1.8s obvious recaptures, 3.5s-8.5s complex middlegames) and compressed
 * proportionally under low remaining clock time.
 */
export function sampleComplexityThinkDelay(
  complexity: ComplexityMetrics,
  clockSnapshot: ClockStateSnapshot | null | undefined,
  config: OrchestratorTimingConfig = DEFAULT_ORCHESTRATOR_TIMING_CONFIG
): ThinkDelayCalculation {
  const rng = config.randomFn ?? Math.random;
  const c = complexity.isObviousRecapture
    ? clamp(complexity.complexityScore, 0, 0.12)
    : clamp(complexity.complexityScore, 0, 1);

  const minMs =
    config.obviousRecaptureMinMs +
    c * (config.complexMiddlegameMinMs - config.obviousRecaptureMinMs);
  const maxMs =
    config.obviousRecaptureMaxMs +
    c * (config.complexMiddlegameMaxMs - config.obviousRecaptureMaxMs);

  const geometricMedian = Math.sqrt(Math.max(1, minMs) * Math.max(1, maxMs));
  const mu = Math.log(geometricMedian);
  const sigma = 0.15 + c * 0.11;

  const gaussian = sampleGaussian2D(rng);
  const clippedZ = clamp(gaussian.x, -1.5, 1.5);
  const baseLogNormalMs = Math.round(
    clamp(Math.exp(mu + sigma * clippedZ), minMs, maxMs)
  );

  const remainingClockMs = clockSnapshot?.activeRemainingMs ?? null;
  let clockCompressionFactor = 1.0;

  if (
    remainingClockMs !== null &&
    remainingClockMs < config.clockCompressionStartMs
  ) {
    if (remainingClockMs < config.timeTroubleThresholdMs) {
      const troubleProgress = clamp(
        remainingClockMs / Math.max(1, config.timeTroubleThresholdMs),
        0,
        1
      );
      clockCompressionFactor = 0.18 + troubleProgress * 0.3;
    } else {
      const span = Math.max(
        1,
        config.clockCompressionStartMs - config.timeTroubleThresholdMs
      );
      const upperProgress = clamp(
        (remainingClockMs - config.timeTroubleThresholdMs) / span,
        0,
        1
      );
      clockCompressionFactor = 0.48 + upperProgress * 0.52;
    }
  }

  const scaledMs = Math.round(
    baseLogNormalMs * config.ratingPacingMultiplier * clockCompressionFactor
  );
  const delayMs = Math.max(config.minThinkFloorMs, scaledMs);

  return {
    delayMs,
    baseLogNormalMs,
    clockCompressionFactor: Number(clockCompressionFactor.toFixed(3)),
    remainingClockMs,
    complexity,
  };
}

/**
 * Coordinates turn observation, complexity-scaled log-normal think delays,
 * manual mouse/pause cancellation guards, FEN re-verification, and pointer execution.
 */
export class AutoPlayOrchestrator {
  private readonly boardObserver: BoardStateObserverPort;
  private readonly boardGeometry: BoardGeometryPort;
  private readonly enginePort: EngineMultiPvPort;
  private readonly clockPort: ClockStatePort;
  private readonly moveSelector: HumanizerMoveSelector;
  private readonly pointerExecutor: KinematicPointerExecutor;

  private controlledSide: PieceColor | "both";
  private timingConfig: OrchestratorTimingConfig;
  private enabled: boolean;
  private paused = false;
  private disposed = false;
  private manualMouseInterrupted = false;

  private activeAbortController: AbortController | null = null;
  private lastHandledFen: string | null = null;
  private activeCyclePromise: Promise<AutoPlayCycleResult> | null = null;

  private unsubscribeBoard: (() => void) | null = null;
  private detachPointerListeners: (() => void) | null = null;

  private readonly humanPriorsProvider?: AutoPlayOrchestratorOptions["humanPriorsProvider"];
  private readonly onCycleComplete?: (result: AutoPlayCycleResult) => void;
  private readonly delayWaiter: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly bookAndTablebaseRouter: BookAndTablebaseRouter | null;
  private readonly dualStateReconciler: DualStateReconciler | null;
  private readonly fairPlayEventBus: FairPlayEventBus | null;
  private readonly riskReactionConfig: OrchestratorRiskReactionConfig;
  private readonly behavioralStateMachine: BehavioralStateMachine | null;
  private readonly sessionPacingManager: SessionPacingManager | null;
  private readonly monotonicClockTracker: MonotonicClockTracker | null;
  private readonly ratingCalibrator: GradualRatingCalibrator | null;
  private readonly inputModeController: InputModeController | null;
  private readonly promotionHandler: PromotionHandler | null;
  private opponentElo: number | undefined;
  private readonly useOnnxPolicy: boolean;
  private timeControl:
    | { readonly initialTimeMs: number; readonly incrementMs: number }
    | undefined;
  private unsubscribeRiskBus: (() => void) | null = null;
  private riskLockoutHalted = false;
  private activeEloPreset: EloPresetId;

  constructor(
    ports: {
      readonly boardObserver: BoardStateObserverPort;
      readonly boardGeometry: BoardGeometryPort;
      readonly enginePort: EngineMultiPvPort;
      readonly clockPort: ClockStatePort;
      readonly moveSelector: HumanizerMoveSelector;
      readonly pointerExecutor: KinematicPointerExecutor;
      readonly openingBookPort?: OpeningBookPort;
      readonly tablebasePort?: TablebasePort | null;
      readonly bookAndTablebaseRouter?: BookAndTablebaseRouter | null;
      readonly dualStateReconciler?: DualStateReconciler | null;
      readonly fairPlayEventBus?: FairPlayEventBus | null;
      readonly behavioralStateMachine?: BehavioralStateMachine | null;
      readonly sessionPacingManager?: SessionPacingManager | null;
      readonly monotonicClockTracker?: MonotonicClockTracker | null;
      readonly ratingCalibrator?: GradualRatingCalibrator | null;
      readonly inputModeController?: InputModeController | null;
      readonly promotionHandler?: PromotionHandler | null;
    },
    options: AutoPlayOrchestratorOptions
  ) {
    this.boardObserver = ports.boardObserver;
    this.boardGeometry = ports.boardGeometry;
    this.enginePort = ports.enginePort;
    this.clockPort = ports.clockPort;
    this.moveSelector = ports.moveSelector;
    this.pointerExecutor = ports.pointerExecutor;

    this.controlledSide = options.controlledSide;
    this.enabled = options.enabled ?? true;
    this.activeEloPreset = options.activeEloPreset ?? 1600;
    this.timingConfig = {
      ...DEFAULT_ORCHESTRATOR_TIMING_CONFIG,
      ...options.timingConfig,
    };
    this.humanPriorsProvider = options.humanPriorsProvider;
    this.onCycleComplete = options.onCycleComplete;
    this.delayWaiter = options.delayWaiter ?? defaultAbortableWait;

    this.bookAndTablebaseRouter =
      ports.bookAndTablebaseRouter !== undefined
        ? ports.bookAndTablebaseRouter
        : ports.openingBookPort || ports.tablebasePort || options.bookAndTablebaseConfig
        ? new BookAndTablebaseRouter(
            {
              openingBookPort: ports.openingBookPort,
              tablebasePort: ports.tablebasePort ?? null,
            },
            { enabled: false, ...options.bookAndTablebaseConfig }
          )
        : null;

    this.dualStateReconciler = ports.dualStateReconciler ?? null;
    this.fairPlayEventBus = ports.fairPlayEventBus ?? null;
    this.behavioralStateMachine = ports.behavioralStateMachine ?? null;
    this.sessionPacingManager = ports.sessionPacingManager ?? null;
    this.monotonicClockTracker = ports.monotonicClockTracker ?? null;
    this.ratingCalibrator = ports.ratingCalibrator ?? null;
    this.inputModeController = ports.inputModeController ?? null;
    this.promotionHandler = ports.promotionHandler ?? null;
    this.opponentElo = options.opponentElo;
    this.useOnnxPolicy = options.useOnnxPolicy ?? false;
    this.timeControl = options.timeControl;

    this.riskReactionConfig = {
      enabled: false,
      onElevated: "PAUSE",
      overlayPort: null,
      ...options.riskReactionConfig,
    };

    if (this.fairPlayEventBus && this.riskReactionConfig.enabled) {
      this.attachFairPlayEventBus(
        this.fairPlayEventBus,
        this.riskReactionConfig
      );
    }
  }

  start(): void {
    if (this.disposed) return;
    this.paused = false;
    this.enabled = true;
    this.manualMouseInterrupted = false;

    if (!this.detachPointerListeners) {
      this.attachUserPointerGuard();
    }
    if (!this.unsubscribeBoard) {
      this.unsubscribeBoard = this.boardObserver.subscribe((snapshot) => {
        void this.handleBoardTransition(snapshot);
      });
    }

    const initial = this.boardObserver.getCurrentBoardState();
    if (initial) {
      void this.handleBoardTransition(initial);
    }
  }

  pause(): void {
    this.paused = true;
    this.abortActiveCycle("CONTROLLER_PAUSED");
  }

  resume(): void {
    if (this.disposed) return;
    this.paused = false;
    this.enabled = true;
    this.manualMouseInterrupted = false;
    this.lastHandledFen = null;
    const latest = this.boardObserver.getCurrentBoardState();
    if (latest) {
      void this.handleBoardTransition(latest);
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.abortActiveCycle("DISABLED_OR_PAUSED");
    } else {
      this.resume();
    }
  }

  setControlledSide(side: PieceColor | "both"): void {
    this.controlledSide = side;
  }

  updateTimingConfig(partial: Partial<OrchestratorTimingConfig>): void {
    this.timingConfig = { ...this.timingConfig, ...partial };
  }

  getActiveEloPreset(): EloPresetId {
    return this.activeEloPreset;
  }

  isAutonomousActive(): boolean {
    return (
      !this.disposed &&
      this.enabled &&
      !this.paused &&
      !this.manualMouseInterrupted &&
      !this.riskLockoutHalted &&
      (!this.dualStateReconciler || this.dualStateReconciler.isAutonomousAllowed())
    );
  }

  attachFairPlayEventBus(
    eventBus: FairPlayEventBus,
    config: Partial<OrchestratorRiskReactionConfig> = {}
  ): () => void {
    this.unsubscribeRiskBus?.();
    this.unsubscribeRiskBus = null;
    const effective: OrchestratorRiskReactionConfig = {
      ...this.riskReactionConfig,
      ...config,
    };
    if (!effective.enabled) {
      return () => {};
    }

    const onRisk = (event: RiskLevelChangedEvent): void => {
      if (event.currentLevel === "LOCKOUT") {
        this.riskLockoutHalted = true;
        this.paused = true;
        this.abortActiveCycle("FAIR_PLAY_RISK_HALT");
        effective.overlayPort?.clearOverlay("LOCKOUT");
      } else if (event.currentLevel === "ELEVATED") {
        if (effective.onElevated === "STEP_DOWN_ELO") {
          const nextElo: EloPresetId =
            this.activeEloPreset === 2000 ? 1600 : 1200;
          this.activeEloPreset = nextElo;
          const nextPreset = getAutoPlayPreset(nextElo);
          this.moveSelector.updateConfig(nextPreset.selector);
          this.pointerExecutor.updateConfig(nextPreset.executor);
          this.updateTimingConfig(nextPreset.orchestrator);
        } else {
          this.paused = true;
          this.abortActiveCycle("FAIR_PLAY_RISK_HALT");
        }
      } else if (event.currentLevel === "SAFE") {
        this.riskLockoutHalted = false;
      }
    };

    this.unsubscribeRiskBus = eventBus.onRiskLevelChanged(onRisk);
    return () => {
      this.unsubscribeRiskBus?.();
      this.unsubscribeRiskBus = null;
    };
  }

  /**
   * Immediately aborts any scheduled think delay, pending engine query, or active cursor drag.
   */
  notifyManualUserPointerActivity(): void {
    this.manualMouseInterrupted = true;
    this.abortActiveCycle("USER_MOUSE_MOVEMENT");
  }

  /**
   * Evaluates and executes a single board state transition cleanly.
   * Safe to invoke directly in tests or reactively via MutationObserver subscriptions.
   */
  async handleBoardTransition(
    snapshot: BoardStateSnapshot
  ): Promise<AutoPlayCycleResult> {
    if (
      this.dualStateReconciler &&
      this.dualStateReconciler.isEnabled() &&
      !this.dualStateReconciler.isAutonomousAllowed()
    ) {
      return {
        status: "SKIPPED",
        fen: snapshot.fen,
        reason: "DEGRADED_READ_ONLY_MODE",
      };
    }

    if (this.riskLockoutHalted) {
      return {
        status: "SKIPPED",
        fen: snapshot.fen,
        reason: "FAIR_PLAY_RISK_HALT",
      };
    }

    if (this.sessionPacingManager?.isEnabled()) {
      const capCheck = this.sessionPacingManager.canStartNewGame();
      if (!capCheck.allowed) {
        return {
          status: "SKIPPED",
          fen: snapshot.fen,
          reason: "SESSION_COOLDOWN_ACTIVE",
        };
      }
    }

    if (!this.isAutonomousActive()) {
      return {
        status: "SKIPPED",
        fen: snapshot.fen,
        reason: this.manualMouseInterrupted
          ? "USER_MOUSE_MOVEMENT"
          : "DISABLED_OR_PAUSED",
      };
    }

    if (
      this.controlledSide !== "both" &&
      snapshot.turn !== this.controlledSide
    ) {
      return {
        status: "SKIPPED",
        fen: snapshot.fen,
        reason: "NOT_CONTROLLED_TURN",
      };
    }

    if (this.lastHandledFen === snapshot.fen && this.activeCyclePromise) {
      return this.activeCyclePromise;
    }

    // Cancel any stale cycle from a previous board state before starting the new turn
    this.abortActiveCycle("FEN_CHANGED_DURING_ANALYSIS");
    this.lastHandledFen = snapshot.fen;

    const controller = new AbortController();
    this.activeAbortController = controller;

    const runPromise = this.runTurnPipeline(snapshot, controller.signal)
      .then((res) => {
        if (this.activeAbortController === controller) {
          this.activeAbortController = null;
        }
        this.onCycleComplete?.(res);
        return res;
      })
      .finally(() => {
        if (this.activeCyclePromise === runPromise) {
          this.activeCyclePromise = null;
        }
      });

    this.activeCyclePromise = runPromise;
    return runPromise;
  }

  dispose(): void {
    this.disposed = true;
    this.abortActiveCycle("DISPOSED");
    this.unsubscribeBoard?.();
    this.unsubscribeBoard = null;
    this.detachPointerListeners?.();
    this.detachPointerListeners = null;
    this.unsubscribeRiskBus?.();
    this.unsubscribeRiskBus = null;
  }

  private abortActiveCycle(reason: OrchestratorAbortReason): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort(reason);
      this.activeAbortController = null;
    }
  }

  private attachUserPointerGuard(): void {
    const doc = this.boardGeometry.getTargetDocument();
    if (!doc || typeof doc.addEventListener !== "function") return;

    const onUserPointerEvent = (ev: Event): void => {
      // Ignore synthetic events dispatched while KinematicPointerExecutor is mid-step,
      // UNLESS event.isTrusted === true (indicating physical hardware mouse override!).
      const isTrusted =
        typeof (ev as { isTrusted?: boolean }).isTrusted === "boolean"
          ? (ev as { isTrusted?: boolean }).isTrusted === true
          : false;

      if (this.pointerExecutor.isDispatching() && !isTrusted) {
        return;
      }

      if (this.activeAbortController || this.isAutonomousActive()) {
        this.notifyManualUserPointerActivity();
      }
    };

    const eventNames = ["pointermove", "mousemove", "pointerdown"] as const;
    for (const name of eventNames) {
      doc.addEventListener(name, onUserPointerEvent, {
        capture: true,
        passive: true,
      });
    }

    this.detachPointerListeners = () => {
      for (const name of eventNames) {
        doc.removeEventListener(name, onUserPointerEvent, { capture: true });
      }
    };
  }

  private async runTurnPipeline(
    snapshot: BoardStateSnapshot,
    signal: AbortSignal
  ): Promise<AutoPlayCycleResult> {
    const targetFen = snapshot.fen;
    const activeClockPort =
      this.monotonicClockTracker?.isEnabled()
        ? this.monotonicClockTracker
        : this.clockPort;
    const budget = this.moveSelector.getRecommendedSearchBudget(
      snapshot.turn,
      activeClockPort
    );

    // Resolve optional Phase 2 effective Elo & behavioral modifiers (all default disabled)
    const configuredElo = this.moveSelector.getConfig().targetElo;
    let calibratedBaseElo =
      this.ratingCalibrator?.isEnabled()
        ? this.ratingCalibrator.getEffectiveRating()
        : configuredElo;
    if (this.sessionPacingManager?.isEnabled() && this.timeControl) {
      const tc = this.sessionPacingManager.classifyTimeControl(
        this.timeControl.initialTimeMs,
        this.timeControl.incrementMs
      );
      if (tc.eloStepDown > 0) {
        calibratedBaseElo = Math.max(400, calibratedBaseElo - tc.eloStepDown);
      }
    }
    const behavioralProfile = this.behavioralStateMachine?.isEnabled()
      ? this.behavioralStateMachine.getEffectiveProfile(calibratedBaseElo)
      : null;
    const hasBehavioralAdjustments =
      this.ratingCalibrator?.isEnabled() === true ||
      this.behavioralStateMachine?.isEnabled() === true ||
      (this.sessionPacingManager?.isEnabled() === true &&
        this.timeControl !== undefined);
    const effectiveEloForTurn = behavioralProfile
      ? behavioralProfile.effectiveElo
      : calibratedBaseElo;

    let routedSource: "OPENING_BOOK" | "TABLEBASE" | "ENGINE" = "ENGINE";
    let directRoutedUci: string | null = null;
    let analysis: EngineMultiPvResult;

    if (this.bookAndTablebaseRouter?.isEnabled()) {
      try {
        const routed = await this.bookAndTablebaseRouter.resolveTurn(
          targetFen,
          snapshot.turn,
          snapshot.moveNumber,
          { targetElo: effectiveEloForTurn }
        );
        if (routed.handled && routed.selectedMoveUci) {
          routedSource =
            routed.source === "OPENING_BOOK" ? "OPENING_BOOK" : "TABLEBASE";
          directRoutedUci = routed.selectedMoveUci;
          analysis = {
            fen: targetFen,
            depth: routedSource === "TABLEBASE" ? 64 : 1,
            lines: routed.candidateLines,
          };
        } else {
          analysis = await this.enginePort.analyzeMultiPv({
            fen: targetFen,
            multiPv: 4,
            maxDepth: budget.recommendedDepth,
            movetimeMs: budget.recommendedThinkTimeMs,
            signal,
          });
        }
      } catch (err) {
        return this.mapAbortOrError(targetFen, signal, err);
      }
    } else {
      try {
        analysis = await this.enginePort.analyzeMultiPv({
          fen: targetFen,
          multiPv: 4,
          maxDepth: budget.recommendedDepth,
          movetimeMs: budget.recommendedThinkTimeMs,
          signal,
        });
      } catch (err) {
        return this.mapAbortOrError(targetFen, signal, err);
      }
    }

    if (signal.aborted) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: resolveAbortReason(signal),
      };
    }

    if (!this.isAutonomousActive()) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: this.riskLockoutHalted
          ? "FAIR_PLAY_RISK_HALT"
          : this.manualMouseInterrupted
          ? "USER_MOUSE_MOVEMENT"
          : "CONTROLLER_PAUSED",
      };
    }

    const latestAfterSearch = this.boardObserver.getCurrentBoardState();
    if (latestAfterSearch && latestAfterSearch.fen !== targetFen) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: "FEN_CHANGED_DURING_ANALYSIS",
      };
    }

    const clockSnap = activeClockPort.readClockState(snapshot.turn);
    let selection: MoveSelectionResult;

    if (directRoutedUci && analysis.lines.length > 0) {
      const matchedLine =
        analysis.lines.find((l) => l.move === directRoutedUci) ??
        analysis.lines[0];
      selection = {
        selected: {
          line: matchedLine,
          wdl: [0.5, 0.35, 0.15],
          expectedScore: 0.675,
          cpLoss: 0,
          humanPrior: 1.0,
          utility: 1.0,
          probability: 1.0,
        },
        distribution: [
          {
            line: matchedLine,
            wdl: [0.5, 0.35, 0.15],
            expectedScore: 0.675,
            cpLoss: 0,
            humanPrior: 1.0,
            utility: 1.0,
            probability: 1.0,
          },
        ],
        expectedScoreDelta: 0.05,
        isCriticalPosition: false,
        recaptureExceptionApplied: false,
        excludedBlunderMoves: [],
        excludedComputerTactics: [],
        temperatureUsed: budget.temperatureMultiplier,
        lambdaUsed: 0.019,
        effectiveBlunderCapCp: this.moveSelector.getConfig().maxAllowedBlunderCp,
        searchBudget: budget,
        regime: "QUIET_NATURAL_HUMAN",
      };
    } else {
      const suppliedPriors = this.humanPriorsProvider
        ? await this.humanPriorsProvider(targetFen, analysis)
        : undefined;

      const lastDestSq =
        snapshot.lastMoveUci && snapshot.lastMoveUci.length >= 4
          ? snapshot.lastMoveUci.slice(2, 4)
          : null;

      const selectionReq = {
        fen: targetFen,
        turn: snapshot.turn,
        lines: analysis.lines,
        humanPriors: suppliedPriors,
        clockSnapshot: clockSnap,
        lastOpponentDestinationSquare: lastDestSq,
        ...(hasBehavioralAdjustments
          ? {
              effectiveTargetEloOverride: effectiveEloForTurn,
              temperatureMultiplierOverride:
                behavioralProfile?.temperatureMultiplier,
              blunderCapAddCpOverride: behavioralProfile?.blunderCapAddCp,
              panicModeActive: behavioralProfile?.isPanicMode,
            }
          : {}),
      };

      selection =
        this.useOnnxPolicy && this.moveSelector.isOnnxPolicyEnabled()
          ? await this.moveSelector.selectMoveWithOnnx(selectionReq)
          : this.moveSelector.selectMove(selectionReq);

      if (!selection.selected) {
        return {
          status: "NO_MOVE",
          fen: targetFen,
          reason: "NO_PLAUSIBLE_MOVE",
          selection,
        };
      }
    }

    const squares = parseUciMoveSquares(selection.selected.line.move);
    if (!squares) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: "INVALID_UCI_MOVE",
        selection,
      };
    }

    const complexity = computePositionComplexityMetrics(
      snapshot,
      analysis,
      selection
    );
    let delayCalculation = sampleComplexityThinkDelay(
      complexity,
      clockSnap,
      this.timingConfig
    );

    if (
      behavioralProfile ||
      this.sessionPacingManager?.isEnabled() ||
      this.monotonicClockTracker?.isEnabled()
    ) {
      let adjustedMs = delayCalculation.delayMs;
      if (behavioralProfile) {
        adjustedMs = Math.round(adjustedMs * behavioralProfile.thinkTimeMultiplier);
      }
      if (this.monotonicClockTracker?.isEnabled()) {
        const curve = this.monotonicClockTracker.getTimeControlCurve(snapshot.turn);
        adjustedMs = Math.max(
          curve.recommendedFloorMs,
          Math.round(
            delayCalculation.baseLogNormalMs *
              this.timingConfig.ratingPacingMultiplier *
              curve.compressionFactor *
              (behavioralProfile?.thinkTimeMultiplier ?? 1.0)
          )
        );
      }
      if (this.sessionPacingManager?.isEnabled()) {
        const oppMult = this.sessionPacingManager.computeOpponentEloMultiplier(
          effectiveEloForTurn,
          this.opponentElo
        );
        const circMult = this.sessionPacingManager.computeCircadianMultiplier();
        const openingFloor = this.sessionPacingManager.sampleOpeningPacingFloorMs(
          snapshot.moveNumber ?? 10
        );
        adjustedMs = Math.max(
          openingFloor,
          Math.round(adjustedMs * oppMult * circMult)
        );
        this.sessionPacingManager.recordThinkTimeObservation(
          adjustedMs,
          budget.recommendedDepth,
          complexity.complexityScore
        );
      }
      delayCalculation = {
        ...delayCalculation,
        delayMs: Math.max(this.timingConfig.minThinkFloorMs, adjustedMs),
      };
    }

    // Execute ALL think-time delays strictly BEFORE pointer movement starts
    // so move packets transmit immediately upon pointer release without buffering.
    let thinkWaitCompletedAtMs = Date.now();
    try {
      await this.delayWaiter(delayCalculation.delayMs, signal);
      thinkWaitCompletedAtMs = Date.now();
    } catch (err) {
      return this.mapAbortOrError(
        targetFen,
        signal,
        err,
        selection,
        delayCalculation
      );
    }

    // Strict pre-execution guard: re-verify autonomous state, zero manual mouse activity,
    // and identical FEN + controlled turn immediately prior to pointer dispatch.
    if (signal.aborted) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: resolveAbortReason(signal),
        selection,
        delayCalculation,
      };
    }

    if (!this.isAutonomousActive()) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: this.manualMouseInterrupted
          ? "USER_MOUSE_MOVEMENT"
          : "CONTROLLER_PAUSED",
        selection,
        delayCalculation,
      };
    }

    const latestBeforePointer = this.boardObserver.getCurrentBoardState();
    if (!latestBeforePointer || latestBeforePointer.fen !== targetFen) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: "FEN_CHANGED_BEFORE_EXECUTION",
        selection,
        delayCalculation,
      };
    }

    if (
      this.controlledSide !== "both" &&
      latestBeforePointer.turn !== this.controlledSide
    ) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: "NOT_CONTROLLED_TURN",
        selection,
        delayCalculation,
      };
    }

    const inputModeDecision = this.inputModeController?.isEnabled()
      ? this.inputModeController.selectInputMode({
          targetElo: effectiveEloForTurn,
          remainingClockMs: clockSnap.activeRemainingMs,
          isOpponentTurn: false,
        })
      : undefined;
    const interactionModeOverride =
      inputModeDecision && inputModeDecision.inputMode !== "premove"
        ? inputModeDecision.inputMode
        : undefined;

    const derivedPly = snapshot.moveNumber
      ? (snapshot.moveNumber - 1) * 2 + (snapshot.turn === "b" ? 1 : 0)
      : undefined;
    const positionCriticality = clamp(
      selection.expectedScoreDelta * 3.0 + complexity.complexityScore * 0.4,
      0,
      1
    );

    const pointerResult = await this.pointerExecutor.executeMove(
      squares.from,
      squares.to,
      {
        signal,
        interactionModeOverride,
        gamePly: derivedPly,
        positionCriticality,
      }
    );

    if (!pointerResult.executed || pointerResult.aborted) {
      return {
        status: "ABORTED",
        fen: targetFen,
        reason: signal.aborted
          ? resolveAbortReason(signal)
          : "EXECUTION_ABORTED",
        selectedMoveUci: selection.selected.line.move,
        selection,
        delayCalculation,
        pointerResult,
        inputModeDecision,
        thinkWaitCompletedAtMs,
      };
    }

    let promotionResult: PromotionResolutionResult | undefined;
    if (this.promotionHandler?.isEnabled()) {
      promotionResult = await this.promotionHandler.handlePostMovePromotion({
        uciMove: selection.selected.line.move,
        turn: snapshot.turn,
        targetElo: effectiveEloForTurn,
        candidateLines: analysis.lines,
        signal,
      });
    }

    return {
      status: "EXECUTED",
      fen: targetFen,
      selectedMoveUci:
        promotionResult?.effectiveUciMove ?? selection.selected.line.move,
      source: routedSource,
      selection,
      delayCalculation,
      pointerResult,
      inputModeDecision,
      promotionResult,
      thinkWaitCompletedAtMs,
    };
  }

  private mapAbortOrError(
    fen: string,
    signal: AbortSignal,
    err: unknown,
    selection?: MoveSelectionResult,
    delayCalculation?: ThinkDelayCalculation
  ): AutoPlayCycleResult {
    if (signal.aborted || err instanceof AbortExecutionError) {
      return {
        status: "ABORTED",
        fen,
        reason: resolveAbortReason(signal),
        selection,
        delayCalculation,
      };
    }
    return {
      status: "ABORTED",
      fen,
      reason: "EXECUTION_ABORTED",
      selection,
      delayCalculation,
    };
  }
}

export interface HumanizedAutoPlaySystemConfig {
  readonly eloPreset?: EloPresetId;
  readonly controlledSide?: PieceColor | "both";
  readonly boardGeometry: BoardGeometryPort;
  readonly boardObserver: BoardStateObserverPort;
  readonly enginePort: EngineMultiPvPort;
  readonly clockPort: ClockStatePort;
  readonly selectorOverrides?: Partial<MoveSelectorConfig>;
  readonly executorOverrides?: Partial<KinematicExecutorConfig>;
  readonly orchestratorOverrides?: Partial<OrchestratorTimingConfig>;
  readonly frameScheduler?: FrameScheduler;
  readonly delayWaiter?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly humanPriorsProvider?: AutoPlayOrchestratorOptions["humanPriorsProvider"];
  readonly onCycleComplete?: (result: AutoPlayCycleResult) => void;
  readonly autoStart?: boolean;
}

export interface HumanizedAutoPlaySystem {
  readonly preset: HumanizedAutoPlayPreset;
  readonly selector: HumanizerMoveSelector;
  readonly executor: KinematicPointerExecutor;
  readonly orchestrator: AutoPlayOrchestrator;
  applyPreset(elo: EloPresetId): void;
  start(): void;
  pause(): void;
  resume(): void;
  dispose(): void;
}

/**
 * Integration factory wiring HumanizerMoveSelector, KinematicPointerExecutor,
 * and AutoPlayOrchestrator with 1200 / 1600 / 2000 Elo calibration presets.
 */
export function createHumanizedAutoPlaySystem(
  config: HumanizedAutoPlaySystemConfig
): HumanizedAutoPlaySystem {
  let activePreset = getAutoPlayPreset(config.eloPreset ?? 1600);

  const selector = new HumanizerMoveSelector({
    ...activePreset.selector,
    ...config.selectorOverrides,
  });

  const executor = new KinematicPointerExecutor(
    config.boardGeometry,
    {
      ...activePreset.executor,
      ...config.executorOverrides,
    },
    config.frameScheduler
  );

  const orchestrator = new AutoPlayOrchestrator(
    {
      boardObserver: config.boardObserver,
      boardGeometry: config.boardGeometry,
      enginePort: config.enginePort,
      clockPort: config.clockPort,
      moveSelector: selector,
      pointerExecutor: executor,
    },
    {
      controlledSide: config.controlledSide ?? "w",
      timingConfig: {
        ...activePreset.orchestrator,
        ...config.orchestratorOverrides,
      },
      humanPriorsProvider: config.humanPriorsProvider,
      onCycleComplete: config.onCycleComplete,
      delayWaiter: config.delayWaiter,
    }
  );

  if (config.autoStart) {
    orchestrator.start();
  }

  return {
    get preset(): HumanizedAutoPlayPreset {
      return activePreset;
    },
    selector,
    executor,
    orchestrator,
    applyPreset(elo: EloPresetId): void {
      activePreset = getAutoPlayPreset(elo);
      selector.updateConfig(activePreset.selector);
      executor.updateConfig(activePreset.executor);
      orchestrator.updateTimingConfig(activePreset.orchestrator);
    },
    start(): void {
      orchestrator.start();
    },
    pause(): void {
      orchestrator.pause();
    },
    resume(): void {
      orchestrator.resume();
    },
    dispose(): void {
      orchestrator.dispose();
    },
  };
}

function defaultAbortableWait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new AbortExecutionError("ABORTED"));
  }
  const safeMs = Math.max(0, Math.round(ms));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, safeMs);

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new AbortExecutionError("ABORTED"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveAbortReason(signal: AbortSignal): OrchestratorAbortReason {
  const r = signal.reason;
  if (
    r === "DISABLED_OR_PAUSED" ||
    r === "NOT_CONTROLLED_TURN" ||
    r === "FEN_CHANGED_DURING_ANALYSIS" ||
    r === "FEN_CHANGED_BEFORE_EXECUTION" ||
    r === "USER_MOUSE_MOVEMENT" ||
    r === "CONTROLLER_PAUSED" ||
    r === "DEGRADED_READ_ONLY_MODE" ||
    r === "FAIR_PLAY_RISK_HALT" ||
    r === "DISPOSED"
  ) {
    return r;
  }
  return "EXECUTION_ABORTED";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
