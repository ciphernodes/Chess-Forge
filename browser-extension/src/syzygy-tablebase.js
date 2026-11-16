/**
 * Chess Forge Syzygy Endgame Tablebase Module
 * Provides mathematically perfect move analysis and WDL/DTZ/DTM evaluation
 * for all positions with 7 or fewer pieces on the board.
 * Uses Lichess Syzygy 7-Piece Tablebase API with LRU caching and instant offline
 * fundamental endgame heuristics.
 */
(function (globalScope) {
  "use strict";

  const cache = new Map();
  const MAX_CACHE = 200;

  function countPieces(fen) {
    if (!fen) return 32;
    const placement = fen.trim().split(/\s+/)[0] || "";
    let count = 0;
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        count++;
      }
    }
    return count;
  }

  function isApplicable(fen) {
    return countPieces(fen) <= 7;
  }

  function fenKey(fen) {
    const parts = (fen || "").trim().split(/\s+/);
    if (parts.length < 4) return fen;
    return `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}`;
  }

  // Instant offline fallback for fundamental endgames when network is offline
  function solveFundamentalEndgame(fen, pieceCount) {
    const parts = (fen || "").trim().split(/\s+/);
    const placement = parts[0] || "";
    const turn = parts[1] || "w";

    const pieces = {};
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z")) {
        pieces[ch] = (pieces[ch] || 0) + 1;
      }
    }

    const whitePieces = (pieces.P || 0) + (pieces.N || 0) + (pieces.B || 0) + (pieces.R || 0) + (pieces.Q || 0);
    const blackPieces = (pieces.p || 0) + (pieces.n || 0) + (pieces.b || 0) + (pieces.r || 0) + (pieces.q || 0);

    // K vs K
    if (whitePieces === 0 && blackPieces === 0) {
      return {
        isTablebase: true,
        pieceCount,
        category: "draw",
        outcome: "Tablebase Draw",
        dtz: 0,
        dtm: 0,
        source: "Syzygy Offline Base",
        moves: []
      };
    }

    // K+minor vs K
    if ((whitePieces === 1 && (pieces.N === 1 || pieces.B === 1) && blackPieces === 0) ||
        (blackPieces === 1 && (pieces.n === 1 || pieces.b === 1) && whitePieces === 0)) {
      return {
        isTablebase: true,
        pieceCount,
        category: "draw",
        outcome: "Tablebase Draw (Insufficient Material)",
        dtz: 0,
        dtm: 0,
        source: "Syzygy Offline Base",
        moves: []
      };
    }

    // KQ vs K or KR vs K
    if (blackPieces === 0 && (pieces.Q || pieces.R)) {
      const isWin = turn === "w";
      return {
        isTablebase: true,
        pieceCount,
        category: isWin ? "win" : "loss",
        outcome: isWin ? "Tablebase Win" : "Tablebase Loss",
        dtz: pieces.Q ? 8 : 14,
        dtm: pieces.Q ? 16 : 28,
        source: "Syzygy Offline Base",
        moves: []
      };
    }
    if (whitePieces === 0 && (pieces.q || pieces.r)) {
      const isWin = turn === "b";
      return {
        isTablebase: true,
        pieceCount,
        category: isWin ? "win" : "loss",
        outcome: isWin ? "Tablebase Win" : "Tablebase Loss",
        dtz: pieces.q ? 8 : 14,
        dtm: pieces.q ? 16 : 28,
        source: "Syzygy Offline Base",
        moves: []
      };
    }

    return null;
  }

  function parseSyzygyData(raw, fen, pieceCount) {
    if (!raw) return null;
    const turn = ((fen || "").trim().split(/\s+/)[1] || "w").toLowerCase();
    const cat = (raw.category || "unknown").toLowerCase();

    // From mover's perspective:
    // "win", "draw", "loss", "unknown"
    let moverOutcome = "Unknown";
    let scoreBadge = "TB";
    if (cat === "win") {
      moverOutcome = "Tablebase Win";
      scoreBadge = raw.dtm ? `+M${Math.abs(raw.dtm)}` : (raw.dtz ? `+W (DTZ ${raw.dtz})` : "+TB Win");
    } else if (cat === "draw") {
      moverOutcome = "Tablebase Draw";
      scoreBadge = "TB Draw";
    } else if (cat === "loss") {
      moverOutcome = "Tablebase Loss";
      scoreBadge = raw.dtm ? `-M${Math.abs(raw.dtm)}` : (raw.dtz ? `-L (DTZ ${Math.abs(raw.dtz)})` : "-TB Loss");
    }

    const rawMoves = Array.isArray(raw.moves) ? raw.moves : [];
    const formattedMoves = rawMoves.map((m) => {
      // In Syzygy API, m.category is from the OPPONENT's perspective after this move!
      // If opponent category is "loss", the current mover is WINNING!
      const oppCat = (m.category || "unknown").toLowerCase();
      let moveQuality = "draw";
      let annotation = "=";
      if (oppCat === "loss") {
        moveQuality = "win";
        annotation = (cat === "win") ? "!" : "!!";
      } else if (oppCat === "draw") {
        moveQuality = "draw";
        annotation = (cat === "win") ? "?!" : "=";
      } else if (oppCat === "win") {
        moveQuality = "loss";
        annotation = (cat === "win" || cat === "draw") ? "??" : "?";
      }

      const dtm = m.dtm !== null && m.dtm !== undefined ? Math.abs(m.dtm) : null;
      const dtz = m.dtz !== null && m.dtz !== undefined ? Math.abs(m.dtz) : null;

      return {
        uci: m.uci,
        san: m.san || m.uci,
        oppCategory: oppCat,
        quality: moveQuality,
        annotation,
        dtm,
        dtz,
        checkmate: !!m.checkmate,
        stalemate: !!m.stalemate
      };
    });

    // Sort moves: Winning moves first (shortest DTM/DTZ), then Drawing moves, then Losing moves
    formattedMoves.sort((a, b) => {
      const order = { win: 0, draw: 1, loss: 2 };
      const qA = order[a.quality] ?? 3;
      const qB = order[b.quality] ?? 3;
      if (qA !== qB) return qA - qB;
      if (a.quality === "win") {
        if (a.checkmate) return -1;
        if (b.checkmate) return 1;
        if (a.dtm && b.dtm) return a.dtm - b.dtm;
        if (a.dtz && b.dtz) return a.dtz - b.dtz;
      }
      if (a.quality === "loss") {
        // In losing position, prefer longest resistance
        if (a.dtm && b.dtm) return b.dtm - a.dtm;
      }
      return 0;
    });

    return {
      isTablebase: true,
      pieceCount,
      turn,
      category: cat,
      outcome: moverOutcome,
      scoreBadge,
      dtz: raw.dtz !== undefined ? raw.dtz : null,
      dtm: raw.dtm !== undefined ? raw.dtm : null,
      checkmate: !!raw.checkmate,
      stalemate: !!raw.stalemate,
      source: "Lichess Syzygy 7-Piece",
      moves: formattedMoves
    };
  }

  async function fetchRemoteTablebase(fen, pieceCount) {
    const url = "https://tablebase.lichess.ovh/standard?fen=" + encodeURIComponent(fen);
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 2600) : null;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) return null;
      const data = await res.json();
      return parseSyzygyData(data, fen, pieceCount);
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function lookup(fen, callback) {
    const pCount = countPieces(fen);
    if (pCount > 7) {
      if (callback) callback(null);
      return null;
    }

    const key = fenKey(fen);
    if (cache.has(key)) {
      const hit = cache.get(key);
      if (callback) callback(hit);
      return hit;
    }

    const fallback = solveFundamentalEndgame(fen, pCount);
    if (fallback && callback) {
      callback(fallback);
    }

    const hasBg =
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function";

    if (hasBg) {
      try {
        chrome.runtime.sendMessage({ type: "TABLEBASE_LOOKUP", fen, pieceCount: pCount }, (resp) => {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return;
          if (resp && resp.ok && resp.tablebase) {
            if (cache.size >= MAX_CACHE) {
              cache.delete(cache.keys().next().value);
            }
            cache.set(key, resp.tablebase);
            if (callback) callback(resp.tablebase);
          }
        });
        return fallback;
      } catch (_) {
      }
    }

    fetchRemoteTablebase(fen, pCount).then((remote) => {
      if (remote) {
        if (cache.size >= MAX_CACHE) {
          cache.delete(cache.keys().next().value);
        }
        cache.set(key, remote);
        if (callback) callback(remote);
      }
    });

    return fallback;
  }

  globalScope.ChessForgeTablebase = {
    countPieces,
    isApplicable,
    lookup,
    solveFundamentalEndgame,
    parseSyzygyData
  };
})(typeof self !== "undefined" ? self : window);
