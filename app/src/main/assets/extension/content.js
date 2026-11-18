/**
 * Chess Forge Browser Extension Content Script
 * Detects Lichess.org, Chess.com, and offline Practice Board DOM state & color scheme,
 * analyzes positions locally via Stockfish 19 WebAssembly (with JS fallback),
 * looks up Master Opening Book theory, annotates moves (!!, !, !?, ?!, ?, ??),
 * and renders theme-adaptive SVG arrows, badges, Eval Bar, and responsive HUD.
 */
(function () {
  "use strict";

  if (window.__chessForgeContentActive) return;
  window.__chessForgeContentActive = true;

  const DEFAULT_CONFIG = {
    enabled: true,
    showArrows: true,
    showHud: true,
    showEvalBar: true,
    showAnnotations: true,
    showOpeningBook: true,
    showTablebase: true,
    autoAdaptTheme: true,
    evalBarOrientation: "vertical",
    multiPv: 4,
    maxDepth: 14,
    skillLevel: 20,
    cpuProfile: "balanced",
    turnOverride: "auto",
    fairPlayAuditorEnabled: true,
    humanizerEnabled: true,
    targetElo: 1500,
    maxHintsPerGame: 3,
    practiceAutoPlay: false,
    practiceHumanDelayMs: 650,
    autonomousMode: false,
    autonomousEloProfile: 1600
  };

  let config = Object.assign({}, DEFAULT_CONFIG, window.__ChessForgeExtensionConfig || {});
  let lastPlacement = "";
  let lastGrid = null;
  let inferredTurn = "w";
  let lastAnalysis = null;
  let lastPositionObservedAtMs = Date.now();
  let humanizerDelayTimer = null;
  let hintsUsedInGame = 0;
  const shownHintFens = new Set();
  let prevAnalysisForAnnotation = null;
  let prevOpeningBookForAnnotation = null;
  let lastPlayedAnnotation = null; // { sq, uci, symbol, label, color, text, cpLoss, winPctLoss }
  let lastOpeningBook = null;
  let lastTablebase = null;
  let lastBoardTheme = {
    name: "Classic Dark",
    isDark: true,
    hue: "neutral",
    primaryArrow: "rgba(16,185,129,0.94)",
    secondaryArrow: "rgba(245,158,11,0.88)",
    tertiaryArrow: "rgba(56,189,248,0.84)",
    arrowOutline: "rgba(8,12,18,0.92)",
    hudBg: "rgba(13,17,23,0.93)",
    hudBorder: "#10B981",
    hudText: "#E6EDF3",
    boardBorder: "rgba(16,185,129,0.42)"
  };

  let engineStatus = "IDLE";
  let scheduledTimer = null;
  let practiceAutoTimer = null;
  let activeSearchSeq = 0;
  let observer = null;
  let boardResizeObserver = null;
  let observedBoardEl = null;

  let overlayHost = null;
  let svgLayer = null;
  let evalBarEl = null;
  let evalFillEl = null;
  let evalLabelEl = null;
  let hudPill = null;
  let statusDotEl = null;
  let hudTextEl = null;
  let fairPlayPill = null;
  let bookBannerEl = null;
  let tablebaseBannerEl = null;
  let fabPill = null;

  function hasChromeStorage() {
    return typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  }

  function hasChromeRuntime() {
    return typeof chrome !== "undefined" && chrome.runtime && typeof chrome.runtime.sendMessage === "function";
  }

  function loadConfig(cb) {
    if (!hasChromeStorage()) {
      cb();
      return;
    }
    try {
      chrome.storage.local.get(Object.assign({}, DEFAULT_CONFIG, { chessForgeFairPlayWindowV1: null }), (stored) => {
        if (stored && stored.chessForgeFairPlayWindowV1 && Array.isArray(stored.chessForgeFairPlayWindowV1.games)) {
          fairPlayState.windowGames = stored.chessForgeFairPlayWindowV1.games.slice(-20);
        }
        config = Object.assign({}, DEFAULT_CONFIG, stored || {});
        cb();
      });
    } catch (_) {
      cb();
    }
  }

  function parseRgbColor(str) {
    if (!str) return null;
    const m = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) return { r: parseInt(m[1], 10), g: parseInt(m[2], 10), b: parseInt(m[3], 10) };
    const hex = str.match(/#([0-9a-f]{6})/i);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    return null;
  }

  function relativeLuminance(rgb) {
    if (!rgb) return 0.25;
    const srgb = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
      c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  }

  function detectBoardTheme(boardInfo) {
    const defaultTheme = {
      name: "Emerald Slate",
      isDark: true,
      hue: "neutral",
      primaryArrow: "rgba(16,185,129,0.94)",
      secondaryArrow: "rgba(245,158,11,0.88)",
      tertiaryArrow: "rgba(56,189,248,0.84)",
      arrowOutline: "rgba(8,12,18,0.92)",
      hudBg: "rgba(13,17,23,0.93)",
      hudBorder: "#10B981",
      hudText: "#E6EDF3",
      boardBorder: "rgba(16,185,129,0.42)"
    };
    if (!config.autoAdaptTheme || !boardInfo || !boardInfo.boardEl) return defaultTheme;

    try {
      const bodyStyle = getComputedStyle(document.body);
      const bodyRgb = parseRgbColor(bodyStyle.backgroundColor);
      const bodyLum = relativeLuminance(bodyRgb);
      const pageIsDark =
        document.body.classList.contains("dark") ||
        document.body.classList.contains("dark-mode") ||
        document.documentElement.classList.contains("dark") ||
        bodyLum < 0.35;

      // Probe board square samples or class names
      let sampleRgb = null;
      const sampleEl =
        boardInfo.boardEl.querySelector(".sq.dark") ||
        boardInfo.boardEl.querySelector(".square-dark") ||
        boardInfo.boardEl;
      if (sampleEl) {
        sampleRgb = parseRgbColor(getComputedStyle(sampleEl).backgroundColor);
      }

      const clsText = [
        document.body.className || "",
        boardInfo.boardEl.className || "",
        (boardInfo.boardEl.closest(".cg-wrap") || {}).className || ""
      ].join(" ").toLowerCase();

      const boardLum = sampleRgb ? relativeLuminance(sampleRgb) : (pageIsDark ? 0.16 : 0.65);
      const isGreenBoard =
        clsText.includes("green") ||
        (sampleRgb && sampleRgb.g > sampleRgb.r + 18 && sampleRgb.g >= sampleRgb.b);
      const isBlueBoard =
        clsText.includes("blue") ||
        clsText.includes("icy") ||
        (sampleRgb && sampleRgb.b > sampleRgb.r + 20 && sampleRgb.b > sampleRgb.g + 8);
      const isLightBoard = !pageIsDark && boardLum > 0.42;

      if (isGreenBoard) {
        return {
          name: pageIsDark ? "Green • Dark UI" : "Green • Light UI",
          isDark: pageIsDark,
          hue: "green",
          // Use luminous Cyan & Gold so arrows never blend with green squares
          primaryArrow: "rgba(34,211,238,0.96)",
          secondaryArrow: "rgba(250,204,21,0.92)",
          tertiaryArrow: "rgba(244,114,182,0.88)",
          arrowOutline: "rgba(6,10,18,0.94)",
          hudBg: pageIsDark ? "rgba(13,17,23,0.94)" : "rgba(248,250,252,0.96)",
          hudBorder: "#06B6D4",
          hudText: pageIsDark ? "#E6EDF3" : "#0F172A",
          boardBorder: "rgba(34,211,238,0.5)"
        };
      }

      if (isBlueBoard) {
        return {
          name: pageIsDark ? "Blue • Dark UI" : "Blue • Light UI",
          isDark: pageIsDark,
          hue: "blue",
          primaryArrow: "rgba(250,204,21,0.96)",
          secondaryArrow: "rgba(52,211,153,0.92)",
          tertiaryArrow: "rgba(251,146,60,0.88)",
          arrowOutline: "rgba(6,10,18,0.94)",
          hudBg: pageIsDark ? "rgba(13,17,23,0.94)" : "rgba(248,250,252,0.96)",
          hudBorder: "#F59E0B",
          hudText: pageIsDark ? "#E6EDF3" : "#0F172A",
          boardBorder: "rgba(250,204,21,0.5)"
        };
      }

      if (isLightBoard) {
        return {
          name: "Light Contrast",
          isDark: false,
          hue: "light",
          primaryArrow: "rgba(5,150,105,0.95)",
          secondaryArrow: "rgba(217,119,6,0.92)",
          tertiaryArrow: "rgba(37,99,235,0.88)",
          arrowOutline: "rgba(255,255,255,0.92)",
          hudBg: "rgba(248,250,252,0.96)",
          hudBorder: "#059669",
          hudText: "#0F172A",
          boardBorder: "rgba(5,150,105,0.55)"
        };
      }

      return Object.assign({}, defaultTheme, {
        name: pageIsDark ? "Dark Adaptive" : "Warm Adaptive",
        isDark: pageIsDark
      });
    } catch (_) {
      return defaultTheme;
    }
  }

  function readLichessBoard() {
    const boardEl = document.querySelector("cg-board");
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return null;

    const wrap = boardEl.closest(".cg-wrap") || boardEl.parentElement;
    const isFlipped = !!(wrap && wrap.classList.contains("orientation-black"));
    const sqW = rect.width / 8;
    const sqH = rect.height / 8;
    const grid = Array.from({ length: 8 }, () => new Array(8).fill("."));

    const roleMap = { pawn: "p", knight: "n", bishop: "b", rook: "r", queen: "q", king: "k" };
    const pieces = boardEl.querySelectorAll("piece");
    let count = 0;

    for (const piece of pieces) {
      if (piece.classList.contains("ghost") || piece.classList.contains("fading")) continue;
      const isWhite = piece.classList.contains("white");
      const isBlack = piece.classList.contains("black");
      if (!isWhite && !isBlack) continue;

      let typeChar = null;
      for (const role of Object.keys(roleMap)) {
        if (piece.classList.contains(role)) {
          typeChar = roleMap[role];
          break;
        }
      }
      if (!typeChar) continue;

      const pRect = piece.getBoundingClientRect();
      if (pRect.width < 4 || pRect.height < 4) continue;
      const cx = pRect.left + pRect.width / 2 - rect.left;
      const cy = pRect.top + pRect.height / 2 - rect.top;
      const col = Math.floor(cx / sqW);
      const row = Math.floor(cy / sqH);
      if (col < 0 || col > 7 || row < 0 || row > 7) continue;

      const whiteRow = isFlipped ? 7 - row : row;
      const whiteCol = isFlipped ? 7 - col : col;
      grid[whiteRow][whiteCol] = isWhite ? typeChar.toUpperCase() : typeChar;
      count++;
    }

    if (count < 2) return null;

    let detectedTurn = null;
    const moves = document.querySelectorAll("l4x kwdb, rm6 kwdb, .tview2 move");
    if (moves.length > 0) {
      detectedTurn = moves.length % 2 === 0 ? "w" : "b";
    }
    return { boardEl, rect, isFlipped, grid, detectedTurn, isPracticeBoard: false, site: "lichess" };
  }

  function readChessComBoard() {
    const boardEl =
      document.querySelector("wc-chess-board") ||
      document.querySelector("chess-board") ||
      document.querySelector(".board-layout-chessboard .board");
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return null;

    const isFlipped = boardEl.classList.contains("flipped") || !!boardEl.closest(".flipped");
    const grid = Array.from({ length: 8 }, () => new Array(8).fill("."));

    const pieces = boardEl.querySelectorAll(".piece");
    let count = 0;
    for (const piece of pieces) {
      let color = null;
      let type = null;
      let fileNum = -1;
      let rankNum = -1;

      for (const cls of piece.classList) {
        if (/^[wb][pnbrqk]$/.test(cls)) {
          color = cls[0];
          type = cls[1];
        } else if (/^square-(\d)(\d)$/.test(cls)) {
          const m = cls.match(/^square-(\d)(\d)$/);
          fileNum = parseInt(m[1], 10);
          rankNum = parseInt(m[2], 10);
        }
      }
      if (!color || !type) continue;

      if (fileNum < 1 || fileNum > 8 || rankNum < 1 || rankNum > 8) {
        const pRect = piece.getBoundingClientRect();
        if (pRect.width < 4) continue;
        const col = Math.floor((pRect.left + pRect.width / 2 - rect.left) / (rect.width / 8));
        const row = Math.floor((pRect.top + pRect.height / 2 - rect.top) / (rect.height / 8));
        if (col < 0 || col > 7 || row < 0 || row > 7) continue;
        const wRow = isFlipped ? 7 - row : row;
        const wCol = isFlipped ? 7 - col : col;
        grid[wRow][wCol] = color === "w" ? type.toUpperCase() : type;
      } else {
        const wRow = 8 - rankNum;
        const wCol = fileNum - 1;
        grid[wRow][wCol] = color === "w" ? type.toUpperCase() : type;
      }
      count++;
    }

    if (count < 2) return null;

    let detectedTurn = null;
    const halfMoves = document.querySelectorAll("wc-simple-move-list .node, .move-list-wrapper .node");
    if (halfMoves.length > 0) {
      detectedTurn = halfMoves.length % 2 === 0 ? "w" : "b";
    }
    return { boardEl, rect, isFlipped, grid, detectedTurn, isPracticeBoard: false, site: "chesscom" };
  }

  function readCustomPracticeBoard() {
    const boardEl = document.querySelector("[data-chess-forge-board='true']");
    if (!boardEl) return null;
    const rect = boardEl.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 120) return null;

    const isFlipped = boardEl.getAttribute("data-flipped") === "true";
    const grid = Array.from({ length: 8 }, () => new Array(8).fill("."));
    const squares = boardEl.querySelectorAll("[data-square]");
    let count = 0;

    for (const sqEl of squares) {
      const sqName = sqEl.getAttribute("data-square") || "";
      const p = sqEl.getAttribute("data-piece") || "";
      if (sqName.length !== 2 || !p) continue;
      const f = "abcdefgh".indexOf(sqName[0]);
      const r = 8 - parseInt(sqName[1], 10);
      if (f >= 0 && f < 8 && r >= 0 && r < 8) {
        grid[r][f] = p;
        count++;
      }
    }
    if (count < 2) return null;
    const turnAttr = boardEl.getAttribute("data-turn");
    return {
      boardEl,
      rect,
      isFlipped,
      grid,
      detectedTurn: turnAttr === "b" || turnAttr === "w" ? turnAttr : null,
      isPracticeBoard: true,
      site: "practice"
    };
  }

  function readActiveBoard() {
    const board = readLichessBoard() || readChessComBoard() || readCustomPracticeBoard();
    if (board && board.boardEl !== observedBoardEl) {
      observedBoardEl = board.boardEl;
      if (boardResizeObserver) boardResizeObserver.disconnect();
      if (typeof ResizeObserver !== "undefined") {
        boardResizeObserver = new ResizeObserver(() => {
          if (lastAnalysis) {
            const b = readActiveBoard();
            if (b) renderOverlay(b, lastAnalysis.result, lastAnalysis.turn);
          }
        });
        boardResizeObserver.observe(board.boardEl);
      }
    }
    return board;
  }

  function diffPlayedMove(oldGrid, newGrid, movedColor) {
    if (!oldGrid || !newGrid) return null;
    const isMoverPiece = (ch) => {
      if (!ch || ch === ".") return false;
      return movedColor === "w" ? (ch >= "A" && ch <= "Z") : (ch >= "a" && ch <= "z");
    };
    const destCandidates = [];
    const srcCandidates = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const oldCh = oldGrid[r][f];
        const newCh = newGrid[r][f];
        if (oldCh !== newCh) {
          const sq = "abcdefgh"[f] + String(8 - r);
          if (isMoverPiece(newCh)) destCandidates.push(sq);
          if (isMoverPiece(oldCh) && !isMoverPiece(newCh)) srcCandidates.push(sq);
        }
      }
    }
    let toSq = destCandidates[0] || null;
    if (destCandidates.length === 2) {
      const kSq = destCandidates.find((sq) => sq[0] === "g" || sq[0] === "c");
      if (kSq) toSq = kSq;
    }
    let fromSq = srcCandidates[0] || null;
    if (srcCandidates.length === 2) {
      const kFrom = srcCandidates.find((sq) => sq[0] === "e");
      if (kFrom) fromSq = kFrom;
    }
    const uci = fromSq && toSq ? `${fromSq}${toSq}` : null;
    return toSq ? { fromSq, toSq, uci } : null;
  }

  function diffPlayedDestination(oldGrid, newGrid, movedColor) {
    const mv = diffPlayedMove(oldGrid, newGrid, movedColor);
    return mv ? mv.toSq : null;
  }

  function gridToPlacement(grid) {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      let line = "";
      for (let f = 0; f < 8; f++) {
        const ch = grid[r][f];
        if (!ch || ch === ".") {
          empty++;
        } else {
          if (empty > 0) {
            line += empty;
            empty = 0;
          }
          line += ch;
        }
      }
      if (empty > 0) line += empty;
      rows.push(line);
    }
    return rows.join("/");
  }

  function inferCastlingRights(grid) {
    let rights = "";
    if (grid[7][4] === "K") {
      if (grid[7][7] === "R") rights += "K";
      if (grid[7][0] === "R") rights += "Q";
    }
    if (grid[0][4] === "k") {
      if (grid[0][7] === "r") rights += "k";
      if (grid[0][0] === "r") rights += "q";
    }
    return rights || "-";
  }

  function ensureOverlayUi() {
    if (overlayHost && document.body.contains(overlayHost)) return;

    overlayHost = document.createElement("div");
    overlayHost.id = "chess-forge-extension-overlay";
    overlayHost.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2147483640;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";

    svgLayer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgLayer.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;";

    evalBarEl = document.createElement("div");
    evalBarEl.style.cssText =
      "position:fixed;display:none;background:#161B22;border:1.5px solid #30363D;border-radius:8px;overflow:hidden;" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.45);pointer-events:none;";
    evalFillEl = document.createElement("div");
    evalFillEl.style.cssText =
      "position:absolute;background:#F0F6FC;transition:all 240ms cubic-bezier(0.22,1,0.36,1);";
    evalLabelEl = document.createElement("div");
    evalLabelEl.style.cssText =
      "position:relative;z-index:2;width:100%;height:100%;display:flex;align-items:center;justify-content:center;" +
      "font-size:10px;font-weight:800;letter-spacing:-0.2px;text-shadow:0 1px 2px rgba(0,0,0,0.6);";
    evalBarEl.appendChild(evalFillEl);
    evalBarEl.appendChild(evalLabelEl);

    hudPill = document.createElement("div");
    hudPill.style.cssText =
      "position:fixed;display:none;align-items:center;gap:6px;padding:5px 10px;border-radius:12px;" +
      "background:rgba(13,17,23,0.92);border:1.5px solid #10B981;color:#E6EDF3;" +
      "font-size:clamp(10px, 2.7vw, 12px);font-weight:700;max-width:calc(100vw - 16px);" +
      "box-shadow:0 6px 18px rgba(0,0,0,0.45);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    statusDotEl = document.createElement("span");
    statusDotEl.style.cssText = "width:8px;height:8px;border-radius:50%;background:#10B981;display:inline-block;flex-shrink:0;";
    hudTextEl = document.createElement("span");
    hudTextEl.style.cssText = "overflow:hidden;text-overflow:ellipsis;";
    hudPill.appendChild(statusDotEl);
    hudPill.appendChild(hudTextEl);

    bookBannerEl = document.createElement("div");
    bookBannerEl.style.cssText =
      "position:fixed;display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:10px;" +
      "background:rgba(22,27,34,0.92);border:1px solid #30363D;color:#C9D1D9;" +
      "font-size:clamp(10px, 2.4vw, 11px);font-weight:600;max-width:calc(100vw - 20px);" +
      "box-shadow:0 4px 12px rgba(0,0,0,0.35);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    tablebaseBannerEl = document.createElement("div");
    tablebaseBannerEl.style.cssText =
      "position:fixed;display:none;align-items:center;gap:6px;padding:4px 10px;border-radius:10px;" +
      "background:rgba(22,27,34,0.94);border:1.5px solid #F59E0B;color:#FEF3C7;" +
      "font-size:clamp(10px, 2.4vw, 11px);font-weight:700;max-width:calc(100vw - 20px);" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.45);pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    fabPill = document.createElement("div");
    fabPill.style.cssText =
      "position:fixed;right:10px;bottom:12px;display:flex;align-items:center;gap:6px;padding:5px 8px;" +
      "border-radius:999px;background:rgba(22,27,34,0.94);border:1.5px solid #10B981;color:#E6EDF3;" +
      "font-size:11px;font-weight:700;box-shadow:0 6px 18px rgba(0,0,0,0.45);pointer-events:auto;cursor:pointer;user-select:none;";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = config.enabled ? "CF: ON" : "CF: OFF";
    toggleBtn.style.cssText =
      "background:#10B981;color:#042F2E;border:none;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:800;cursor:pointer;min-height:32px;";
    toggleBtn.addEventListener("click", () => {
      config.enabled = !config.enabled;
      toggleBtn.textContent = config.enabled ? "CF: ON" : "CF: OFF";
      toggleBtn.style.background = config.enabled ? "#10B981" : "#30363D";
      toggleBtn.style.color = config.enabled ? "#042F2E" : "#9CA3AF";
      if (hasChromeStorage()) chrome.storage.local.set({ enabled: config.enabled });
      if (!config.enabled) clearOverlayVisuals();
      else runAnalysis(true);
    });

    const sideBtn = document.createElement("button");
    sideBtn.type = "button";
    sideBtn.textContent =
      config.turnOverride === "auto" ? "Auto" : config.turnOverride === "w" ? "White" : "Black";
    sideBtn.style.cssText =
      "background:#21262D;color:#E6EDF3;border:1px solid #30363D;border-radius:999px;padding:6px 9px;font-size:11px;font-weight:600;cursor:pointer;min-height:32px;";
    sideBtn.addEventListener("click", () => {
      config.turnOverride =
        config.turnOverride === "auto" ? "w" : config.turnOverride === "w" ? "b" : "auto";
      sideBtn.textContent =
        config.turnOverride === "auto" ? "Auto" : config.turnOverride === "w" ? "White" : "Black";
      if (hasChromeStorage()) chrome.storage.local.set({ turnOverride: config.turnOverride });
      runAnalysis(true);
    });

    fairPlayPill = document.createElement("div");
    fairPlayPill.style.cssText =
      "position:fixed;left:10px;bottom:12px;display:none;align-items:center;gap:6px;padding:4px 10px;" +
      "border-radius:999px;background:rgba(13,17,23,0.94);border:1.5px solid #10B981;color:#E6EDF3;" +
      "font-size:10px;font-weight:800;box-shadow:0 4px 14px rgba(0,0,0,0.45);pointer-events:none;";

    fabPill.appendChild(toggleBtn);
    fabPill.appendChild(sideBtn);
    overlayHost.appendChild(svgLayer);
    overlayHost.appendChild(evalBarEl);
    overlayHost.appendChild(hudPill);
    overlayHost.appendChild(bookBannerEl);
    overlayHost.appendChild(tablebaseBannerEl);
    overlayHost.appendChild(fairPlayPill);
    overlayHost.appendChild(fabPill);
    document.body.appendChild(overlayHost);
  }

  function clearOverlayVisuals() {
    if (svgLayer) svgLayer.innerHTML = "";
    if (hudPill) hudPill.style.display = "none";
    if (bookBannerEl) bookBannerEl.style.display = "none";
    if (tablebaseBannerEl) tablebaseBannerEl.style.display = "none";
    if (evalBarEl) evalBarEl.style.display = "none";
  }

  function setStatus(nextStatus) {
    engineStatus = nextStatus;
    if (!statusDotEl) return;
    const colorMap = {
      LOADING: "#F59E0B",
      CALCULATING: "#38BDF8",
      IDLE: "#10B981",
      ERROR: "#EF4444"
    };
    statusDotEl.style.background = colorMap[nextStatus] || "#10B981";
  }

  function toWhitePerspective(line, turn) {
    const sign = turn === "b" ? -1 : 1;
    const whiteMate = line.mate !== null && line.mate !== undefined ? line.mate * sign : null;
    const whiteCp = line.centipawns !== null && line.centipawns !== undefined ? line.centipawns * sign : null;
    const whiteWinPct =
      whiteMate !== null
        ? (whiteMate > 0 ? 99.9 : 0.1)
        : (turn === "b" ? 100 - (line.winPct || 50) : (line.winPct || 50));
    return { whiteMate, whiteCp, whiteWinPct };
  }

  function scoreToComparableCp(line) {
    if (!line) return 0;
    if (line.mate !== null && line.mate !== undefined) {
      return line.mate > 0 ? (10000 - Math.abs(line.mate) * 10) : (-10000 + Math.abs(line.mate) * 10);
    }
    return line.centipawns || 0;
  }

  function whiteComparableCp(whiteMate, whiteCp) {
    if (whiteMate !== null && whiteMate !== undefined) {
      return whiteMate > 0 ? (10000 - Math.abs(whiteMate) * 10) : (-10000 + Math.abs(whiteMate) * 10);
    }
    return whiteCp || 0;
  }

  function cpToWinPct(cp) {
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
  }

  function fenMaterialBalance(fen, color) {
    if (!fen) return 0;
    const placement = fen.trim().split(/\s+/)[0] || "";
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9 };
    let wMat = 0;
    let bMat = 0;
    for (let i = 0; i < placement.length; i++) {
      const ch = placement[i];
      const lower = ch.toLowerCase();
      const v = values[lower] || 0;
      if (!v) continue;
      if (ch >= "A" && ch <= "Z") wMat += v;
      else bMat += v;
    }
    return color === "w" ? (wMat - bMat) : (bMat - wMat);
  }

  // Chess.com Game Review Move Classifications & Palette
  function annotationStyle(symbol) {
    switch (symbol) {
      case "!!": return { label: "Brilliant", color: "#1BACA6", text: "#FFFFFF", glyph: "!!" };
      case "!": return { label: "Great", color: "#5C8BB0", text: "#FFFFFF", glyph: "!" };
      case "★": return { label: "Best", color: "#81B64C", text: "#FFFFFF", glyph: "star" };
      case "+": return { label: "Excellent", color: "#96BC4B", text: "#042F2E", glyph: "+" };
      case "✓": return { label: "Good", color: "#95B776", text: "#042F2E", glyph: "check" };
      case "Book": return { label: "Book", color: "#A88865", text: "#FFFFFF", glyph: "book" };
      case "?!": return { label: "Inaccuracy", color: "#F7C631", text: "#451A03", glyph: "?!" };
      case "?": return { label: "Mistake", color: "#E6912C", text: "#FFFFFF", glyph: "?" };
      case "✕": return { label: "Miss", color: "#FF7769", text: "#FFFFFF", glyph: "miss" };
      case "??": return { label: "Blunder", color: "#CA3431", text: "#FFFFFF", glyph: "??" };
      // Legacy fallback mappings
      case "!?": return { label: "Excellent", color: "#96BC4B", text: "#042F2E", glyph: "+" };
      default: return null;
    }
  }

  function classifyCandidateAnnotations(lines, openingBook) {
    if (!lines || lines.length === 0) return lines;
    const topCp = scoreToComparableCp(lines[0]);
    const topWinPct = lines[0].winPct !== undefined ? lines[0].winPct : cpToWinPct(topCp);
    const secondCp = lines.length > 1 ? scoreToComparableCp(lines[1]) : null;
    const secondWinPct = lines.length > 1
      ? (lines[1].winPct !== undefined ? lines[1].winPct : cpToWinPct(secondCp))
      : null;

    const bookUcis = new Set(
      (openingBook && Array.isArray(openingBook.moves))
        ? openingBook.moves.map((m) => (m.uci || "").slice(0, 4))
        : []
    );

    return lines.map((line, idx) => {
      let annotation = "";
      const uci4 = (line.uci || "").slice(0, 4);
      const isBookMove = bookUcis.has(uci4);

      if (idx === 0) {
        const cpGap = secondCp !== null ? topCp - secondCp : 0;
        const winGap = secondWinPct !== null ? topWinPct - secondWinPct : 0;
        if ((line.mate !== null && line.mate > 0 && Math.abs(line.mate) <= 5) || winGap >= 18) {
          annotation = "!!";
        } else if (winGap >= 10 || cpGap >= 140) {
          annotation = "!";
        } else if (isBookMove) {
          annotation = "Book";
        } else {
          annotation = "★";
        }
      } else {
        const dropCp = topCp - scoreToComparableCp(line);
        const lineWinPct = line.winPct !== undefined ? line.winPct : cpToWinPct(scoreToComparableCp(line));
        const dropWin = Math.max(0, topWinPct - lineWinPct);
        if (isBookMove && dropWin <= 3.5) annotation = "Book";
        else if (dropWin <= 2.0 || dropCp <= 20) annotation = "+";
        else if (dropWin <= 5.0 || dropCp <= 45) annotation = "✓";
        else if (dropWin <= 10.0 || dropCp <= 105) annotation = "?!";
        else if (dropWin <= 20.0 || dropCp <= 240) annotation = "?";
        else annotation = "??";
      }
      return Object.assign({}, line, { annotation });
    });
  }

  function evaluatePlayedMoveAnnotation(prev, prevBook, currFen, currTurn, currLines, playedMove) {
    if (!prev || !currLines || currLines.length === 0 || !playedMove || !playedMove.toSq) return null;
    const top = currLines[0];
    const currWhiteCp = whiteComparableCp(top.whiteMate, top.whiteCp);
    const prevTop = prev.result && prev.result.lines && prev.result.lines[0];
    if (!prevTop) return null;

    const prevSecond = prev.result && prev.result.lines && prev.result.lines[1];
    const prevWhiteCp = whiteComparableCp(prevTop.whiteMate, prevTop.whiteCp);
    const prevMoverCp = prev.turn === "w" ? prevWhiteCp : -prevWhiteCp;
    const currMoverCp = prev.turn === "w" ? currWhiteCp : -currWhiteCp;

    const prevMoverWinPct = cpToWinPct(prevMoverCp);
    const currMoverWinPct = cpToWinPct(currMoverCp);
    const cpLoss = Math.max(0, prevMoverCp - currMoverCp);
    const winPctLoss = Math.max(0, prevMoverWinPct - currMoverWinPct);

    const playedUci4 = (playedMove.uci || "").slice(0, 4);
    const prevTopUci4 = (prevTop.uci || "").slice(0, 4);
    const matchedEngineTop = playedUci4 && prevTopUci4 && playedUci4 === prevTopUci4;

    const inBook = Boolean(
      prevBook &&
      Array.isArray(prevBook.moves) &&
      prevBook.moves.some((m) => (m.uci || "").slice(0, 4) === playedUci4)
    );

    // Detect material sacrifice for Chess.com-style Brilliant (!!)
    const prevMat = fenMaterialBalance(prev.fen, prev.turn);
    const currMat = fenMaterialBalance(currFen, prev.turn);
    const sacrificedMaterial = (prevMat - currMat) >= 2; // Offered at least a minor/exchange/2 pawns

    // Gap to #2 move for Great (!)
    const secondWhiteCp = prevSecond ? whiteComparableCp(prevSecond.whiteMate, prevSecond.whiteCp) : null;
    const secondMoverCp = secondWhiteCp !== null ? (prev.turn === "w" ? secondWhiteCp : -secondWhiteCp) : null;
    const winGapOverSecond = secondMoverCp !== null ? (prevMoverWinPct - cpToWinPct(secondMoverCp)) : 0;

    let symbol = null;
    if (inBook && winPctLoss <= 4.0) {
      symbol = "Book";
    } else if ((matchedEngineTop || winPctLoss <= 1.2) && sacrificedMaterial && currMoverWinPct >= 58 && prevMoverCp < 900) {
      symbol = "!!";
    } else if ((matchedEngineTop || winPctLoss <= 1.0) && (winGapOverSecond >= 11 || (currMoverWinPct >= 62 && prevMoverWinPct <= 52))) {
      symbol = "!";
    } else if (matchedEngineTop || winPctLoss <= 0.6) {
      symbol = "★";
    } else if (prevMoverWinPct >= 74 && winPctLoss >= 12 && currMoverWinPct >= 42 && currMoverWinPct < 62) {
      // Missed a clear winning opportunity without blundering into a lost position
      symbol = "✕";
    } else if (winPctLoss <= 2.2 && cpLoss <= 25) {
      symbol = "+";
    } else if (winPctLoss <= 5.2 && cpLoss <= 55) {
      symbol = "✓";
    } else if (winPctLoss <= 10.5 && cpLoss <= 115) {
      symbol = "?!";
    } else if (winPctLoss <= 20.5 && cpLoss <= 245) {
      symbol = "?";
    } else {
      symbol = "??";
    }

    const style = annotationStyle(symbol);
    if (!style) return null;
    return {
      sq: playedMove.toSq,
      uci: playedMove.uci || "",
      symbol,
      label: style.label,
      color: style.color,
      text: style.text,
      glyph: style.glyph,
      cpLoss: Math.round(cpLoss),
      winPctLoss: Math.round(winPctLoss * 10) / 10
    };
  }

  function formatEvalText(whiteMate, whiteCp) {
    if (whiteMate !== null) {
      return (whiteMate > 0 ? "+M" : "-M") + Math.abs(whiteMate);
    }
    if (whiteCp !== null) {
      const pawns = whiteCp / 100;
      return pawns >= 0 ? `+${pawns.toFixed(1)}` : pawns.toFixed(1);
    }
    return "0.0";
  }

  function uciSquareToScreenCenter(sq, rect, isFlipped) {
    const file = "abcdefgh".indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    if (file < 0 || Number.isNaN(rank)) return null;
    const whiteCol = file;
    const whiteRow = 8 - rank;
    const viewCol = isFlipped ? 7 - whiteCol : whiteCol;
    const viewRow = isFlipped ? 7 - whiteRow : whiteRow;
    const cellW = rect.width / 8;
    const cellH = rect.height / 8;
    return {
      x: rect.left + (viewCol + 0.5) * cellW,
      y: rect.top + (viewRow + 0.5) * cellH,
      cellW,
      sqLeft: rect.left + viewCol * cellW,
      sqTop: rect.top + viewRow * cellH
    };
  }

  function renderEvalBar(rect, topLine, turn) {
    if (!evalBarEl || !config.showEvalBar || !topLine) {
      if (evalBarEl) evalBarEl.style.display = "none";
      return;
    }

    const { whiteMate, whiteCp, whiteWinPct } = toWhitePerspective(topLine, turn);
    const pct = Math.max(4, Math.min(96, whiteWinPct));
    const scoreText = formatEvalText(whiteMate, whiteCp);
    const isHorizontal = config.evalBarOrientation === "horizontal" || rect.left < 22;

    evalBarEl.style.display = "block";
    evalBarEl.style.borderColor = lastBoardTheme.hudBorder;
    if (isHorizontal) {
      const barW = Math.min(rect.width, window.innerWidth - 16);
      const barTop = Math.max(4, rect.top - 20);
      evalBarEl.style.left = `${Math.max(8, rect.left)}px`;
      evalBarEl.style.top = `${barTop}px`;
      evalBarEl.style.width = `${barW}px`;
      evalBarEl.style.height = "16px";
      evalFillEl.style.left = "0";
      evalFillEl.style.top = "0";
      evalFillEl.style.bottom = "0";
      evalFillEl.style.width = `${pct.toFixed(1)}%`;
      evalFillEl.style.height = "100%";
    } else {
      const barLeft = Math.max(4, rect.left - 24);
      evalBarEl.style.left = `${barLeft}px`;
      evalBarEl.style.top = `${rect.top}px`;
      evalBarEl.style.width = "18px";
      evalBarEl.style.height = `${rect.height}px`;
      evalFillEl.style.left = "0";
      evalFillEl.style.right = "0";
      evalFillEl.style.bottom = "0";
      evalFillEl.style.top = "auto";
      evalFillEl.style.width = "100%";
      evalFillEl.style.height = `${pct.toFixed(1)}%`;
    }

    evalLabelEl.textContent = scoreText;
    evalLabelEl.style.color = pct >= 55 ? "#0D1117" : "#F0F6FC";
  }

  function drawAnnotationBadgeSvg(pt, symbol, style, highlightSquare) {
    const r = Math.max(9, Math.min(14, pt.cellW * 0.22));
    const bx = pt.sqLeft + pt.cellW - r * 0.85;
    const by = pt.sqTop + r * 0.85;

    if (highlightSquare) {
      const sqRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      sqRect.setAttribute("x", pt.sqLeft.toFixed(1));
      sqRect.setAttribute("y", pt.sqTop.toFixed(1));
      sqRect.setAttribute("width", pt.cellW.toFixed(1));
      sqRect.setAttribute("height", pt.cellW.toFixed(1));
      sqRect.setAttribute("fill", style.color);
      sqRect.setAttribute("fill-opacity", "0.22");
      svgLayer.appendChild(sqRect);
    }

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    // Soft drop shadow just like Chess.com Game Review badges
    const shadow = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    shadow.setAttribute("cx", bx.toFixed(1));
    shadow.setAttribute("cy", (by + 1.4).toFixed(1));
    shadow.setAttribute("r", r.toFixed(1));
    shadow.setAttribute("fill", "rgba(0,0,0,0.42)");
    g.appendChild(shadow);

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", bx.toFixed(1));
    circle.setAttribute("cy", by.toFixed(1));
    circle.setAttribute("r", r.toFixed(1));
    circle.setAttribute("fill", style.color);
    circle.setAttribute("stroke", "#FFFFFF");
    circle.setAttribute("stroke-opacity", "0.85");
    circle.setAttribute("stroke-width", "1.4");
    g.appendChild(circle);

    const glyph = style.glyph || symbol;
    if (glyph === "star") {
      // Crisp 5-point Chess.com Best Move Star
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r * 0.62 : r * 0.27;
        pts.push(`${(bx + Math.cos(ang) * rad).toFixed(1)},${(by + Math.sin(ang) * rad).toFixed(1)}`);
      }
      const star = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      star.setAttribute("points", pts.join(" "));
      star.setAttribute("fill", style.text);
      g.appendChild(star);
    } else if (glyph === "book") {
      // Open book silhouette for Book moves
      const s = r * 0.52;
      const bookPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      bookPath.setAttribute(
        "d",
        `M${(bx - s).toFixed(1)},${(by - s * 0.7).toFixed(1)} ` +
        `Q${(bx - s * 0.4).toFixed(1)},${(by - s * 0.9).toFixed(1)} ${bx.toFixed(1)},${(by - s * 0.5).toFixed(1)} ` +
        `Q${(bx + s * 0.4).toFixed(1)},${(by - s * 0.9).toFixed(1)} ${(bx + s).toFixed(1)},${(by - s * 0.7).toFixed(1)} ` +
        `L${(bx + s).toFixed(1)},${(by + s * 0.7).toFixed(1)} ` +
        `Q${(bx + s * 0.4).toFixed(1)},${(by + s * 0.5).toFixed(1)} ${bx.toFixed(1)},${(by + s * 0.85).toFixed(1)} ` +
        `Q${(bx - s * 0.4).toFixed(1)},${(by + s * 0.5).toFixed(1)} ${(bx - s).toFixed(1)},${(by + s * 0.7).toFixed(1)} Z`
      );
      bookPath.setAttribute("fill", style.text);
      g.appendChild(bookPath);
    } else if (glyph === "miss") {
      const d = r * 0.44;
      const cross = document.createElementNS("http://www.w3.org/2000/svg", "path");
      cross.setAttribute(
        "d",
        `M${(bx - d).toFixed(1)},${(by - d).toFixed(1)} L${(bx + d).toFixed(1)},${(by + d).toFixed(1)} ` +
        `M${(bx + d).toFixed(1)},${(by - d).toFixed(1)} L${(bx - d).toFixed(1)},${(by + d).toFixed(1)}`
      );
      cross.setAttribute("stroke", style.text);
      cross.setAttribute("stroke-width", Math.max(2, r * 0.24).toFixed(1));
      cross.setAttribute("stroke-linecap", "round");
      g.appendChild(cross);
    } else if (glyph === "check") {
      const d = r * 0.48;
      const chk = document.createElementNS("http://www.w3.org/2000/svg", "path");
      chk.setAttribute(
        "d",
        `M${(bx - d * 0.85).toFixed(1)},${(by + d * 0.05).toFixed(1)} ` +
        `L${(bx - d * 0.15).toFixed(1)},${(by + d * 0.72).toFixed(1)} ` +
        `L${(bx + d * 0.9).toFixed(1)},${(by - d * 0.62).toFixed(1)}`
      );
      chk.setAttribute("fill", "none");
      chk.setAttribute("stroke", style.text);
      chk.setAttribute("stroke-width", Math.max(2, r * 0.24).toFixed(1));
      chk.setAttribute("stroke-linecap", "round");
      chk.setAttribute("stroke-linejoin", "round");
      g.appendChild(chk);
    } else {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", bx.toFixed(1));
      text.setAttribute("y", (by + r * 0.36).toFixed(1));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("fill", style.text);
      text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
      text.setAttribute("font-size", Math.max(9, Math.round(symbol.length > 1 ? r * 0.96 : r * 1.18)));
      text.setAttribute("font-weight", "900");
      text.textContent = symbol;
      g.appendChild(text);
    }

    svgLayer.appendChild(g);
  }

  function renderOverlay(boardInfo, analysis, turn) {
    ensureOverlayUi();
    if (!config.enabled || !boardInfo || !analysis || !analysis.lines || analysis.lines.length === 0) {
      clearOverlayVisuals();
      return;
    }

    lastBoardTheme = detectBoardTheme(boardInfo);
    const { rect, isFlipped } = boardInfo;
    svgLayer.innerHTML = "";

    // Subtle theme-adaptive board frame
    const border = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    border.setAttribute("x", rect.left.toFixed(1));
    border.setAttribute("y", rect.top.toFixed(1));
    border.setAttribute("width", rect.width.toFixed(1));
    border.setAttribute("height", rect.height.toFixed(1));
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", lastBoardTheme.boardBorder);
    border.setAttribute("stroke-width", "2");
    svgLayer.appendChild(border);

    // SVG Multi-PV arrows injected into DOM over board
    if (config.showArrows) {
      const sorted = analysis.lines.slice().sort((a, b) => b.rank - a.rank);
      for (const line of sorted) {
        const fromPt = uciSquareToScreenCenter(line.uci.slice(0, 2), rect, isFlipped);
        const toPt = uciSquareToScreenCenter(line.uci.slice(2, 4), rect, isFlipped);
        if (!fromPt || !toPt) continue;
        drawArrowSvg(line, fromPt, toPt);
      }
    }

    const top = analysis.lines[0];

    // Chess.com-style Move Annotations on board squares (last played move + top engine recommendation)
    if (config.showAnnotations) {
      if (lastPlayedAnnotation && lastPlayedAnnotation.sq) {
        const playedDest = uciSquareToScreenCenter(lastPlayedAnnotation.sq, rect, isFlipped);
        if (playedDest) {
          drawAnnotationBadgeSvg(playedDest, lastPlayedAnnotation.symbol, lastPlayedAnnotation, true);
        }
      }
      const topDest = uciSquareToScreenCenter(top.uci.slice(2, 4), rect, isFlipped);
      if (topDest && top.annotation && (!lastPlayedAnnotation || lastPlayedAnnotation.sq !== top.uci.slice(2, 4))) {
        const st = annotationStyle(top.annotation);
        if (st) drawAnnotationBadgeSvg(topDest, top.annotation, st, false);
      }
    }

    renderEvalBar(rect, top, turn);

    if (config.showHud) {
      const { whiteMate, whiteCp } = toWhitePerspective(top, turn);
      const scoreLabel = formatEvalText(whiteMate, whiteCp);
      const alt = analysis.lines[1] ? ` | #2 ${analysis.lines[1].san}` : "";
      const backendTag = analysis.engineBackend && analysis.engineBackend.includes("WASM") ? "SF19" : "JS";
      const annTag = top.annotation ? top.annotation : "";
      hudTextEl.textContent = `${backendTag} • ${top.san}${annTag} ${scoreLabel} • D${top.depth}${alt}`;
      hudPill.style.background = lastBoardTheme.hudBg;
      hudPill.style.color = lastBoardTheme.hudText;
      hudPill.style.borderColor =
        engineStatus === "CALCULATING" ? "#38BDF8" : lastBoardTheme.hudBorder;
      const hudOffset = (config.showEvalBar && (config.evalBarOrientation === "horizontal" || rect.left < 22)) ? 54 : 36;
      const topPos = Math.max(6, rect.top - hudOffset);
      const centerX = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2));
      hudPill.style.left = `${centerX}px`;
      hudPill.style.top = `${topPos}px`;
      hudPill.style.transform = "translateX(-50%)";
      hudPill.style.display = "flex";
    } else {
      hudPill.style.display = "none";
    }

    if (config.showOpeningBook && lastOpeningBook && (lastOpeningBook.opening || (lastOpeningBook.moves && lastOpeningBook.moves.length > 0))) {
      const topBook = lastOpeningBook.moves && lastOpeningBook.moves[0]
        ? ` • Book: ${lastOpeningBook.moves.slice(0, 2).map((m) => m.san).join(", ")}`
        : "";
      bookBannerEl.textContent = `${lastOpeningBook.eco ? lastOpeningBook.eco + " " : ""}${lastOpeningBook.opening || "Master Book"}${topBook}`;
      bookBannerEl.style.background = lastBoardTheme.hudBg;
      bookBannerEl.style.color = lastBoardTheme.hudText;
      bookBannerEl.style.borderColor = lastBoardTheme.hudBorder;
      const bottomY = Math.min(window.innerHeight - 54, rect.bottom + 8);
      const centerX = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2));
      bookBannerEl.style.left = `${centerX}px`;
      bookBannerEl.style.top = `${bottomY}px`;
      bookBannerEl.style.transform = "translateX(-50%)";
      bookBannerEl.style.display = "flex";
    } else {
      bookBannerEl.style.display = "none";
    }

    if (config.showTablebase && lastTablebase && lastTablebase.isTablebase) {
      const bestMove = lastTablebase.moves && lastTablebase.moves[0]
        ? ` • Best: ${lastTablebase.moves[0].san} (${lastTablebase.moves[0].uci})`
        : "";
      tablebaseBannerEl.textContent = `Syzygy 7-Piece • ${lastTablebase.outcome} ${lastTablebase.scoreBadge}${bestMove}`;
      tablebaseBannerEl.style.background = lastBoardTheme.hudBg;
      tablebaseBannerEl.style.borderColor =
        lastTablebase.category === "win" ? "#10B981" : (lastTablebase.category === "loss" ? "#EF4444" : "#F59E0B");
      tablebaseBannerEl.style.color =
        lastTablebase.category === "win" ? "#A7F3D0" : (lastTablebase.category === "loss" ? "#FCA5A5" : "#FEF3C7");
      const bottomY = Math.min(
        window.innerHeight - 54,
        rect.bottom + (bookBannerEl && bookBannerEl.style.display !== "none" ? 36 : 8)
      );
      const centerX = Math.max(120, Math.min(window.innerWidth - 120, rect.left + rect.width / 2));
      tablebaseBannerEl.style.left = `${centerX}px`;
      tablebaseBannerEl.style.top = `${bottomY}px`;
      tablebaseBannerEl.style.transform = "translateX(-50%)";
      tablebaseBannerEl.style.display = "flex";
    } else {
      tablebaseBannerEl.style.display = "none";
    }

    if (fabPill) {
      fabPill.style.borderColor = lastBoardTheme.hudBorder;
    }
  }

  function drawArrowSvg(line, fromPt, toPt) {
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) return;

    const color =
      line.rank === 1
        ? lastBoardTheme.primaryArrow
        : line.rank === 2
        ? lastBoardTheme.secondaryArrow
        : lastBoardTheme.tertiaryArrow;

    const strokeW = Math.max(4, Math.min(13, fromPt.cellW * (line.rank === 1 ? 0.17 : line.rank === 2 ? 0.12 : 0.09)));
    const headLen = strokeW * 2.2;
    const headWid = strokeW * 1.85;
    const angle = Math.atan2(dy, dx);
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const sx = fromPt.x + cosA * (fromPt.cellW * 0.12);
    const sy = fromPt.y + sinA * (fromPt.cellW * 0.12);
    const ex = toPt.x - cosA * (headLen * 0.72);
    const ey = toPt.y - sinA * (headLen * 0.72);

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");

    if (line.rank === 1) {
      const destRing = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      destRing.setAttribute("x", (toPt.sqLeft + 2).toFixed(1));
      destRing.setAttribute("y", (toPt.sqTop + 2).toFixed(1));
      destRing.setAttribute("width", Math.max(8, toPt.cellW - 4).toFixed(1));
      destRing.setAttribute("height", Math.max(8, toPt.cellW - 4).toFixed(1));
      destRing.setAttribute("rx", "4");
      destRing.setAttribute("fill", "none");
      destRing.setAttribute("stroke", color);
      destRing.setAttribute("stroke-width", "2.2");
      destRing.setAttribute("stroke-opacity", "0.75");
      g.appendChild(destRing);
    }

    const outline = document.createElementNS("http://www.w3.org/2000/svg", "line");
    outline.setAttribute("x1", sx);
    outline.setAttribute("y1", sy);
    outline.setAttribute("x2", ex);
    outline.setAttribute("y2", ey);
    outline.setAttribute("stroke", lastBoardTheme.arrowOutline);
    outline.setAttribute("stroke-width", strokeW + 3.5);
    outline.setAttribute("stroke-linecap", "round");
    g.appendChild(outline);

    const shaft = document.createElementNS("http://www.w3.org/2000/svg", "line");
    shaft.setAttribute("x1", sx);
    shaft.setAttribute("y1", sy);
    shaft.setAttribute("x2", ex);
    shaft.setAttribute("y2", ey);
    shaft.setAttribute("stroke", color);
    shaft.setAttribute("stroke-width", strokeW);
    shaft.setAttribute("stroke-linecap", "round");
    g.appendChild(shaft);

    const baseX = toPt.x - cosA * headLen;
    const baseY = toPt.y - sinA * headLen;
    const perpX = -sinA * headWid;
    const perpY = cosA * headWid;

    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    head.setAttribute(
      "points",
      `${toPt.x},${toPt.y} ${baseX + perpX},${baseY + perpY} ${baseX - perpX},${baseY - perpY}`
    );
    head.setAttribute("fill", color);
    head.setAttribute("stroke", lastBoardTheme.arrowOutline);
    head.setAttribute("stroke-width", "1.6");
    g.appendChild(head);

    svgLayer.appendChild(g);
  }

  function enrichResult(fen, turn, result) {
    if (!result || !Array.isArray(result.lines)) return result;
    const mapped = result.lines.map((line) => {
      const san =
        window.ChessForgeEngine && typeof window.ChessForgeEngine.uciToSan === "function"
          ? window.ChessForgeEngine.uciToSan(fen, line.uci)
          : (line.san || line.uci);
      const { whiteMate, whiteCp, whiteWinPct } = toWhitePerspective(line, turn);
      return Object.assign({}, line, { san, whiteMate, whiteCp, whiteWinPct });
    });
    result.lines = classifyCandidateAnnotations(mapped, lastOpeningBook);
    return result;
  }

  function fallbackBudget() {
    const profile = config.cpuProfile || "balanced";
    if (profile === "eco") return { depth: Math.min(config.maxDepth || 3, 3), moveTimeMs: 200 };
    if (profile === "turbo") return { depth: Math.min(config.maxDepth || 6, 6), moveTimeMs: 550 };
    return { depth: Math.min(config.maxDepth || 4, 4), moveTimeMs: 320 };
  }

  function runFallbackJsAnalysis(fen, turn) {
    if (!window.ChessForgeEngine) return null;
    const budget = fallbackBudget();
    const raw = window.ChessForgeEngine.analyzePosition(fen, {
      multiPv: config.multiPv,
      maxDepth: budget.depth,
      moveTimeMs: budget.moveTimeMs
    });
    return enrichResult(fen, turn, raw);
  }

  // --- HumanizerController & FairPlayAuditor Runtime Bridge ---
  const FAIR_PLAY_KEY = "chessForgeFairPlayWindowV1";
  const fairPlayState = {
    windowGames: [],
    currentMoves: [],
    lockedOut: false,
    lockoutReason: null,
    lastSnapshot: {
      riskLevel: "SAFE",
      lockedOut: false,
      lockoutReason: null,
      baselineElo: 1500,
      observedIpr: 1500,
      sigmaIpr: 235,
      zScore: 0,
      currentGameMoves: 0,
      currentGameSiSpikes: 0,
      slidingWindowGames: 0,
      acpl: 0,
      stdcpl: 0,
      meanPartialCredit: 0.59,
      moveTimeMeanMs: 0,
      moveTimeCv: 0.45,
      sub15sMoves: 0,
      sub15sAccuracy: 0,
      warnings: []
    }
  };

  function parseClockTextMs(raw) {
    if (!raw) return null;
    const clean = String(raw).replace(/\s+/g, "").trim();
    if (!clean) return null;
    const parts = clean.split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]), m = Number(parts[1]), s = Number(parts[2]);
      if ([h, m, s].some((n) => Number.isNaN(n) || n < 0)) return null;
      return Math.round((h * 3600 + m * 60 + s) * 1000);
    }
    if (parts.length === 2) {
      const m = Number(parts[0]), s = Number(parts[1]);
      if (Number.isNaN(m) || Number.isNaN(s) || m < 0 || s < 0) return null;
      return Math.round((m * 60 + s) * 1000);
    }
    const secOnly = Number(clean);
    return !Number.isNaN(secOnly) && secOnly >= 0 ? Math.round(secOnly * 1000) : null;
  }

  function readActiveClockMs(turn) {
    const selectors = turn === "b"
      ? [".rclock-black .time", ".clock-black .clock-time-monospace", ".clock-component.clock-black", "[data-cy='clock-black']"]
      : [".rclock-white .time", ".clock-white .clock-time-monospace", ".clock-component.clock-white", "[data-cy='clock-white']"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el || !el.textContent) continue;
      const ms = parseClockTextMs(el.textContent);
      if (ms !== null) return ms;
    }
    return null;
  }

  function expectedScoreForLine(line) {
    if (line && Array.isArray(line.wdl) && line.wdl.length === 3) {
      const total = line.wdl[0] + line.wdl[1] + line.wdl[2];
      if (total > 0) return (line.wdl[0] + 0.5 * line.wdl[1]) / total;
    }
    return 1 / (1 + Math.exp(-0.00368208 * scoreToComparableCp(line)));
  }

  function computeHeuristicPriors(fen, lines, targetElo) {
    const map = new Map();
    if (!lines || lines.length === 0) return map;
    const bestEval = scoreToComparableCp(lines[0]);
    const eloFactor = Math.max(0.2, Math.min(1.0, (targetElo - 500) / 2100));
    const weights = lines.map((line, idx) => {
      const cpDrop = Math.max(0, bestEval - scoreToComparableCp(line));
      const destSq = (line.uci || "").slice(2, 4);
      const isCapture = (line.san || "").includes("x");
      const isCheck = (line.san || "").includes("+") || (line.san || "").includes("#");
      const isCenter = /^(c|d|e|f)[3-6]$/.test(destSq);
      let boost = 1.0;
      if (isCapture) boost *= 1.35;
      if (isCheck) boost *= 1.25;
      if (isCenter) boost *= 1.15;
      if (!isCapture && !isCheck && !isCenter && idx === 0 && cpDrop === 0) boost *= 0.72 + 0.28 * eloFactor;
      return Math.max(1e-4, Math.exp(-cpDrop / (90 + (1 - eloFactor) * 140)) * Math.exp(-idx * (0.35 + eloFactor * 0.4)) * boost);
    });
    const sum = weights.reduce((a, b) => a + b, 0) || 1;
    lines.forEach((l, i) => map.set(l.uci, weights[i] / sum));
    return map;
  }

  function recomputeFairPlaySnapshot() {
    const baselineElo = Math.max(400, Math.min(3000, parseInt(config.targetElo || 1500, 10)));
    const cur = fairPlayState.currentMoves;
    const win = fairPlayState.windowGames;
    const winMoves = win.reduce((acc, g) => acc + (g.moveCount || 0), 0);
    const totalMoves = winMoves + cur.length;

    const meanArr = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const stdArr = (arr) => {
      if (arr.length < 2) return 0;
      const m = meanArr(arr);
      return Math.sqrt(arr.reduce((a, v) => a + (v - m) * (v - m), 0) / arr.length);
    };

    const expectedCredit = 0.42 + Math.max(0, Math.min(1, (baselineElo - 600) / 2200)) * 0.4;
    const expectedAcpl = 108 - Math.max(0, Math.min(1, (baselineElo - 600) / 2200)) * 86;

    let combinedAcpl = expectedAcpl;
    let combinedCredit = expectedCredit;
    if (totalMoves > 0) {
      const wAcpl = win.reduce((acc, g) => acc + (g.acpl || 0) * (g.moveCount || 0), 0);
      const wCredit = win.reduce((acc, g) => acc + (g.meanPartialCredit || 0) * (g.moveCount || 0), 0);
      combinedAcpl = (wAcpl + cur.reduce((a, m) => a + m.cpLoss, 0)) / totalMoves;
      combinedCredit = (wCredit + cur.reduce((a, m) => a + m.partialCredit, 0)) / totalMoves;
    }

    const spikes = cur.filter((m) => m.isSiSpike).length;
    const sampleWeight = totalMoves / (totalMoves + 6);
    const observedIpr = Math.max(400, Math.min(3200,
      baselineElo + sampleWeight * ((combinedCredit - expectedCredit) * 1450 + (expectedAcpl - combinedAcpl) * 5.2) + spikes * 95
    ));
    const sigmaIpr = Math.max(42, 235 / Math.sqrt(Math.max(1, totalMoves)));
    const zScore = (observedIpr - baselineElo) / sigmaIpr;

    const times = cur.map((m) => m.elapsedMs);
    const moveTimeMeanMs = meanArr(times);
    const moveTimeCv = times.length >= 3 && moveTimeMeanMs > 0 ? stdArr(times) / moveTimeMeanMs : 0.45;
    const sub15 = cur.filter((m) => m.remainingClockMs !== null && m.remainingClockMs < 15000);
    const sub15Acc = sub15.length ? meanArr(sub15.map((m) => m.partialCredit)) : 0;

    const warnings = [];
    const now = Date.now();
    if (spikes >= 2) {
      warnings.push({ code: "LOCKOUT_SPIKE_LIMIT", severity: "CRITICAL", message: `${spikes} rapid critical S_i spikes in one game`, timestampMs: now });
    } else if (spikes === 1) {
      warnings.push({ code: "RAPID_CRITICAL_MATCH", severity: "WARN", message: "1 rapid critical S_i match detected", timestampMs: now });
    }
    if (times.length >= 6 && moveTimeCv < 0.2) {
      warnings.push({ code: "FLAT_MOVE_CADENCE", severity: "WARN", message: `Flat cadence CV (${moveTimeCv.toFixed(2)})`, timestampMs: now });
    }
    if (sub15.length >= 3 && sub15Acc >= 0.88) {
      warnings.push({ code: "SUB_15S_ENGINE_PRECISION", severity: "CRITICAL", message: `High <15s precision (${Math.round(sub15Acc * 100)}%)`, timestampMs: now });
    }
    if (zScore >= 2.5) {
      warnings.push({ code: "CRITICAL_IPR_ZSCORE", severity: "CRITICAL", message: `IPR Z=${zScore.toFixed(2)} >= 2.5σ`, timestampMs: now });
    } else if (zScore >= 1.8) {
      warnings.push({ code: "ELEVATED_IPR_ZSCORE", severity: "WARN", message: `Elevated IPR Z=${zScore.toFixed(2)}`, timestampMs: now });
    }

    if (spikes >= 2 || zScore >= 2.5) {
      fairPlayState.lockedOut = true;
      fairPlayState.lockoutReason = spikes >= 2 ? `Lockout: ${spikes} S_i critical spikes` : `Lockout: Z=${zScore.toFixed(2)} >= 2.5`;
    }

    const riskLevel = fairPlayState.lockedOut ? "LOCKOUT" : (zScore >= 1.8 || (spikes >= 1 && zScore >= 1.25)) ? "ELEVATED" : "SAFE";
    fairPlayState.lastSnapshot = {
      riskLevel,
      lockedOut: fairPlayState.lockedOut,
      lockoutReason: fairPlayState.lockoutReason,
      baselineElo,
      observedIpr: Math.round(observedIpr),
      sigmaIpr: Number(sigmaIpr.toFixed(1)),
      zScore: Number(zScore.toFixed(2)),
      currentGameMoves: cur.length,
      currentGameSiSpikes: spikes,
      slidingWindowGames: win.length,
      acpl: Number(combinedAcpl.toFixed(1)),
      stdcpl: Number(stdArr(cur.map((m) => m.cpLoss)).toFixed(1)),
      meanPartialCredit: Number(combinedCredit.toFixed(3)),
      moveTimeMeanMs: Math.round(moveTimeMeanMs),
      moveTimeCv: Number(moveTimeCv.toFixed(3)),
      sub15sMoves: sub15.length,
      sub15sAccuracy: Number(sub15Acc.toFixed(3)),
      warnings
    };
    renderFairPlayPill();
    return fairPlayState.lastSnapshot;
  }

  function recordCompletedMoveForAuditor(prevAnalysis, playedMove, turnAfterMove) {
    if (!prevAnalysis || !prevAnalysis.result || !Array.isArray(prevAnalysis.result.lines) || prevAnalysis.result.lines.length === 0 || !playedMove || !playedMove.uci) return;
    const lines = prevAnalysis.result.lines;
    const top = lines[0];
    const played4 = playedMove.uci.slice(0, 4);
    const matched = lines.find((l) => (l.uci || "").slice(0, 4) === played4) || null;
    const bestCp = scoreToComparableCp(top);
    const cpLoss = matched ? Math.max(0, bestCp - scoreToComparableCp(matched)) : Math.min(600, Math.max(40, bestCp - scoreToComparableCp(lines[lines.length - 1])) + 85);
    const wdlLoss = matched ? Math.max(0, expectedScoreForLine(top) - expectedScoreForLine(matched)) : 0.14;
    const matchedTop = played4 === (top.uci || "").slice(0, 4);
    const partialCredit = matchedTop ? 1.0 : Math.max(0, Math.min(1, 0.5 * Math.exp(-cpLoss / 70) + 0.5 * Math.max(0, 1 - wdlLoss * 2.1)));

    const priors = computeHeuristicPriors(prevAnalysis.fen, lines, config.targetElo || 1500);
    const humanPrior = priors.get(matched ? matched.uci : playedMove.uci) ?? 0.05;
    const elapsedMs = Math.max(250, Date.now() - lastPositionObservedAtMs);
    const remainingClockMs = readActiveClockMs(prevAnalysis.turn || (turnAfterMove === "w" ? "b" : "w"));

    const deltaE = lines.length >= 2 ? Math.max(0, expectedScoreForLine(lines[0]) - expectedScoreForLine(lines[1])) : 0;
    const shallow = prevAnalysis.result.shallowDepth6;
    const shallowDisagrees = shallow && shallow.bestUci && shallow.bestUci.slice(0, 4) !== (top.uci || "").slice(0, 4);
    const isCriticalTrap = (prevAnalysis.result.depth || 0) >= 14 && ((shallowDisagrees && deltaE >= 0.15) || deltaE >= 0.22);
    const matchedDeepOnlyWin = isCriticalTrap && matchedTop;
    const expectedHumanMs = Math.max(3800, 9200 - ((config.targetElo || 1500) - 1000) * 1.6);
    const siScore = matchedDeepOnlyWin ? (expectedHumanMs / elapsedMs) * (0.45 + 1.45 * (1 - Math.min(0.92, humanPrior))) : 0;
    const isSiSpike = matchedDeepOnlyWin && humanPrior <= 0.28 && elapsedMs <= expectedHumanMs * 0.55 && siScore >= 2.0;

    fairPlayState.currentMoves.push({ cpLoss, wdlLoss, partialCredit, humanPrior, elapsedMs, remainingClockMs, isSiSpike });
    recomputeFairPlaySnapshot();
  }

  function renderFairPlayPill() {
    if (!fairPlayPill) return;
    if (config.fairPlayAuditorEnabled === false) {
      fairPlayPill.style.display = "flex";
      fairPlayPill.style.borderColor = "#6E7681";
      fairPlayPill.style.color = "#8B949E";
      fairPlayPill.textContent = "FairPlay: OFF";
      return;
    }
    const snap = fairPlayState.lastSnapshot;
    const palette = snap.riskLevel === "LOCKOUT"
      ? { border: "#EF4444", text: "#FCA5A5", label: `LOCKOUT • Z=${snap.zScore.toFixed(1)}σ` }
      : snap.riskLevel === "ELEVATED"
      ? { border: "#F59E0B", text: "#FDE68A", label: `ELEVATED • Z=${snap.zScore.toFixed(1)}σ` }
      : { border: "#10B981", text: "#A7F3D0", label: `FairPlay: SAFE • ${hintsUsedInGame}/${config.maxHintsPerGame || 3}` };
    fairPlayPill.style.display = "flex";
    fairPlayPill.style.borderColor = palette.border;
    fairPlayPill.style.color = palette.text;
    fairPlayPill.textContent = palette.label;
  }

  function evaluateHumanizerDecision(fen, turn, result) {
    const snap = recomputeFairPlaySnapshot();
    if (config.fairPlayAuditorEnabled !== false && snap.lockedOut) {
      return { allow: false, reason: "LOCKOUT", delayMs: 0, result };
    }
    if (!config.humanizerEnabled) {
      return { allow: true, reason: "HUMANIZER_OFF", delayMs: 0, result };
    }
    const lines = result.lines || [];
    if (lines.length === 0) return { allow: false, reason: "NO_LINES", delayMs: 0, result };

    // Suppress on opening book, simplified endgames (<= 6 pieces), or forced recaptures
    const pieceCount = ((fen.split(" ")[0] || "").match(/[a-zA-Z]/g) || []).length;
    if (pieceCount <= 6) return { allow: false, reason: "SIMPLIFIED_ENDGAME", delayMs: 0, result };

    if (lastOpeningBook && Array.isArray(lastOpeningBook.moves) && lastOpeningBook.moves.some((m) => (m.uci || "").slice(0, 4) === (lines[0].uci || "").slice(0, 4))) {
      return { allow: false, reason: "OPENING_BOOK", delayMs: 0, result };
    }

    if (lines.length >= 2 && (scoreToComparableCp(lines[0]) - scoreToComparableCp(lines[1])) >= 150 && (lines[0].san || "").includes("x")) {
      return { allow: false, reason: "FORCED_RECAPTURE", delayMs: 0, result };
    }

    const maxHints = Math.max(1, parseInt(config.maxHintsPerGame || 3, 10));
    if (!shownHintFens.has(fen) && hintsUsedInGame >= maxHints) {
      return { allow: false, reason: "HINT_BUDGET_EXHAUSTED", delayMs: 0, result };
    }

    const deltaE = lines.length >= 2 ? Math.max(0, expectedScoreForLine(lines[0]) - expectedScoreForLine(lines[1])) : 0.5;
    const criticalThreshold = 0.14 + (snap.riskLevel === "ELEVATED" ? 0.08 : 0);
    if (deltaE < criticalThreshold) {
      return { allow: false, reason: "LOW_CRITICALITY_WDL", delayMs: 0, result };
    }

    const clockMs = readActiveClockMs(turn);
    if (clockMs !== null) {
      if (clockMs < 15000) return { allow: false, reason: "LOW_CLOCK_CUTOFF", delayMs: 0, result };
      if (clockMs < 25000) {
        const p = (clockMs - 15000) / 10000;
        const prob = p * p * (3 - 2 * p);
        if (Math.random() > prob) return { allow: false, reason: "LOW_CLOCK_TAPER", delayMs: 0, result };
      }
    }

    const targetElo = Math.max(400, Math.min(3000, parseInt(config.targetElo || 1500, 10)));
    const priors = computeHeuristicPriors(fen, lines, targetElo);
    const bestCp = scoreToComparableCp(lines[0]);
    const lambda = 0.004 + ((Math.max(600, Math.min(2800, targetElo)) - 600) / 2200) * 0.028;
    const baseTemp = 1.35 - ((Math.max(600, Math.min(2800, targetElo)) - 600) / 2200) * 0.95;
    const temp = baseTemp * (snap.riskLevel === "ELEVATED" ? 2.0 : 1.0);

    const survivors = lines.filter((l) => (bestCp - scoreToComparableCp(l)) <= 160 && (priors.get(l.uci) || 0) >= 0.03);
    if (survivors.length === 0) return { allow: false, reason: "NO_PLAUSIBLE_HUMAN", delayMs: 0, result };

    const utils = survivors.map((l) => (Math.log(Math.max(1e-5, priors.get(l.uci) || 0.03)) - lambda * Math.max(0, bestCp - scoreToComparableCp(l))) / Math.max(0.08, temp));
    const maxU = Math.max(...utils);
    const exps = utils.map((u) => Math.exp(u - maxU));
    const sumExp = exps.reduce((a, b) => a + b, 0) || 1;
    let roll = Math.random(), cum = 0, chosen = survivors[0];
    for (let i = 0; i < survivors.length; i++) {
      cum += exps[i] / sumExp;
      if (roll <= cum) { chosen = survivors[i]; break; }
    }

    const reorderedLines = [chosen, ...lines.filter((l) => l.uci !== chosen.uci)];
    const shallow = result.shallowDepth6;
    const sharpDivergence = shallow && shallow.bestUci && shallow.bestUci.slice(0, 4) !== (lines[0].uci || "").slice(0, 4) ? 0.7 : 0;
    const complexity = Math.max(0, Math.min(1, 0.45 * Math.min(1, deltaE / 0.35) + 0.35 * sharpDivergence + 0.2 * Math.min(1, lines.length / 4)));
    const minD = 800 + complexity * (4000 - 800);
    const maxD = 1500 + complexity * (9500 - 1500);
    const delayMs = Math.max(snap.riskLevel === "ELEVATED" ? 1200 : 0, Math.round(minD + Math.random() * (maxD - minD)));

    return {
      allow: true,
      reason: "OK",
      delayMs,
      result: Object.assign({}, result, { lines: reorderedLines })
    };
  }

  function clearSessionTelemetry() {
    hintsUsedInGame = 0;
    shownHintFens.clear();
    fairPlayState.windowGames = [];
    fairPlayState.currentMoves = [];
    fairPlayState.lockedOut = false;
    fairPlayState.lockoutReason = null;
    if (hasChromeStorage()) {
      try {
        chrome.storage.local.remove(FAIR_PLAY_KEY);
      } catch (_) {}
    }
    const snap = recomputeFairPlaySnapshot();
    if (typeof window.ChessForgeAndroidBridge !== "undefined" &&
        typeof window.ChessForgeAndroidBridge.onAnalysisUpdate === "function" &&
        lastAnalysis) {
      window.ChessForgeAndroidBridge.onAnalysisUpdate(JSON.stringify(
        Object.assign({}, lastAnalysis.result, { fairPlay: snap })
      ));
    }
    runAnalysis(true);
    return snap;
  }

  window.__ChessForgeHumanizer = {
    getSnapshot: () => fairPlayState.lastSnapshot,
    resetGame: () => {
      hintsUsedInGame = 0;
      shownHintFens.clear();
      fairPlayState.currentMoves = [];
      recomputeFairPlaySnapshot();
    },
    clearSessionTelemetry
  };

  function publishResult(boardInfo, turn, result, playedMove) {
    if (humanizerDelayTimer) {
      clearTimeout(humanizerDelayTimer);
      humanizerDelayTimer = null;
    }
    if (lastAnalysis && lastAnalysis.fen !== result.fen) {
      prevAnalysisForAnnotation = lastAnalysis;
      lastPlayedAnnotation = evaluatePlayedMoveAnnotation(
        prevAnalysisForAnnotation,
        prevOpeningBookForAnnotation,
        result.fen,
        turn,
        result.lines,
        playedMove
      );
      if (config.fairPlayAuditorEnabled !== false) {
        recordCompletedMoveForAuditor(prevAnalysisForAnnotation, playedMove, turn);
      }
    }

    lastAnalysis = { fen: result.fen, turn, result };
    lastBoardTheme = detectBoardTheme(boardInfo);
    setStatus("IDLE");

    const decision = evaluateHumanizerDecision(result.fen, turn, result);
    const snapshot = fairPlayState.lastSnapshot;
    const activeResult = decision.result || result;

    if (!decision.allow) {
      clearOverlayVisuals();
      renderFairPlayPill();
    } else if (decision.delayMs > 0) {
      clearOverlayVisuals();
      renderFairPlayPill();
      const scheduledFen = result.fen;
      humanizerDelayTimer = setTimeout(() => {
        humanizerDelayTimer = null;
        if (!lastAnalysis || lastAnalysis.fen !== scheduledFen || fairPlayState.lockedOut) return;
        if (!shownHintFens.has(scheduledFen)) {
          shownHintFens.add(scheduledFen);
          hintsUsedInGame++;
          renderFairPlayPill();
        }
        const liveBoard = readActiveBoard();
        if (liveBoard) renderOverlay(liveBoard, activeResult, turn);
      }, decision.delayMs);
    } else {
      renderOverlay(boardInfo, activeResult, turn);
    }

    const payload = Object.assign({}, activeResult, {
      status: "IDLE",
      boardTheme: {
        name: lastBoardTheme.name,
        isDark: lastBoardTheme.isDark,
        hue: lastBoardTheme.hue,
        accentHex: lastBoardTheme.hudBorder
      },
      lastMoveAnnotation: lastPlayedAnnotation,
      openingBook: lastOpeningBook,
      tablebase: lastTablebase,
      fairPlay: snapshot,
      humanizerSuppression: decision.allow ? null : decision.reason
    });

    if (typeof window.ChessForgeAndroidBridge !== "undefined" &&
        typeof window.ChessForgeAndroidBridge.onAnalysisUpdate === "function") {
      window.ChessForgeAndroidBridge.onAnalysisUpdate(JSON.stringify(payload));
    }
    if (hasChromeStorage()) {
      chrome.storage.local.set({
        lastResult: payload,
        engineStatus: { status: "IDLE", backend: result.engineBackend || "Stockfish 19 WASM" },
        updatedAt: Date.now()
      });
    }

    // Offline Practice Board Sparring Auto-Play (strictly offline Practice Board only)
    if (practiceAutoTimer) clearTimeout(practiceAutoTimer);
    if (
      boardInfo.isPracticeBoard === true &&
      (config.practiceAutoPlay || config.autonomousMode) &&
      result.lines &&
      result.lines.length > 0 &&
      typeof window.__chessForgeMakePracticeMove === "function"
    ) {
      const baseDelay = Math.max(250, Math.min(2500, parseInt(config.practiceHumanDelayMs || 650, 10)));
      const jitter = Math.round((Math.random() - 0.5) * Math.min(240, baseDelay * 0.35));
      practiceAutoTimer = setTimeout(() => {
        if (config.enabled && (config.practiceAutoPlay || config.autonomousMode) && boardInfo.isPracticeBoard === true) {
          window.__chessForgeMakePracticeMove(result.lines[0].uci);
        }
      }, baseDelay + jitter);
    }
  }

  function runAnalysis(force) {
    ensureOverlayUi();
    if (!config.enabled || fairPlayState.lockedOut) {
      clearOverlayVisuals();
      renderFairPlayPill();
      return;
    }
    const boardInfo = readActiveBoard();
    if (!boardInfo || !window.ChessForgeEngine) {
      clearOverlayVisuals();
      return;
    }

    const placement = gridToPlacement(boardInfo.grid);
    if (!window.ChessForgeEngine.hasValidKings(placement)) {
      return;
    }

    let turn = inferredTurn;
    if (config.turnOverride === "w" || config.turnOverride === "b") {
      turn = config.turnOverride;
    } else if (boardInfo.detectedTurn) {
      turn = boardInfo.detectedTurn;
      inferredTurn = turn;
    } else if (lastPlacement && placement !== lastPlacement) {
      turn = inferredTurn === "w" ? "b" : "w";
      inferredTurn = turn;
    } else if (!lastPlacement) {
      turn = placement === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
        ? "w"
        : boardInfo.isFlipped ? "b" : "w";
      inferredTurn = turn;
    }

    if (!force && placement === lastPlacement && lastAnalysis && lastAnalysis.turn === turn) {
      renderOverlay(boardInfo, lastAnalysis.result, turn);
      return;
    }

    const prevGridSnapshot = lastGrid;
    const playedMove =
      lastPlacement && placement !== lastPlacement
        ? diffPlayedMove(prevGridSnapshot, boardInfo.grid, turn === "w" ? "b" : "w")
        : null;

    if (lastPlacement && placement !== lastPlacement) {
      prevOpeningBookForAnnotation = lastOpeningBook;
      if (humanizerDelayTimer) {
        clearTimeout(humanizerDelayTimer);
        humanizerDelayTimer = null;
      }
      lastPositionObservedAtMs = Date.now();
    }

    lastPlacement = placement;
    lastGrid = boardInfo.grid.map((row) => row.slice());
    const castling = inferCastlingRights(boardInfo.grid);
    const fen = `${placement} ${turn} ${castling} - 0 1`;
    const seq = ++activeSearchSeq;

    // Master Opening Book lookup (synchronous built-in + async Lichess Masters refresh)
    if (window.ChessForgeOpeningBook && config.showOpeningBook) {
      lastOpeningBook = window.ChessForgeOpeningBook.lookup(fen, (bookData) => {
        if (seq !== activeSearchSeq || !bookData) return;
        lastOpeningBook = bookData;
        if (lastAnalysis && lastAnalysis.fen === fen) {
          lastAnalysis.result.lines = classifyCandidateAnnotations(lastAnalysis.result.lines, lastOpeningBook);
          publishResult(boardInfo, turn, lastAnalysis.result, playedMove);
        }
      });
    } else {
      lastOpeningBook = null;
    }

    // Syzygy Endgame Tablebase lookup (7 or fewer pieces on board)
    if (window.ChessForgeTablebase && config.showTablebase && window.ChessForgeTablebase.isApplicable(fen)) {
      lastTablebase = window.ChessForgeTablebase.lookup(fen, (tbData) => {
        if (seq !== activeSearchSeq || !tbData) return;
        lastTablebase = tbData;
        if (lastAnalysis && lastAnalysis.fen === fen) {
          publishResult(boardInfo, turn, lastAnalysis.result, playedMove);
        }
      });
    } else {
      lastTablebase = null;
    }

    setStatus("CALCULATING");
    if (lastAnalysis) renderOverlay(boardInfo, lastAnalysis.result, turn);

    if (hasChromeRuntime()) {
      try {
        chrome.runtime.sendMessage(
          { type: "STOCKFISH_ANALYZE", fen, config },
          (resp) => {
            if (seq !== activeSearchSeq) return;
            if (!chrome.runtime.lastError && resp && resp.ok && resp.result) {
              const enriched = enrichResult(fen, turn, resp.result);
              publishResult(boardInfo, turn, enriched, playedMove);
            } else {
              const fallback = runFallbackJsAnalysis(fen, turn);
              if (fallback) publishResult(boardInfo, turn, fallback, playedMove);
              else setStatus("ERROR");
            }
          }
        );
        return;
      } catch (_) {
      }
    }

    const fallback = runFallbackJsAnalysis(fen, turn);
    if (fallback && seq === activeSearchSeq) {
      publishResult(boardInfo, turn, fallback, playedMove);
    }
  }

  function scheduleAnalysis(delayMs) {
    if (scheduledTimer) clearTimeout(scheduledTimer);
    scheduledTimer = setTimeout(() => runAnalysis(false), delayMs || 110);
  }

  function startObserving() {
    ensureOverlayUi();
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleAnalysis(100));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-piece", "data-turn", "data-flipped"]
    });
    window.addEventListener("scroll", () => {
      if (lastAnalysis) {
        const b = readActiveBoard();
        if (b) renderOverlay(b, lastAnalysis.result, lastAnalysis.turn);
      }
    }, { passive: true });
    window.addEventListener("resize", () => {
      if (lastAnalysis) {
        const b = readActiveBoard();
        if (b) renderOverlay(b, lastAnalysis.result, lastAnalysis.turn);
      }
    }, { passive: true });
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return;
      if (msg.type === "GET_STATE") {
        sendResponse({
          config,
          engineStatus,
          fairPlay: fairPlayState.lastSnapshot,
          lastAnalysis: lastAnalysis ? Object.assign({}, lastAnalysis.result, { openingBook: lastOpeningBook, tablebase: lastTablebase, boardTheme: lastBoardTheme, fairPlay: fairPlayState.lastSnapshot }) : null
        });
      } else if (msg.type === "UPDATE_CONFIG") {
        config = Object.assign({}, config, msg.config || {});
        if (hasChromeStorage()) chrome.storage.local.set(config);
        runAnalysis(true);
        sendResponse({ ok: true, engineStatus, lastAnalysis: lastAnalysis ? lastAnalysis.result : null });
      } else if (msg.type === "FORCE_ANALYZE") {
        runAnalysis(true);
        sendResponse({ ok: true, engineStatus, lastAnalysis: lastAnalysis ? lastAnalysis.result : null });
      } else if (msg.type === "CLEAR_FAIRPLAY_TELEMETRY") {
        const snap = clearSessionTelemetry();
        sendResponse({ ok: true, fairPlay: snap });
      }
    });
  }

  window.__chessForgeUpdateConfig = function (partial) {
    config = Object.assign({}, config, partial || {});
    if (config.fairPlayAuditorEnabled === false) {
      fairPlayState.lockedOut = false;
      fairPlayState.lockoutReason = null;
      recomputeFairPlaySnapshot();
    }
    runAnalysis(true);
  };

  loadConfig(() => {
    startObserving();
    scheduleAnalysis(140);
  });
})();
