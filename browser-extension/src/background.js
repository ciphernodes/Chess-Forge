const DEFAULT_SETTINGS = {
  enabled: true,
  showArrows: true,
  showHud: true,
  showEvalBar: true,
  showAnnotations: true,
  showOpeningBook: true,
  showTablebase: true,
  autoAdaptTheme: true,
  evalBarOrientation: "vertical",
  multiPv: 2,
  maxDepth: 14,
  skillLevel: 20,
  cpuProfile: "balanced",
  turnOverride: "auto",
  practiceAutoPlay: false,
  practiceHumanDelayMs: 650
};

let engineStatus = {
  status: "LOADING",
  detail: "Initializing Stockfish 19 WASM…",
  backend: "Stockfish 19 WASM"
};

let creatingOffscreen = null;
const bookCache = new Map();
const tablebaseCache = new Map();

async function fetchSyzygyTablebase(fen) {
  const parts = (fen || "").trim().split(/\s+/);
  const key = parts.length >= 4 ? `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]}` : fen;
  if (tablebaseCache.has(key)) return tablebaseCache.get(key);

  const url = `https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2800);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    const json = await res.json();
    const pCount = (parts[0] || "").replace(/[^a-zA-Z]/g, "").length;
    const cat = (json.category || "unknown").toLowerCase();
    const rawMoves = Array.isArray(json.moves) ? json.moves : [];
    const formattedMoves = rawMoves.map((m) => {
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
      return {
        uci: m.uci,
        san: m.san || m.uci,
        oppCategory: oppCat,
        quality: moveQuality,
        annotation,
        dtm: m.dtm !== null && m.dtm !== undefined ? Math.abs(m.dtm) : null,
        dtz: m.dtz !== null && m.dtz !== undefined ? Math.abs(m.dtz) : null,
        checkmate: !!m.checkmate,
        stalemate: !!m.stalemate
      };
    });

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
      return 0;
    });

    const parsed = {
      isTablebase: true,
      pieceCount: pCount,
      turn: parts[1] || "w",
      category: cat,
      outcome: cat === "win" ? "Tablebase Win" : cat === "draw" ? "Tablebase Draw" : "Tablebase Loss",
      scoreBadge: cat === "win" ? (json.dtm ? `+M${Math.abs(json.dtm)}` : "+TB Win") : cat === "draw" ? "TB Draw" : (json.dtm ? `-M${Math.abs(json.dtm)}` : "-TB Loss"),
      dtz: json.dtz !== undefined ? json.dtz : null,
      dtm: json.dtm !== undefined ? json.dtm : null,
      checkmate: !!json.checkmate,
      stalemate: !!json.stalemate,
      source: "Lichess Syzygy 7-Piece",
      moves: formattedMoves
    };

    if (tablebaseCache.size >= 150) {
      tablebaseCache.delete(tablebaseCache.keys().next().value);
    }
    tablebaseCache.set(key, parsed);
    return parsed;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMastersBook(fen) {
  const parts = (fen || "").trim().split(/\s+/);
  const key = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : fen;
  if (bookCache.has(key)) return bookCache.get(key);

  const url = `https://explorer.lichess.ovh/masters?fen=${encodeURIComponent(fen)}&moves=4&topGames=0`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 2200);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal
    });
    if (!res.ok) return null;
    const json = await res.json();
    const moves = Array.isArray(json.moves)
      ? json.moves.slice(0, 4).map((m) => {
          const w = Number(m.white || 0);
          const d = Number(m.draws || 0);
          const b = Number(m.black || 0);
          const g = Number(m.games || (w + d + b) || 1);
          return {
            uci: m.uci,
            san: m.san || m.uci,
            games: g,
            whitePct: Math.round((w / Math.max(1, g)) * 100),
            drawPct: Math.round((d / Math.max(1, g)) * 100),
            blackPct: Math.round((b / Math.max(1, g)) * 100),
            source: "Lichess Masters DB"
          };
        })
      : [];
    const formatted = {
      inBook: moves.length > 0,
      eco: json.opening && json.opening.eco ? json.opening.eco : "",
      opening: json.opening && json.opening.name ? json.opening.name : (moves.length > 0 ? "Master Theory" : ""),
      source: "Lichess Masters DB",
      moves
    };
    if (bookCache.size >= 150) {
      bookCache.delete(bookCache.keys().next().value);
    }
    bookCache.set(key, formatted);
    return formatted;
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error("chrome.offscreen API unavailable");
  }
  const offscreenUrl = chrome.runtime.getURL("src/offscreen.html");
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    if (existing.length > 0) return;
  }
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "src/offscreen.html",
    reasons: ["WORKERS"],
    justification: "Run Stockfish 19 WebAssembly chess engine locally without external servers."
  });
  try {
    await creatingOffscreen;
  } finally {
    creatingOffscreen = null;
  }
}

async function analyzeWithWasm(fen, config) {
  await ensureOffscreenDocument();
  return await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "OFFSCREEN_ANALYZE",
    fen,
    config
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(DEFAULT_SETTINGS, (existing) => {
    chrome.storage.local.set(Object.assign({}, DEFAULT_SETTINGS, existing || {}));
  });
  ensureOffscreenDocument()
    .then(() => chrome.runtime.sendMessage({ target: "offscreen", type: "OFFSCREEN_WARMUP" }))
    .catch(() => {
      engineStatus = {
        status: "IDLE",
        detail: "JS Engine fallback active",
        backend: "Local JS Fallback"
      };
    });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;

  if (msg.target === "background" && msg.type === "ENGINE_STATUS") {
    engineStatus = {
      status: msg.status || "IDLE",
      detail: msg.detail || "",
      backend: msg.backend || "Stockfish 19 WASM"
    };
    chrome.storage.local.set({ engineStatus });
    return;
  }

  if (msg.type === "GET_ENGINE_STATUS") {
    sendResponse(engineStatus);
    return;
  }

  if (msg.type === "OPENING_BOOK_LOOKUP") {
    fetchMastersBook(msg.fen)
      .then((book) => sendResponse({ ok: !!book, book }))
      .catch(() => sendResponse({ ok: false, book: null }));
    return true;
  }

  if (msg.type === "TABLEBASE_LOOKUP") {
    fetchSyzygyTablebase(msg.fen)
      .then((tablebase) => sendResponse({ ok: !!tablebase, tablebase }))
      .catch(() => sendResponse({ ok: false, tablebase: null }));
    return true;
  }

  if (msg.type === "STOCKFISH_ANALYZE") {
    analyzeWithWasm(msg.fen, msg.config || DEFAULT_SETTINGS)
      .then((resp) => sendResponse(resp || { ok: false, error: "Empty offscreen response" }))
      .catch((err) => sendResponse({ ok: false, error: err ? err.message : "Offscreen unavailable" }));
    return true;
  }
});
