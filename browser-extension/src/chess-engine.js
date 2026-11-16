/**
 * Chess Forge Self-Contained JavaScript Chess Engine (Zero External Dependencies)
 * Supports full chess rules (castling, en passant, promotions, check/mate),
 * iterative-deepening alpha-beta search with quiescence, MVV-LVA, piece-square
 * tables, transposition cache, Multi-PV root analysis, and SAN conversion.
 */
(function (globalScope) {
  "use strict";

  const FILES = "abcdefgh";
  const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-square tables from White's perspective (row 0 = rank 8 .. row 7 = rank 1)
  const PST_PAWN = [
    0,  0,  0,  0,  0,  0,  0,  0,
   50, 50, 50, 50, 50, 50, 50, 50,
   10, 10, 20, 30, 30, 20, 10, 10,
    5,  5, 10, 27, 27, 10,  5,  5,
    0,  0,  0, 24, 24,  0,  0,  0,
    5, -5,-10,  0,  0,-10, -5,  5,
    5, 10, 10,-22,-22, 10, 10,  5,
    0,  0,  0,  0,  0,  0,  0,  0
  ];
  const PST_KNIGHT = [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50
  ];
  const PST_BISHOP = [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20
  ];
  const PST_ROOK = [
    0,  0,  0,  0,  0,  0,  0,  0,
    5, 10, 10, 10, 10, 10, 10,  5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
   -5,  0,  0,  0,  0,  0,  0, -5,
    0,  0,  0,  5,  5,  0,  0,  0
  ];
  const PST_QUEEN = [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20
  ];
  const PST_KING = [
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20
  ];

  const PST_MAP = {
    p: PST_PAWN,
    n: PST_KNIGHT,
    b: PST_BISHOP,
    r: PST_ROOK,
    q: PST_QUEEN,
    k: PST_KING
  };

  function isUpper(ch) {
    return ch >= "A" && ch <= "Z";
  }

  function pieceColor(ch) {
    if (!ch) return null;
    return isUpper(ch) ? "w" : "b";
  }

  function sqToIndex(sq) {
    if (!sq || sq.length < 2) return -1;
    const f = FILES.indexOf(sq[0]);
    const r = 8 - parseInt(sq[1], 10);
    if (f < 0 || f > 7 || r < 0 || r > 7 || Number.isNaN(r)) return -1;
    return r * 8 + f;
  }

  function indexToSq(idx) {
    const r = Math.floor(idx / 8);
    const f = idx % 8;
    return FILES[f] + String(8 - r);
  }

  function parseFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const placement = parts[0] || "8/8/8/8/8/8/8/8";
    const turn = parts[1] === "b" ? "b" : "w";
    const castling = parts[2] || "-";
    const epSq = parts[3] && parts[3] !== "-" ? sqToIndex(parts[3]) : -1;
    const halfmove = parseInt(parts[4] || "0", 10) || 0;
    const fullmove = parseInt(parts[5] || "1", 10) || 1;

    const board = new Array(64).fill(null);
    const ranks = placement.split("/");
    if (ranks.length !== 8) {
      throw new Error("Invalid FEN rank count");
    }
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of ranks[r]) {
        if (ch >= "1" && ch <= "8") {
          f += parseInt(ch, 10);
        } else {
          if (f < 8) {
            board[r * 8 + f] = ch;
            f++;
          }
        }
      }
    }

    return {
      board,
      turn,
      castling: {
        K: castling.includes("K"),
        Q: castling.includes("Q"),
        k: castling.includes("k"),
        q: castling.includes("q")
      },
      ep: epSq,
      halfmove,
      fullmove
    };
  }

  function stateToFen(state) {
    let placement = "";
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = state.board[r * 8 + f];
        if (!p) {
          empty++;
        } else {
          if (empty > 0) {
            placement += empty;
            empty = 0;
          }
          placement += p;
        }
      }
      if (empty > 0) placement += empty;
      if (r < 7) placement += "/";
    }
    let cStr = "";
    if (state.castling.K) cStr += "K";
    if (state.castling.Q) cStr += "Q";
    if (state.castling.k) cStr += "k";
    if (state.castling.q) cStr += "q";
    if (!cStr) cStr = "-";
    const epStr = state.ep >= 0 ? indexToSq(state.ep) : "-";
    return `${placement} ${state.turn} ${cStr} ${epStr} ${state.halfmove} ${state.fullmove}`;
  }

  function isSquareAttacked(board, sqIdx, attackerColor) {
    const r = Math.floor(sqIdx / 8);
    const f = sqIdx % 8;

    // Pawn attacks
    if (attackerColor === "w") {
      if (r + 1 < 8) {
        if (f - 1 >= 0 && board[(r + 1) * 8 + (f - 1)] === "P") return true;
        if (f + 1 < 8 && board[(r + 1) * 8 + (f + 1)] === "P") return true;
      }
    } else {
      if (r - 1 >= 0) {
        if (f - 1 >= 0 && board[(r - 1) * 8 + (f - 1)] === "p") return true;
        if (f + 1 < 8 && board[(r - 1) * 8 + (f + 1)] === "p") return true;
      }
    }

    // Knight attacks
    const knightDeltas = [
      [-2, -1], [-2, 1], [-1, -2], [-1, 2],
      [1, -2], [1, 2], [2, -1], [2, 1]
    ];
    const targetKnight = attackerColor === "w" ? "N" : "n";
    for (const [dr, df] of knightDeltas) {
      const nr = r + dr, nf = f + df;
      if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && board[nr * 8 + nf] === targetKnight) {
        return true;
      }
    }

    // King attacks
    const targetKing = attackerColor === "w" ? "K" : "k";
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const nr = r + dr, nf = f + df;
        if (nr >= 0 && nr < 8 && nf >= 0 && nf < 8 && board[nr * 8 + nf] === targetKing) {
          return true;
        }
      }
    }

    // Orthogonal sliders (Rook / Queen)
    const targetR = attackerColor === "w" ? "R" : "r";
    const targetQ = attackerColor === "w" ? "Q" : "q";
    const orthoDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dr, df] of orthoDirs) {
      let nr = r + dr, nf = f + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const p = board[nr * 8 + nf];
        if (p) {
          if (p === targetR || p === targetQ) return true;
          break;
        }
        nr += dr;
        nf += df;
      }
    }

    // Diagonal sliders (Bishop / Queen)
    const targetB = attackerColor === "w" ? "B" : "b";
    const diagDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
    for (const [dr, df] of diagDirs) {
      let nr = r + dr, nf = f + df;
      while (nr >= 0 && nr < 8 && nf >= 0 && nf < 8) {
        const p = board[nr * 8 + nf];
        if (p) {
          if (p === targetB || p === targetQ) return true;
          break;
        }
        nr += dr;
        nf += df;
      }
    }

    return false;
  }

  function findKing(board, color) {
    const k = color === "w" ? "K" : "k";
    for (let i = 0; i < 64; i++) {
      if (board[i] === k) return i;
    }
    return -1;
  }

  function generatePseudoMoves(state, capturesOnly) {
    const moves = [];
    const us = state.turn;
    const them = us === "w" ? "b" : "w";
    const b = state.board;

    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p || pieceColor(p) !== us) continue;
      const type = p.toLowerCase();
      const r = Math.floor(sq / 8);
      const f = sq % 8;

      if (type === "p") {
        const dir = us === "w" ? -1 : 1;
        const startRank = us === "w" ? 6 : 1;
        const promoRank = us === "w" ? 0 : 7;
        const oneStep = (r + dir) * 8 + f;
        if (r + dir >= 0 && r + dir < 8 && !b[oneStep]) {
          if (r + dir === promoRank) {
            for (const promo of ["q", "r", "b", "n"]) {
              moves.push({ from: sq, to: oneStep, promo, captured: null });
            }
          } else if (!capturesOnly) {
            moves.push({ from: sq, to: oneStep, promo: null, captured: null });
            if (r === startRank) {
              const twoStep = (r + dir * 2) * 8 + f;
              if (!b[twoStep]) {
                moves.push({ from: sq, to: twoStep, promo: null, captured: null, isDoublePawn: true });
              }
            }
          }
        }
        for (const df of [-1, 1]) {
          const nf = f + df;
          const nr = r + dir;
          if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
          const targetSq = nr * 8 + nf;
          const target = b[targetSq];
          if (target && pieceColor(target) === them) {
            if (nr === promoRank) {
              for (const promo of ["q", "r", "b", "n"]) {
                moves.push({ from: sq, to: targetSq, promo, captured: target });
              }
            } else {
              moves.push({ from: sq, to: targetSq, promo: null, captured: target });
            }
          } else if (targetSq === state.ep && state.ep >= 0) {
            moves.push({
              from: sq,
              to: targetSq,
              promo: null,
              captured: us === "w" ? "p" : "P",
              isEp: true
            });
          }
        }
      } else if (type === "n") {
        const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, df] of deltas) {
          const nr = r + dr, nf = f + df;
          if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
          const to = nr * 8 + nf;
          const target = b[to];
          if (!target && !capturesOnly) {
            moves.push({ from: sq, to, promo: null, captured: null });
          } else if (target && pieceColor(target) === them) {
            moves.push({ from: sq, to, promo: null, captured: target });
          }
        }
      } else if (type === "b" || type === "r" || type === "q") {
        const dirs = [];
        if (type === "b" || type === "q") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
        if (type === "r" || type === "q") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
        for (const [dr, df] of dirs) {
          let nr = r + dr, nf = f + df;
          while (nr >= 0 && nr <= 7 && nf >= 0 && nf <= 7) {
            const to = nr * 8 + nf;
            const target = b[to];
            if (!target) {
              if (!capturesOnly) moves.push({ from: sq, to, promo: null, captured: null });
            } else {
              if (pieceColor(target) === them) {
                moves.push({ from: sq, to, promo: null, captured: target });
              }
              break;
            }
            nr += dr;
            nf += df;
          }
        }
      } else if (type === "k") {
        for (let dr = -1; dr <= 1; dr++) {
          for (let df = -1; df <= 1; df++) {
            if (dr === 0 && df === 0) continue;
            const nr = r + dr, nf = f + df;
            if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
            const to = nr * 8 + nf;
            const target = b[to];
            if (!target && !capturesOnly) {
              moves.push({ from: sq, to, promo: null, captured: null });
            } else if (target && pieceColor(target) === them) {
              moves.push({ from: sq, to, promo: null, captured: target });
            }
          }
        }
        if (!capturesOnly) {
          if (us === "w" && sq === 60) {
            if (state.castling.K && !b[61] && !b[62] && b[63] === "R" &&
                !isSquareAttacked(b, 60, "b") && !isSquareAttacked(b, 61, "b") && !isSquareAttacked(b, 62, "b")) {
              moves.push({ from: 60, to: 62, promo: null, captured: null, isCastle: "K" });
            }
            if (state.castling.Q && !b[59] && !b[58] && !b[57] && b[56] === "R" &&
                !isSquareAttacked(b, 60, "b") && !isSquareAttacked(b, 59, "b") && !isSquareAttacked(b, 58, "b")) {
              moves.push({ from: 60, to: 58, promo: null, captured: null, isCastle: "Q" });
            }
          } else if (us === "b" && sq === 4) {
            if (state.castling.k && !b[5] && !b[6] && b[7] === "r" &&
                !isSquareAttacked(b, 4, "w") && !isSquareAttacked(b, 5, "w") && !isSquareAttacked(b, 6, "w")) {
              moves.push({ from: 4, to: 6, promo: null, captured: null, isCastle: "k" });
            }
            if (state.castling.q && !b[3] && !b[2] && !b[1] && b[0] === "r" &&
                !isSquareAttacked(b, 4, "w") && !isSquareAttacked(b, 3, "w") && !isSquareAttacked(b, 2, "w")) {
              moves.push({ from: 4, to: 2, promo: null, captured: null, isCastle: "q" });
            }
          }
        }
      }
    }
    return moves;
  }

  function makeMove(state, move) {
    const b = state.board.slice();
    const piece = b[move.from];
    const us = state.turn;
    const them = us === "w" ? "b" : "w";

    b[move.from] = null;
    if (move.isEp) {
      const capSq = move.to + (us === "w" ? 8 : -8);
      b[capSq] = null;
    }
    b[move.to] = move.promo ? (us === "w" ? move.promo.toUpperCase() : move.promo.toLowerCase()) : piece;

    if (move.isCastle === "K") {
      b[61] = b[63]; b[63] = null;
    } else if (move.isCastle === "Q") {
      b[59] = b[56]; b[56] = null;
    } else if (move.isCastle === "k") {
      b[5] = b[7]; b[7] = null;
    } else if (move.isCastle === "q") {
      b[3] = b[0]; b[0] = null;
    }

    const nextCastling = {
      K: state.castling.K && move.from !== 60 && move.from !== 63 && move.to !== 63,
      Q: state.castling.Q && move.from !== 60 && move.from !== 56 && move.to !== 56,
      k: state.castling.k && move.from !== 4 && move.from !== 7 && move.to !== 7,
      q: state.castling.q && move.from !== 4 && move.from !== 0 && move.to !== 0
    };

    const nextEp = move.isDoublePawn ? (move.from + move.to) >> 1 : -1;
    const isPawnOrCap = piece.toLowerCase() === "p" || move.captured !== null;
    return {
      board: b,
      turn: them,
      castling: nextCastling,
      ep: nextEp,
      halfmove: isPawnOrCap ? 0 : state.halfmove + 1,
      fullmove: us === "b" ? state.fullmove + 1 : state.fullmove
    };
  }

  function generateLegalMoves(state, capturesOnly) {
    const us = state.turn;
    const them = us === "w" ? "b" : "w";
    const pseudo = generatePseudoMoves(state, capturesOnly);
    const legal = [];
    for (const m of pseudo) {
      const next = makeMove(state, m);
      const kSq = findKing(next.board, us);
      if (kSq >= 0 && !isSquareAttacked(next.board, kSq, them)) {
        legal.push(m);
      }
    }
    return legal;
  }

  function moveToUci(move) {
    return indexToSq(move.from) + indexToSq(move.to) + (move.promo ? move.promo : "");
  }

  function moveToSan(state, move, allLegal) {
    if (move.isCastle === "K" || move.isCastle === "k") return "O-O";
    if (move.isCastle === "Q" || move.isCastle === "q") return "O-O-O";
    const p = state.board[move.from];
    const type = p.toLowerCase();
    const fromSq = indexToSq(move.from);
    const toSq = indexToSq(move.to);
    const isCap = move.captured !== null;

    let san = "";
    if (type === "p") {
      if (isCap) san += fromSq[0] + "x";
      san += toSq;
      if (move.promo) san += "=" + move.promo.toUpperCase();
    } else {
      san += type.toUpperCase();
      const legal = allLegal || generateLegalMoves(state, false);
      const peers = legal.filter(
        (m) =>
          m.to === move.to &&
          m.from !== move.from &&
          state.board[m.from] &&
          state.board[m.from].toLowerCase() === type
      );
      if (peers.length > 0) {
        const sameFile = peers.some((m) => (m.from % 8) === (move.from % 8));
        const sameRank = peers.some((m) => Math.floor(m.from / 8) === Math.floor(move.from / 8));
        if (!sameFile) {
          san += fromSq[0];
        } else if (!sameRank) {
          san += fromSq[1];
        } else {
          san += fromSq;
        }
      }
      if (isCap) san += "x";
      san += toSq;
    }

    const next = makeMove(state, move);
    const oppKing = findKing(next.board, next.turn);
    if (oppKing >= 0 && isSquareAttacked(next.board, oppKing, state.turn)) {
      const oppLegal = generateLegalMoves(next, false);
      san += oppLegal.length === 0 ? "#" : "+";
    }
    return san;
  }

  function evaluateBoard(state) {
    let score = 0;
    const b = state.board;
    for (let sq = 0; sq < 64; sq++) {
      const p = b[sq];
      if (!p) continue;
      const white = isUpper(p);
      const type = p.toLowerCase();
      const base = PIECE_VALUES[type] || 0;
      const pst = PST_MAP[type];
      const pstIdx = white ? sq : (7 - Math.floor(sq / 8)) * 8 + (sq % 8);
      const val = base + (pst ? pst[pstIdx] : 0);
      score += white ? val : -val;
    }
    return state.turn === "w" ? score : -score;
  }

  function scoreMoveOrder(state, move, ttBestUci) {
    const uci = moveToUci(move);
    if (uci === ttBestUci) return 1_000_000;
    let score = 0;
    if (move.captured) {
      const victimVal = PIECE_VALUES[move.captured.toLowerCase()] || 100;
      const attackerVal = PIECE_VALUES[state.board[move.from].toLowerCase()] || 100;
      score += 100_000 + victimVal * 10 - attackerVal;
    }
    if (move.promo) score += 80_000 + (PIECE_VALUES[move.promo] || 0);
    return score;
  }

  function scoreToWinPct(cp) {
    const clamped = Math.max(-2000, Math.min(2000, cp));
    return Math.round((100 / (1 + Math.exp(-0.00368208 * clamped))) * 10) / 10;
  }

  function analyzePosition(fen, options) {
    const opts = options || {};
    const timeLimitMs = Math.max(40, Math.min(1500, opts.moveTimeMs || 180));
    const maxDepth = Math.max(1, Math.min(6, opts.maxDepth || 4));
    const multiPv = Math.max(1, Math.min(3, opts.multiPv || 2));

    const rootState = parseFen(fen);
    const rootLegal = generateLegalMoves(rootState, false);
    if (rootLegal.length === 0) {
      return { fen, lines: [], nodes: 0, depth: 0 };
    }

    const startTime = Date.now();
    const deadline = startTime + timeLimitMs;
    const tt = new Map();
    let nodes = 0;
    let aborted = false;

    function quiescence(state, alpha, beta, qPly) {
      nodes++;
      if ((nodes & 1023) === 0 && Date.now() >= deadline) {
        aborted = true;
        return alpha;
      }
      const standPat = evaluateBoard(state);
      if (standPat >= beta) return beta;
      if (alpha < standPat) alpha = standPat;
      if (qPly >= 3) return alpha;

      const caps = generateLegalMoves(state, true);
      caps.sort((a, b) => scoreMoveOrder(state, b, null) - scoreMoveOrder(state, a, null));
      for (const m of caps) {
        const next = makeMove(state, m);
        const s = -quiescence(next, -beta, -alpha, qPly + 1);
        if (aborted) return alpha;
        if (s >= beta) return beta;
        if (s > alpha) alpha = s;
      }
      return alpha;
    }

    function alphaBeta(state, depth, alpha, beta, ply) {
      nodes++;
      if ((nodes & 1023) === 0 && Date.now() >= deadline) {
        aborted = true;
        return alpha;
      }
      if (depth <= 0) {
        return quiescence(state, alpha, beta, 0);
      }

      const key = stateToFen(state).split(" ").slice(0, 4).join(" ");
      const cached = tt.get(key);
      if (cached && cached.depth >= depth) {
        if (cached.flag === 0) return cached.score;
        if (cached.flag === 1 && cached.score > alpha) alpha = cached.score;
        if (cached.flag === 2 && cached.score < beta) beta = cached.score;
        if (alpha >= beta) return cached.score;
      }

      const legal = generateLegalMoves(state, false);
      if (legal.length === 0) {
        const kSq = findKing(state.board, state.turn);
        const opp = state.turn === "w" ? "b" : "w";
        if (kSq >= 0 && isSquareAttacked(state.board, kSq, opp)) {
          return -19000 + ply;
        }
        return 0;
      }

      const ttMove = cached ? cached.bestUci : null;
      legal.sort((a, b) => scoreMoveOrder(state, b, ttMove) - scoreMoveOrder(state, a, ttMove));

      let origAlpha = alpha;
      let bestScore = -999999;
      let bestUci = moveToUci(legal[0]);

      for (const m of legal) {
        const next = makeMove(state, m);
        const s = -alphaBeta(next, depth - 1, -beta, -alpha, ply + 1);
        if (aborted) return bestScore > -999999 ? bestScore : alpha;
        if (s > bestScore) {
          bestScore = s;
          bestUci = moveToUci(m);
        }
        if (s > alpha) alpha = s;
        if (alpha >= beta) break;
      }

      let flag = 0;
      if (bestScore <= origAlpha) flag = 2;
      else if (bestScore >= beta) flag = 1;
      if (tt.size > 12000) tt.clear();
      tt.set(key, { depth, score: bestScore, flag, bestUci });
      return bestScore;
    }

    let bestResults = [];
    let completedDepth = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const scoredMoves = [];
      const orderHint = bestResults.length > 0 ? bestResults[0].uci : null;
      const ordered = rootLegal.slice().sort(
        (a, b) => scoreMoveOrder(rootState, b, orderHint) - scoreMoveOrder(rootState, a, orderHint)
      );

      for (const m of ordered) {
        const next = makeMove(rootState, m);
        const score = -alphaBeta(next, depth - 1, -999999, 999999, 1);
        if (aborted) break;
        scoredMoves.push({ move: m, score });
      }

      if (aborted) break;
      scoredMoves.sort((a, b) => b.score - a.score);
      completedDepth = depth;
      bestResults = scoredMoves.slice(0, multiPv).map((entry, idx) => {
        const raw = entry.score;
        const isMate = Math.abs(raw) > 18000;
        let mateIn = null;
        if (isMate) {
          const plies = 19000 - Math.abs(raw);
          const movesToMate = Math.max(1, Math.ceil(plies / 2));
          mateIn = raw > 0 ? movesToMate : -movesToMate;
        }
        const winPct = isMate ? (raw > 0 ? 100.0 : 0.0) : scoreToWinPct(raw);
        return {
          rank: idx + 1,
          uci: moveToUci(entry.move),
          san: moveToSan(rootState, entry.move, rootLegal),
          centipawns: isMate ? null : raw,
          mate: mateIn,
          winPct,
          depth
        };
      });

      if (Date.now() >= deadline) break;
    }

    // Ensure at least depth-1 quick result if time ran out before depth 1 completed
    if (bestResults.length === 0 && rootLegal.length > 0) {
      const fallbackScored = rootLegal.map((m) => {
        const next = makeMove(rootState, m);
        return { move: m, score: -evaluateBoard(next) };
      });
      fallbackScored.sort((a, b) => b.score - a.score);
      completedDepth = 1;
      bestResults = fallbackScored.slice(0, multiPv).map((entry, idx) => ({
        rank: idx + 1,
        uci: moveToUci(entry.move),
        san: moveToSan(rootState, entry.move, rootLegal),
        centipawns: entry.score,
        mate: null,
        winPct: scoreToWinPct(entry.score),
        depth: 1
      }));
    }

    return {
      fen,
      lines: bestResults,
      nodes,
      depth: completedDepth,
      elapsedMs: Date.now() - startTime,
      engineBackend: "Local JS Fallback"
    };
  }

  function uciToSan(fen, uci) {
    try {
      const state = parseFen(fen);
      const legal = generateLegalMoves(state);
      const clean = String(uci || "").trim().toLowerCase();
      const matched = legal.find((m) => moveToUci(m) === clean);
      return matched ? moveToSan(state, matched, legal) : uci;
    } catch (_) {
      return uci;
    }
  }

  function hasValidKings(placement) {
    let wk = 0, bk = 0;
    for (const ch of placement) {
      if (ch === "K") wk++;
      else if (ch === "k") bk++;
    }
    return wk === 1 && bk === 1;
  }

  globalScope.ChessForgeEngine = {
    parseFen,
    stateToFen,
    generateLegalMoves,
    analyzePosition,
    uciToSan,
    hasValidKings
  };
})(typeof self !== "undefined" ? self : window);
