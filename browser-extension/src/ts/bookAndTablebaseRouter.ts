/**
 * Opening Book & Syzygy Tablebase Short-Circuit Router (`bookAndTablebaseRouter.ts`).
 *
 * Implements `OpeningBookPort -> TablebasePort (<=7 pieces) -> EngineMultiPvPort` priority:
 * - Pre-fetches/batches up to top 20 opening continuations at game start when FEN is in book.
 * - Silences remote `explorer.lichess.ovh` queries after move 15, using offline ECO dictionary only.
 * - Samples top 1-3 opening moves weighted by W/D/B win rates.
 * - Selects practical DTZ/DTM tablebase conversion lines instead of blindly picking shortest mate.
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { MultiPvCandidateLine, PieceColor } from "./autoPlayPorts.ts";
import { ChessStateEngine } from "./dualStateReconciler.ts";
import {
  OpeningPreferenceEngine,
  type OpeningPreferenceConfig,
} from "./openingPreferenceMatrix.ts";

export interface BookMoveCandidate {
  readonly uci: string;
  readonly san: string;
  readonly games: number;
  readonly white: number;
  readonly draws: number;
  readonly black: number;
}

export interface OpeningBookLookupResult {
  readonly inBook: boolean;
  readonly eco: string;
  readonly opening: string;
  readonly source: "OFFLINE_ECO" | "LICHESS_MASTERS" | "PREFETCH_CACHE";
  readonly moves: readonly BookMoveCandidate[];
}

export interface OpeningBookPort {
  lookup(fen: string, fullmoveNumber?: number): Promise<OpeningBookLookupResult | null>;
  fetchRemoteMasters?(fen: string): Promise<OpeningBookLookupResult | null>;
}

export type TablebaseCategory = "win" | "draw" | "loss" | "unknown";

export interface TablebaseMoveCandidate {
  readonly uci: string;
  readonly san: string;
  readonly oppCategory: TablebaseCategory;
  readonly dtm: number | null;
  readonly dtz: number | null;
  readonly checkmate: boolean;
  readonly stalemate: boolean;
}

export interface TablebaseLookupResult {
  readonly isTablebase: boolean;
  readonly pieceCount: number;
  readonly category: TablebaseCategory;
  readonly dtz: number | null;
  readonly dtm: number | null;
  readonly source: string;
  readonly moves: readonly TablebaseMoveCandidate[];
}

export interface TablebasePort {
  lookup(fen: string): Promise<TablebaseLookupResult | null>;
}

export interface BookAndTablebaseRouterConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing behavior. */
  readonly enabled: boolean;
  /** Maximum fullmove number allowed for remote explorer.lichess.ovh lookups (default 15). */
  readonly maxRemoteBookMove: number;
  /** Maximum number of opening continuations to batch/pre-fetch at game start (default 20). */
  readonly prefetchBatchLimit: number;
  /** Piece threshold at or below which Syzygy tablebase routing activates (default 7). */
  readonly tablebasePieceCutoff: number;
  /** Maximum top book moves to sample across (default 3). */
  readonly bookSampleTopK: number;
  /** Optional opening preference configuration (defaults to disabled). */
  readonly openingPreferenceConfig?: Partial<OpeningPreferenceConfig>;
  /** Deterministic PRNG hook for testing. */
  readonly randomFn?: () => number;
}

export const DEFAULT_BOOK_AND_TABLEBASE_CONFIG: BookAndTablebaseRouterConfig = {
  enabled: false,
  maxRemoteBookMove: 15,
  prefetchBatchLimit: 20,
  tablebasePieceCutoff: 7,
  bookSampleTopK: 3,
};

export interface RouterResolution {
  readonly handled: boolean;
  readonly source: "OPENING_BOOK" | "TABLEBASE" | "ENGINE_FALLBACK" | "DISABLED";
  readonly selectedMoveUci: string | null;
  readonly selectedSan: string | null;
  readonly candidateLines: readonly MultiPvCandidateLine[];
  readonly bookResult?: OpeningBookLookupResult;
  readonly tablebaseResult?: TablebaseLookupResult;
  readonly prefetchedCount: number;
}

interface BuiltinEcoEntry {
  readonly eco: string;
  readonly opening: string;
  readonly moves: readonly BookMoveCandidate[];
}

/**
 * Built-in offline Master ECO dictionary keyed by `<piece-placement> <turn>`.
 */
export const OFFLINE_ECO_DICTIONARY: Readonly<Record<string, BuiltinEcoEntry>> = {
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w": {
    eco: "A00",
    opening: "Starting Position",
    moves: [
      { uci: "e2e4", san: "e4", games: 1485200, white: 558000, draws: 504000, black: 423200 },
      { uci: "d2d4", san: "d4", games: 1124500, white: 432000, draws: 405000, black: 287500 },
      { uci: "c2c4", san: "c4", games: 312800, white: 119000, draws: 116000, black: 77800 },
      { uci: "g1f3", san: "Nf3", games: 294100, white: 111000, draws: 115000, black: 68100 },
    ],
  },
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": {
    eco: "B00",
    opening: "King's Pawn Game",
    moves: [
      { uci: "c7c5", san: "c5", games: 642300, white: 229000, draws: 218000, black: 195300 },
      { uci: "e7e5", san: "e5", games: 389100, white: 146000, draws: 147000, black: 96100 },
      { uci: "e7e6", san: "e6", games: 192400, white: 75000, draws: 64000, black: 53400 },
      { uci: "c7c6", san: "c6", games: 138700, white: 52000, draws: 49000, black: 37700 },
    ],
  },
  "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b": {
    eco: "A40",
    opening: "Queen's Pawn Game",
    moves: [
      { uci: "g8f6", san: "Nf6", games: 694000, white: 256000, draws: 255000, black: 183000 },
      { uci: "d7d5", san: "d5", games: 345200, white: 131000, draws: 132000, black: 82200 },
      { uci: "e7e6", san: "e6", games: 41800, white: 16200, draws: 14200, black: 11400 },
    ],
  },
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w": {
    eco: "B20",
    opening: "Sicilian Defense",
    moves: [
      { uci: "g1f3", san: "Nf3", games: 528900, white: 189000, draws: 181000, black: 158900 },
      { uci: "b1c3", san: "Nc3", games: 54100, white: 19500, draws: 18400, black: 16200 },
      { uci: "c2c3", san: "c3", games: 34800, white: 12100, draws: 11900, black: 10800 },
    ],
  },
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b": {
    eco: "B27",
    opening: "Sicilian Defense: King's Knight",
    moves: [
      { uci: "d7d6", san: "d6", games: 241000, white: 87000, draws: 82000, black: 72000 },
      { uci: "b8c6", san: "Nc6", games: 158000, white: 56000, draws: 55000, black: 47000 },
      { uci: "e7e6", san: "e6", games: 119000, white: 42000, draws: 41000, black: 36000 },
    ],
  },
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w": {
    eco: "C20",
    opening: "Open Game",
    moves: [
      { uci: "g1f3", san: "Nf3", games: 356000, white: 135000, draws: 136000, black: 85000 },
      { uci: "b1c3", san: "Nc3", games: 12100, white: 4500, draws: 4100, black: 3500 },
      { uci: "f1c4", san: "Bc4", games: 9800, white: 3500, draws: 3400, black: 2900 },
    ],
  },
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b": {
    eco: "C40",
    opening: "King's Knight Opening",
    moves: [
      { uci: "b8c6", san: "Nc6", games: 312000, white: 118000, draws: 119000, black: 75000 },
      { uci: "g8f6", san: "Nf6", games: 34800, white: 11900, draws: 15800, black: 7100 },
      { uci: "d7d6", san: "d6", games: 8200, white: 3600, draws: 2700, black: 1900 },
    ],
  },
  "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w": {
    eco: "C44",
    opening: "King's Knight: 2...Nc6",
    moves: [
      { uci: "f1b5", san: "Bb5", games: 198000, white: 74000, draws: 77000, black: 47000 },
      { uci: "f1c4", san: "Bc4", games: 69400, white: 26200, draws: 25100, black: 18100 },
      { uci: "d2d4", san: "d4", games: 34100, white: 13200, draws: 12900, black: 8000 },
    ],
  },
  "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b": {
    eco: "C60",
    opening: "Ruy Lopez",
    moves: [
      { uci: "a7a6", san: "a6", games: 141200, white: 52100, draws: 56200, black: 32900 },
      { uci: "g8f6", san: "Nf6", games: 39400, white: 14200, draws: 16500, black: 8700 },
      { uci: "f8c5", san: "Bc5", games: 6400, white: 2400, draws: 2300, black: 1700 },
    ],
  },
  "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b": {
    eco: "C50",
    opening: "Italian Game",
    moves: [
      { uci: "f8c5", san: "Bc5", games: 39800, white: 15100, draws: 14800, black: 9900 },
      { uci: "g8f6", san: "Nf6", games: 27400, white: 10200, draws: 9800, black: 7400 },
    ],
  },
  "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b": {
    eco: "D06",
    opening: "Queen's Gambit",
    moves: [
      { uci: "e7e6", san: "e6", games: 139000, white: 53000, draws: 56000, black: 30000 },
      { uci: "c7c6", san: "c6", games: 108000, white: 41000, draws: 44000, black: 23000 },
      { uci: "d5c4", san: "dxc4", games: 27400, white: 11000, draws: 10400, black: 6000 },
    ],
  },
};

export function lookupOfflineEcoBook(fen: string): OpeningBookLookupResult | null {
  const key = bookCacheKey(fen);
  const hit = OFFLINE_ECO_DICTIONARY[key];
  if (!hit) return null;
  return {
    inBook: true,
    eco: hit.eco,
    opening: hit.opening,
    source: "OFFLINE_ECO",
    moves: hit.moves,
  };
}

/**
 * Composite OpeningBookPort supporting:
 * - Instant offline ECO lookup
 * - Remote `explorer.lichess.ovh` query BEFORE/AT move 15
 * - Strict remote cutoff AFTER move 15 (`fullmoveNumber > maxRemoteBookMove`)
 * - Bounded LRU cache fed by start-of-game batch pre-fetching
 */
export class CompositeOpeningBookAdapter implements OpeningBookPort {
  private readonly maxRemoteBookMove: number;
  private readonly remoteFetcher: ((fen: string) => Promise<OpeningBookLookupResult | null>) | null;
  private readonly cache = new Map<string, OpeningBookLookupResult>();
  private readonly maxCacheEntries: number;
  private remoteQueryCount = 0;

  constructor(
    options: {
      readonly maxRemoteBookMove?: number;
      readonly remoteFetcher?: ((fen: string) => Promise<OpeningBookLookupResult | null>) | null;
      readonly maxCacheEntries?: number;
    } = {}
  ) {
    this.maxRemoteBookMove = options.maxRemoteBookMove ?? 15;
    this.remoteFetcher = options.remoteFetcher ?? null;
    this.maxCacheEntries = options.maxCacheEntries ?? 250;
  }

  getRemoteQueryCount(): number {
    return this.remoteQueryCount;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async lookup(
    fen: string,
    fullmoveNumber?: number
  ): Promise<OpeningBookLookupResult | null> {
    const key = bookCacheKey(fen);
    if (!key) return null;

    const moveNum = fullmoveNumber ?? extractFullmoveNumber(fen);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const offline = lookupOfflineEcoBook(fen);

    // Silence remote explorer.lichess.ovh queries strictly after move 15; rely only on offline ECO.
    if (moveNum > this.maxRemoteBookMove || !this.remoteFetcher) {
      return offline;
    }

    if (offline) {
      // Cache offline hit immediately and avoid unnecessary network call if offline book covers position,
      // OR allow remote fetcher only when offline doesn't already cover deep theory.
      this.saveCache(key, offline);
      return offline;
    }

    return this.fetchRemoteMasters(fen);
  }

  async fetchRemoteMasters(fen: string): Promise<OpeningBookLookupResult | null> {
    const moveNum = extractFullmoveNumber(fen);
    if (moveNum > this.maxRemoteBookMove || !this.remoteFetcher) {
      return lookupOfflineEcoBook(fen);
    }

    const key = bookCacheKey(fen);
    const cached = this.cache.get(key);
    if (cached) return cached;

    this.remoteQueryCount++;
    const remote = await this.remoteFetcher(fen);
    if (remote && remote.inBook && remote.moves.length > 0) {
      this.saveCache(key, remote);
      return remote;
    }
    return lookupOfflineEcoBook(fen);
  }

  seedCache(fen: string, result: OpeningBookLookupResult): void {
    const key = bookCacheKey(fen);
    if (!key) return;
    this.saveCache(key, result);
  }

  private saveCache(key: string, value: OpeningBookLookupResult): void {
    if (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }
}

/**
 * Default HTTP adapter for `https://explorer.lichess.ovh/masters` (optional wiring).
 */
export async function fetchLichessMastersApi(
  fen: string
): Promise<OpeningBookLookupResult | null> {
  const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(
    fen
  )}&moves=4&topGames=0`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2200);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      opening?: { eco?: string; name?: string };
      moves?: Array<{
        uci: string;
        san?: string;
        games?: number;
        white?: number;
        draws?: number;
        black?: number;
      }>;
    };
    if (!Array.isArray(json.moves) || json.moves.length === 0) return null;
    const moves: BookMoveCandidate[] = json.moves.slice(0, 4).map((m) => {
      const white = Number(m.white ?? 0);
      const draws = Number(m.draws ?? 0);
      const black = Number(m.black ?? 0);
      const games = Number(m.games ?? (white + draws + black || 1));
      return {
        uci: m.uci,
        san: m.san ?? m.uci,
        games,
        white,
        draws,
        black,
      };
    });
    return {
      inBook: true,
      eco: json.opening?.eco ?? "",
      opening: json.opening?.name ?? "Master Theory",
      source: "LICHESS_MASTERS",
      moves,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Samples among the top 1..K (default 3) opening book moves weighted by W/D/B expected win rate
 * from the active side's perspective, modulated by game frequency.
 */
export function sampleBookMoveByWinRate(
  moves: readonly BookMoveCandidate[],
  turn: PieceColor,
  topK: number = 3,
  rng: () => number = Math.random
): {
  readonly selected: BookMoveCandidate | null;
  readonly weights: ReadonlyMap<string, number>;
} {
  const pool = moves.slice(0, Math.max(1, Math.min(3, topK)));
  const weights = new Map<string, number>();
  if (pool.length === 0) {
    return { selected: null, weights };
  }

  const maxGames = Math.max(1, ...pool.map((m) => Math.max(1, m.games)));
  const rawWeights = pool.map((m) => {
    const total = Math.max(1, m.white + m.draws + m.black);
    const winScore = turn === "w" ? m.white : m.black;
    const wdbExpectedRate = (winScore + 0.5 * m.draws) / total;
    const freqFactor = Math.sqrt(Math.max(1, m.games) / maxGames);
    return Math.max(0.01, Math.pow(wdbExpectedRate, 2) * (0.45 + 0.55 * freqFactor));
  });

  const sum = rawWeights.reduce((a, b) => a + b, 0) || 1;
  pool.forEach((m, i) => weights.set(m.uci, rawWeights[i] / sum));

  const roll = Math.max(0, Math.min(0.999999, rng()));
  let cum = 0;
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) {
    cum += rawWeights[i] / sum;
    if (roll <= cum) {
      chosen = pool[i];
      break;
    }
  }

  return { selected: chosen, weights };
}

/**
 * Selects a practical endgame conversion move using DTZ and DTM metrics rather than
 * blindly always picking the shortest mate, while strictly preserving winning/drawing outcomes.
 */
export function selectPracticalTablebaseMove(
  tablebase: TablebaseLookupResult,
  rng: () => number = Math.random
): TablebaseMoveCandidate | null {
  const moves = tablebase.moves;
  if (!moves || moves.length === 0) return null;

  // Immediate checkmate in 1 is always played directly
  const mateInOne = moves.find((m) => m.checkmate || m.dtm === 1);
  if (mateInOne) return mateInOne;

  const winningMoves = moves.filter(
    (m) => m.oppCategory === "loss" && !m.stalemate
  );
  if (winningMoves.length > 0) {
    // Filter moves safely clear of 50-move rule reset threshold when possible
    const safeDtzWins = winningMoves.filter(
      (m) => m.dtz === null || Math.abs(m.dtz) < 96
    );
    const pool = safeDtzWins.length > 0 ? safeDtzWins : winningMoves;
    const minDtz = Math.min(
      ...pool.map((m) => (m.dtz !== null ? Math.abs(m.dtz) : 40))
    );

    // Retain practical winning lines within +4 DTZ plies of the cleanest conversion
    const practicalPool = pool
      .filter((m) => (m.dtz !== null ? Math.abs(m.dtz) : minDtz) <= minDtz + 4)
      .slice(0, 3);

    if (practicalPool.length === 1) return practicalPool[0];

    // Prefer clean DTZ zeroing / promotion / practical conversion moves weighted smoothly
    const scores = practicalPool.map((m) => {
      const dtz = m.dtz !== null ? Math.abs(m.dtz) : 30;
      const dtm = m.dtm !== null ? Math.abs(m.dtm) : 50;
      const isZeroing =
        m.san.includes("x") || m.san.includes("=") || dtz <= 2 ? 1.35 : 1.0;
      return (isZeroing * 1.0) / (1 + 0.12 * (dtz - minDtz) + 0.03 * dtm);
    });
    const sum = scores.reduce((a, b) => a + b, 0) || 1;
    const roll = Math.max(0, Math.min(0.999999, rng()));
    let cum = 0;
    for (let i = 0; i < practicalPool.length; i++) {
      cum += scores[i] / sum;
      if (roll <= cum) return practicalPool[i];
    }
    return practicalPool[0];
  }

  const drawingMoves = moves.filter((m) => m.oppCategory === "draw");
  if (drawingMoves.length > 0) {
    return drawingMoves[0];
  }

  // Losing position: pick longest practical resistance (highest DTM/DTZ)
  const sortedResistance = [...moves].sort((a, b) => {
    const ra = (a.dtm ?? 0) * 10 + (a.dtz ?? 0);
    const rb = (b.dtm ?? 0) * 10 + (b.dtz ?? 0);
    return rb - ra;
  });
  return sortedResistance[0];
}

/**
 * Coordinates OpeningBookPort -> TablebasePort (<=7 pieces) -> EngineMultiPvPort priority,
 * start-of-game opening batch pre-fetch (up to 20 continuations), and move-15 remote cutoff.
 *
 * Defaults to `enabled: false` (explicit opt-in) for backward compatibility.
 */
export class BookAndTablebaseRouter {
  private config: BookAndTablebaseRouterConfig;
  private readonly openingBookPort: OpeningBookPort;
  private readonly tablebasePort: TablebasePort | null;
  private readonly openingPreferenceEngine: OpeningPreferenceEngine | null;
  private readonly prefetchedRoots = new Set<string>();
  private readonly inMemoryBatchCache = new Map<string, OpeningBookLookupResult>();

  constructor(
    ports: {
      readonly openingBookPort?: OpeningBookPort;
      readonly tablebasePort?: TablebasePort | null;
      readonly openingPreferenceEngine?: OpeningPreferenceEngine | null;
    } = {},
    config: Partial<BookAndTablebaseRouterConfig> = {}
  ) {
    this.config = {
      ...DEFAULT_BOOK_AND_TABLEBASE_CONFIG,
      ...config,
    };
    this.openingBookPort =
      ports.openingBookPort ??
      new CompositeOpeningBookAdapter({
        maxRemoteBookMove: this.config.maxRemoteBookMove,
      });
    this.tablebasePort = ports.tablebasePort ?? null;
    this.openingPreferenceEngine =
      ports.openingPreferenceEngine !== undefined
        ? ports.openingPreferenceEngine
        : config.openingPreferenceConfig
        ? new OpeningPreferenceEngine(config.openingPreferenceConfig)
        : null;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getPrefetchCacheSize(): number {
    return this.inMemoryBatchCache.size;
  }

  resetGameState(): void {
    this.prefetchedRoots.clear();
  }

  /**
   * Pre-fetches up to `prefetchBatchLimit` (default 20) opening continuations when game starts
   * from an in-book FEN using breadth-first expansion across the top opening lines.
   */
  async batchPrefetchOpeningTree(rootFen: string): Promise<number> {
    if (!this.config.enabled) return 0;

    const rootKey = bookCacheKey(rootFen);
    if (!rootKey || this.prefetchedRoots.has(rootKey)) {
      return 0;
    }
    this.prefetchedRoots.add(rootKey);

    const limit = Math.max(1, this.config.prefetchBatchLimit);
    const queue: string[] = [rootFen];
    const visited = new Set<string>();
    let cachedCount = 0;

    while (queue.length > 0 && cachedCount < limit) {
      const currentFen = queue.shift()!;
      const curKey = bookCacheKey(currentFen);
      if (!curKey || visited.has(curKey)) continue;
      visited.add(curKey);

      const moveNum = extractFullmoveNumber(currentFen);
      if (moveNum > this.config.maxRemoteBookMove) continue;

      const hit =
        this.inMemoryBatchCache.get(curKey) ??
        (await this.openingBookPort.lookup(currentFen, moveNum));
      if (!hit || !hit.inBook || hit.moves.length === 0) continue;

      this.inMemoryBatchCache.set(curKey, {
        ...hit,
        source:
          hit.source === "OFFLINE_ECO" ? "OFFLINE_ECO" : "PREFETCH_CACHE",
      });
      cachedCount++;

      // Expand up to top 2 continuations per node until reaching batch limit (20)
      for (const m of hit.moves.slice(0, 2)) {
        if (cachedCount + queue.length >= limit * 2) break;
        const engine = new ChessStateEngine(currentFen);
        if (engine.playUci(m.uci)) {
          const childFen = engine.getFen();
          const childKey = bookCacheKey(childFen);
          if (!visited.has(childKey)) {
            queue.push(childFen);
          }
        }
      }
    }

    return cachedCount;
  }

  /**
   * Resolves a position through `OpeningBookPort -> TablebasePort (<= 7 pieces)` before
   * falling back to Stockfish MultiPV (`handled: false`).
   */
  async resolveTurn(
    fen: string,
    turn: PieceColor,
    moveNumber?: number,
    repertoireContext?: {
      readonly targetElo?: number;
      readonly historyUcis?: readonly string[];
    }
  ): Promise<RouterResolution> {
    if (!this.config.enabled) {
      return {
        handled: false,
        source: "DISABLED",
        selectedMoveUci: null,
        selectedSan: null,
        candidateLines: [],
        prefetchedCount: 0,
      };
    }

    const rng = this.config.randomFn ?? Math.random;
    const effectiveMoveNum = moveNumber ?? extractFullmoveNumber(fen);
    let prefetchedCount = 0;

    // Batch-prefetch top 20 opening continuations at game start when FEN is in book
    if (effectiveMoveNum <= 2 && !this.prefetchedRoots.has(bookCacheKey(fen))) {
      prefetchedCount = await this.batchPrefetchOpeningTree(fen);
    }

    // 1. OpeningBookPort priority
    const cacheKey = bookCacheKey(fen);
    let bookHit: OpeningBookLookupResult | null = null;
    if (effectiveMoveNum <= this.config.maxRemoteBookMove) {
      bookHit =
        this.inMemoryBatchCache.get(cacheKey) ??
        (await this.openingBookPort.lookup(fen, effectiveMoveNum));
    } else {
      // Strictly silence remote explorer.lichess.ovh queries after move 15 -> offline ECO only
      bookHit = lookupOfflineEcoBook(fen);
    }

    if (bookHit && bookHit.inBook && bookHit.moves.length > 0) {
      const selectedCandidate =
        this.openingPreferenceEngine?.isEnabled() &&
        repertoireContext?.targetElo !== undefined
          ? this.openingPreferenceEngine.samplePreferredBookMove(
              bookHit.moves,
              {
                targetElo: repertoireContext.targetElo,
                turn,
                eco: bookHit.eco,
                openingName: bookHit.opening,
                historyUcis: repertoireContext.historyUcis,
              },
              rng
            ).selected
          : sampleBookMoveByWinRate(
              bookHit.moves,
              turn,
              this.config.bookSampleTopK,
              rng
            ).selected;
      if (selectedCandidate) {
        const candidateLines = bookMovesToCandidateLines(
          bookHit.moves,
          selectedCandidate.uci,
          turn
        );
        return {
          handled: true,
          source: "OPENING_BOOK",
          selectedMoveUci: selectedCandidate.uci,
          selectedSan: selectedCandidate.san,
          candidateLines,
          bookResult: bookHit,
          prefetchedCount,
        };
      }
    }

    // 2. TablebasePort priority (<= 7 pieces)
    const pieceCount = countFenPieces(fen);
    if (pieceCount <= this.config.tablebasePieceCutoff && this.tablebasePort) {
      const tbHit = await this.tablebasePort.lookup(fen);
      if (tbHit && tbHit.isTablebase && tbHit.moves.length > 0) {
        const chosen = selectPracticalTablebaseMove(tbHit, rng);
        if (chosen) {
          const candidateLines = tablebaseMovesToCandidateLines(
            tbHit.moves,
            chosen.uci
          );
          return {
            handled: true,
            source: "TABLEBASE",
            selectedMoveUci: chosen.uci,
            selectedSan: chosen.san,
            candidateLines,
            tablebaseResult: tbHit,
            prefetchedCount,
          };
        }
      }
    }

    // 3. EngineMultiPvPort fallback
    return {
      handled: false,
      source: "ENGINE_FALLBACK",
      selectedMoveUci: null,
      selectedSan: null,
      candidateLines: [],
      prefetchedCount,
    };
  }
}

export function extractFullmoveNumber(fen: string): number {
  const parts = (fen || "").trim().split(/\s+/);
  if (parts.length >= 6) {
    const parsed = parseInt(parts[5], 10);
    if (Number.isFinite(parsed) && parsed >= 1) return parsed;
  }
  return 1;
}

export function countFenPieces(fen: string): number {
  const placement = (fen || "").trim().split(/\s+/)[0] ?? "";
  let count = 0;
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i];
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) count++;
  }
  return count;
}

export function bookCacheKey(fen: string): string {
  const parts = (fen || "").trim().split(/\s+/);
  if (parts.length < 2) return "";
  return `${parts[0]} ${parts[1]}`;
}

function bookMovesToCandidateLines(
  moves: readonly BookMoveCandidate[],
  selectedUci: string,
  turn: PieceColor
): MultiPvCandidateLine[] {
  const ordered = [
    ...moves.filter((m) => m.uci === selectedUci),
    ...moves.filter((m) => m.uci !== selectedUci),
  ];
  return ordered.map((m, idx) => {
    const total = Math.max(1, m.white + m.draws + m.black);
    const winP = Math.round(((turn === "w" ? m.white : m.black) / total) * 1000);
    const drawP = Math.round((m.draws / total) * 1000);
    const lossP = Math.max(0, 1000 - winP - drawP);
    return {
      rank: idx + 1,
      move: m.uci,
      san: m.san,
      centipawns: 20 - idx * 10,
      mate: null,
      depth: 1,
      wdl: [winP, drawP, lossP],
    };
  });
}

function tablebaseMovesToCandidateLines(
  moves: readonly TablebaseMoveCandidate[],
  selectedUci: string
): MultiPvCandidateLine[] {
  const ordered = [
    ...moves.filter((m) => m.uci === selectedUci),
    ...moves.filter((m) => m.uci !== selectedUci),
  ];
  return ordered.map((m, idx) => {
    const isWin = m.oppCategory === "loss";
    const isDraw = m.oppCategory === "draw";
    return {
      rank: idx + 1,
      move: m.uci,
      san: m.san,
      centipawns: isWin ? 850 - (m.dtz ?? 0) : isDraw ? 0 : -850,
      mate: m.checkmate ? 1 : m.dtm !== null && isWin ? Math.ceil(m.dtm / 2) : null,
      depth: 64,
      wdl: isWin ? [990, 10, 0] : isDraw ? [50, 900, 50] : [0, 10, 990],
    };
  });
}
