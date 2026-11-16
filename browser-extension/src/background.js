const DEFAULT_SETTINGS = {
  enabled: true,
  showArrows: true,
  showHud: true,
  showEvalBar: true,
  showAnnotations: true,
  showOpeningBook: true,
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

  if (msg.type === "STOCKFISH_ANALYZE") {
    analyzeWithWasm(msg.fen, msg.config || DEFAULT_SETTINGS)
      .then((resp) => sendResponse(resp || { ok: false, error: "Empty offscreen response" }))
      .catch((err) => sendResponse({ ok: false, error: err ? err.message : "Offscreen unavailable" }));
    return true;
  }
});
