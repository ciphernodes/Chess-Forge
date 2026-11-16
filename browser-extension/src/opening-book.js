/**
 * Chess Forge Master Opening Book Database Lookup
 * Combines a fast built-in Master ECO transposition book (zero-latency offline)
 * with live Lichess Masters Explorer database queries (cached by board+turn).
 */
(function (globalScope) {
  "use strict";

  // Key format: "<piece-placement> <turn>" (transposition-safe)
  const BUILTIN_MASTER_BOOK = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w": {
      eco: "A00",
      opening: "Starting Position",
      moves: [
        { uci: "e2e4", san: "e4", games: 1485200, white: 558000, draws: 504000, black: 423200 },
        { uci: "d2d4", san: "d4", games: 1124500, white: 432000, draws: 405000, black: 287500 },
        { uci: "c2c4", san: "c4", games: 312800, white: 119000, draws: 116000, black: 77800 },
        { uci: "g1f3", san: "Nf3", games: 294100, white: 111000, draws: 115000, black: 68100 }
      ]
    },
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b": {
      eco: "B00",
      opening: "King's Pawn Game",
      moves: [
        { uci: "c7c5", san: "c5", games: 642300, white: 229000, draws: 218000, black: 195300 },
        { uci: "e7e5", san: "e5", games: 389100, white: 146000, draws: 147000, black: 96100 },
        { uci: "e7e6", san: "e6", games: 192400, white: 75000, draws: 64000, black: 53400 },
        { uci: "c7c6", san: "c6", games: 138700, white: 52000, draws: 49000, black: 37700 }
      ]
    },
    "rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b": {
      eco: "A40",
      opening: "Queen's Pawn Game",
      moves: [
        { uci: "g8f6", san: "Nf6", games: 694000, white: 256000, draws: 255000, black: 183000 },
        { uci: "d7d5", san: "d5", games: 345200, white: 131000, draws: 132000, black: 82200 },
        { uci: "e7e6", san: "e6", games: 41800, white: 16200, draws: 14200, black: 11400 },
        { uci: "f7f5", san: "f5", games: 21900, white: 9400, draws: 6400, black: 6100 }
      ]
    },
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w": {
      eco: "B20",
      opening: "Sicilian Defense",
      moves: [
        { uci: "g1f3", san: "Nf3", games: 528900, white: 189000, draws: 181000, black: 158900 },
        { uci: "b1c3", san: "Nc3", games: 54100, white: 19500, draws: 18400, black: 16200 },
        { uci: "c2c3", san: "c3", games: 34800, white: 12100, draws: 11900, black: 10800 }
      ]
    },
    "rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b": {
      eco: "B27",
      opening: "Sicilian Defense: King's Knight",
      moves: [
        { uci: "d7d6", san: "d6", games: 241000, white: 87000, draws: 82000, black: 72000 },
        { uci: "b8c6", san: "Nc6", games: 158000, white: 56000, draws: 55000, black: 47000 },
        { uci: "e7e6", san: "e6", games: 119000, white: 42000, draws: 41000, black: 36000 }
      ]
    },
    "rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w": {
      eco: "B50",
      opening: "Sicilian Defense: Modern Variations",
      moves: [
        { uci: "d2d4", san: "d4", games: 215000, white: 78000, draws: 72000, black: 65000 },
        { uci: "f1b5", san: "Bb5+", games: 18400, white: 6300, draws: 7400, black: 4700 },
        { uci: "c2c3", san: "c3", games: 5900, white: 2100, draws: 2100, black: 1700 }
      ]
    },
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w": {
      eco: "C20",
      opening: "King's Pawn Game: Open Game",
      moves: [
        { uci: "g1f3", san: "Nf3", games: 356000, white: 135000, draws: 136000, black: 85000 },
        { uci: "b1c3", san: "Nc3", games: 12100, white: 4500, draws: 4100, black: 3500 },
        { uci: "f1c4", san: "Bc4", games: 9800, white: 3500, draws: 3400, black: 2900 }
      ]
    },
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b": {
      eco: "C40",
      opening: "King's Knight Opening",
      moves: [
        { uci: "b8c6", san: "Nc6", games: 312000, white: 118000, draws: 119000, black: 75000 },
        { uci: "g8f6", san: "Nf6", games: 34800, white: 11900, draws: 15800, black: 7100 },
        { uci: "d7d6", san: "d6", games: 8200, white: 3600, draws: 2700, black: 1900 }
      ]
    },
    "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w": {
      eco: "C44",
      opening: "King's Knight: 2...Nc6",
      moves: [
        { uci: "f1b5", san: "Bb5", games: 198000, white: 74000, draws: 77000, black: 47000 },
        { uci: "f1c4", san: "Bc4", games: 69400, white: 26200, draws: 25100, black: 18100 },
        { uci: "d2d4", san: "d4", games: 34100, white: 13200, draws: 12900, black: 8000 }
      ]
    },
    "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b": {
      eco: "C60",
      opening: "Ruy Lopez",
      moves: [
        { uci: "a7a6", san: "a6", games: 141200, white: 52100, draws: 56200, black: 32900 },
        { uci: "g8f6", san: "Nf6", games: 39400, white: 14200, draws: 16500, black: 8700 },
        { uci: "f8c5", san: "Bc5", games: 6400, white: 2400, draws: 2300, black: 1700 }
      ]
    },
    "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b": {
      eco: "C50",
      opening: "Italian Game",
      moves: [
        { uci: "f8c5", san: "Bc5", games: 39800, white: 15100, draws: 14800, black: 9900 },
        { uci: "g8f6", san: "Nf6", games: 27400, white: 10200, draws: 9800, black: 7400 }
      ]
    },
    "rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w": {
      eco: "C00",
      opening: "French Defense",
      moves: [
        { uci: "d2d4", san: "d4", games: 178500, white: 69800, draws: 59800, black: 48900 },
        { uci: "d2d3", san: "d3", games: 9200, white: 3400, draws: 3100, black: 2700 }
      ]
    },
    "rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w": {
      eco: "B10",
      opening: "Caro-Kann Defense",
      moves: [
        { uci: "d2d4", san: "d4", games: 118400, white: 44600, draws: 41900, black: 31900 },
        { uci: "b1c3", san: "Nc3", games: 12100, white: 4500, draws: 4200, black: 3400 },
        { uci: "c2c4", san: "c4", games: 4300, white: 1600, draws: 1600, black: 1100 }
      ]
    },
    "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w": {
      eco: "A45",
      opening: "Indian Defense",
      moves: [
        { uci: "c2c4", san: "c4", games: 521000, white: 192000, draws: 195000, black: 134000 },
        { uci: "g1f3", san: "Nf3", games: 138000, white: 51000, draws: 50000, black: 37000 },
        { uci: "c1f4", san: "Bf4", games: 24500, white: 9800, draws: 8400, black: 6300 }
      ]
    },
    "rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b": {
      eco: "A50",
      opening: "Indian Defense: 2.c4",
      moves: [
        { uci: "e7e6", san: "e6", games: 256000, white: 93000, draws: 100000, black: 63000 },
        { uci: "g7g6", san: "g6", games: 198000, white: 77000, draws: 68000, black: 53000 },
        { uci: "c7c5", san: "c5", games: 41000, white: 16000, draws: 14000, black: 11000 }
      ]
    },
    "rnbqkb1r/pppp1ppp/4pn2/8/2PP4/8/PP2PPPP/RNBQKBNR w": {
      eco: "E00",
      opening: "Queen's Pawn: East Indian",
      moves: [
        { uci: "g1f3", san: "Nf3", games: 132000, white: 47000, draws: 54000, black: 31000 },
        { uci: "b1c3", san: "Nc3", games: 112000, white: 41000, draws: 43000, black: 28000 },
        { uci: "g2g3", san: "g3", games: 9800, white: 3800, draws: 3900, black: 2100 }
      ]
    },
    "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w": {
      eco: "D00",
      opening: "Queen's Pawn: Closed Game",
      moves: [
        { uci: "c2c4", san: "c4", games: 286000, white: 110000, draws: 112000, black: 64000 },
        { uci: "g1f3", san: "Nf3", games: 44100, white: 16800, draws: 16200, black: 11100 },
        { uci: "c1f4", san: "Bf4", games: 12400, white: 5100, draws: 4200, black: 3100 }
      ]
    },
    "rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b": {
      eco: "D06",
      opening: "Queen's Gambit",
      moves: [
        { uci: "e7e6", san: "e6", games: 139000, white: 53000, draws: 56000, black: 30000 },
        { uci: "c7c6", san: "c6", games: 108000, white: 41000, draws: 44000, black: 23000 },
        { uci: "d5c4", san: "dxc4", games: 27400, white: 11000, draws: 10400, black: 6000 }
      ]
    },
    "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b": {
      eco: "A10",
      opening: "English Opening",
      moves: [
        { uci: "e7e5", san: "e5", games: 94000, white: 35000, draws: 35000, black: 24000 },
        { uci: "g8f6", san: "Nf6", games: 89000, white: 34000, draws: 34000, black: 21000 },
        { uci: "c7c5", san: "c5", games: 52000, white: 19500, draws: 20500, black: 12000 }
      ]
    },
    "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b": {
      eco: "A04",
      opening: "Zukertort / Reti Opening",
      moves: [
        { uci: "d7d5", san: "d5", games: 112000, white: 42000, draws: 44000, black: 26000 },
        { uci: "g8f6", san: "Nf6", games: 108000, white: 40000, draws: 44000, black: 24000 },
        { uci: "c7c5", san: "c5", games: 41000, white: 15500, draws: 15500, black: 10000 }
      ]
    }
  };

  const remoteCache = new Map();
  const MAX_CACHE = 150;

  function fenKey(fen) {
    const parts = (fen || "").trim().split(/\s+/);
    if (parts.length < 2) return "";
    return `${parts[0]} ${parts[1]}`;
  }

  function formatMoveList(rawMoves, sourceLabel) {
    return (rawMoves || []).slice(0, 4).map((m) => {
      const white = Number(m.white || 0);
      const draws = Number(m.draws || 0);
      const black = Number(m.black || 0);
      const games = Number(m.games || (white + draws + black) || 1);
      return {
        uci: m.uci,
        san: m.san || m.uci,
        games,
        whitePct: Math.round((white / Math.max(1, games)) * 100),
        drawPct: Math.round((draws / Math.max(1, games)) * 100),
        blackPct: Math.round((black / Math.max(1, games)) * 100),
        source: sourceLabel
      };
    });
  }

  function lookupBuiltin(fen) {
    const key = fenKey(fen);
    const hit = BUILTIN_MASTER_BOOK[key];
    if (!hit) return null;
    return {
      inBook: true,
      eco: hit.eco,
      opening: hit.opening,
      source: "Master ECO Book",
      moves: formatMoveList(hit.moves, "Master ECO")
    };
  }

  function saveCache(key, data) {
    if (remoteCache.size >= MAX_CACHE) {
      const firstKey = remoteCache.keys().next().value;
      remoteCache.delete(firstKey);
    }
    remoteCache.set(key, data);
  }

  async function fetchLichessMasters(fen) {
    const url = "https://explorer.lichess.ovh/masters?fen=" + encodeURIComponent(fen) + "&moves=4&topGames=0";
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 1800) : null;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) return null;
      const json = await res.json();
      if (!json || !Array.isArray(json.moves) || json.moves.length === 0) {
        return {
          inBook: false,
          eco: json && json.opening ? json.opening.eco || "" : "",
          opening: json && json.opening ? json.opening.name || "" : "",
          source: "Lichess Masters DB",
          moves: []
        };
      }
      return {
        inBook: true,
        eco: json.opening && json.opening.eco ? json.opening.eco : "",
        opening: json.opening && json.opening.name ? json.opening.name : "Master Theory",
        source: "Lichess Masters DB",
        moves: formatMoveList(json.moves, "Masters DB")
      };
    } catch (_) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function lookup(fen, callback) {
    const key = fenKey(fen);
    if (!key) {
      if (callback) callback(null);
      return null;
    }

    const cached = remoteCache.get(key);
    const localHit = lookupBuiltin(fen);
    if (cached) {
      if (callback) callback(cached);
      return cached;
    }

    if (localHit && callback) {
      callback(localHit);
    }

    // Prefer extension background script for CORS-safe network lookup, fall back to direct fetch
    const hasBg =
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.sendMessage === "function";

    if (hasBg) {
      try {
        chrome.runtime.sendMessage({ type: "OPENING_BOOK_LOOKUP", fen }, (resp) => {
          if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.lastError) return;
          if (resp && resp.ok && resp.book) {
            saveCache(key, resp.book);
            if (callback) callback(resp.book);
          }
        });
        return localHit;
      } catch (_) {
      }
    }

    fetchLichessMasters(fen).then((remote) => {
      if (remote && (remote.inBook || !localHit)) {
        saveCache(key, remote);
        if (callback) callback(remote);
      }
    });

    return localHit;
  }

  globalScope.ChessForgeOpeningBook = {
    lookup,
    lookupBuiltin,
    fetchLichessMasters
  };
})(typeof self !== "undefined" ? self : window);
