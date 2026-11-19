/**
 * Visibility & Connection Watchdogs (`environmentWatchdog.ts`).
 *
 * Implements:
 * 1. Continuous monitoring of `document.hidden`, `document.visibilityState`, and WebSocket
 *    connection state.
 * 2. Immediate orchestrator pause whenever `document.hidden === true`,
 *    `visibilityState !== "visible"`, or a WebSocket disconnects, dispatching a tab-focus
 *    alert via the desktop or Android companion bridge (`BridgeAlertPort`).
 * 3. On reconnect / visibility restoration, forces full dual-source state reconciliation
 *    via both DOM board scraping and move-list reconstruction, resuming the orchestrator
 *    ONLY when state parity is verified and it is still the user's controlled turn.
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { BoardStateSnapshot, PieceColor } from "./autoPlayPorts.ts";
import {
  DualStateReconciler,
  STANDARD_START_FEN,
  extractPlacementAndTurn,
  reconstructFenFromMoveList,
  type ReconciliationResult,
} from "./dualStateReconciler.ts";

export interface WatchdogOrchestratorTarget {
  pause(): void;
  resume(): void;
  isAutonomousActive(): boolean;
}

export interface DocumentVisibilityMonitorTarget {
  readonly hidden: boolean;
  readonly visibilityState: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export type BridgeAlertTarget = "desktop" | "android" | "both";

export type WatchdogAlertReason =
  | "TAB_HIDDEN"
  | "VISIBILITY_STATE_NON_VISIBLE"
  | "WEBSOCKET_DISCONNECTED";

export interface TabFocusAlertPayload {
  readonly type: "TAB_FOCUS_ALERT";
  readonly reason: WatchdogAlertReason;
  readonly bridgeTarget: BridgeAlertTarget;
  readonly documentHidden: boolean;
  readonly visibilityState: string;
  readonly socketConnected: boolean;
  readonly detail: string;
  readonly timestampMs: number;
}

export interface BridgeAlertPort {
  sendTabFocusAlert(payload: TabFocusAlertPayload): Promise<void> | void;
}

export interface WebSocketStatusSource {
  isConnected(): boolean;
  subscribe(listener: (connected: boolean, reason?: string) => void): () => void;
}

export interface WatchdogReconciliationHooks {
  readonly controlledSide: PieceColor | "both";
  readonly initialFen?: string;
  readonly dualStateReconciler?: DualStateReconciler | null;
  readonly scrapeBoardState: () =>
    | Promise<BoardStateSnapshot | null>
    | BoardStateSnapshot
    | null;
  readonly readMoveTokens: () =>
    | Promise<readonly string[]>
    | readonly string[];
}

export interface EnvironmentWatchdogConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing lifecycle behavior. */
  readonly enabled: boolean;
  /** Target companion bridge receiving tab-focus & disconnect alerts. */
  readonly bridgeTarget: BridgeAlertTarget;
  /** Injectable timestamp provider for deterministic tests. */
  readonly nowMs?: () => number;
  /** Optional diagnostic callback. */
  readonly onDiagnostic?: (message: string) => void;
}

export const DEFAULT_ENVIRONMENT_WATCHDOG_CONFIG: EnvironmentWatchdogConfig = {
  enabled: false,
  bridgeTarget: "both",
};

export type WatchdogRecoveryStatus =
  | "RESUMED"
  | "DISABLED"
  | "STILL_HIDDEN_OR_DISCONNECTED"
  | "SCRAPE_UNAVAILABLE"
  | "PARITY_MISMATCH"
  | "NOT_USER_TURN";

export interface WatchdogRecoveryResult {
  readonly status: WatchdogRecoveryStatus;
  readonly resumed: boolean;
  readonly parityVerified: boolean;
  readonly isUsersTurn: boolean;
  readonly scrapedPlacementAndTurn: string | null;
  readonly reconstructedPlacementAndTurn: string | null;
  readonly reconciliation: ReconciliationResult | null;
  readonly reason: string;
}

export interface EnvironmentWatchdogSnapshot {
  readonly enabled: boolean;
  readonly started: boolean;
  readonly documentHidden: boolean;
  readonly visibilityState: string;
  readonly socketConnected: boolean;
  readonly pausedByWatchdog: boolean;
  readonly alertsDispatched: number;
  readonly lastAlert: TabFocusAlertPayload | null;
  readonly lastRecovery: WatchdogRecoveryResult | null;
}

/**
 * In-memory / programmable WebSocket connection monitor suitable for MV3 page-bridge events
 * and deterministic tests.
 */
export class ObservableWebSocketMonitor implements WebSocketStatusSource {
  private connected: boolean;
  private readonly listeners = new Set<(connected: boolean, reason?: string) => void>();

  constructor(initialConnected: boolean = true) {
    this.connected = initialConnected;
  }

  isConnected(): boolean {
    return this.connected;
  }

  setConnected(next: boolean, reason?: string): void {
    if (this.connected === next) return;
    this.connected = next;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(next, reason);
      } catch {
        // Isolate subscriber errors
      }
    }
  }

  subscribe(listener: (connected: boolean, reason?: string) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class EnvironmentWatchdog {
  private config: EnvironmentWatchdogConfig;
  private readonly orchestrator: WatchdogOrchestratorTarget;
  private readonly documentSource: DocumentVisibilityMonitorTarget | null;
  private readonly socketSource: WebSocketStatusSource;
  private readonly bridgeAlertPort: BridgeAlertPort | null;
  private readonly reconcileHooks: WatchdogReconciliationHooks;
  private readonly nowMs: () => number;

  private started = false;
  private documentHidden = false;
  private visibilityState = "visible";
  private socketConnected = true;
  private pausedByWatchdog = false;
  private alertsDispatched = 0;
  private lastAlert: TabFocusAlertPayload | null = null;
  private lastRecovery: WatchdogRecoveryResult | null = null;

  private detachVisibilityListener: (() => void) | null = null;
  private detachSocketListener: (() => void) | null = null;

  constructor(
    deps: {
      readonly orchestrator: WatchdogOrchestratorTarget;
      readonly reconcileHooks: WatchdogReconciliationHooks;
      readonly documentSource?: DocumentVisibilityMonitorTarget | null;
      readonly socketSource?: WebSocketStatusSource | null;
      readonly bridgeAlertPort?: BridgeAlertPort | null;
    },
    config: Partial<EnvironmentWatchdogConfig> = {}
  ) {
    this.config = {
      ...DEFAULT_ENVIRONMENT_WATCHDOG_CONFIG,
      ...config,
    };
    this.orchestrator = deps.orchestrator;
    this.reconcileHooks = deps.reconcileHooks;
    this.documentSource =
      deps.documentSource !== undefined
        ? deps.documentSource
        : typeof document !== "undefined"
        ? (document as unknown as DocumentVisibilityMonitorTarget)
        : null;
    this.socketSource = deps.socketSource ?? new ObservableWebSocketMonitor(true);
    this.bridgeAlertPort = deps.bridgeAlertPort ?? null;
    this.nowMs = config.nowMs ?? (() => Date.now());

    if (this.documentSource) {
      this.documentHidden = Boolean(this.documentSource.hidden);
      this.visibilityState = this.documentSource.visibilityState || "visible";
    }
    this.socketConnected = this.socketSource.isConnected();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getSnapshot(): EnvironmentWatchdogSnapshot {
    return {
      enabled: this.config.enabled,
      started: this.started,
      documentHidden: this.documentHidden,
      visibilityState: this.visibilityState,
      socketConnected: this.socketConnected,
      pausedByWatchdog: this.pausedByWatchdog,
      alertsDispatched: this.alertsDispatched,
      lastAlert: this.lastAlert,
      lastRecovery: this.lastRecovery,
    };
  }

  /**
   * Starts listening to `visibilitychange` and WebSocket connection transitions.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    if (this.documentSource) {
      this.documentHidden = Boolean(this.documentSource.hidden);
      this.visibilityState = this.documentSource.visibilityState || "visible";

      const onVisibility = (): void => {
        void this.handleVisibilityUpdate(
          Boolean(this.documentSource?.hidden),
          this.documentSource?.visibilityState ?? "visible"
        );
      };
      this.documentSource.addEventListener("visibilitychange", onVisibility);
      this.detachVisibilityListener = () => {
        this.documentSource?.removeEventListener("visibilitychange", onVisibility);
      };
    }

    this.socketConnected = this.socketSource.isConnected();
    this.detachSocketListener = this.socketSource.subscribe(
      (connected, reason) => {
        void this.handleWebSocketStateChange(connected, reason);
      }
    );

    if (this.config.enabled) {
      if (this.isEnvironmentDegraded()) {
        this.triggerPauseAndAlert(this.resolveCurrentAlertReason(), "Initial watchdog check");
      }
    }
  }

  stop(): void {
    this.started = false;
    this.detachVisibilityListener?.();
    this.detachVisibilityListener = null;
    this.detachSocketListener?.();
    this.detachSocketListener = null;
  }

  dispose(): void {
    this.stop();
  }

  /**
   * Handles changes to `document.hidden` / `document.visibilityState`.
   * Pauses immediately when hidden and dispatches a bridge tab-focus alert;
   * attempts verified recovery when restored and socket is connected.
   */
  async handleVisibilityUpdate(
    hidden: boolean,
    visibilityState: string = hidden ? "hidden" : "visible"
  ): Promise<WatchdogRecoveryResult | null> {
    this.documentHidden = Boolean(hidden);
    this.visibilityState = visibilityState || (hidden ? "hidden" : "visible");

    if (!this.config.enabled) {
      return null;
    }

    if (this.documentHidden || this.visibilityState !== "visible") {
      const reason: WatchdogAlertReason = this.documentHidden
        ? "TAB_HIDDEN"
        : "VISIBILITY_STATE_NON_VISIBLE";
      this.triggerPauseAndAlert(
        reason,
        `Document unfocused (hidden=${this.documentHidden}, visibilityState=${this.visibilityState})`
      );
      return null;
    }

    if (this.pausedByWatchdog && this.socketConnected) {
      return this.attemptVerifiedResume();
    }
    return null;
  }

  /**
   * Handles WebSocket connection/disconnection events.
   * Pauses immediately on disconnect + alerts bridge; forces full dual-source
   * reconciliation on reconnect before resuming.
   */
  async handleWebSocketStateChange(
    connected: boolean,
    detail: string = ""
  ): Promise<WatchdogRecoveryResult | null> {
    this.socketConnected = Boolean(connected);

    if (!this.config.enabled) {
      return null;
    }

    if (!this.socketConnected) {
      this.triggerPauseAndAlert(
        "WEBSOCKET_DISCONNECTED",
        detail || "Game WebSocket disconnected"
      );
      return null;
    }

    if (this.pausedByWatchdog && !this.isEnvironmentDegraded()) {
      return this.attemptVerifiedResume();
    }
    return null;
  }

  /**
   * Forces full state reconciliation via BOTH DOM scraping and move-list reconstruction.
   * Resumes orchestrator ONLY if parity is verified AND it is still the user's controlled turn.
   */
  async attemptVerifiedResume(): Promise<WatchdogRecoveryResult> {
    if (!this.config.enabled) {
      const res: WatchdogRecoveryResult = {
        status: "DISABLED",
        resumed: false,
        parityVerified: false,
        isUsersTurn: false,
        scrapedPlacementAndTurn: null,
        reconstructedPlacementAndTurn: null,
        reconciliation: null,
        reason: "WATCHDOG_DISABLED",
      };
      this.lastRecovery = res;
      return res;
    }

    if (this.isEnvironmentDegraded()) {
      const res: WatchdogRecoveryResult = {
        status: "STILL_HIDDEN_OR_DISCONNECTED",
        resumed: false,
        parityVerified: false,
        isUsersTurn: false,
        scrapedPlacementAndTurn: null,
        reconstructedPlacementAndTurn: null,
        reconciliation: null,
        reason: `Cannot resume while hidden=${this.documentHidden}, visibility=${this.visibilityState}, socketConnected=${this.socketConnected}`,
      };
      this.lastRecovery = res;
      return res;
    }

    // Force parallel DOM scraping + move-list token reading
    const [scrapedBoard, moveTokens] = await Promise.all([
      Promise.resolve().then(() => this.reconcileHooks.scrapeBoardState()),
      Promise.resolve().then(() => this.reconcileHooks.readMoveTokens()),
    ]);

    if (!scrapedBoard || !scrapedBoard.fen) {
      const res: WatchdogRecoveryResult = {
        status: "SCRAPE_UNAVAILABLE",
        resumed: false,
        parityVerified: false,
        isUsersTurn: false,
        scrapedPlacementAndTurn: null,
        reconstructedPlacementAndTurn: null,
        reconciliation: null,
        reason: "DOM board scraping returned no FEN on reconnect",
      };
      this.lastRecovery = res;
      return res;
    }

    const initFen = this.reconcileHooks.initialFen ?? STANDARD_START_FEN;
    const scrapedKey = extractPlacementAndTurn(scrapedBoard.fen);
    const reconSummary = reconstructFenFromMoveList(moveTokens, initFen);

    let reconcilerResult: ReconciliationResult | null = null;
    if (this.reconcileHooks.dualStateReconciler?.isEnabled()) {
      reconcilerResult = await this.reconcileHooks.dualStateReconciler.reconcilePly({
        scrapeBoardFen: () => scrapedBoard.fen,
        readMoveTokens: () => moveTokens,
        initialFen: initFen,
      });
    }

    const parityVerified = Boolean(
      scrapedKey &&
        reconSummary.ok &&
        scrapedKey === reconSummary.placementAndTurn &&
        (!reconcilerResult || reconcilerResult.status === "MATCHED")
    );

    if (!parityVerified) {
      const res: WatchdogRecoveryResult = {
        status: "PARITY_MISMATCH",
        resumed: false,
        parityVerified: false,
        isUsersTurn: false,
        scrapedPlacementAndTurn: scrapedKey,
        reconstructedPlacementAndTurn: reconSummary.placementAndTurn,
        reconciliation: reconcilerResult,
        reason: `Reconnect state parity failed: scraped "${scrapedKey ?? "null"}" vs reconstructed "${reconSummary.placementAndTurn}"`,
      };
      this.lastRecovery = res;
      this.config.onDiagnostic?.(res.reason);
      return res;
    }

    const isUsersTurn =
      this.reconcileHooks.controlledSide === "both" ||
      scrapedBoard.turn === this.reconcileHooks.controlledSide;

    if (!isUsersTurn) {
      const res: WatchdogRecoveryResult = {
        status: "NOT_USER_TURN",
        resumed: false,
        parityVerified: true,
        isUsersTurn: false,
        scrapedPlacementAndTurn: scrapedKey,
        reconstructedPlacementAndTurn: reconSummary.placementAndTurn,
        reconciliation: reconcilerResult,
        reason: `State parity verified, waiting because turn is "${scrapedBoard.turn}" (controlled="${this.reconcileHooks.controlledSide}")`,
      };
      this.lastRecovery = res;
      return res;
    }

    this.pausedByWatchdog = false;
    this.orchestrator.resume();
    const res: WatchdogRecoveryResult = {
      status: "RESUMED",
      resumed: true,
      parityVerified: true,
      isUsersTurn: true,
      scrapedPlacementAndTurn: scrapedKey,
      reconstructedPlacementAndTurn: reconSummary.placementAndTurn,
      reconciliation: reconcilerResult,
      reason: "Full dual-source state parity verified on user turn; orchestrator resumed",
    };
    this.lastRecovery = res;
    return res;
  }

  private isEnvironmentDegraded(): boolean {
    return (
      this.documentHidden ||
      this.visibilityState !== "visible" ||
      !this.socketConnected
    );
  }

  private resolveCurrentAlertReason(): WatchdogAlertReason {
    if (!this.socketConnected) return "WEBSOCKET_DISCONNECTED";
    if (this.documentHidden) return "TAB_HIDDEN";
    return "VISIBILITY_STATE_NON_VISIBLE";
  }

  private triggerPauseAndAlert(
    reason: WatchdogAlertReason,
    detail: string
  ): void {
    const alreadyPausedSameReason =
      this.pausedByWatchdog && this.lastAlert?.reason === reason;

    this.pausedByWatchdog = true;
    this.orchestrator.pause();

    if (alreadyPausedSameReason) {
      return;
    }

    const alertPayload: TabFocusAlertPayload = {
      type: "TAB_FOCUS_ALERT",
      reason,
      bridgeTarget: this.config.bridgeTarget,
      documentHidden: this.documentHidden,
      visibilityState: this.visibilityState,
      socketConnected: this.socketConnected,
      detail,
      timestampMs: this.nowMs(),
    };
    this.lastAlert = alertPayload;
    this.alertsDispatched++;
    this.config.onDiagnostic?.(detail);

    if (this.bridgeAlertPort) {
      try {
        void Promise.resolve(
          this.bridgeAlertPort.sendTabFocusAlert(alertPayload)
        ).catch(() => {});
      } catch {
        // Isolate bridge alert dispatch failures
      }
    }
  }
}
