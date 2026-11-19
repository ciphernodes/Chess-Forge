/**
 * OS-Level Trusted Input Drivers (`desktopInputDrivers.ts`).
 *
 * Implements:
 * 1. Chrome DevTools Protocol driver (`CdpTrustedInputDriver`) using `chrome.debugger`
 *    and `Input.dispatchMouseEvent` consuming Cubic Bézier waypoints from
 *    `KinematicPointerExecutor`.
 * 2. Native Messaging Host driver (`NativeMessagingInputDriver`) formatting JSON
 *    waypoint batches over `chrome.runtime.sendNativeMessage` for `native_input_host.go`
 *    (Windows `SendInput` / `MOUSEEVENTF_MOVE`).
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type {
  BoardGeometryPort,
  KinematicExecutorConfig,
  SquareName,
} from "./autoPlayPorts.ts";
import {
  DEFAULT_KINEMATIC_CONFIG,
  computeSquareGeometry,
  computeSquareTargetPoint,
  generateCubicBezierTrajectory,
  type Point2D,
  type RefinedKinematicProfileConfig,
  type TrajectoryPlan,
  type TrajectoryWaypoint,
} from "./kinematicPointerExecutor.ts";

export interface CdpDebugTarget {
  readonly tabId: number;
}

export type CdpMouseEventType = "mouseMoved" | "mousePressed" | "mouseReleased";

export interface CdpDispatchMouseEventParams {
  readonly type: CdpMouseEventType;
  readonly x: number;
  readonly y: number;
  readonly button?: "none" | "left" | "right" | "middle";
  readonly buttons?: number;
  readonly clickCount?: number;
  readonly pointerType?: "mouse" | "pen";
}

export interface DebuggerTransportPort {
  attach(target: CdpDebugTarget, requiredVersion: string): Promise<void>;
  detach(target: CdpDebugTarget): Promise<void>;
  sendCommand(
    target: CdpDebugTarget,
    method: string,
    commandParams?: Record<string, unknown>
  ): Promise<unknown>;
}

export interface ChromeDebuggerApiLike {
  attach(
    target: { tabId?: number },
    requiredVersion: string,
    callback?: () => void
  ): void;
  detach(target: { tabId?: number }, callback?: () => void): void;
  sendCommand(
    target: { tabId?: number },
    method: string,
    commandParams?: Record<string, unknown>,
    callback?: (result?: unknown) => void
  ): void;
}

interface ChromeLastErrorCarrier {
  readonly runtime?: {
    readonly lastError?: { readonly message?: string };
    sendNativeMessage?(
      application: string,
      message: Record<string, unknown>,
      callback: (response: unknown) => void
    ): void;
  };
  readonly debugger?: ChromeDebuggerApiLike;
}

export function createChromeDebuggerPort(
  chromeRef?: ChromeLastErrorCarrier
): DebuggerTransportPort | null {
  const host =
    chromeRef ??
    ((globalThis as { chrome?: ChromeLastErrorCarrier }).chrome ?? undefined);
  const dbg = host?.debugger;
  if (!dbg) return null;

  return {
    attach(target, requiredVersion) {
      return new Promise<void>((resolve, reject) => {
        dbg.attach({ tabId: target.tabId }, requiredVersion, () => {
          const err = host?.runtime?.lastError?.message;
          if (err && !err.includes("Another debugger is already attached")) {
            reject(new Error(err));
            return;
          }
          resolve();
        });
      });
    },
    detach(target) {
      return new Promise<void>((resolve, reject) => {
        dbg.detach({ tabId: target.tabId }, () => {
          const err = host?.runtime?.lastError?.message;
          if (err && !err.includes("Debugger is not attached")) {
            reject(new Error(err));
            return;
          }
          resolve();
        });
      });
    },
    sendCommand(target, method, commandParams) {
      return new Promise<unknown>((resolve, reject) => {
        dbg.sendCommand(
          { tabId: target.tabId },
          method,
          commandParams,
          (result) => {
            const err = host?.runtime?.lastError?.message;
            if (err) {
              reject(new Error(err));
              return;
            }
            resolve(result);
          }
        );
      });
    },
  };
}

export interface CdpTrustedDriverConfig {
  /** Explicit opt-in flag; defaults to false. */
  readonly enabled: boolean;
  /** Chrome Debugger protocol version (default "1.3"). */
  readonly protocolVersion: string;
  /** Viewport offset to convert board CSS coords to CDP page viewport coords. */
  readonly viewportOffsetPx: Point2D;
  /** Scale multiplier applied to CSS coordinates (default 1.0 for CSS-pixel CDP). */
  readonly coordinateScale: number;
  /** Detach debugger automatically after each completed gesture (default false). */
  readonly autoDetachAfterMove: boolean;
  /** Kinematic configuration shared with KinematicPointerExecutor. */
  readonly kinematicConfig: KinematicExecutorConfig;
  /** Optional Phase 3 refined kinematic profile. */
  readonly refinedProfile?: Partial<RefinedKinematicProfileConfig>;
  readonly waitMs?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly nowMs?: () => number;
}

export const DEFAULT_CDP_DRIVER_CONFIG: CdpTrustedDriverConfig = {
  enabled: false,
  protocolVersion: "1.3",
  viewportOffsetPx: { x: 0, y: 0 },
  coordinateScale: 1,
  autoDetachAfterMove: false,
  kinematicConfig: DEFAULT_KINEMATIC_CONFIG,
};

export interface CdpMoveExecutionResult {
  readonly executed: boolean;
  readonly aborted: boolean;
  readonly reason: string;
  readonly fromSquare: SquareName;
  readonly toSquare: SquareName;
  readonly mode: "drag" | "click";
  readonly dispatchedCommands: readonly CdpDispatchMouseEventParams[];
  readonly totalDurationMs: number;
}

export interface CdpExecuteMoveInput {
  readonly tabId: number;
  readonly fromSquare: SquareName;
  readonly toSquare: SquareName;
  readonly mode?: "drag" | "click";
  readonly precomputedOrigin?: Point2D;
  readonly precomputedDragWaypoints?: readonly TrajectoryWaypoint[];
  readonly dwellMs?: number;
  readonly signal?: AbortSignal;
  readonly onImmediateRelease?: (releasedAtMs: number) => void;
}

function defaultWaitMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error("ABORTED"));
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(id);
      reject(new Error("ABORTED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function clampBetween(min: number, max: number, rnd: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + (hi - lo) * Math.max(0, Math.min(1, rnd));
}

export class CdpTrustedInputDriver {
  private readonly geometry: BoardGeometryPort;
  private readonly transport: DebuggerTransportPort;
  private config: CdpTrustedDriverConfig;
  private readonly attachedTabs = new Set<number>();

  constructor(
    geometry: BoardGeometryPort,
    transport: DebuggerTransportPort,
    config: Partial<CdpTrustedDriverConfig> = {}
  ) {
    this.geometry = geometry;
    this.transport = transport;
    this.config = {
      ...DEFAULT_CDP_DRIVER_CONFIG,
      ...config,
      kinematicConfig: {
        ...DEFAULT_CDP_DRIVER_CONFIG.kinematicConfig,
        ...config.kinematicConfig,
      },
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  async detachAll(): Promise<void> {
    for (const tabId of Array.from(this.attachedTabs)) {
      try {
        await this.transport.detach({ tabId });
      } finally {
        this.attachedTabs.delete(tabId);
      }
    }
  }

  private toViewportPoint(pt: Point2D): Point2D {
    const s = Number.isFinite(this.config.coordinateScale) && this.config.coordinateScale > 0
      ? this.config.coordinateScale
      : 1;
    return {
      x: Number(((pt.x + this.config.viewportOffsetPx.x) * s).toFixed(2)),
      y: Number(((pt.y + this.config.viewportOffsetPx.y) * s).toFixed(2)),
    };
  }

  /**
   * Executes a move over Chrome DevTools Protocol `Input.dispatchMouseEvent`
   * consuming Bézier trajectories from `KinematicPointerExecutor`.
   */
  async executeMove(input: CdpExecuteMoveInput): Promise<CdpMoveExecutionResult> {
    const mode = input.mode ?? this.config.kinematicConfig.interactionMode;
    if (!this.config.enabled) {
      return {
        executed: false,
        aborted: false,
        reason: "CDP_DRIVER_DISABLED",
        fromSquare: input.fromSquare,
        toSquare: input.toSquare,
        mode,
        dispatchedCommands: [],
        totalDurationMs: 0,
      };
    }

    const rect = this.geometry.getBoardRect();
    if (!rect) {
      return {
        executed: false,
        aborted: false,
        reason: "BOARD_RECT_UNAVAILABLE",
        fromSquare: input.fromSquare,
        toSquare: input.toSquare,
        mode,
        dispatchedCommands: [],
        totalDurationMs: 0,
      };
    }

    const waitMs = this.config.waitMs ?? defaultWaitMs;
    const nowMs = this.config.nowMs ?? (() => Date.now());
    const rng = this.config.kinematicConfig.randomFn ?? Math.random;
    const flipped = this.geometry.isFlipped();

    const originGeom = computeSquareGeometry(input.fromSquare, rect, flipped);
    const originPt =
      input.precomputedOrigin ?? {
        x: originGeom.centerX,
        y: originGeom.centerY,
      };
    const destPt = computeSquareTargetPoint(
      input.toSquare,
      rect,
      flipped,
      this.config.kinematicConfig,
      rng
    );

    const dragDurationMs = Math.round(
      clampBetween(
        this.config.kinematicConfig.dragMinMs,
        this.config.kinematicConfig.dragMaxMs,
        rng()
      )
    );
    const dwellMs =
      input.dwellMs ??
      Math.round(
        clampBetween(
          this.config.kinematicConfig.dwellMinMs,
          this.config.kinematicConfig.dwellMaxMs,
          rng()
        )
      );

    const plan: TrajectoryPlan = input.precomputedDragWaypoints?.length
      ? {
          controlPoints: {
            p0: originPt,
            p1: originPt,
            p2: destPt,
            p3: destPt,
          },
          durationMs:
            input.precomputedDragWaypoints[
              input.precomputedDragWaypoints.length - 1
            ]?.timestampOffsetMs ?? dragDurationMs,
          waypoints: input.precomputedDragWaypoints,
        }
      : generateCubicBezierTrajectory(
          originPt,
          destPt,
          dragDurationMs,
          this.config.kinematicConfig,
          rng,
          16,
          this.config.refinedProfile
        );

    const target: CdpDebugTarget = { tabId: input.tabId };
    const dispatched: CdpDispatchMouseEventParams[] = [];
    const startedAt = nowMs();

    const sendMouse = async (params: CdpDispatchMouseEventParams): Promise<void> => {
      if (input.signal?.aborted) {
        throw new Error("ABORTED");
      }
      await this.transport.sendCommand(
        target,
        "Input.dispatchMouseEvent",
        params as unknown as Record<string, unknown>
      );
      dispatched.push(params);
    };

    try {
      if (!this.attachedTabs.has(input.tabId)) {
        await this.transport.attach(target, this.config.protocolVersion);
        this.attachedTabs.add(input.tabId);
      }

      const startVp = this.toViewportPoint(plan.waypoints[0] ?? originPt);
      const endVp = this.toViewportPoint(
        plan.waypoints[plan.waypoints.length - 1] ?? destPt
      );

      await sendMouse({
        type: "mouseMoved",
        x: startVp.x,
        y: startVp.y,
        button: "none",
        buttons: 0,
        pointerType: "mouse",
      });

      await sendMouse({
        type: "mousePressed",
        x: startVp.x,
        y: startVp.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
        pointerType: "mouse",
      });

      await waitMs(dwellMs, input.signal);

      if (mode === "click") {
        await sendMouse({
          type: "mouseReleased",
          x: startVp.x,
          y: startVp.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "mouse",
        });

        let prevOffset = 0;
        for (let i = 1; i < plan.waypoints.length; i++) {
          const wp = plan.waypoints[i];
          const dt = Math.max(0, wp.timestampOffsetMs - prevOffset);
          prevOffset = wp.timestampOffsetMs;
          await waitMs(dt, input.signal);
          const pt = this.toViewportPoint(wp);
          await sendMouse({
            type: "mouseMoved",
            x: pt.x,
            y: pt.y,
            button: "none",
            buttons: 0,
            pointerType: "mouse",
          });
        }

        await sendMouse({
          type: "mousePressed",
          x: endVp.x,
          y: endVp.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
          pointerType: "mouse",
        });
        await waitMs(Math.max(18, Math.round(dwellMs * 0.45)), input.signal);
        await sendMouse({
          type: "mouseReleased",
          x: endVp.x,
          y: endVp.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "mouse",
        });
      } else {
        let prevOffset = 0;
        for (let i = 1; i < plan.waypoints.length; i++) {
          const wp = plan.waypoints[i];
          const dt = Math.max(0, wp.timestampOffsetMs - prevOffset);
          prevOffset = wp.timestampOffsetMs;
          await waitMs(dt, input.signal);
          const pt = this.toViewportPoint(wp);
          await sendMouse({
            type: "mouseMoved",
            x: pt.x,
            y: pt.y,
            button: "left",
            buttons: 1,
            pointerType: "mouse",
          });
        }

        await sendMouse({
          type: "mouseReleased",
          x: endVp.x,
          y: endVp.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "mouse",
        });
      }

      input.onImmediateRelease?.(nowMs());

      if (this.config.autoDetachAfterMove && this.attachedTabs.has(input.tabId)) {
        await this.transport.detach(target);
        this.attachedTabs.delete(input.tabId);
      }

      return {
        executed: true,
        aborted: false,
        reason: "CDP_EXECUTED",
        fromSquare: input.fromSquare,
        toSquare: input.toSquare,
        mode,
        dispatchedCommands: dispatched,
        totalDurationMs: Math.max(0, nowMs() - startedAt),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const aborted = msg.includes("ABORTED") || Boolean(input.signal?.aborted);
      // Best-effort release if button remained held
      try {
        const last = dispatched[dispatched.length - 1];
        if (last && last.buttons === 1) {
          await this.transport.sendCommand(target, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: last.x,
            y: last.y,
            button: "left",
            buttons: 0,
            clickCount: 1,
          });
        }
      } catch {
        // Ignore cleanup failures
      }
      return {
        executed: false,
        aborted,
        reason: aborted ? "ABORTED" : `CDP_ERROR:${msg}`,
        fromSquare: input.fromSquare,
        toSquare: input.toSquare,
        mode,
        dispatchedCommands: dispatched,
        totalDurationMs: Math.max(0, nowMs() - startedAt),
      };
    }
  }
}

export type NativeWaypointAction = "move" | "left_down" | "left_up";

export interface NativeInputWaypointPayload {
  readonly x: number;
  readonly y: number;
  readonly delayMs: number;
  readonly action: NativeWaypointAction;
}

export interface NativeInputBatchRequest {
  readonly type: "DISPATCH_TRAJECTORY";
  readonly enabled: boolean;
  readonly batchId: string;
  readonly mode: "drag" | "click";
  readonly coordinateSpace: "screen_px";
  readonly waypoints: readonly NativeInputWaypointPayload[];
}

export interface NativeInputBatchResponse {
  readonly ok: boolean;
  readonly batchId: string;
  readonly dispatchedEvents: number;
  readonly simulated?: boolean;
  readonly error?: string;
}

export interface NativeMessagingPort {
  sendNativeMessage(
    hostName: string,
    payload: NativeInputBatchRequest
  ): Promise<NativeInputBatchResponse>;
}

export function createChromeNativeMessagingPort(
  chromeRef?: ChromeLastErrorCarrier
): NativeMessagingPort | null {
  const host =
    chromeRef ??
    ((globalThis as { chrome?: ChromeLastErrorCarrier }).chrome ?? undefined);
  const rt = host?.runtime;
  if (!rt || typeof rt.sendNativeMessage !== "function") return null;

  return {
    sendNativeMessage(hostName, payload) {
      return new Promise<NativeInputBatchResponse>((resolve, reject) => {
        rt.sendNativeMessage!(
          hostName,
          payload as unknown as Record<string, unknown>,
          (response) => {
            const err = host?.runtime?.lastError?.message;
            if (err) {
              reject(new Error(err));
              return;
            }
            const res = (response ?? {}) as Partial<NativeInputBatchResponse>;
            resolve({
              ok: Boolean(res.ok),
              batchId: String(res.batchId ?? payload.batchId),
              dispatchedEvents: Number(res.dispatchedEvents ?? 0),
              simulated: res.simulated,
              error: res.error,
            });
          }
        );
      });
    },
  };
}

export interface NativeMessagingDriverConfig {
  /** Explicit opt-in flag; defaults to false. */
  readonly enabled: boolean;
  /** Registered Chrome native messaging host identifier. */
  readonly hostName: string;
  /** Screen origin of the browser viewport in physical screen pixels. */
  readonly screenOffsetPx: Point2D;
  /** Device pixel ratio converting CSS coords to OS screen pixels. */
  readonly devicePixelRatio: number;
  readonly kinematicConfig: KinematicExecutorConfig;
  readonly refinedProfile?: Partial<RefinedKinematicProfileConfig>;
  readonly nowMs?: () => number;
}

export const DEFAULT_NATIVE_DRIVER_CONFIG: NativeMessagingDriverConfig = {
  enabled: false,
  hostName: "com.chessforge.native_input_host",
  screenOffsetPx: { x: 0, y: 0 },
  devicePixelRatio: 1,
  kinematicConfig: DEFAULT_KINEMATIC_CONFIG,
};

export interface NativeExecuteMoveInput {
  readonly fromSquare: SquareName;
  readonly toSquare: SquareName;
  readonly mode?: "drag" | "click";
  readonly precomputedOrigin?: Point2D;
  readonly precomputedDragWaypoints?: readonly TrajectoryWaypoint[];
  readonly dwellMs?: number;
  readonly batchId?: string;
}

export class NativeMessagingInputDriver {
  private readonly geometry: BoardGeometryPort;
  private readonly port: NativeMessagingPort;
  private config: NativeMessagingDriverConfig;
  private batchCounter = 0;

  constructor(
    geometry: BoardGeometryPort,
    port: NativeMessagingPort,
    config: Partial<NativeMessagingDriverConfig> = {}
  ) {
    this.geometry = geometry;
    this.port = port;
    this.config = {
      ...DEFAULT_NATIVE_DRIVER_CONFIG,
      ...config,
      kinematicConfig: {
        ...DEFAULT_NATIVE_DRIVER_CONFIG.kinematicConfig,
        ...config.kinematicConfig,
      },
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  private toScreenPx(pt: Point2D): Point2D {
    const dpr =
      Number.isFinite(this.config.devicePixelRatio) &&
      this.config.devicePixelRatio > 0
        ? this.config.devicePixelRatio
        : 1;
    return {
      x: Math.round(this.config.screenOffsetPx.x + pt.x * dpr),
      y: Math.round(this.config.screenOffsetPx.y + pt.y * dpr),
    };
  }

  /**
   * Builds a JSON batch consumable by `native_input_host.go` and transmits it
   * over Chrome native messaging.
   */
  buildBatchPayload(input: NativeExecuteMoveInput): NativeInputBatchRequest | null {
    const rect = this.geometry.getBoardRect();
    if (!rect) return null;

    const rng = this.config.kinematicConfig.randomFn ?? Math.random;
    const flipped = this.geometry.isFlipped();
    const mode = input.mode ?? this.config.kinematicConfig.interactionMode;

    const originGeom = computeSquareGeometry(input.fromSquare, rect, flipped);
    const originPt =
      input.precomputedOrigin ?? {
        x: originGeom.centerX,
        y: originGeom.centerY,
      };
    const destPt = computeSquareTargetPoint(
      input.toSquare,
      rect,
      flipped,
      this.config.kinematicConfig,
      rng
    );

    const dragDurationMs = Math.round(
      clampBetween(
        this.config.kinematicConfig.dragMinMs,
        this.config.kinematicConfig.dragMaxMs,
        rng()
      )
    );
    const dwellMs =
      input.dwellMs ??
      Math.round(
        clampBetween(
          this.config.kinematicConfig.dwellMinMs,
          this.config.kinematicConfig.dwellMaxMs,
          rng()
        )
      );

    const plan: TrajectoryPlan = input.precomputedDragWaypoints?.length
      ? {
          controlPoints: {
            p0: originPt,
            p1: originPt,
            p2: destPt,
            p3: destPt,
          },
          durationMs:
            input.precomputedDragWaypoints[
              input.precomputedDragWaypoints.length - 1
            ]?.timestampOffsetMs ?? dragDurationMs,
          waypoints: input.precomputedDragWaypoints,
        }
      : generateCubicBezierTrajectory(
          originPt,
          destPt,
          dragDurationMs,
          this.config.kinematicConfig,
          rng,
          16,
          this.config.refinedProfile
        );

    const waypoints: NativeInputWaypointPayload[] = [];
    const startPx = this.toScreenPx(plan.waypoints[0] ?? originPt);
    const endPx = this.toScreenPx(
      plan.waypoints[plan.waypoints.length - 1] ?? destPt
    );

    waypoints.push({ x: startPx.x, y: startPx.y, delayMs: 0, action: "move" });
    waypoints.push({
      x: startPx.x,
      y: startPx.y,
      delayMs: 4,
      action: "left_down",
    });

    if (mode === "click") {
      waypoints.push({
        x: startPx.x,
        y: startPx.y,
        delayMs: dwellMs,
        action: "left_up",
      });
      let prevOffset = 0;
      for (let i = 1; i < plan.waypoints.length; i++) {
        const wp = plan.waypoints[i];
        const dt = Math.max(0, Math.round(wp.timestampOffsetMs - prevOffset));
        prevOffset = wp.timestampOffsetMs;
        const p = this.toScreenPx(wp);
        waypoints.push({ x: p.x, y: p.y, delayMs: dt, action: "move" });
      }
      waypoints.push({
        x: endPx.x,
        y: endPx.y,
        delayMs: 8,
        action: "left_down",
      });
      waypoints.push({
        x: endPx.x,
        y: endPx.y,
        delayMs: Math.max(18, Math.round(dwellMs * 0.45)),
        action: "left_up",
      });
    } else {
      let prevOffset = 0;
      for (let i = 1; i < plan.waypoints.length; i++) {
        const wp = plan.waypoints[i];
        const rawDt = Math.max(0, Math.round(wp.timestampOffsetMs - prevOffset));
        const dt = i === 1 ? rawDt + dwellMs : rawDt;
        prevOffset = wp.timestampOffsetMs;
        const p = this.toScreenPx(wp);
        waypoints.push({ x: p.x, y: p.y, delayMs: dt, action: "move" });
      }
      waypoints.push({
        x: endPx.x,
        y: endPx.y,
        delayMs: 4,
        action: "left_up",
      });
    }

    this.batchCounter++;
    const now = this.config.nowMs?.() ?? Date.now();
    return {
      type: "DISPATCH_TRAJECTORY",
      enabled: this.config.enabled,
      batchId: input.batchId ?? `batch-${now}-${this.batchCounter}`,
      mode,
      coordinateSpace: "screen_px",
      waypoints,
    };
  }

  async executeMove(
    input: NativeExecuteMoveInput
  ): Promise<NativeInputBatchResponse> {
    if (!this.config.enabled) {
      return {
        ok: false,
        batchId: input.batchId ?? "disabled",
        dispatchedEvents: 0,
        error: "NATIVE_DRIVER_DISABLED",
      };
    }

    const batch = this.buildBatchPayload(input);
    if (!batch) {
      return {
        ok: false,
        batchId: input.batchId ?? "no-rect",
        dispatchedEvents: 0,
        error: "BOARD_RECT_UNAVAILABLE",
      };
    }

    return this.port.sendNativeMessage(this.config.hostName, batch);
  }
}
