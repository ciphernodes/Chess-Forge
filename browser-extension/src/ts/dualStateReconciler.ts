/**
 * Dual-Source FEN Reconciliation & Startup Self-Test (`dualStateReconciler.ts`).
 *
 * Implements a strict TypeScript pure-chess state machine + DOM move-list extractors
 * (Lichess `<l4x>`, Chess.com `.move` / `[data-ply]`) running in parallel with DOM
 * square scraping on every ply.
 *
 * Defaults to `enabled: false` (explicit opt-in) to preserve backward compatibility.
 */

import type { PieceColor } from "./autoPlayPorts.ts";

export const STANDARD_START_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const DEGRADED_DETECTION_MESSAGE =
  "Board detection degraded — check for site updates";

export type ReconcilerExecutionMode = "AUTONOMOUS" | "READ_ONLY_HINT";

export interface InternalMove {
  readonly fromRow: number;
  readonly fromCol: number;
  readonly toRow: number;
  readonly toCol: number;
  readonly piece: string;
  readonly capture: boolean;
  readonly promotion: string | null;
  readonly isCastling: "K" | "Q" | null;
  readonly isEnPassant: boolean;
  readonly uci: string;
}

const FILES = "abcdefgh";

/**
 * Pure TypeScript chess state machine & SAN/UCI/FEN validator (zero external dependencies).
 */
export class ChessStateEngine {
  private board: (string | null)[];
  private turn: PieceColor;
  private castling: string;
  private epSquare: string | null;
  private halfmove: number;
  private fullmove: number;

  constructor(initialFen: string = STANDARD_START_FEN) {
    this.board = Array<string | null>(64).fill(null);
    this.turn = "w";
    this.castling = "KQkq";
    this.epSquare = null;
    this.halfmove = 0;
    this.fullmove = 1;
    this.loadFen(initialFen);
  }

  loadFen(fen: string): boolean {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 2) return false;
    const ranks = parts[0].split("/");
    if (ranks.length !== 8) return false;

    const nextBoard: (string | null)[] = Array<string | null>(64).fill(null);
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of ranks[r]) {
        if (ch >= "1" && ch <= "8") {
          c += parseInt(ch, 10);
        } else if (/^[pnbrqkPNBRQK]$/.test(ch)) {
          if (c >= 8) return false;
          nextBoard[r * 8 + c] = ch;
          c++;
        } else {
          return false;
        }
      }
      if (c !== 8) return false;
    }

    const active = parts[1];
    if (active !== "w" && active !== "b") return false;

    this.board = nextBoard;
    this.turn = active;
    this.castling = parts[2] && parts[2] !== "" ? parts[2] : "-";
    this.epSquare = parts[3] && parts[3] !== "-" ? parts[3] : null;
    this.halfmove = parts[4] ? Math.max(0, parseInt(parts[4], 10) || 0) : 0;
    this.fullmove = parts[5] ? Math.max(1, parseInt(parts[5], 10) || 1) : 1;
    return true;
  }

  getTurn(): PieceColor {
    return this.turn;
  }

  getPlacementAndTurn(): string {
    return `${this.getPlacement()} ${this.turn}`;
  }

  getFen(): string {
    return `${this.getPlacement()} ${this.turn} ${this.castling || "-"} ${
      this.epSquare || "-"
    } ${this.halfmove} ${this.fullmove}`;
  }

  private getPlacement(): string {
    const rows: string[] = [];
    for (let r = 0; r < 8; r++) {
      let rowStr = "";
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r * 8 + c];
        if (!piece) {
          empty++;
        } else {
          if (empty > 0) {
            rowStr += String(empty);
            empty = 0;
          }
          rowStr += piece;
        }
      }
      if (empty > 0) rowStr += String(empty);
      rows.push(rowStr);
    }
    return rows.join("/");
  }

  clone(): ChessStateEngine {
    return new ChessStateEngine(this.getFen());
  }

  generateLegalMoves(): InternalMove[] {
    const pseudo = this.generatePseudoLegalMoves(this.turn);
    const legal: InternalMove[] = [];
    for (const move of pseudo) {
      const copy = this.clone();
      copy.applyInternalMove(move);
      if (!copy.isKingInCheck(this.turn)) {
        legal.push(move);
      }
    }
    return legal;
  }

  playUci(uci: string): boolean {
    const norm = uci.trim().toLowerCase();
    const legal = this.generateLegalMoves();
    const matched = legal.find((m) => m.uci === norm);
    if (!matched) return false;
    this.applyInternalMove(matched);
    return true;
  }

  playSan(rawSan: string): boolean {
    const move = this.resolveSanMove(rawSan);
    if (!move) return false;
    this.applyInternalMove(move);
    return true;
  }

  playMoveToken(token: string): boolean {
    const trimmed = token.trim();
    if (!trimmed) return false;
    if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(trimmed)) {
      if (this.playUci(trimmed)) return true;
    }
    return this.playSan(trimmed);
  }

  resolveSanMove(rawSan: string): InternalMove | null {
    const cleaned = normalizeSanToken(rawSan);
    if (!cleaned) return null;

    const legal = this.generateLegalMoves();

    if (cleaned === "O-O" || cleaned === "0-0") {
      return legal.find((m) => m.isCastling === "K") ?? null;
    }
    if (cleaned === "O-O-O" || cleaned === "0-0-0") {
      return legal.find((m) => m.isCastling === "Q") ?? null;
    }

    let work = cleaned;
    let promo: string | null = null;
    const promoMatch = work.match(/=([QRBN])$/i);
    if (promoMatch) {
      promo = promoMatch[1].toLowerCase();
      work = work.slice(0, -promoMatch[0].length);
    } else if (/^[a-h]([18])[QRBN]$/i.test(work)) {
      promo = work[work.length - 1].toLowerCase();
      work = work.slice(0, -1);
    }

    let pieceType = "P";
    if (/^[KQRBN]/.test(work)) {
      pieceType = work[0];
      work = work.slice(1);
    }

    const isCapture = work.includes("x");
    work = work.replace(/x/g, "");

    if (work.length < 2) return null;
    const targetStr = work.slice(-2);
    const disambig = work.slice(0, -2);
    const targetCol = FILES.indexOf(targetStr[0]);
    const targetRow = 8 - parseInt(targetStr[1], 10);
    if (targetCol < 0 || targetCol > 7 || targetRow < 0 || targetRow > 7) {
      return null;
    }

    let disambigFile: number | null = null;
    let disambigRank: number | null = null;
    for (const ch of disambig) {
      if (ch >= "a" && ch <= "h") disambigFile = FILES.indexOf(ch);
      else if (ch >= "1" && ch <= "8") disambigRank = 8 - parseInt(ch, 10);
    }

    const candidates = legal.filter((m) => {
      if (m.piece.toUpperCase() !== pieceType) return false;
      if (m.toRow !== targetRow || m.toCol !== targetCol) return false;
      if (promo !== null && m.promotion !== promo) return false;
      if (promo === null && m.promotion !== null) return false;
      if (isCapture && !m.capture) return false;
      if (disambigFile !== null && m.fromCol !== disambigFile) return false;
      if (disambigRank !== null && m.fromRow !== disambigRank) return false;
      return true;
    });

    return candidates.length === 1 ? candidates[0] : candidates[0] ?? null;
  }

  private isKingInCheck(color: PieceColor): boolean {
    const kingChar = color === "w" ? "K" : "k";
    let kingRow = -1;
    let kingCol = -1;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        if (this.board[r * 8 + c] === kingChar) {
          kingRow = r;
          kingCol = c;
          break;
        }
      }
      if (kingRow >= 0) break;
    }
    if (kingRow < 0) return false;
    return this.isSquareAttacked(kingRow, kingCol, color === "w" ? "b" : "w");
  }

  private isSquareAttacked(
    row: number,
    col: number,
    attackerColor: PieceColor
  ): boolean {
    const isWhiteAtt = attackerColor === "w";
    const pawnChar = isWhiteAtt ? "P" : "p";
    const knightChar = isWhiteAtt ? "N" : "n";
    const bishopChar = isWhiteAtt ? "B" : "b";
    const rookChar = isWhiteAtt ? "R" : "r";
    const queenChar = isWhiteAtt ? "Q" : "q";
    const kingChar = isWhiteAtt ? "K" : "k";

    // Pawn attacks: white pawns move up (row-1), so a white pawn attacking (row,col) sits at row+1
    const pawnSourceRow = isWhiteAtt ? row + 1 : row - 1;
    if (pawnSourceRow >= 0 && pawnSourceRow < 8) {
      for (const dc of [-1, 1]) {
        const pc = col + dc;
        if (pc >= 0 && pc < 8 && this.board[pawnSourceRow * 8 + pc] === pawnChar) {
          return true;
        }
      }
    }

    // Knight attacks
    const knightOffsets = [
      [-2, -1],
      [-2, 1],
      [-1, -2],
      [-1, 2],
      [1, -2],
      [1, 2],
      [2, -1],
      [2, 1],
    ];
    for (const [dr, dc] of knightOffsets) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr * 8 + nc] === knightChar) {
        return true;
      }
    }

    // King adjacent attacks
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && this.board[nr * 8 + nc] === kingChar) {
          return true;
        }
      }
    }

    // Orthogonal rays (rook/queen)
    const orth = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dr, dc] of orth) {
      let nr = row + dr;
      let nc = col + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const sq = this.board[nr * 8 + nc];
        if (sq) {
          if (sq === rookChar || sq === queenChar) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    // Diagonal rays (bishop/queen)
    const diag = [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ];
    for (const [dr, dc] of diag) {
      let nr = row + dr;
      let nc = col + dc;
      while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
        const sq = this.board[nr * 8 + nc];
        if (sq) {
          if (sq === bishopChar || sq === queenChar) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }

    return false;
  }

  private generatePseudoLegalMoves(side: PieceColor): InternalMove[] {
    const moves: InternalMove[] = [];
    const isWhite = side === "w";
    const enemyColor: PieceColor = isWhite ? "b" : "w";

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = this.board[r * 8 + c];
        if (!piece) continue;
        const pieceIsWhite = piece >= "A" && piece <= "Z";
        if (pieceIsWhite !== isWhite) continue;

        const upper = piece.toUpperCase();
        if (upper === "P") {
          const dir = isWhite ? -1 : 1;
          const startRow = isWhite ? 6 : 1;
          const promoRow = isWhite ? 0 : 7;
          const oneStep = r + dir;

          if (oneStep >= 0 && oneStep < 8 && !this.board[oneStep * 8 + c]) {
            if (oneStep === promoRow) {
              for (const pr of ["q", "r", "b", "n"]) {
                moves.push(makeMove(r, c, oneStep, c, piece, false, pr, null, false));
              }
            } else {
              moves.push(makeMove(r, c, oneStep, c, piece, false, null, null, false));
              const twoStep = r + dir * 2;
              if (r === startRow && !this.board[twoStep * 8 + c]) {
                moves.push(makeMove(r, c, twoStep, c, piece, false, null, null, false));
              }
            }
          }

          for (const dc of [-1, 1]) {
            const nc = c + dc;
            if (oneStep < 0 || oneStep >= 8 || nc < 0 || nc >= 8) continue;
            const target = this.board[oneStep * 8 + nc];
            const targetIsEnemy =
              target !== null && (target >= "A" && target <= "Z") !== isWhite;
            if (targetIsEnemy) {
              if (oneStep === promoRow) {
                for (const pr of ["q", "r", "b", "n"]) {
                  moves.push(makeMove(r, c, oneStep, nc, piece, true, pr, null, false));
                }
              } else {
                moves.push(makeMove(r, c, oneStep, nc, piece, true, null, null, false));
              }
            } else if (this.epSquare === `${FILES[nc]}${8 - oneStep}`) {
              moves.push(makeMove(r, c, oneStep, nc, piece, true, null, null, true));
            }
          }
        } else if (upper === "N") {
          const offsets = [
            [-2, -1],
            [-2, 1],
            [-1, -2],
            [-1, 2],
            [1, -2],
            [1, 2],
            [2, -1],
            [2, 1],
          ];
          for (const [dr, dc] of offsets) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
            const target = this.board[nr * 8 + nc];
            if (!target) {
              moves.push(makeMove(r, c, nr, nc, piece, false, null, null, false));
            } else if ((target >= "A" && target <= "Z") !== isWhite) {
              moves.push(makeMove(r, c, nr, nc, piece, true, null, null, false));
            }
          }
        } else if (upper === "B" || upper === "R" || upper === "Q") {
          const dirs: number[][] = [];
          if (upper === "B" || upper === "Q") {
            dirs.push([-1, -1], [-1, 1], [1, -1], [1, 1]);
          }
          if (upper === "R" || upper === "Q") {
            dirs.push([-1, 0], [1, 0], [0, -1], [0, 1]);
          }
          for (const [dr, dc] of dirs) {
            let nr = r + dr;
            let nc = c + dc;
            while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
              const target = this.board[nr * 8 + nc];
              if (!target) {
                moves.push(makeMove(r, c, nr, nc, piece, false, null, null, false));
              } else {
                if ((target >= "A" && target <= "Z") !== isWhite) {
                  moves.push(makeMove(r, c, nr, nc, piece, true, null, null, false));
                }
                break;
              }
              nr += dr;
              nc += dc;
            }
          }
        } else if (upper === "K") {
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
              const target = this.board[nr * 8 + nc];
              if (!target) {
                moves.push(makeMove(r, c, nr, nc, piece, false, null, null, false));
              } else if ((target >= "A" && target <= "Z") !== isWhite) {
                moves.push(makeMove(r, c, nr, nc, piece, true, null, null, false));
              }
            }
          }

          // Castling
          const homeRow = isWhite ? 7 : 0;
          const kRight = isWhite ? "K" : "k";
          const qRight = isWhite ? "Q" : "q";
          const rookExpected = isWhite ? "R" : "r";
          if (r === homeRow && c === 4 && !this.isSquareAttacked(homeRow, 4, enemyColor)) {
            if (
              this.castling.includes(kRight) &&
              this.board[homeRow * 8 + 7] === rookExpected &&
              !this.board[homeRow * 8 + 5] &&
              !this.board[homeRow * 8 + 6] &&
              !this.isSquareAttacked(homeRow, 5, enemyColor) &&
              !this.isSquareAttacked(homeRow, 6, enemyColor)
            ) {
              moves.push(makeMove(homeRow, 4, homeRow, 6, piece, false, null, "K", false));
            }
            if (
              this.castling.includes(qRight) &&
              this.board[homeRow * 8 + 0] === rookExpected &&
              !this.board[homeRow * 8 + 1] &&
              !this.board[homeRow * 8 + 2] &&
              !this.board[homeRow * 8 + 3] &&
              !this.isSquareAttacked(homeRow, 3, enemyColor) &&
              !this.isSquareAttacked(homeRow, 2, enemyColor)
            ) {
              moves.push(makeMove(homeRow, 4, homeRow, 2, piece, false, null, "Q", false));
            }
          }
        }
      }
    }

    return moves;
  }

  private applyInternalMove(move: InternalMove): void {
    const movingPiece = this.board[move.fromRow * 8 + move.fromCol]!;
    const capturedTarget = this.board[move.toRow * 8 + move.toCol];
    const isWhite = this.turn === "w";

    this.board[move.fromRow * 8 + move.fromCol] = null;

    if (move.isEnPassant) {
      this.board[move.fromRow * 8 + move.toCol] = null;
    }

    if (move.isCastling === "K") {
      const rook = this.board[move.fromRow * 8 + 7];
      this.board[move.fromRow * 8 + 7] = null;
      this.board[move.fromRow * 8 + 5] = rook;
    } else if (move.isCastling === "Q") {
      const rook = this.board[move.fromRow * 8 + 0];
      this.board[move.fromRow * 8 + 0] = null;
      this.board[move.fromRow * 8 + 3] = rook;
    }

    if (move.promotion) {
      this.board[move.toRow * 8 + move.toCol] = isWhite
        ? move.promotion.toUpperCase()
        : move.promotion.toLowerCase();
    } else {
      this.board[move.toRow * 8 + move.toCol] = movingPiece;
    }

    // Update castling rights
    let nextCastling = this.castling === "-" ? "" : this.castling;
    if (movingPiece === "K") nextCastling = nextCastling.replace(/[KQ]/g, "");
    if (movingPiece === "k") nextCastling = nextCastling.replace(/[kq]/g, "");
    if (move.fromRow === 7 && move.fromCol === 7) nextCastling = nextCastling.replace("K", "");
    if (move.fromRow === 7 && move.fromCol === 0) nextCastling = nextCastling.replace("Q", "");
    if (move.fromRow === 0 && move.fromCol === 7) nextCastling = nextCastling.replace("k", "");
    if (move.fromRow === 0 && move.fromCol === 0) nextCastling = nextCastling.replace("q", "");
    if (move.toRow === 7 && move.toCol === 7) nextCastling = nextCastling.replace("K", "");
    if (move.toRow === 7 && move.toCol === 0) nextCastling = nextCastling.replace("Q", "");
    if (move.toRow === 0 && move.toCol === 7) nextCastling = nextCastling.replace("k", "");
    if (move.toRow === 0 && move.toCol === 0) nextCastling = nextCastling.replace("q", "");
    this.castling = nextCastling || "-";

    // Update en passant square
    if (
      movingPiece.toUpperCase() === "P" &&
      Math.abs(move.toRow - move.fromRow) === 2
    ) {
      const midRow = (move.fromRow + move.toRow) / 2;
      this.epSquare = `${FILES[move.fromCol]}${8 - midRow}`;
    } else {
      this.epSquare = null;
    }

    if (movingPiece.toUpperCase() === "P" || capturedTarget || move.isEnPassant) {
      this.halfmove = 0;
    } else {
      this.halfmove++;
    }

    if (this.turn === "b") {
      this.fullmove++;
    }
    this.turn = isWhite ? "b" : "w";
  }
}

export interface MoveListDocumentLike {
  querySelectorAll(
    selector: string
  ): Iterable<{ readonly textContent: string | null; getAttribute?(n: string): string | null }>
    | ArrayLike<{ readonly textContent: string | null; getAttribute?(n: string): string | null }>;
}

/**
 * Extracts chronological SAN/UCI move tokens from Lichess `<l4x>` and Chess.com `.move` DOM trees.
 */
export function extractDomMoveList(
  doc: MoveListDocumentLike | null | undefined
): string[] {
  if (!doc) return [];

  // 1. Lichess `<l4x>` move list (`<l4x><i5z>1.</i5z><kwdb>e4</kwdb><kwdb>c5</kwdb>...</l4x>`)
  const lichessTokens = readMoveSelector(doc, [
    "l4x kwdb",
    "l4x move",
    ".tview2 move",
  ]);
  if (lichessTokens.length > 0) return lichessTokens;

  // 2. Chess.com `.move` / `[data-ply]` move list
  const chessComNodes = Array.from(
    doc.querySelectorAll(
      ".move .node-highlight-content, [data-ply] .node-highlight-content, .main-line-ply, .move"
    )
  );
  if (chessComNodes.length > 0) {
    const tokens: string[] = [];
    for (const node of chessComNodes) {
      const fig =
        typeof node.getAttribute === "function"
          ? node.getAttribute("data-figurine")
          : null;
      const raw = (node.textContent ?? "").trim();
      if (!raw || /^\d+\.{1,3}$/.test(raw)) continue;
      // Split composite `.move` rows like "1. e4 c5" if matched at row level
      const parts = raw.split(/\s+/);
      for (const p of parts) {
        const cleaned = stripMoveNumberPrefix(
          fig && parts.length === 1 && !/^[KQRBNO0]/.test(p) ? `${fig}${p}` : p
        );
        if (cleaned) tokens.push(cleaned);
      }
    }
    if (tokens.length > 0) return tokens;
  }

  return [];
}

/**
 * Reconstructs board FEN from an initial FEN + chronological list of SAN/UCI move tokens.
 */
export function reconstructFenFromMoveList(
  moveTokens: readonly string[],
  initialFen: string = STANDARD_START_FEN
): {
  readonly ok: boolean;
  readonly fen: string;
  readonly placementAndTurn: string;
  readonly appliedPlies: number;
  readonly failedToken: string | null;
} {
  const engine = new ChessStateEngine(initialFen);
  let applied = 0;
  for (const token of moveTokens) {
    const cleaned = stripMoveNumberPrefix(token);
    if (!cleaned) continue;
    if (!engine.playMoveToken(cleaned)) {
      return {
        ok: false,
        fen: engine.getFen(),
        placementAndTurn: engine.getPlacementAndTurn(),
        appliedPlies: applied,
        failedToken: cleaned,
      };
    }
    applied++;
  }
  return {
    ok: true,
    fen: engine.getFen(),
    placementAndTurn: engine.getPlacementAndTurn(),
    appliedPlies: applied,
    failedToken: null,
  };
}

export interface DualStateReconcilerConfig {
  /** Explicit opt-in flag; defaults to false for full backward compatibility. */
  readonly enabled: boolean;
  /** Number of consecutive mismatched plies allowed before downgrading (default 2 -> downgrade on 3rd). */
  readonly maxConsecutiveMismatchPlies: number;
  readonly initialFen?: string;
  readonly onModeDowngrade?: (
    mode: ReconcilerExecutionMode,
    reason: string
  ) => void;
  readonly onDiagnostic?: (message: string) => void;
}

export const DEFAULT_RECONCILER_CONFIG: DualStateReconcilerConfig = {
  enabled: false,
  maxConsecutiveMismatchPlies: 2,
  initialFen: STANDARD_START_FEN,
};

export interface ReconcilePlyInput {
  readonly scrapeBoardFen: () => Promise<string | null> | string | null;
  readonly readMoveTokens: () => Promise<readonly string[]> | readonly string[];
  readonly initialFen?: string;
}

export interface ReconciliationResult {
  readonly enabled: boolean;
  readonly status: "MATCHED" | "MISMATCH" | "RECONSTRUCTION_ERROR" | "SCRAPE_UNAVAILABLE" | "DISABLED";
  readonly executionMode: ReconcilerExecutionMode;
  readonly autonomousAllowed: boolean;
  readonly consecutiveMismatchPlies: number;
  readonly scrapedPlacementAndTurn: string | null;
  readonly reconstructedFen: string | null;
  readonly reconstructedPlacementAndTurn: string | null;
  readonly appliedPlies: number;
  readonly message: string | null;
}

export interface StartupSelfTestProbe {
  /** Returns DOM-scraped FEN after applying the supplied sequence of test plies. */
  readonly scrapeForPlies: (
    expectedPlies: readonly string[],
    initialFen: string
  ) => Promise<string | null> | string | null;
}

export interface StartupSelfTestResult {
  readonly passed: boolean;
  readonly checkedPlies: number;
  readonly executionMode: ReconcilerExecutionMode;
  readonly autonomousAllowed: boolean;
  readonly diagnosticMessage: string | null;
  readonly failedAtPly: number | null;
}

/**
 * Dual-source verification engine running DOM square scraping and independent move-list
 * reconstruction in parallel on every ply, downgrading to read-only hints after >2 mismatch plies
 * or on startup self-test failure. Defaults to `enabled: false`.
 */
export class DualStateReconciler {
  private config: DualStateReconcilerConfig;
  private executionMode: ReconcilerExecutionMode = "AUTONOMOUS";
  private consecutiveMismatchPlies = 0;
  private selfTestPassed: boolean | null = null;
  private lastDiagnostic: string | null = null;

  constructor(config: Partial<DualStateReconcilerConfig> = {}) {
    this.config = {
      ...DEFAULT_RECONCILER_CONFIG,
      ...config,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(next: boolean): void {
    this.config = { ...this.config, enabled: next };
  }

  getExecutionMode(): ReconcilerExecutionMode {
    return this.executionMode;
  }

  isAutonomousAllowed(): boolean {
    if (!this.config.enabled) return true;
    return this.executionMode === "AUTONOMOUS";
  }

  getConsecutiveMismatchPlies(): number {
    return this.consecutiveMismatchPlies;
  }

  getLastDiagnostic(): string | null {
    return this.lastDiagnostic;
  }

  getSelfTestStatus(): boolean | null {
    return this.selfTestPassed;
  }

  reset(): void {
    this.executionMode = "AUTONOMOUS";
    this.consecutiveMismatchPlies = 0;
    this.selfTestPassed = null;
    this.lastDiagnostic = null;
  }

  /**
   * Executes DOM square scraping (Source A) and move-list reconstruction (Source B)
   * in parallel, comparing placement+turn FENs and downgrading to read-only hints
   * when mismatches persist beyond `maxConsecutiveMismatchPlies` (default > 2 plies).
   */
  async reconcilePly(input: ReconcilePlyInput): Promise<ReconciliationResult> {
    if (!this.config.enabled) {
      return {
        enabled: false,
        status: "DISABLED",
        executionMode: this.executionMode,
        autonomousAllowed: true,
        consecutiveMismatchPlies: 0,
        scrapedPlacementAndTurn: null,
        reconstructedFen: null,
        reconstructedPlacementAndTurn: null,
        appliedPlies: 0,
        message: null,
      };
    }

    const initFen = input.initialFen ?? this.config.initialFen ?? STANDARD_START_FEN;

    // Parallel execution of DOM square scraper + move-list extractor & chess reconstructor
    const [scrapedRaw, tokens] = await Promise.all([
      Promise.resolve().then(() => input.scrapeBoardFen()),
      Promise.resolve().then(() => input.readMoveTokens()),
    ]);

    const scrapedKey = extractPlacementAndTurn(scrapedRaw);
    const recon = reconstructFenFromMoveList(tokens, initFen);

    if (!scrapedKey) {
      return this.registerMismatch(
        "SCRAPE_UNAVAILABLE",
        null,
        recon.fen,
        recon.placementAndTurn,
        recon.appliedPlies,
        "DOM square scraping returned no board state"
      );
    }

    if (!recon.ok) {
      return this.registerMismatch(
        "RECONSTRUCTION_ERROR",
        scrapedKey,
        recon.fen,
        recon.placementAndTurn,
        recon.appliedPlies,
        `Move-list replay failed at token "${recon.failedToken ?? ""}"`
      );
    }

    if (scrapedKey !== recon.placementAndTurn) {
      return this.registerMismatch(
        "MISMATCH",
        scrapedKey,
        recon.fen,
        recon.placementAndTurn,
        recon.appliedPlies,
        `FEN mismatch: scraped "${scrapedKey}" != reconstructed "${recon.placementAndTurn}"`
      );
    }

    // Verified parity
    this.consecutiveMismatchPlies = 0;
    return {
      enabled: true,
      status: "MATCHED",
      executionMode: this.executionMode,
      autonomousAllowed: this.executionMode === "AUTONOMOUS",
      consecutiveMismatchPlies: 0,
      scrapedPlacementAndTurn: scrapedKey,
      reconstructedFen: recon.fen,
      reconstructedPlacementAndTurn: recon.placementAndTurn,
      appliedPlies: recon.appliedPlies,
      message: null,
    };
  }

  /**
   * Startup self-test routine verifying known reference FEN and 3-ply parity (`1. e4 c5 2. Nf3`).
   * On failure, emits `"Board detection degraded — check for site updates"` and restricts to manual hints.
   */
  async runStartupSelfTest(
    probe?: StartupSelfTestProbe
  ): Promise<StartupSelfTestResult> {
    if (!this.config.enabled) {
      return {
        passed: true,
        checkedPlies: 0,
        executionMode: this.executionMode,
        autonomousAllowed: true,
        diagnosticMessage: null,
        failedAtPly: null,
      };
    }

    const referencePlies = ["e4", "c5", "Nf3"] as const;
    const expectedFens: string[] = [STANDARD_START_FEN];
    const verifier = new ChessStateEngine(STANDARD_START_FEN);
    for (const san of referencePlies) {
      verifier.playSan(san);
      expectedFens.push(verifier.getFen());
    }

    try {
      for (let ply = 0; ply <= referencePlies.length; ply++) {
        const subset = referencePlies.slice(0, ply);
        const expectedKey = extractPlacementAndTurn(expectedFens[ply])!;
        const recon = reconstructFenFromMoveList(subset, STANDARD_START_FEN);
        if (!recon.ok || recon.placementAndTurn !== expectedKey) {
          return this.failSelfTest(ply);
        }

        if (probe) {
          const scraped = await probe.scrapeForPlies(subset, STANDARD_START_FEN);
          const scrapedKey = extractPlacementAndTurn(scraped);
          if (!scrapedKey || scrapedKey !== expectedKey) {
            return this.failSelfTest(ply);
          }
        }
      }

      this.selfTestPassed = true;
      return {
        passed: true,
        checkedPlies: referencePlies.length,
        executionMode: this.executionMode,
        autonomousAllowed: this.executionMode === "AUTONOMOUS",
        diagnosticMessage: null,
        failedAtPly: null,
      };
    } catch {
      return this.failSelfTest(0);
    }
  }

  private registerMismatch(
    status: "MISMATCH" | "RECONSTRUCTION_ERROR" | "SCRAPE_UNAVAILABLE",
    scrapedKey: string | null,
    reconstructedFen: string | null,
    reconstructedKey: string | null,
    appliedPlies: number,
    detail: string
  ): ReconciliationResult {
    this.consecutiveMismatchPlies++;
    this.lastDiagnostic = detail;

    if (
      this.consecutiveMismatchPlies > this.config.maxConsecutiveMismatchPlies &&
      this.executionMode !== "READ_ONLY_HINT"
    ) {
      this.executionMode = "READ_ONLY_HINT";
      const downgradeMsg = `Persistent dual-state FEN mismatch (${this.consecutiveMismatchPlies} plies) — downgraded to read-only hint mode`;
      this.lastDiagnostic = downgradeMsg;
      this.config.onModeDowngrade?.("READ_ONLY_HINT", downgradeMsg);
      this.config.onDiagnostic?.(downgradeMsg);
    }

    return {
      enabled: true,
      status,
      executionMode: this.executionMode,
      autonomousAllowed: this.executionMode === "AUTONOMOUS",
      consecutiveMismatchPlies: this.consecutiveMismatchPlies,
      scrapedPlacementAndTurn: scrapedKey,
      reconstructedFen,
      reconstructedPlacementAndTurn: reconstructedKey,
      appliedPlies,
      message: this.lastDiagnostic,
    };
  }

  private failSelfTest(failedAtPly: number): StartupSelfTestResult {
    this.selfTestPassed = false;
    this.executionMode = "READ_ONLY_HINT";
    this.lastDiagnostic = DEGRADED_DETECTION_MESSAGE;
    this.config.onModeDowngrade?.("READ_ONLY_HINT", DEGRADED_DETECTION_MESSAGE);
    this.config.onDiagnostic?.(DEGRADED_DETECTION_MESSAGE);
    return {
      passed: false,
      checkedPlies: failedAtPly,
      executionMode: "READ_ONLY_HINT",
      autonomousAllowed: false,
      diagnosticMessage: DEGRADED_DETECTION_MESSAGE,
      failedAtPly,
    };
  }
}

export function extractPlacementAndTurn(fen: string | null | undefined): string | null {
  if (!fen) return null;
  const parts = fen.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0].includes("/")) return null;
  const turn = parts[1] === "b" ? "b" : "w";
  return `${parts[0]} ${turn}`;
}

function normalizeSanToken(raw: string): string {
  return raw
    .trim()
    .replace(/^\d+\.+\s*/, "")
    .replace(/[+#!?]+$/g, "")
    .replace(/[\u2654\u265A]/g, "K")
    .replace(/[\u2655\u265B]/g, "Q")
    .replace(/[\u2656\u265C]/g, "R")
    .replace(/[\u2657\u265D]/g, "B")
    .replace(/[\u2658\u265E]/g, "N")
    .replace(/^0-0-0$/, "O-O-O")
    .replace(/^0-0$/, "O-O");
}

function stripMoveNumberPrefix(token: string): string {
  const t = token.trim();
  if (!t || /^\d+\.{1,3}$/.test(t) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) {
    return "";
  }
  return t.replace(/^\d+\.+\s*/, "").trim();
}

function readMoveSelector(
  doc: MoveListDocumentLike,
  selectors: readonly string[]
): string[] {
  for (const sel of selectors) {
    const nodes = Array.from(doc.querySelectorAll(sel));
    if (nodes.length === 0) continue;
    const out: string[] = [];
    for (const n of nodes) {
      const cleaned = stripMoveNumberPrefix(n.textContent ?? "");
      if (cleaned) out.push(cleaned);
    }
    if (out.length > 0) return out;
  }
  return [];
}

function makeMove(
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  piece: string,
  capture: boolean,
  promotion: string | null,
  isCastling: "K" | "Q" | null,
  isEnPassant: boolean
): InternalMove {
  const fromSq = `${FILES[fromCol]}${8 - fromRow}`;
  const toSq = `${FILES[toCol]}${8 - toRow}`;
  return {
    fromRow,
    fromCol,
    toRow,
    toCol,
    piece,
    capture,
    promotion,
    isCastling,
    isEnPassant,
    uci: `${fromSq}${toSq}${promotion ?? ""}`,
  };
}
