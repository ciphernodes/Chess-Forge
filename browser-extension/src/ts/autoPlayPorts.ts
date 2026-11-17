/**
 * Generic 8x8 DOM chessboard adapter ports, Elo configuration presets (1200 / 1600 / 2000),
 * and platform-agnostic DOM implementations.
 *
 * Intentionally decouples move selection, kinematic cursor execution, and orchestration
 * from any specific commercial site or DOM framework.
 */

export type PieceColor = "w" | "b";

export type FileChar = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
export type RankChar = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";
export type SquareName = `${FileChar}${RankChar}`;

export type EloPresetId = 1200 | 1600 | 2000;

export interface BoardBoundingRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface BoardStateSnapshot {
  readonly fen: string;
  readonly turn: PieceColor;
  readonly isFlipped: boolean;
  readonly moveNumber?: number;
  readonly legalMoveCount?: number;
  readonly availableChecksCount?: number;
  readonly availableCapturesCount?: number;
  readonly isRecaptureOpportunity?: boolean;
  readonly lastMoveUci?: string | null;
  readonly capturedAtMs: number;
}

export interface MultiPvCandidateLine {
  readonly rank: number;
  /** UCI move string such as "e2e4" or "e7e8q". */
  readonly move: string;
  readonly san?: string;
  /** Score from side-to-move perspective in centipawns. */
  readonly centipawns: number | null;
  readonly mate?: number | null;
  readonly depth: number;
  /**
   * Stockfish WDL triple [win, draw, loss] from side-to-move perspective.
   * Accepts either permille values (e.g., [520, 340, 140]) or probabilities ([0.52, 0.34, 0.14]).
   */
  readonly wdl?: readonly [number, number, number];
  readonly isRecapture?: boolean;
  readonly isCheck?: boolean;
  readonly isCapture?: boolean;
  readonly pv?: readonly string[];
}

export interface ShallowDepthEvaluation {
  readonly depth: number;
  readonly bestMove: string;
  readonly centipawns: number | null;
  readonly mate?: number | null;
}

export interface EngineMultiPvQuery {
  readonly fen: string;
  readonly multiPv: number;
  readonly maxDepth: number;
  readonly movetimeMs?: number;
  readonly signal?: AbortSignal;
}

export interface EngineMultiPvResult {
  readonly fen: string;
  readonly depth: number;
  readonly lines: readonly MultiPvCandidateLine[];
  readonly shallowDepth6?: ShallowDepthEvaluation;
  readonly deepDepth16?: ShallowDepthEvaluation;
  readonly legalMoveCount?: number;
  readonly availableChecksCount?: number;
  readonly availableCapturesCount?: number;
  readonly isRecaptureOpportunity?: boolean;
}

export interface ClockStateSnapshot {
  readonly whiteRemainingMs: number | null;
  readonly blackRemainingMs: number | null;
  readonly activeRemainingMs: number | null;
  readonly incrementMs?: number;
  readonly capturedAtMs: number;
}

/**
 * Binds kinematic pointer execution to any coordinate-based 8x8 DOM/Canvas board container.
 */
export interface BoardGeometryPort {
  getBoardRect(): BoardBoundingRect | null;
  isFlipped(): boolean;
  getBoardContainer(): Element | null;
  getTargetDocument(): Document | null;
  resolveSquareElement?(square: SquareName): Element | null;
  resolveElementAt?(clientX: number, clientY: number): Element | null;
}

/**
 * Abstraction over a local Stockfish MultiPV engine worker or test harness.
 */
export interface EngineMultiPvPort {
  analyzeMultiPv(query: EngineMultiPvQuery): Promise<EngineMultiPvResult>;
}

/**
 * Abstraction over clock telemetry for the active game.
 */
export interface ClockStatePort {
  readClockState(turn: PieceColor): ClockStateSnapshot;
}

/**
 * Observes generic 8x8 board FEN & turn transitions.
 */
export interface BoardStateObserverPort {
  getCurrentBoardState(): BoardStateSnapshot | null;
  subscribe(onStateChange: (snapshot: BoardStateSnapshot) => void): () => void;
}

export interface MoveSelectorConfig {
  readonly targetElo: number;
  readonly maxAllowedBlunderCp: number;
  readonly minHumanPriorProb: number;
  readonly criticalWdlThreshold: number;
  readonly baseTemperature: number;
  readonly lambdaCp: number;
  readonly standardSearchDepth: number;
  readonly standardThinkTimeMs: number;
  readonly timeTroubleThresholdMs: number;
  readonly timeTroubleDepth: number;
  readonly timeTroubleThinkTimeMs: number;
  readonly timeTroubleTempMultiplier: number;
  readonly randomFn?: () => number;
}

export interface KinematicExecutorConfig {
  /** Fraction of square width/height allowed for target jitter (0.60 = inner 60%). */
  readonly innerSquareClampFraction: number;
  /** Standard deviation of 2D Gaussian spatial jitter relative to square size. */
  readonly gaussianJitterSigmaFraction: number;
  /** Approach segment base duration range in ms. */
  readonly approachMinMs: number;
  readonly approachMaxMs: number;
  /** Drag segment base duration range in ms (scaled by pixel distance). */
  readonly dragMinMs: number;
  readonly dragMaxMs: number;
  /** Natural pause between pointerdown and drag/release in ms (40..110 ms). */
  readonly dwellMinMs: number;
  readonly dwellMaxMs: number;
  /** Perpendicular arc curvature ratio relative to segment distance. */
  readonly arcCurvatureMin: number;
  readonly arcCurvatureMax: number;
  /** Micro-tremor amplitude in CSS pixels during mid-flight motion. */
  readonly microTremorPx: number;
  /** Interaction mode: pointer drag or two-step click. */
  readonly interactionMode: "drag" | "click";
  /** Prefer requestAnimationFrame when running in a browser window. */
  readonly preferAnimationFrame: boolean;
  /** Optional custom PRNG for deterministic testing. */
  readonly randomFn?: () => number;
}

export interface OrchestratorTimingConfig {
  /** Target average delay range on obvious recaptures / simple positions (ms). */
  readonly obviousRecaptureMinMs: number;
  readonly obviousRecaptureMaxMs: number;
  /** Target average delay range in complex middlegames (ms). */
  readonly complexMiddlegameMinMs: number;
  readonly complexMiddlegameMaxMs: number;
  /** Clock threshold below which delays begin compressing proportionally. */
  readonly clockCompressionStartMs: number;
  /** Time-trouble threshold matching MoveSelector (15,000 ms). */
  readonly timeTroubleThresholdMs: number;
  /** Floor delay during extreme time trouble (ms). */
  readonly minThinkFloorMs: number;
  /** Multiplier applied across sampled delays for rating-calibrated pacing. */
  readonly ratingPacingMultiplier: number;
  /** Optional custom PRNG for deterministic testing. */
  readonly randomFn?: () => number;
}

export interface HumanizedAutoPlayPreset {
  readonly presetId: EloPresetId;
  readonly label: string;
  readonly selector: MoveSelectorConfig;
  readonly executor: KinematicExecutorConfig;
  readonly orchestrator: OrchestratorTimingConfig;
}

export const ELO_1200_PRESET: HumanizedAutoPlayPreset = {
  presetId: 1200,
  label: "Club Novice (1200 Elo)",
  selector: {
    targetElo: 1200,
    maxAllowedBlunderCp: 165,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.14,
    baseTemperature: 1.08,
    lambdaCp: 0.011,
    standardSearchDepth: 14,
    standardThinkTimeMs: 420,
    timeTroubleThresholdMs: 15_000,
    timeTroubleDepth: 8,
    timeTroubleThinkTimeMs: 160,
    timeTroubleTempMultiplier: 1.45,
  },
  executor: {
    innerSquareClampFraction: 0.6,
    gaussianJitterSigmaFraction: 0.12,
    approachMinMs: 150,
    approachMaxMs: 280,
    dragMinMs: 200,
    dragMaxMs: 390,
    dwellMinMs: 45,
    dwellMaxMs: 110,
    arcCurvatureMin: 0.06,
    arcCurvatureMax: 0.16,
    microTremorPx: 1.1,
    interactionMode: "drag",
    preferAnimationFrame: true,
  },
  orchestrator: {
    obviousRecaptureMinMs: 950,
    obviousRecaptureMaxMs: 1_800,
    complexMiddlegameMinMs: 3_600,
    complexMiddlegameMaxMs: 8_500,
    clockCompressionStartMs: 45_000,
    timeTroubleThresholdMs: 15_000,
    minThinkFloorMs: 240,
    ratingPacingMultiplier: 1.06,
  },
};

export const ELO_1600_PRESET: HumanizedAutoPlayPreset = {
  presetId: 1600,
  label: "Intermediate (1600 Elo)",
  selector: {
    targetElo: 1600,
    maxAllowedBlunderCp: 105,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.14,
    baseTemperature: 0.78,
    lambdaCp: 0.019,
    standardSearchDepth: 16,
    standardThinkTimeMs: 550,
    timeTroubleThresholdMs: 15_000,
    timeTroubleDepth: 10,
    timeTroubleThinkTimeMs: 200,
    timeTroubleTempMultiplier: 1.4,
  },
  executor: {
    innerSquareClampFraction: 0.6,
    gaussianJitterSigmaFraction: 0.105,
    approachMinMs: 125,
    approachMaxMs: 245,
    dragMinMs: 170,
    dragMaxMs: 335,
    dwellMinMs: 42,
    dwellMaxMs: 105,
    arcCurvatureMin: 0.05,
    arcCurvatureMax: 0.14,
    microTremorPx: 0.85,
    interactionMode: "drag",
    preferAnimationFrame: true,
  },
  orchestrator: {
    obviousRecaptureMinMs: 900,
    obviousRecaptureMaxMs: 1_750,
    complexMiddlegameMinMs: 3_500,
    complexMiddlegameMaxMs: 8_300,
    clockCompressionStartMs: 45_000,
    timeTroubleThresholdMs: 15_000,
    minThinkFloorMs: 210,
    ratingPacingMultiplier: 1.0,
  },
};

export const ELO_2000_PRESET: HumanizedAutoPlayPreset = {
  presetId: 2000,
  label: "Expert Candidate (2000 Elo)",
  selector: {
    targetElo: 2000,
    maxAllowedBlunderCp: 60,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.13,
    baseTemperature: 0.5,
    lambdaCp: 0.028,
    standardSearchDepth: 18,
    standardThinkTimeMs: 680,
    timeTroubleThresholdMs: 15_000,
    timeTroubleDepth: 12,
    timeTroubleThinkTimeMs: 240,
    timeTroubleTempMultiplier: 1.35,
  },
  executor: {
    innerSquareClampFraction: 0.6,
    gaussianJitterSigmaFraction: 0.09,
    approachMinMs: 105,
    approachMaxMs: 210,
    dragMinMs: 145,
    dragMaxMs: 285,
    dwellMinMs: 40,
    dwellMaxMs: 95,
    arcCurvatureMin: 0.04,
    arcCurvatureMax: 0.11,
    microTremorPx: 0.65,
    interactionMode: "drag",
    preferAnimationFrame: true,
  },
  orchestrator: {
    obviousRecaptureMinMs: 900,
    obviousRecaptureMaxMs: 1_650,
    complexMiddlegameMinMs: 3_500,
    complexMiddlegameMaxMs: 7_900,
    clockCompressionStartMs: 40_000,
    timeTroubleThresholdMs: 15_000,
    minThinkFloorMs: 185,
    ratingPacingMultiplier: 0.94,
  },
};

export const HUMANIZED_AUTOPLAY_PRESETS: Readonly<Record<EloPresetId, HumanizedAutoPlayPreset>> = {
  1200: ELO_1200_PRESET,
  1600: ELO_1600_PRESET,
  2000: ELO_2000_PRESET,
};

export function getAutoPlayPreset(elo: EloPresetId): HumanizedAutoPlayPreset {
  return HUMANIZED_AUTOPLAY_PRESETS[elo];
}

export interface GenericDomBoardGeometryOptions {
  readonly boardElement: Element;
  readonly flippedAttribute?: string;
  readonly squareAttribute?: string;
  readonly isFlippedFn?: (boardElement: Element) => boolean;
}

/**
 * Generic coordinate-based 8x8 DOM chessboard geometry adapter.
 * Binds to any container element (div grid, custom element, or HTML canvas).
 */
export class GenericDomBoardGeometryAdapter implements BoardGeometryPort {
  private readonly boardElement: Element;
  private readonly flippedAttribute: string;
  private readonly squareAttribute: string;
  private readonly isFlippedFn?: (boardElement: Element) => boolean;

  constructor(options: GenericDomBoardGeometryOptions) {
    this.boardElement = options.boardElement;
    this.flippedAttribute = options.flippedAttribute ?? "data-flipped";
    this.squareAttribute = options.squareAttribute ?? "data-square";
    this.isFlippedFn = options.isFlippedFn;
  }

  getBoardRect(): BoardBoundingRect | null {
    const rect = this.boardElement.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  isFlipped(): boolean {
    if (this.isFlippedFn) {
      return this.isFlippedFn(this.boardElement);
    }
    const attr = this.boardElement.getAttribute(this.flippedAttribute);
    return attr === "true" || attr === "black" || attr === "1";
  }

  getBoardContainer(): Element | null {
    return this.boardElement;
  }

  getTargetDocument(): Document | null {
    return this.boardElement.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  }

  resolveSquareElement(square: SquareName): Element | null {
    const selector = `[${this.squareAttribute}="${square}"]`;
    return this.boardElement.querySelector(selector);
  }

  resolveElementAt(clientX: number, clientY: number): Element | null {
    const doc = this.getTargetDocument();
    if (doc && typeof doc.elementFromPoint === "function") {
      const hit = doc.elementFromPoint(clientX, clientY);
      if (hit) return hit;
    }
    return this.boardElement;
  }
}

export interface GenericDomClockSelectors {
  readonly whiteClockSelector: string;
  readonly blackClockSelector: string;
  readonly root?: Document | Element;
  readonly incrementMs?: number;
}

/**
 * Generic DOM clock adapter reading text timestamps (hh:mm:ss, mm:ss, or ss.d)
 * from configurable CSS selectors on any host container.
 */
export class GenericDomClockStateAdapter implements ClockStatePort {
  private readonly whiteClockSelector: string;
  private readonly blackClockSelector: string;
  private readonly root: Document | Element | null;
  private readonly incrementMs?: number;

  constructor(options: GenericDomClockSelectors) {
    this.whiteClockSelector = options.whiteClockSelector;
    this.blackClockSelector = options.blackClockSelector;
    this.root = options.root ?? (typeof document !== "undefined" ? document : null);
    this.incrementMs = options.incrementMs;
  }

  readClockState(turn: PieceColor): ClockStateSnapshot {
    const now = Date.now();
    if (!this.root) {
      return {
        whiteRemainingMs: null,
        blackRemainingMs: null,
        activeRemainingMs: null,
        incrementMs: this.incrementMs,
        capturedAtMs: now,
      };
    }

    const whiteEl = this.root.querySelector(this.whiteClockSelector);
    const blackEl = this.root.querySelector(this.blackClockSelector);
    const whiteRemainingMs = whiteEl?.textContent ? parseClockDurationMs(whiteEl.textContent) : null;
    const blackRemainingMs = blackEl?.textContent ? parseClockDurationMs(blackEl.textContent) : null;
    const activeRemainingMs = turn === "w" ? whiteRemainingMs : blackRemainingMs;

    return {
      whiteRemainingMs,
      blackRemainingMs,
      activeRemainingMs,
      incrementMs: this.incrementMs,
      capturedAtMs: now,
    };
  }
}

export function parseClockDurationMs(rawText: string): number | null {
  const clean = rawText.replace(/\s+/g, "").trim();
  if (!clean) return null;
  const parts = clean.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if ([h, m, s].some((n) => !Number.isFinite(n) || n < 0)) return null;
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if ([m, s].some((n) => !Number.isFinite(n) || n < 0)) return null;
    return Math.round((m * 60 + s) * 1000);
  }
  const secs = Number(clean);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return Math.round(secs * 1000);
}

export function isValidSquareName(value: string): value is SquareName {
  return /^[a-h][1-8]$/.test(value);
}

export function parseUciMoveSquares(uci: string): {
  readonly from: SquareName;
  readonly to: SquareName;
  readonly promotion?: string;
} | null {
  const trimmed = uci.trim().toLowerCase();
  if (trimmed.length < 4) return null;
  const from = trimmed.slice(0, 2);
  const to = trimmed.slice(2, 4);
  if (!isValidSquareName(from) || !isValidSquareName(to)) return null;
  const promotion = trimmed.length >= 5 ? trimmed[4] : undefined;
  return { from, to, promotion };
}
