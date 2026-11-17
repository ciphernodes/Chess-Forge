import {
  ELO_1600_PRESET,
  isValidSquareName,
  type BoardBoundingRect,
  type BoardGeometryPort,
  type KinematicExecutorConfig,
  type SquareName,
} from "./autoPlayPorts.ts";

export {
  isValidSquareName,
  type BoardBoundingRect,
  type BoardGeometryPort,
  type KinematicExecutorConfig,
  type SquareName,
};

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface TrajectoryWaypoint {
  readonly x: number;
  readonly y: number;
  /** Normalized elapsed time tau in [0, 1]. */
  readonly tau: number;
  /** Minimum-jerk warped curve progress s(tau) in [0, 1]. */
  readonly progress: number;
  /** Dimensionless bell-curve velocity factor 30 * tau^2 * (1 - tau)^2. */
  readonly velocityProfile: number;
  readonly timestampOffsetMs: number;
}

export interface CubicBezierControlPoints {
  readonly p0: Point2D;
  readonly p1: Point2D;
  readonly p2: Point2D;
  readonly p3: Point2D;
}

export interface TrajectoryPlan {
  readonly controlPoints: CubicBezierControlPoints;
  readonly durationMs: number;
  readonly waypoints: readonly TrajectoryWaypoint[];
}

export interface DispatchedPointerEventRecord {
  readonly type: string;
  readonly clientX: number;
  readonly clientY: number;
  readonly buttons: number;
  readonly button: number;
  readonly timestampMs: number;
}

export interface PointerExecutionResult {
  readonly executed: boolean;
  readonly aborted: boolean;
  readonly abortReason?: string;
  readonly fromSquare: SquareName;
  readonly toSquare: SquareName;
  readonly originPoint: Point2D;
  readonly destinationPoint: Point2D;
  readonly approachDurationMs: number;
  readonly dragDurationMs: number;
  readonly dwellDurationMs: number;
  readonly totalDurationMs: number;
  readonly eventSequence: readonly DispatchedPointerEventRecord[];
}

export interface FrameScheduler {
  waitNextFrame(signal?: AbortSignal): Promise<number>;
  waitMs(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export interface ExecuteMoveOptions {
  readonly signal?: AbortSignal;
  readonly onEventDispatched?: (record: DispatchedPointerEventRecord) => void;
}

export const DEFAULT_KINEMATIC_CONFIG: KinematicExecutorConfig =
  ELO_1600_PRESET.executor;

/**
 * Minimum-jerk time-warping polynomial s(tau) = 10*tau^3 - 15*tau^4 + 6*tau^5.
 * Produces zero start/end velocity and smooth acceleration/deceleration.
 */
export function minimumJerkProgress(tau: number): number {
  const t = clamp(tau, 0, 1);
  const t3 = t * t * t;
  return t3 * (10 + t * (-15 + 6 * t));
}

/**
 * Derivative of minimum-jerk polynomial: ds/dtau = 30 * tau^2 * (1 - tau)^2.
 * Exhibits a symmetric bell-curve velocity profile peaking at tau = 0.5.
 */
export function minimumJerkVelocity(tau: number): number {
  const t = clamp(tau, 0, 1);
  const oneMinus = 1 - t;
  return 30 * t * t * oneMinus * oneMinus;
}

/**
 * Box-Muller standard normal 2D sample (independent zero-mean, unit-variance Gaussians).
 */
export function sampleGaussian2D(rng: () => number = Math.random): Point2D {
  const u1 = Math.max(1e-7, Math.min(0.9999999, rng()));
  const u2 = Math.max(1e-7, Math.min(0.9999999, rng()));
  const mag = Math.sqrt(-2.0 * Math.log(u1));
  const theta = 2.0 * Math.PI * u2;
  return {
    x: mag * Math.cos(theta),
    y: mag * Math.sin(theta),
  };
}

/**
 * Computes square center and bounds from BoardBoundingRect and orientation.
 */
export function computeSquareGeometry(
  square: SquareName,
  rect: BoardBoundingRect,
  isFlipped: boolean
): {
  readonly centerX: number;
  readonly centerY: number;
  readonly squareWidth: number;
  readonly squareHeight: number;
  readonly minInnerX: number;
  readonly maxInnerX: number;
  readonly minInnerY: number;
  readonly maxInnerY: number;
} {
  const fileIdx = square.charCodeAt(0) - 97; // 0..7 ('a'..'h')
  const rankIdx = parseInt(square[1], 10) - 1; // 0..7 ('1'..'8')
  const col = isFlipped ? 7 - fileIdx : fileIdx;
  const row = isFlipped ? rankIdx : 7 - rankIdx;

  const squareWidth = rect.width / 8;
  const squareHeight = rect.height / 8;
  const centerX = rect.left + (col + 0.5) * squareWidth;
  const centerY = rect.top + (row + 0.5) * squareHeight;

  return {
    centerX,
    centerY,
    squareWidth,
    squareHeight,
    minInnerX: centerX - 0.3 * squareWidth,
    maxInnerX: centerX + 0.3 * squareWidth,
    minInnerY: centerY - 0.3 * squareHeight,
    maxInnerY: centerY + 0.3 * squareHeight,
  };
}

/**
 * Computes jittered pixel coordinates inside a square using 2D Gaussian noise
 * strictly clamped within the inner 60% of the square ([-0.30*sq, +0.30*sq]).
 */
export function computeSquareTargetPoint(
  square: SquareName,
  rect: BoardBoundingRect,
  isFlipped: boolean,
  config: KinematicExecutorConfig = DEFAULT_KINEMATIC_CONFIG,
  rng: () => number = Math.random
): Point2D {
  const geom = computeSquareGeometry(square, rect, isFlipped);
  const innerFraction = clamp(config.innerSquareClampFraction, 0.1, 0.6);
  const halfSpanX = (innerFraction * 0.5) * geom.squareWidth;
  const halfSpanY = (innerFraction * 0.5) * geom.squareHeight;

  const z = sampleGaussian2D(rng);
  const offsetX = clamp(
    z.x * config.gaussianJitterSigmaFraction * geom.squareWidth,
    -halfSpanX,
    halfSpanX
  );
  const offsetY = clamp(
    z.y * config.gaussianJitterSigmaFraction * geom.squareHeight,
    -halfSpanY,
    halfSpanY
  );

  return {
    x: Number((geom.centerX + offsetX).toFixed(2)),
    y: Number((geom.centerY + offsetY).toFixed(2)),
  };
}

/**
 * Evaluates a cubic Bézier curve B(s) at progress s in [0, 1].
 */
export function evaluateCubicBezier(
  cp: CubicBezierControlPoints,
  s: number
): Point2D {
  const t = clamp(s, 0, 1);
  const u = 1 - t;
  const u2 = u * u;
  const t2 = t * t;
  const w0 = u2 * u;
  const w1 = 3 * u2 * t;
  const w2 = 3 * u * t2;
  const w3 = t2 * t;
  return {
    x: w0 * cp.p0.x + w1 * cp.p1.x + w2 * cp.p2.x + w3 * cp.p3.x,
    y: w0 * cp.p0.y + w1 * cp.p1.y + w2 * cp.p2.y + w3 * cp.p3.y,
  };
}

/**
 * Generates a cubic Bézier trajectory with perpendicular arc curvature,
 * physiological micro-tremor noise (tapered to 0 at endpoints), and
 * minimum-jerk / bell-curve velocity time-warping.
 */
export function generateCubicBezierTrajectory(
  start: Point2D,
  end: Point2D,
  durationMs: number,
  config: KinematicExecutorConfig,
  rng: () => number = Math.random,
  stepIntervalMs: number = 16
): TrajectoryPlan {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);

  const safeDuration = Math.max(40, Math.round(durationMs));
  const numSteps = Math.max(6, Math.round(safeDuration / Math.max(4, stepIntervalMs)));

  if (distance < 0.5) {
    const cp: CubicBezierControlPoints = {
      p0: start,
      p1: start,
      p2: end,
      p3: end,
    };
    const waypoints: TrajectoryWaypoint[] = [];
    for (let i = 0; i <= numSteps; i++) {
      const tau = i / numSteps;
      waypoints.push({
        x: i === numSteps ? end.x : start.x,
        y: i === numSteps ? end.y : start.y,
        tau,
        progress: minimumJerkProgress(tau),
        velocityProfile: minimumJerkVelocity(tau),
        timestampOffsetMs: Math.round(tau * safeDuration),
      });
    }
    return { controlPoints: cp, durationMs: safeDuration, waypoints };
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const nx = -uy;
  const ny = ux;

  const arcSign = rng() < 0.5 ? -1 : 1;
  const arcSpan =
    config.arcCurvatureMin +
    rng() * Math.max(0, config.arcCurvatureMax - config.arcCurvatureMin);
  const arcOffset1 = arcSign * distance * arcSpan * (0.85 + rng() * 0.4);
  const arcOffset2 = arcSign * distance * arcSpan * (0.65 + rng() * 0.5);

  const t1 = 0.26 + rng() * 0.12;
  const t2 = 0.64 + rng() * 0.12;

  const p1: Point2D = {
    x: start.x + dx * t1 + nx * arcOffset1,
    y: start.y + dy * t1 + ny * arcOffset1,
  };
  const p2: Point2D = {
    x: start.x + dx * t2 + nx * arcOffset2,
    y: start.y + dy * t2 + ny * arcOffset2,
  };

  const controlPoints: CubicBezierControlPoints = {
    p0: start,
    p1,
    p2,
    p3: end,
  };

  const tremorPhase = rng() * Math.PI * 2;
  const tremorFreq = 2.5 + rng() * 2.5;
  const waypoints: TrajectoryWaypoint[] = [];

  for (let i = 0; i <= numSteps; i++) {
    const tau = i / numSteps;
    const progress = minimumJerkProgress(tau);
    const velocityProfile = minimumJerkVelocity(tau);

    if (i === 0) {
      waypoints.push({
        x: Number(start.x.toFixed(2)),
        y: Number(start.y.toFixed(2)),
        tau: 0,
        progress: 0,
        velocityProfile: 0,
        timestampOffsetMs: 0,
      });
      continue;
    }

    if (i === numSteps) {
      waypoints.push({
        x: Number(end.x.toFixed(2)),
        y: Number(end.y.toFixed(2)),
        tau: 1,
        progress: 1,
        velocityProfile: 0,
        timestampOffsetMs: safeDuration,
      });
      continue;
    }

    const basePt = evaluateCubicBezier(controlPoints, progress);
    // Taper micro-tremor to 0 at endpoints so origin & target acquisition stay exact
    const envelope = Math.sin(Math.PI * tau);
    const tremorNoise = sampleGaussian2D(rng);
    const harmonic = Math.sin(tau * Math.PI * tremorFreq + tremorPhase);
    const offsetPerp =
      envelope * config.microTremorPx * (0.55 * harmonic + 0.45 * tremorNoise.x);
    const offsetAxial = envelope * config.microTremorPx * 0.3 * tremorNoise.y;

    waypoints.push({
      x: Number((basePt.x + nx * offsetPerp + ux * offsetAxial).toFixed(2)),
      y: Number((basePt.y + ny * offsetPerp + uy * offsetAxial).toFixed(2)),
      tau,
      progress,
      velocityProfile,
      timestampOffsetMs: Math.round(tau * safeDuration),
    });
  }

  return {
    controlPoints,
    durationMs: safeDuration,
    waypoints,
  };
}

/**
 * Default browser/Node frame scheduler preferring requestAnimationFrame when available.
 */
export function createDefaultFrameScheduler(
  preferAnimationFrame: boolean = true
): FrameScheduler {
  const nowFn = (): number =>
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();

  const waitMs = (ms: number, signal?: AbortSignal): Promise<void> => {
    if (signal?.aborted) {
      return Promise.reject(new AbortExecutionError("ABORTED"));
    }
    const clampedMs = Math.max(0, Math.round(ms));
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, clampedMs);

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new AbortExecutionError("ABORTED"));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
    });
  };

  const waitNextFrame = (signal?: AbortSignal): Promise<number> => {
    if (signal?.aborted) {
      return Promise.reject(new AbortExecutionError("ABORTED"));
    }
    if (
      preferAnimationFrame &&
      typeof globalThis.requestAnimationFrame === "function"
    ) {
      return new Promise<number>((resolve, reject) => {
        let settled = false;
        const rafId = globalThis.requestAnimationFrame((ts) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(ts);
        });
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          if (typeof globalThis.cancelAnimationFrame === "function") {
            globalThis.cancelAnimationFrame(rafId);
          }
          reject(new AbortExecutionError("ABORTED"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return waitMs(16, signal).then(() => nowFn());
  };

  return {
    waitNextFrame,
    waitMs,
    now: nowFn,
  };
}

export class AbortExecutionError extends Error {
  constructor(message: string = "ABORTED") {
    super(message);
    this.name = "AbortExecutionError";
  }
}

/**
 * Executes humanized cursor approach, press, dwell, drag, and release sequences
 * on any coordinate-based 8x8 DOM board bound via BoardGeometryPort.
 */
export class KinematicPointerExecutor {
  private readonly geometryPort: BoardGeometryPort;
  private config: KinematicExecutorConfig;
  private readonly scheduler: FrameScheduler;
  private virtualCursor: Point2D | null = null;
  private dispatching = false;

  constructor(
    geometryPort: BoardGeometryPort,
    config: Partial<KinematicExecutorConfig> = {},
    scheduler?: FrameScheduler
  ) {
    this.geometryPort = geometryPort;
    this.config = { ...DEFAULT_KINEMATIC_CONFIG, ...config };
    this.scheduler =
      scheduler ?? createDefaultFrameScheduler(this.config.preferAnimationFrame);
  }

  getConfig(): KinematicExecutorConfig {
    return this.config;
  }

  updateConfig(partial: Partial<KinematicExecutorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getVirtualCursor(): Point2D | null {
    return this.virtualCursor;
  }

  setVirtualCursor(point: Point2D | null): void {
    this.virtualCursor = point;
  }

  isDispatching(): boolean {
    return this.dispatching;
  }

  /**
   * Executes a move from `fromSquare` to `toSquare` with realistic pointer kinematics.
   */
  async executeMove(
    fromSquare: SquareName,
    toSquare: SquareName,
    options: ExecuteMoveOptions = {}
  ): Promise<PointerExecutionResult> {
    if (!isValidSquareName(fromSquare) || !isValidSquareName(toSquare)) {
      return {
        executed: false,
        aborted: true,
        abortReason: "INVALID_SQUARE",
        fromSquare,
        toSquare,
        originPoint: { x: 0, y: 0 },
        destinationPoint: { x: 0, y: 0 },
        approachDurationMs: 0,
        dragDurationMs: 0,
        dwellDurationMs: 0,
        totalDurationMs: 0,
        eventSequence: [],
      };
    }

    const rect = this.geometryPort.getBoardRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        executed: false,
        aborted: true,
        abortReason: "BOARD_RECT_UNAVAILABLE",
        fromSquare,
        toSquare,
        originPoint: { x: 0, y: 0 },
        destinationPoint: { x: 0, y: 0 },
        approachDurationMs: 0,
        dragDurationMs: 0,
        dwellDurationMs: 0,
        totalDurationMs: 0,
        eventSequence: [],
      };
    }

    const signal = options.signal;
    const rng = this.config.randomFn ?? Math.random;
    const flipped = this.geometryPort.isFlipped();

    const originPoint = computeSquareTargetPoint(
      fromSquare,
      rect,
      flipped,
      this.config,
      rng
    );
    const destinationPoint = computeSquareTargetPoint(
      toSquare,
      rect,
      flipped,
      this.config,
      rng
    );

    const startCursor: Point2D = this.virtualCursor ?? {
      x: Number((rect.left + rect.width * (0.25 + rng() * 0.5)).toFixed(2)),
      y: Number((rect.top + rect.height * (0.25 + rng() * 0.5)).toFixed(2)),
    };

    const approachDist = Math.hypot(
      originPoint.x - startCursor.x,
      originPoint.y - startCursor.y
    );
    const dragDist = Math.hypot(
      destinationPoint.x - originPoint.x,
      destinationPoint.y - originPoint.y
    );

    const approachDurationMs = scaleDurationByDistance(
      approachDist,
      rect.width,
      this.config.approachMinMs,
      this.config.approachMaxMs,
      rng
    );
    const dragDurationMs = scaleDurationByDistance(
      dragDist,
      rect.width,
      this.config.dragMinMs,
      this.config.dragMaxMs,
      rng
    );
    const dwellDurationMs = sampleDwellDurationMs(
      this.config.dwellMinMs,
      this.config.dwellMaxMs,
      rng
    );

    const eventSequence: DispatchedPointerEventRecord[] = [];
    const emitEvent = (
      target: Element | null,
      type: string,
      pt: Point2D,
      buttons: number,
      button: number
    ): void => {
      if (!target) return;
      const nowMs = Math.round(this.scheduler.now());
      dispatchSyntheticDomEvent(target, type, pt, buttons, button);
      const record: DispatchedPointerEventRecord = {
        type,
        clientX: pt.x,
        clientY: pt.y,
        buttons,
        button,
        timestampMs: nowMs,
      };
      eventSequence.push(record);
      options.onEventDispatched?.(record);
      this.virtualCursor = pt;
    };

    const resolveTarget = (
      square: SquareName,
      pt: Point2D
    ): Element | null => {
      return (
        this.geometryPort.resolveSquareElement?.(square) ??
        this.geometryPort.resolveElementAt?.(pt.x, pt.y) ??
        this.geometryPort.getBoardContainer()
      );
    };

    const startedAt = this.scheduler.now();
    let pointerIsDown = false;
    let activeDownTarget: Element | null = null;
    this.dispatching = true;

    try {
      checkAborted(signal);

      const originTarget = resolveTarget(fromSquare, originPoint);
      if (!originTarget) {
        return {
          executed: false,
          aborted: true,
          abortReason: "NO_DOM_TARGET",
          fromSquare,
          toSquare,
          originPoint,
          destinationPoint,
          approachDurationMs: 0,
          dragDurationMs: 0,
          dwellDurationMs: 0,
          totalDurationMs: 0,
          eventSequence,
        };
      }

      // 1. Hover entry + Bézier approach to origin square
      emitEvent(originTarget, "pointerover", startCursor, 0, 0);
      emitEvent(originTarget, "pointerenter", startCursor, 0, 0);
      emitEvent(originTarget, "mouseover", startCursor, 0, 0);
      emitEvent(originTarget, "mouseenter", startCursor, 0, 0);

      const approachPlan = generateCubicBezierTrajectory(
        startCursor,
        originPoint,
        approachDurationMs,
        this.config,
        rng
      );
      await this.followPlan(
        approachPlan,
        (pt) => {
          const hovered = resolveTarget(fromSquare, pt) ?? originTarget;
          emitEvent(hovered, "pointermove", pt, 0, 0);
          emitEvent(hovered, "mousemove", pt, 0, 0);
        },
        signal
      );

      checkAborted(signal);

      // 2. Press on origin square
      const pressTarget = resolveTarget(fromSquare, originPoint) ?? originTarget;
      activeDownTarget = pressTarget;
      emitEvent(pressTarget, "pointerdown", originPoint, 1, 0);
      emitEvent(pressTarget, "mousedown", originPoint, 1, 0);
      pointerIsDown = true;

      if (this.config.interactionMode === "click") {
        // First click dwell (40..110 ms) before release
        await this.scheduler.waitMs(dwellDurationMs, signal);
        emitEvent(pressTarget, "pointerup", originPoint, 0, 0);
        emitEvent(pressTarget, "mouseup", originPoint, 0, 0);
        emitEvent(pressTarget, "click", originPoint, 0, 0);
        pointerIsDown = false;

        // Move to destination square along Bézier trajectory
        const travelPlan = generateCubicBezierTrajectory(
          originPoint,
          destinationPoint,
          dragDurationMs,
          this.config,
          rng
        );
        await this.followPlan(
          travelPlan,
          (pt) => {
            const hovered = resolveTarget(toSquare, pt) ?? pressTarget;
            emitEvent(hovered, "pointermove", pt, 0, 0);
            emitEvent(hovered, "mousemove", pt, 0, 0);
          },
          signal
        );

        const destTarget = resolveTarget(toSquare, destinationPoint) ?? pressTarget;
        emitEvent(destTarget, "pointerover", destinationPoint, 0, 0);
        emitEvent(destTarget, "pointerenter", destinationPoint, 0, 0);
        emitEvent(destTarget, "pointerdown", destinationPoint, 1, 0);
        emitEvent(destTarget, "mousedown", destinationPoint, 1, 0);
        pointerIsDown = true;

        const destDwell = sampleDwellDurationMs(
          this.config.dwellMinMs,
          this.config.dwellMaxMs,
          rng
        );
        await this.scheduler.waitMs(destDwell, signal);
        emitEvent(destTarget, "pointerup", destinationPoint, 0, 0);
        emitEvent(destTarget, "mouseup", destinationPoint, 0, 0);
        emitEvent(destTarget, "click", destinationPoint, 0, 0);
        pointerIsDown = false;
      } else {
        // Drag mode: brief grip dwell, drag Bézier steps with buttons=1, settle dwell, release + click
        const gripDwellMs = clamp(Math.round(dwellDurationMs * 0.55), 40, 75);
        await this.scheduler.waitMs(gripDwellMs, signal);

        const dragPlan = generateCubicBezierTrajectory(
          originPoint,
          destinationPoint,
          dragDurationMs,
          this.config,
          rng
        );
        await this.followPlan(
          dragPlan,
          (pt) => {
            const over = resolveTarget(toSquare, pt) ?? pressTarget;
            emitEvent(over, "pointermove", pt, 1, 0);
            emitEvent(over, "mousemove", pt, 1, 0);
          },
          signal
        );

        checkAborted(signal);
        const destTarget = resolveTarget(toSquare, destinationPoint) ?? pressTarget;
        emitEvent(destTarget, "pointerover", destinationPoint, 1, 0);
        emitEvent(destTarget, "pointerenter", destinationPoint, 1, 0);
        emitEvent(destTarget, "mouseover", destinationPoint, 1, 0);
        emitEvent(destTarget, "mouseenter", destinationPoint, 1, 0);

        // Natural target acquisition dwell before releasing piece (40..110 ms)
        await this.scheduler.waitMs(dwellDurationMs, signal);
        emitEvent(destTarget, "pointerup", destinationPoint, 0, 0);
        emitEvent(destTarget, "mouseup", destinationPoint, 0, 0);
        emitEvent(destTarget, "click", destinationPoint, 0, 0);
        pointerIsDown = false;
      }

      const totalDurationMs = Math.max(
        1,
        Math.round(this.scheduler.now() - startedAt)
      );

      return {
        executed: true,
        aborted: false,
        fromSquare,
        toSquare,
        originPoint,
        destinationPoint,
        approachDurationMs,
        dragDurationMs,
        dwellDurationMs,
        totalDurationMs,
        eventSequence,
      };
    } catch (err) {
      if (pointerIsDown && activeDownTarget) {
        const cancelPt = this.virtualCursor ?? originPoint;
        emitEvent(activeDownTarget, "pointercancel", cancelPt, 0, 0);
      }
      const totalDurationMs = Math.round(this.scheduler.now() - startedAt);
      const reason =
        err instanceof AbortExecutionError
          ? err.message
          : err instanceof Error
          ? err.message
          : "ABORTED";
      return {
        executed: false,
        aborted: true,
        abortReason: reason,
        fromSquare,
        toSquare,
        originPoint,
        destinationPoint,
        approachDurationMs,
        dragDurationMs,
        dwellDurationMs,
        totalDurationMs,
        eventSequence,
      };
    } finally {
      this.dispatching = false;
    }
  }

  private async followPlan(
    plan: TrajectoryPlan,
    onPoint: (pt: Point2D) => void,
    signal?: AbortSignal
  ): Promise<void> {
    if (plan.waypoints.length === 0) return;

    const startTime = this.scheduler.now();
    let lastDispatchedIndex = -1;

    while (lastDispatchedIndex < plan.waypoints.length - 1) {
      checkAborted(signal);
      const elapsed = this.scheduler.now() - startTime;
      let targetIdx = lastDispatchedIndex + 1;
      while (
        targetIdx < plan.waypoints.length - 1 &&
        plan.waypoints[targetIdx].timestampOffsetMs <= elapsed
      ) {
        targetIdx++;
      }

      const wp = plan.waypoints[targetIdx];
      onPoint({ x: wp.x, y: wp.y });
      lastDispatchedIndex = targetIdx;

      if (targetIdx >= plan.waypoints.length - 1) break;
      await this.scheduler.waitNextFrame(signal);
    }
  }
}

function scaleDurationByDistance(
  distancePx: number,
  boardWidthPx: number,
  minMs: number,
  maxMs: number,
  rng: () => number
): number {
  const safeBoard = Math.max(120, boardWidthPx);
  const ratio = clamp(distancePx / safeBoard, 0.08, 1.0);
  const span = Math.max(0, maxMs - minMs);
  const jitter = (rng() - 0.5) * Math.min(40, span * 0.25);
  return Math.round(clamp(minMs + ratio * span + jitter, minMs, maxMs));
}

function sampleDwellDurationMs(
  minMs: number,
  maxMs: number,
  rng: () => number
): number {
  const low = clamp(Math.round(minMs), 40, 110);
  const high = clamp(Math.round(maxMs), low, 110);
  // Averaged pair produces natural central tendency within [40, 110] ms
  const t = 0.5 * (rng() + rng());
  return Math.round(low + t * (high - low));
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AbortExecutionError("ABORTED");
  }
}

function dispatchSyntheticDomEvent(
  target: Element,
  type: string,
  pt: Point2D,
  buttons: number,
  button: number
): void {
  const isPointer = type.startsWith("pointer");
  const baseInit = {
    bubbles: type !== "pointerenter" && type !== "mouseenter",
    cancelable: type !== "pointerenter" && type !== "mouseenter",
    composed: true,
    view: typeof window !== "undefined" ? window : undefined,
    clientX: pt.x,
    clientY: pt.y,
    screenX: pt.x,
    screenY: pt.y,
    button,
    buttons,
  };

  let eventObj: Event;
  if (isPointer && typeof globalThis.PointerEvent === "function") {
    eventObj = new globalThis.PointerEvent(type, {
      ...baseInit,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: buttons > 0 ? 0.5 : 0,
    });
  } else if (typeof globalThis.MouseEvent === "function") {
    eventObj = new globalThis.MouseEvent(type, baseInit);
  } else {
    eventObj = Object.assign(
      {
        type,
        preventDefault: () => {},
        stopPropagation: () => {},
      },
      baseInit,
      isPointer
        ? {
            pointerId: 1,
            pointerType: "mouse",
            isPrimary: true,
            pressure: buttons > 0 ? 0.5 : 0,
          }
        : {}
    ) as unknown as Event;
  }

  target.dispatchEvent(eventObj);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
