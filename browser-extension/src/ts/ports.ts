import type { FairPlayMetricsSnapshot } from "./fairPlayModels.ts";

export type SideToMove = "w" | "b";

/**
 * Raw Stockfish MultiPV + WDL candidate line emitted by the offscreen WASM worker
 * or local JS fallback engine.
 */
export interface EngineLine {
  readonly rank: number;
  readonly uci: string;
  readonly san: string;
  readonly centipawns: number | null;
  readonly mate: number | null;
  readonly winPct: number;
  readonly depth: number;
  /** Stockfish UCI_ShowWDL triple [winPermille, drawPermille, lossPermille] summing to 1000. */
  readonly wdl?: readonly [number, number, number];
  readonly pv?: string;
}

export interface ShallowSearchSnapshot {
  readonly depth: number;
  readonly bestUci: string;
  readonly centipawns: number | null;
  readonly mate: number | null;
  readonly wdl?: readonly [number, number, number];
}

export interface EngineAnalysis {
  readonly fen: string;
  readonly turn: SideToMove;
  readonly depth: number;
  readonly lines: readonly EngineLine[];
  readonly shallowDepth6?: ShallowSearchSnapshot;
  readonly engineBackend: string;
  readonly isOpeningBook?: boolean;
  readonly openingBookUcis?: readonly string[];
  readonly legalMoveCount?: number;
  readonly tacticalMoveCount?: number;
  readonly isRecaptureOpportunity?: boolean;
}

export interface EngineAnalyzeOptions {
  readonly multiPv: number;
  readonly maxDepth: number;
  readonly skillLevel: number;
  readonly cpuProfile: "eco" | "balanced" | "turbo";
}

/** Adapter over the existing Stockfish WASM offscreen worker / JS fallback engine. */
export interface EnginePort {
  analyze(fen: string, options: EngineAnalyzeOptions): Promise<EngineAnalysis>;
}

/**
 * Adapter over human move probability priors (quantized Maia-2 ONNX model
 * with graceful heuristic fallback when ONNX runtime is unavailable).
 */
export interface PolicyPort {
  predictHumanPriors(
    fen: string,
    candidateLines: readonly EngineLine[],
    targetElo: number
  ): Promise<ReadonlyMap<string, number>>;
}

export interface ClockSnapshot {
  readonly whiteRemainingMs: number | null;
  readonly blackRemainingMs: number | null;
  readonly activeRemainingMs: number | null;
  readonly capturedAtMs: number;
}

/** Adapter over the host site's DOM clock observer (Lichess / Chess.com / Practice). */
export interface ClockTelemetryPort {
  readClocks(turn: SideToMove): ClockSnapshot;
}

export interface OverlayDrawCommand {
  readonly fen: string;
  readonly turn: SideToMove;
  readonly selectedLine: EngineLine;
  readonly candidatePool: readonly EngineLine[];
  readonly expectedScoreDelta: number;
  readonly complexityScore: number;
  readonly humanPrior: number;
  readonly temperatureUsed: number;
  readonly delayMs: number;
  readonly hintsUsedInGame: number;
  readonly maxHintsPerGame: number;
}

/** Adapter over the existing Shadow DOM / SVG overlay renderer. */
export interface OverlayRenderPort {
  drawOverlay(command: OverlayDrawCommand): void;
  clearOverlay(reason: string): void;
  updateFairPlayBadge(snapshot: FairPlayMetricsSnapshot): void;
}

/**
 * Optional inference bridge interface for a loaded quantized Maia-2 ONNX Runtime Web session.
 * When `session` is absent or throws, PolicyPort falls back transparently to HeuristicPolicyAdapter.
 */
export interface OnnxPolicyRunner {
  inferMoveProbs(
    fen: string,
    targetElo: number,
    candidateUcis: readonly string[]
  ): Promise<ReadonlyMap<string, number>>;
}

export class Maia2PolicyAdapter implements PolicyPort {
  private readonly onnxRunner: OnnxPolicyRunner | null;
  private readonly fallback: HeuristicPolicyAdapter;

  constructor(onnxRunner: OnnxPolicyRunner | null = null) {
    this.onnxRunner = onnxRunner;
    this.fallback = new HeuristicPolicyAdapter();
  }

  async predictHumanPriors(
    fen: string,
    candidateLines: readonly EngineLine[],
    targetElo: number
  ): Promise<ReadonlyMap<string, number>> {
    if (this.onnxRunner && candidateLines.length > 0) {
      try {
        const ucis = candidateLines.map((l) => l.uci);
        const onnxProbs = await this.onnxRunner.inferMoveProbs(fen, targetElo, ucis);
        if (onnxProbs.size > 0) {
          return normalizeProbabilityMap(candidateLines, onnxProbs);
        }
      } catch {
        // Fall through cleanly to Stockfish MultiPV heuristic prior model
      }
    }
    return this.fallback.predictHumanPriors(fen, candidateLines, targetElo);
  }
}

/**
 * Graceful Stockfish-informed human plausibility fallback when Maia-2 ONNX weights
 * are not loaded in the browser extension context.
 */
export class HeuristicPolicyAdapter implements PolicyPort {
  async predictHumanPriors(
    fen: string,
    candidateLines: readonly EngineLine[],
    targetElo: number
  ): Promise<ReadonlyMap<string, number>> {
    const out = new Map<string, number>();
    if (candidateLines.length === 0) return out;

    const bestEval = comparableCp(candidateLines[0]);
    const eloFactor = Math.max(0.2, Math.min(1.0, (targetElo - 500) / 2100));
    const boardPieces = parseBoardPlacementMap(fen);

    const rawWeights: number[] = candidateLines.map((line, idx) => {
      const cpDrop = Math.max(0, bestEval - comparableCp(line));
      const destSq = line.uci.slice(2, 4);
      const isCapture = boardPieces.has(destSq) || line.san.includes("x");
      const isCheck = line.san.includes("+") || line.san.includes("#");
      const isCenterTarget = /^(c|d|e|f)[3-6]$/.test(destSq);
      const isQuietDeepShift = !isCapture && !isCheck && !isCenterTarget && idx === 0 && cpDrop === 0;

      // Humans spot natural recaptures, checks, and central developing moves easily,
      // while obscure quiet multi-step prophylaxis moves have lower prior at amateur Elos.
      let heuristicBoost = 1.0;
      if (isCapture) heuristicBoost *= 1.35;
      if (isCheck) heuristicBoost *= 1.25;
      if (isCenterTarget) heuristicBoost *= 1.15;
      if (isQuietDeepShift) heuristicBoost *= 0.72 + 0.28 * eloFactor;

      const evalDecay = Math.exp(-cpDrop / (90 + (1 - eloFactor) * 140));
      const rankDecay = Math.exp(-idx * (0.35 + eloFactor * 0.4));
      return Math.max(1e-4, evalDecay * rankDecay * heuristicBoost);
    });

    const sum = rawWeights.reduce((acc, w) => acc + w, 0) || 1;
    candidateLines.forEach((line, idx) => {
      out.set(line.uci, rawWeights[idx] / sum);
    });
    return out;
  }
}

/**
 * DOM Clock observer adapter for Lichess.org, Chess.com, and Practice Board.
 */
export class DomClockTelemetryAdapter implements ClockTelemetryPort {
  private readonly doc: Document | null;

  constructor(doc: Document | null = typeof document !== "undefined" ? document : null) {
    this.doc = doc;
  }

  readClocks(turn: SideToMove): ClockSnapshot {
    const now = Date.now();
    if (!this.doc) {
      return {
        whiteRemainingMs: null,
        blackRemainingMs: null,
        activeRemainingMs: null,
        capturedAtMs: now,
      };
    }

    const whiteRemainingMs =
      readFirstClockMs(this.doc, [
        ".rclock-white .time",
        ".clock-white .clock-time-monospace",
        ".clock-component.clock-white",
        "[data-cy='clock-white']",
      ]) ?? null;

    const blackRemainingMs =
      readFirstClockMs(this.doc, [
        ".rclock-black .time",
        ".clock-black .clock-time-monospace",
        ".clock-component.clock-black",
        "[data-cy='clock-black']",
      ]) ?? null;

    const activeRemainingMs = turn === "w" ? whiteRemainingMs : blackRemainingMs;
    return {
      whiteRemainingMs,
      blackRemainingMs,
      activeRemainingMs,
      capturedAtMs: now,
    };
  }
}

function readFirstClockMs(doc: Document, selectors: readonly string[]): number | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (!el || !el.textContent) continue;
    const parsed = parseClockTextToMs(el.textContent);
    if (parsed !== null) return parsed;
  }
  return null;
}

export function parseClockTextToMs(raw: string): number | null {
  const clean = raw.replace(/\s+/g, "").trim();
  if (!clean) return null;
  // Support hh:mm:ss, mm:ss, or ss.d (sub-minute tenths)
  const parts = clean.split(":");
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if ([h, m, s].some((n) => Number.isNaN(n) || n < 0)) return null;
    return Math.round((h * 3600 + m * 60 + s) * 1000);
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isNaN(m) || Number.isNaN(s) || m < 0 || s < 0) return null;
    return Math.round((m * 60 + s) * 1000);
  }
  const secOnly = Number(clean);
  if (!Number.isNaN(secOnly) && secOnly >= 0) {
    return Math.round(secOnly * 1000);
  }
  return null;
}

function normalizeProbabilityMap(
  lines: readonly EngineLine[],
  raw: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  const weights = lines.map((l) => Math.max(0, raw.get(l.uci) ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (total <= 0) {
    const uniform = 1 / Math.max(1, lines.length);
    lines.forEach((l) => out.set(l.uci, uniform));
    return out;
  }
  lines.forEach((l, idx) => out.set(l.uci, weights[idx] / total));
  return out;
}

export function comparableCp(line: EngineLine): number {
  if (line.mate !== null && line.mate !== undefined) {
    return line.mate > 0
      ? 10_000 - Math.abs(line.mate) * 10
      : -10_000 + Math.abs(line.mate) * 10;
  }
  return line.centipawns ?? 0;
}

function parseBoardPlacementMap(fen: string): Map<string, string> {
  const map = new Map<string, string>();
  const placement = fen.trim().split(/\s+/)[0] || "";
  const ranks = placement.split("/");
  if (ranks.length !== 8) return map;
  const files = "abcdefgh";
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of ranks[r]) {
      if (ch >= "1" && ch <= "8") {
        f += parseInt(ch, 10);
      } else if (f < 8) {
        map.set(`${files[f]}${8 - r}`, ch);
        f++;
      }
    }
  }
  return map;
}
