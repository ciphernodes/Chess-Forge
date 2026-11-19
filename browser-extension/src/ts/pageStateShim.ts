/**
 * Read-only page-context board state shim & isolated-world message bridge.
 *
 * Strictly zero DOM mutations: reads board state from page DOM/containers and posts
 * structured snapshots to the Chrome ISOLATED content-script world via window.postMessage.
 * Defaults to `enabled: false` (explicit opt-in) for backward compatibility.
 */

import type { PieceColor } from "./autoPlayPorts.ts";

export const PAGE_STATE_CHANNEL = "CHESS_FORGE_PAGE_STATE_V1";

export type HostSiteKind = "lichess" | "chesscom" | "generic" | "practice";

export interface PageStateClockReading {
  readonly whiteText: string | null;
  readonly blackText: string | null;
}

export interface PageBoardSnapshot {
  readonly site: HostSiteKind;
  readonly fenPlacementAndTurn: string;
  readonly turn: PieceColor | null;
  readonly isFlipped: boolean;
  readonly moveTokens: readonly string[];
  readonly clocks: PageStateClockReading;
  readonly boardRect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } | null;
  readonly capturedAtMs: number;
}

export interface PageStateMessage {
  readonly channel: typeof PAGE_STATE_CHANNEL;
  readonly version: 1;
  readonly nonce: string;
  readonly snapshot: PageBoardSnapshot;
}

export interface MessageWindowLike {
  readonly location?: { readonly origin?: string };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: string, listener: (event: MessageEventLike) => void): void;
}

export interface MessageEventLike {
  readonly data: unknown;
  readonly origin?: string;
  readonly source?: unknown;
}

export interface ReadOnlyElementLike {
  getAttribute(name: string): string | null;
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  querySelector(selector: string): ReadOnlyElementLike | null;
  querySelectorAll(selector: string): Iterable<ReadOnlyElementLike> | ArrayLike<ReadOnlyElementLike>;
  readonly textContent: string | null;
  readonly className?: string;
}

export interface ReadOnlyDocumentLike {
  querySelector(selector: string): ReadOnlyElementLike | null;
  querySelectorAll(selector: string): Iterable<ReadOnlyElementLike> | ArrayLike<ReadOnlyElementLike>;
}

export interface PageStateShimConfig {
  /** Explicit opt-in flag; defaults to false to preserve existing behavior. */
  readonly enabled: boolean;
  readonly siteHint?: HostSiteKind;
  readonly targetOrigin?: string;
  readonly nonce?: string;
  readonly documentRef?: ReadOnlyDocumentLike | null;
  readonly windowRef?: MessageWindowLike | null;
}

export const DEFAULT_PAGE_STATE_SHIM_CONFIG: PageStateShimConfig = {
  enabled: false,
};

/**
 * Pure read-only DOM inspector. Never creates, removes, appends, or mutates any DOM node.
 */
export function extractReadOnlyBoardSnapshot(
  doc: ReadOnlyDocumentLike | null | undefined,
  siteHint: HostSiteKind = "generic"
): PageBoardSnapshot | null {
  if (!doc) return null;

  const lichessBoard = doc.querySelector("cg-board");
  if (lichessBoard && (siteHint === "lichess" || siteHint === "generic")) {
    return readLichessSnapshot(doc, lichessBoard);
  }

  const chessComBoard =
    doc.querySelector("wc-chess-board") ?? doc.querySelector("chess-board");
  if (chessComBoard && (siteHint === "chesscom" || siteHint === "generic")) {
    return readChessComSnapshot(doc, chessComBoard);
  }

  const genericBoard = doc.querySelector("[data-board], [data-fen], .chessboard-8x8");
  if (genericBoard) {
    return readGenericSnapshot(doc, genericBoard, siteHint);
  }

  return null;
}

function readLichessSnapshot(
  doc: ReadOnlyDocumentLike,
  boardEl: ReadOnlyElementLike
): PageBoardSnapshot | null {
  const rect = boardEl.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const cgWrap = doc.querySelector(".cg-wrap");
  const isFlipped = Boolean(
    cgWrap && (cgWrap.className ?? "").includes("orientation-black")
  );
  const grid = createEmptyGrid();
  const sqSize = rect.width / 8;

  const pieceNodes = toArray(boardEl.querySelectorAll("piece"));
  for (const p of pieceNodes) {
    const cls = p.className ?? "";
    if (!cls || cls.includes("ghost")) continue;
    const fenChar = classTokensToFenChar(cls);
    if (!fenChar) continue;

    const pRect = p.getBoundingClientRect();
    const cx = pRect.left + pRect.width / 2 - rect.left;
    const cy = pRect.top + pRect.height / 2 - rect.top;
    const col = Math.floor(cx / sqSize);
    const row = Math.floor(cy / sqSize);
    if (col < 0 || col > 7 || row < 0 || row > 7) continue;

    const gridRow = isFlipped ? 7 - row : row;
    const gridCol = isFlipped ? 7 - col : col;
    grid[gridRow][gridCol] = fenChar;
  }

  const moveTokens = extractTokensFromSelectors(doc, [
    "l4x kwdb",
    "l4x move",
    ".tview2 move",
  ]);
  const turn: PieceColor = moveTokens.length % 2 === 1 ? "b" : "w";

  return {
    site: "lichess",
    fenPlacementAndTurn: `${gridToPlacement(grid)} ${turn}`,
    turn,
    isFlipped,
    moveTokens,
    clocks: {
      whiteText: readFirstText(doc, [".rclock-white .time"]),
      blackText: readFirstText(doc, [".rclock-black .time"]),
    },
    boardRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    capturedAtMs: Date.now(),
  };
}

function readChessComSnapshot(
  doc: ReadOnlyDocumentLike,
  boardEl: ReadOnlyElementLike
): PageBoardSnapshot | null {
  const rect = boardEl.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const clsName = boardEl.className ?? "";
  const isFlipped =
    clsName.includes("flipped") ||
    boardEl.getAttribute("flipped") === "true" ||
    boardEl.getAttribute("data-flipped") === "true";

  const grid = createEmptyGrid();
  const pieceNodes = toArray(boardEl.querySelectorAll(".piece"));
  for (const p of pieceNodes) {
    const cls = p.className ?? "";
    const squareMatch = cls.match(/\bsquare-(\d)(\d)\b/);
    const pieceMatch = cls.match(/\b([wb])([pnbrqk])\b/i);
    if (!squareMatch || !pieceMatch) continue;
    const fileIdx = parseInt(squareMatch[1], 10) - 1;
    const rankIdx = parseInt(squareMatch[2], 10) - 1;
    if (fileIdx < 0 || fileIdx > 7 || rankIdx < 0 || rankIdx > 7) continue;
    const color = pieceMatch[1].toLowerCase();
    const type = pieceMatch[2].toLowerCase();
    grid[7 - rankIdx][fileIdx] = color === "w" ? type.toUpperCase() : type;
  }

  const moveTokens = extractTokensFromSelectors(doc, [
    ".move .node-highlight-content",
    "[data-ply] .node-highlight-content",
    ".main-line-ply",
  ]);
  const turn: PieceColor = moveTokens.length % 2 === 1 ? "b" : "w";

  return {
    site: "chesscom",
    fenPlacementAndTurn: `${gridToPlacement(grid)} ${turn}`,
    turn,
    isFlipped,
    moveTokens,
    clocks: {
      whiteText: readFirstText(doc, [
        ".clock-white .clock-time-monospace",
        ".clock-component.clock-white",
      ]),
      blackText: readFirstText(doc, [
        ".clock-black .clock-time-monospace",
        ".clock-component.clock-black",
      ]),
    },
    boardRect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
    capturedAtMs: Date.now(),
  };
}

function readGenericSnapshot(
  doc: ReadOnlyDocumentLike,
  boardEl: ReadOnlyElementLike,
  siteHint: HostSiteKind
): PageBoardSnapshot | null {
  const rect = boardEl.getBoundingClientRect();
  const explicitFen = boardEl.getAttribute("data-fen");
  const isFlipped =
    boardEl.getAttribute("data-flipped") === "true" ||
    boardEl.getAttribute("data-flipped") === "1";

  const grid = createEmptyGrid();
  let populatedSquares = 0;

  if (!explicitFen) {
    const squares = toArray(boardEl.querySelectorAll("[data-square]"));
    const files = "abcdefgh";
    for (const sqEl of squares) {
      const sqName = sqEl.getAttribute("data-square") ?? "";
      if (!/^[a-h][1-8]$/.test(sqName)) continue;
      const pieceAttr = sqEl.getAttribute("data-piece");
      if (pieceAttr && /^[pnbrqkPNBRQK]$/.test(pieceAttr)) {
        const col = files.indexOf(sqName[0]);
        const row = 8 - parseInt(sqName[1], 10);
        grid[row][col] = pieceAttr;
        populatedSquares++;
      }
    }
    if (populatedSquares === 0) return null;
  }

  const moveTokens = extractTokensFromSelectors(doc, [
    "[data-move-token]",
    ".move-list .move",
  ]);
  const parts = explicitFen ? explicitFen.trim().split(/\s+/) : [];
  const turn: PieceColor =
    parts[1] === "b" || parts[1] === "w"
      ? parts[1]
      : moveTokens.length % 2 === 1
      ? "b"
      : "w";
  const fenPlacementAndTurn =
    parts.length >= 2 ? `${parts[0]} ${parts[1]}` : `${gridToPlacement(grid)} ${turn}`;

  return {
    site: siteHint,
    fenPlacementAndTurn,
    turn,
    isFlipped,
    moveTokens,
    clocks: {
      whiteText: readFirstText(doc, ["[data-clock='w']", "#clock-white"]),
      blackText: readFirstText(doc, ["[data-clock='b']", "#clock-black"]),
    },
    boardRect:
      rect && rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        : null,
    capturedAtMs: Date.now(),
  };
}

/**
 * Page-context shim that ONLY reads DOM state and publishes snapshots via window.postMessage.
 * Defaults to `enabled: false`; performs zero DOM writes or style mutations.
 */
export class PageStateShim {
  private enabled: boolean;
  private readonly siteHint: HostSiteKind;
  private readonly targetOrigin: string;
  private readonly nonce: string;
  private readonly documentRef: ReadOnlyDocumentLike | null;
  private readonly windowRef: MessageWindowLike | null;
  private started = false;
  private lastPostedKey = "";

  constructor(config: Partial<PageStateShimConfig> = {}) {
    this.enabled = config.enabled ?? DEFAULT_PAGE_STATE_SHIM_CONFIG.enabled;
    this.siteHint = config.siteHint ?? "generic";
    this.documentRef =
      config.documentRef !== undefined
        ? config.documentRef
        : typeof document !== "undefined"
        ? (document as unknown as ReadOnlyDocumentLike)
        : null;
    this.windowRef =
      config.windowRef !== undefined
        ? config.windowRef
        : typeof window !== "undefined"
        ? (window as unknown as MessageWindowLike)
        : null;
    const originFromWin = this.windowRef?.location?.origin;
    this.targetOrigin =
      config.targetOrigin ??
      (originFromWin && originFromWin !== "null" ? originFromWin : "*");
    this.nonce = config.nonce ?? generateShimNonce();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isStarted(): boolean {
    return this.started;
  }

  getNonce(): string {
    return this.nonce;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
    if (!next) {
      this.stop();
    }
  }

  start(): boolean {
    if (!this.enabled) return false;
    this.started = true;
    this.publishSnapshotNow();
    return true;
  }

  stop(): void {
    this.started = false;
  }

  dispose(): void {
    this.stop();
    this.lastPostedKey = "";
  }

  /**
   * Reads board state cleanly without mutating the DOM and dispatches a structured
   * `PageStateMessage` over `window.postMessage` if enabled and state changed (or forced).
   */
  publishSnapshotNow(force: boolean = false): PageStateMessage | null {
    if (!this.enabled || !this.windowRef) return null;
    const snapshot = extractReadOnlyBoardSnapshot(this.documentRef, this.siteHint);
    if (!snapshot) return null;

    const dedupeKey = `${snapshot.fenPlacementAndTurn}|${snapshot.isFlipped}|${snapshot.moveTokens.length}`;
    if (!force && dedupeKey === this.lastPostedKey) {
      return null;
    }
    this.lastPostedKey = dedupeKey;

    const payload: PageStateMessage = {
      channel: PAGE_STATE_CHANNEL,
      version: 1,
      nonce: this.nonce,
      snapshot,
    };

    this.windowRef.postMessage(payload, this.targetOrigin);
    return payload;
  }
}

export interface IsolatedReceiverConfig {
  readonly enabled: boolean;
  readonly expectedOrigin?: string | null;
  readonly expectedNonce?: string | null;
  readonly windowRef?: MessageWindowLike | null;
  readonly onSnapshot: (snapshot: PageBoardSnapshot) => void;
}

/**
 * Isolated-world receiver verifying channel, origin, source window, and payload shape
 * for read-only page-state messages before forwarding into ChessForge pipelines.
 */
export class IsolatedPageStateReceiver {
  private enabled: boolean;
  private readonly expectedOrigin: string | null;
  private readonly expectedNonce: string | null;
  private readonly windowRef: MessageWindowLike | null;
  private readonly onSnapshot: (snapshot: PageBoardSnapshot) => void;
  private listening = false;
  private readonly boundHandler: (event: MessageEventLike) => void;

  constructor(config: IsolatedReceiverConfig) {
    this.enabled = config.enabled ?? false;
    this.expectedOrigin = config.expectedOrigin ?? null;
    this.expectedNonce = config.expectedNonce ?? null;
    this.windowRef =
      config.windowRef !== undefined
        ? config.windowRef
        : typeof window !== "undefined"
        ? (window as unknown as MessageWindowLike)
        : null;
    this.onSnapshot = config.onSnapshot;
    this.boundHandler = (ev: MessageEventLike) => this.handleMessage(ev);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
    if (!next) {
      this.stop();
    }
  }

  start(): boolean {
    if (!this.enabled || !this.windowRef || this.listening) return false;
    this.windowRef.addEventListener("message", this.boundHandler);
    this.listening = true;
    return true;
  }

  stop(): void {
    if (!this.listening || !this.windowRef) return;
    this.windowRef.removeEventListener("message", this.boundHandler);
    this.listening = false;
  }

  handleMessage(event: MessageEventLike): boolean {
    if (!this.enabled) return false;
    if (this.windowRef && event.source !== undefined && event.source !== this.windowRef) {
      return false;
    }
    if (this.expectedOrigin && event.origin && event.origin !== this.expectedOrigin) {
      return false;
    }
    if (!isValidPageStateMessage(event.data)) {
      return false;
    }
    if (this.expectedNonce && event.data.nonce !== this.expectedNonce) {
      return false;
    }
    this.onSnapshot(event.data.snapshot);
    return true;
  }
}

export function isValidPageStateMessage(data: unknown): data is PageStateMessage {
  if (!data || typeof data !== "object") return false;
  const candidate = data as Partial<PageStateMessage>;
  if (candidate.channel !== PAGE_STATE_CHANNEL || candidate.version !== 1) return false;
  if (typeof candidate.nonce !== "string" || !candidate.nonce) return false;
  const snap = candidate.snapshot as Partial<PageBoardSnapshot> | undefined;
  if (!snap || typeof snap !== "object") return false;
  if (typeof snap.fenPlacementAndTurn !== "string" || !snap.fenPlacementAndTurn.includes("/")) {
    return false;
  }
  if (!Array.isArray(snap.moveTokens)) return false;
  return typeof snap.capturedAtMs === "number";
}

function generateShimNonce(): string {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
    const bytes = new Uint8Array(12);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `shim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyGrid(): string[][] {
  return Array.from({ length: 8 }, () => Array<string>(8).fill(""));
}

function gridToPlacement(grid: readonly string[][]): string {
  return grid
    .map((row) => {
      let empty = 0;
      let out = "";
      for (const cell of row) {
        if (!cell) {
          empty++;
        } else {
          if (empty > 0) {
            out += String(empty);
            empty = 0;
          }
          out += cell;
        }
      }
      if (empty > 0) out += String(empty);
      return out || "8";
    })
    .join("/");
}

function classTokensToFenChar(cls: string): string | null {
  const lower = cls.toLowerCase();
  const isWhite = /\bwhite\b/.test(lower);
  const isBlack = /\bblack\b/.test(lower);
  if (!isWhite && !isBlack) return null;

  let piece = "";
  if (/\bpawn\b/.test(lower)) piece = "p";
  else if (/\bknight\b/.test(lower)) piece = "n";
  else if (/\bbishop\b/.test(lower)) piece = "b";
  else if (/\brook\b/.test(lower)) piece = "r";
  else if (/\bqueen\b/.test(lower)) piece = "q";
  else if (/\bking\b/.test(lower)) piece = "k";
  if (!piece) return null;

  return isWhite ? piece.toUpperCase() : piece;
}

function extractTokensFromSelectors(
  doc: ReadOnlyDocumentLike,
  selectors: readonly string[]
): string[] {
  for (const sel of selectors) {
    const nodes = toArray(doc.querySelectorAll(sel));
    if (nodes.length === 0) continue;
    const tokens: string[] = [];
    for (const node of nodes) {
      const text = (node.textContent ?? "").trim();
      if (!text) continue;
      if (/^\d+\.{1,3}$/.test(text)) continue;
      const cleaned = text.replace(/^\d+\.+\s*/, "").trim();
      if (cleaned) tokens.push(cleaned);
    }
    if (tokens.length > 0) return tokens;
  }
  return [];
}

function readFirstText(
  doc: ReadOnlyDocumentLike,
  selectors: readonly string[]
): string | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const txt = el?.textContent?.trim();
    if (txt) return txt;
  }
  return null;
}

function toArray<T>(iterableOrArray: Iterable<T> | ArrayLike<T>): T[] {
  return Array.from(iterableOrArray);
}
