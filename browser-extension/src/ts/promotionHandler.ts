/**
 * Pawn Promotion Handler & Underpromotion Variance (`promotionHandler.ts`).
 *
 * Implements:
 * 1. `PromotionPort` abstraction and `DomPromotionAdapter` supporting:
 *    - Lichess promotion choice modal (`#promotion-choice`, `[data-role="queen"|"rook"|...]`)
 *    - Chess.com auto-queen settings detection + `.promotion-window` modal selection
 * 2. Human visual recognition pause (200–400 ms) when selecting from an interactive
 *    promotion dialog before clicking the chosen piece.
 * 3. 2% non-losing rook underpromotion variance at 1200 Elo (only when rook promotion
 *    keeps the evaluation cleanly non-losing).
 *
 * Defaults to `enabled: false` (explicit opt-in) for full backward compatibility.
 */

import type { MultiPvCandidateLine, PieceColor } from "./autoPlayPorts.ts";
import { parseUciMoveSquares } from "./autoPlayPorts.ts";

export type PromotionPiece = "q" | "r" | "b" | "n";

export type PromotionPlatform = "lichess" | "chesscom" | "generic";

export interface PromotionDialogHandle {
  readonly platform: PromotionPlatform;
  readonly rootElement: Element | null;
}

export interface PromotionPort {
  isAutoQueenEnabled(): Promise<boolean> | boolean;
  waitForPromotionDialog(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<PromotionDialogHandle | null>;
  selectPromotionPiece(
    piece: PromotionPiece,
    turn: PieceColor,
    dialog?: PromotionDialogHandle | null
  ): Promise<boolean>;
}

export interface PromotionHandlerConfig {
  /** Explicit opt-in flag; defaults to false to preserve legacy move execution. */
  readonly enabled: boolean;
  /** Minimum recognition pause before clicking promotion dialog piece (default 200 ms). */
  readonly recognitionPauseMinMs: number;
  /** Maximum recognition pause before clicking promotion dialog piece (default 400 ms). */
  readonly recognitionPauseMaxMs: number;
  /** 2% non-losing rook underpromotion probability at ~1200 Elo (default 0.02). */
  readonly noviceRookUnderpromoRate: number;
  /** Elo threshold below/around which 1200-tier rook underpromotion applies (default 1350). */
  readonly noviceEloThreshold: number;
  /** Minimum comparable centipawn advantage / eval floor required to consider rook underpromotion non-losing (default +150 cp). */
  readonly nonLosingEvalFloorCp: number;
  /** Timeout waiting for promotion modal DOM appearance (default 1,200 ms). */
  readonly dialogWaitTimeoutMs: number;
  /** Optional injectable wait implementation for deterministic testing. */
  readonly waitMs?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Optional RNG hook for deterministic unit tests. */
  readonly randomFn?: () => number;
}

export const DEFAULT_PROMOTION_HANDLER_CONFIG: PromotionHandlerConfig = {
  enabled: false,
  recognitionPauseMinMs: 200,
  recognitionPauseMaxMs: 400,
  noviceRookUnderpromoRate: 0.02,
  noviceEloThreshold: 1350,
  nonLosingEvalFloorCp: 150,
  dialogWaitTimeoutMs: 1_200,
};

export interface PromotionResolutionRequest {
  readonly uciMove: string;
  readonly turn: PieceColor;
  readonly targetElo: number;
  readonly candidateLines?: readonly MultiPvCandidateLine[];
  readonly signal?: AbortSignal;
}

export interface PromotionResolutionResult {
  readonly enabled: boolean;
  readonly isPromotionMove: boolean;
  readonly handled: boolean;
  readonly chosenPiece: PromotionPiece | null;
  readonly effectiveUciMove: string;
  readonly usedAutoQueen: boolean;
  readonly recognitionPauseMs: number;
  readonly underpromotionApplied: boolean;
  readonly reason: string;
}

/**
 * DOM adapter for Lichess `#promotion-choice` overlays and Chess.com auto-queen / `.promotion-window`.
 */
export interface PromotionDomDocument {
  querySelector(selector: string): Element | null;
}

export class DomPromotionAdapter implements PromotionPort {
  private readonly doc: PromotionDomDocument | null;
  private readonly platform: PromotionPlatform;
  private readonly readChessComAutoQueen?: () => boolean;
  private readonly waitFn: (ms: number) => Promise<void>;

  constructor(
    options: {
      readonly doc?: PromotionDomDocument | null;
      readonly platform?: PromotionPlatform;
      readonly readChessComAutoQueen?: () => boolean;
      readonly waitFn?: (ms: number) => Promise<void>;
    } = {}
  ) {
    this.doc = options.doc ?? (typeof document !== "undefined" ? document : null);
    this.platform = options.platform ?? "generic";
    this.readChessComAutoQueen = options.readChessComAutoQueen;
    this.waitFn =
      options.waitFn ??
      ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  isAutoQueenEnabled(): boolean {
    if (this.readChessComAutoQueen) {
      return Boolean(this.readChessComAutoQueen());
    }
    if (this.platform === "chesscom" && this.doc) {
      const toggle = this.doc.querySelector(
        "[data-cy='auto-queen-setting'][data-enabled='true'], .auto-queen-enabled, input[name='alwaysPromoteToQueen']:checked"
      );
      if (toggle) return true;
    }
    return false;
  }

  async waitForPromotionDialog(
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<PromotionDialogHandle | null> {
    if (!this.doc) return null;
    const deadline = Date.now() + Math.max(0, timeoutMs);
    const pollStep = 25;

    while (true) {
      if (signal?.aborted) return null;
      const lichessModal = this.doc.querySelector(
        "#promotion-choice, .promotion-choice"
      );
      if (lichessModal) {
        return { platform: "lichess", rootElement: lichessModal };
      }
      const chessComModal = this.doc.querySelector(
        ".promotion-window, [data-cy='promotion-menu']"
      );
      if (chessComModal) {
        return { platform: "chesscom", rootElement: chessComModal };
      }

      if (Date.now() >= deadline) return null;
      await this.waitFn(Math.min(pollStep, Math.max(1, deadline - Date.now())));
    }
  }

  async selectPromotionPiece(
    piece: PromotionPiece,
    turn: PieceColor,
    dialog?: PromotionDialogHandle | null
  ): Promise<boolean> {
    const root: PromotionDomDocument | null =
      (dialog?.rootElement as unknown as PromotionDomDocument | null) ?? this.doc;
    if (!root) return false;

    const roleName =
      piece === "q"
        ? "queen"
        : piece === "r"
        ? "rook"
        : piece === "b"
        ? "bishop"
        : "knight";

    const selectors = [
      // Lichess selectors
      `square[data-role='${roleName}']`,
      `.promotion-choice [data-role='${roleName}']`,
      `piece.${roleName}`,
      // Chess.com selectors (e.g. .promotion-piece.wq / .bq)
      `.promotion-piece.${turn}${piece}`,
      `[data-piece='${turn}${piece}']`,
      `[data-piece='${piece}']`,
      `[data-promotion='${piece}']`,
    ];

    for (const sel of selectors) {
      const btn = root.querySelector(sel) ?? this.doc?.querySelector(sel) ?? null;
      if (btn) {
        clickPromotionElement(btn);
        return true;
      }
    }
    return false;
  }
}

export class PromotionHandler {
  private config: PromotionHandlerConfig;
  private readonly port: PromotionPort;
  private readonly waitMs: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    port: PromotionPort = new DomPromotionAdapter(),
    config: Partial<PromotionHandlerConfig> = {}
  ) {
    this.port = port;
    this.config = {
      ...DEFAULT_PROMOTION_HANDLER_CONFIG,
      ...config,
    };
    this.waitMs = config.waitMs ?? defaultWaitMs;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getConfig(): PromotionHandlerConfig {
    return this.config;
  }

  updateConfig(partial: Partial<PromotionHandlerConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /**
   * Decides the effective promotion piece (`q` / `r` / `b` / `n`), applying the
   * 2% non-losing rook underpromotion rate at 1200 Elo when eligible.
   */
  resolvePromotionChoice(
    request: PromotionResolutionRequest
  ): {
    readonly isPromotion: boolean;
    readonly chosenPiece: PromotionPiece | null;
    readonly underpromotionApplied: boolean;
    readonly effectiveUciMove: string;
  } {
    const parsed = parseUciMoveSquares(request.uciMove);
    if (!parsed) {
      return {
        isPromotion: false,
        chosenPiece: null,
        underpromotionApplied: false,
        effectiveUciMove: request.uciMove,
      };
    }

    const explicitPromo = normalizePromoChar(parsed.promotion);
    const isPromotionRankTarget =
      (request.turn === "w" && parsed.to.endsWith("8")) ||
      (request.turn === "b" && parsed.to.endsWith("1"));

    if (!explicitPromo && !isPromotionRankTarget) {
      return {
        isPromotion: false,
        chosenPiece: null,
        underpromotionApplied: false,
        effectiveUciMove: request.uciMove,
      };
    }

    let chosen: PromotionPiece = explicitPromo ?? "q";
    let underpromotionApplied = chosen === "r";

    if (
      this.config.enabled &&
      chosen === "q" &&
      request.targetElo <= this.config.noviceEloThreshold
    ) {
      const canUnderpromoteSafely = isRookUnderpromotionNonLosing(
        parsed.from,
        parsed.to,
        request.candidateLines ?? [],
        this.config.nonLosingEvalFloorCp
      );
      if (canUnderpromoteSafely) {
        const rng = this.config.randomFn ?? Math.random;
        if (rng() < this.config.noviceRookUnderpromoRate) {
          chosen = "r";
          underpromotionApplied = true;
        }
      }
    }

    const effectiveUciMove = `${parsed.from}${parsed.to}${chosen}`;
    return {
      isPromotion: true,
      chosenPiece: chosen,
      underpromotionApplied,
      effectiveUciMove,
    };
  }

  /**
   * Executes promotion completion after the pawn lands on the 8th/1st rank:
   * - Respects Chess.com auto-queen setting without forcing unnecessary dialog clicks.
   * - Otherwise waits for Lichess/Chess.com promotion dialog, pauses 200–400 ms for
   *   visual recognition, and clicks the selected piece.
   */
  async handlePostMovePromotion(
    request: PromotionResolutionRequest
  ): Promise<PromotionResolutionResult> {
    const choice = this.resolvePromotionChoice(request);
    if (!this.config.enabled) {
      return {
        enabled: false,
        isPromotionMove: choice.isPromotion,
        handled: false,
        chosenPiece: choice.chosenPiece,
        effectiveUciMove: request.uciMove,
        usedAutoQueen: false,
        recognitionPauseMs: 0,
        underpromotionApplied: false,
        reason: "DISABLED_DEFAULT",
      };
    }

    if (!choice.isPromotion || !choice.chosenPiece) {
      return {
        enabled: true,
        isPromotionMove: false,
        handled: false,
        chosenPiece: null,
        effectiveUciMove: request.uciMove,
        usedAutoQueen: false,
        recognitionPauseMs: 0,
        underpromotionApplied: false,
        reason: "NOT_PROMOTION_MOVE",
      };
    }

    const autoQueen = await this.port.isAutoQueenEnabled();
    if (autoQueen && choice.chosenPiece === "q") {
      return {
        enabled: true,
        isPromotionMove: true,
        handled: true,
        chosenPiece: "q",
        effectiveUciMove: choice.effectiveUciMove,
        usedAutoQueen: true,
        recognitionPauseMs: 0,
        underpromotionApplied: false,
        reason: "CHESSCOM_AUTO_QUEEN",
      };
    }

    const dialog = await this.port.waitForPromotionDialog(
      this.config.dialogWaitTimeoutMs,
      request.signal
    );
    if (!dialog) {
      return {
        enabled: true,
        isPromotionMove: true,
        handled: false,
        chosenPiece: choice.chosenPiece,
        effectiveUciMove: choice.effectiveUciMove,
        usedAutoQueen: false,
        recognitionPauseMs: 0,
        underpromotionApplied: choice.underpromotionApplied,
        reason: "PROMOTION_DIALOG_NOT_FOUND",
      };
    }

    const rng = this.config.randomFn ?? Math.random;
    const minPause = Math.max(0, Math.round(this.config.recognitionPauseMinMs));
    const maxPause = Math.max(minPause, Math.round(this.config.recognitionPauseMaxMs));
    const recognitionPauseMs = Math.round(minPause + rng() * (maxPause - minPause));

    await this.waitMs(recognitionPauseMs, request.signal);
    const clicked = await this.port.selectPromotionPiece(
      choice.chosenPiece,
      request.turn,
      dialog
    );

    return {
      enabled: true,
      isPromotionMove: true,
      handled: clicked,
      chosenPiece: choice.chosenPiece,
      effectiveUciMove: choice.effectiveUciMove,
      usedAutoQueen: false,
      recognitionPauseMs,
      underpromotionApplied: choice.underpromotionApplied,
      reason: clicked
        ? choice.underpromotionApplied
          ? "NOVICE_ROOK_UNDERPROMOTION_CLICKED"
          : "DIALOG_PROMOTION_CLICKED"
        : "PROMOTION_PIECE_CLICK_FAILED",
    };
  }
}

function isRookUnderpromotionNonLosing(
  from: string,
  to: string,
  lines: readonly MultiPvCandidateLine[],
  nonLosingFloorCp: number
): boolean {
  const prefix = `${from}${to}`;
  const queenLine = lines.find((l) => l.move.toLowerCase() === `${prefix}q`);
  const rookLine = lines.find((l) => l.move.toLowerCase() === `${prefix}r`);

  if (rookLine) {
    if (rookLine.mate !== null && rookLine.mate !== undefined) {
      return rookLine.mate > 0;
    }
    const rookCp = rookLine.centipawns ?? 0;
    return rookCp >= nonLosingFloorCp;
  }

  // If MultiPV didn't separately return `r` (common when Stockfish prunes inferior minor/rook lines
  // in completely winning endgames), only allow rook underpromotion when `q` is already overwhelmingly winning (+450 cp or mate)
  if (queenLine) {
    if (queenLine.mate !== null && queenLine.mate !== undefined && queenLine.mate > 0) {
      return true;
    }
    if ((queenLine.centipawns ?? 0) >= 850) {
      return true;
    }
  }

  // Fallback when no MultiPV lines supplied: do not guess non-losing status blindly unless explicitly safe
  return lines.length === 0 ? false : false;
}

function normalizePromoChar(ch?: string): PromotionPiece | null {
  if (!ch) return null;
  const lower = ch.toLowerCase();
  if (lower === "q" || lower === "r" || lower === "b" || lower === "n") {
    return lower;
  }
  return null;
}

function clickPromotionElement(el: Element): void {
  const maybeClickable = el as Element & { click?: () => void };
  if (typeof maybeClickable.click === "function") {
    maybeClickable.click();
    return;
  }
  if (typeof globalThis.MouseEvent === "function") {
    el.dispatchEvent(new globalThis.MouseEvent("click", { bubbles: true, cancelable: true }));
    return;
  }
  el.dispatchEvent({ type: "click" } as unknown as Event);
}

function defaultWaitMs(ms: number, signal?: AbortSignal): Promise<void> {
  const safeMs = Math.max(0, Math.round(ms));
  if (signal?.aborted) return Promise.reject(new Error("ABORTED"));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, safeMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("ABORTED"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
