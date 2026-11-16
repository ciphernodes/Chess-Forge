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

  let config = Object.assign({}, DEFAULT_CONFIG, window.__ChessForgeExtensionConfig || {});
  let lastPlacement = "";
  let lastGrid = null;
  let inferredTurn = "w";
  let lastAnalysis = null;
  let prevAnalysisForAnnotation = null;
  let lastPlayedAnnotation = null; // { sq, symbol, label, color, cpLoss }
  let lastOpeningBook = null;
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
  let bookBannerEl = null;
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
      chrome.storage.local.get(DEFAULT_CONFIG, (stored) => {
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

  function diffPlayedDestination(oldGrid, newGrid, movedColor) {
    if (!oldGrid || !newGrid) return null;
    const isMoverPiece = (ch) => {
      if (!ch || ch === ".") return false;
      return movedColor === "w" ? (ch >= "A" && ch <= "Z") : (ch >= "a" && ch <= "z");
    };
    const candidates = [];
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (oldGrid[r][f] !== newGrid[r][f] && isMoverPiece(newGrid[r][f])) {
          candidates.push("abcdefgh"[f] + String(8 - r));
        }
      }
    }
    // Skip castling rook square if king square also appears
    if (candidates.length === 2) {
      const kSq = candidates.find((sq) => sq[0] === "g" || sq[0] === "c");
      if (kSq) return kSq;
    }
    return candidates[0] || null;
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

    fabPill.appendChild(toggleBtn);
    fabPill.appendChild(sideBtn);
    overlayHost.appendChild(svgLayer);
    overlayHost.appendChild(evalBarEl);
    overlayHost.appendChild(hudPill);
    overlayHost.appendChild(bookBannerEl);
    overlayHost.appendChild(fabPill);
    document.body.appendChild(overlayHost);
  }

  function clearOverlayVisuals() {
    if (svgLayer) svgLayer.innerHTML = "";
    if (hudPill) hudPill.style.display = "none";
    if (bookBannerEl) bookBannerEl.style.display = "none";
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

  function annotationStyle(symbol) {
    switch (symbol) {
      case "!!": return { label: "Brilliant", color: "#06B6D4", text: "#042F2E" };
      case "!": return { label: "Best", color: "#10B981", text: "#042F2E" };
      case "!?": return { label: "Interesting", color: "#38BDF8", text: "#082F49" };
      case "?!": return { label: "Inaccuracy", color: "#F59E0B", text: "#451A03" };
      case "?": return { label: "Mistake", color: "#F97316", text: "#FFFFFF" };
      case "??": return { label: "Blunder", color: "#EF4444", text: "#FFFFFF" };
      default: return null;
    }
  }

  function classifyCandidateAnnotations(lines) {
    if (!lines || lines.length === 0) return lines;
    const topCp = scoreToComparableCp(lines[0]);
    const secondCp = lines.length > 1 ? scoreToComparableCp(lines[1]) : null;

    return lines.map((line, idx) => {
      let annotation = "";
      if (idx === 0) {
        const gap = secondCp !== null ? topCp - secondCp : 0;
        if ((line.mate !== null && line.mate > 0) || gap >= 165) {
          annotation = "!!";
        } else if (gap >= 45 || lines.length === 1) {
          annotation = "!";
        } else {
          annotation = "!";
        }
      } else {
        const drop = topCp - scoreToComparableCp(line);
        if (drop <= 35) annotation = "!?";
        else if (drop < 120) annotation = "?!";
        else if (drop < 280) annotation = "?";
        else annotation = "??";
      }
      return Object.assign({}, line, { annotation });
    });
  }

  function evaluatePlayedMoveAnnotation(prev, currTurn, currLines, playedDestSq) {
    if (!prev || !currLines || currLines.length === 0) return null;
    const top = currLines[0];
    const currWhiteCp = whiteComparableCp(top.whiteMate, top.whiteCp);
    const prevTop = prev.result && prev.result.lines && prev.result.lines[0];
    if (!prevTop) return null;

    const prevWhiteCp = whiteComparableCp(prevTop.whiteMate, prevTop.whiteCp);
    // Perspective of whoever just moved (prev.turn)
    const cpLoss = prev.turn === "w" ? (prevWhiteCp - currWhiteCp) : (currWhiteCp - prevWhiteCp);

    let symbol = null;
    if (cpLoss >= 280) symbol = "??";
    else if (cpLoss >= 140) symbol = "?";
    else if (cpLoss >= 60) symbol = "?!";
    else if (cpLoss <= -40 && (top.whiteMate !== null || Math.abs(currWhiteCp) > 150)) symbol = "!!";
    else if (cpLoss <= 15) symbol = "!";

    if (!symbol || !playedDestSq) return null;
    const style = annotationStyle(symbol);
    return {
      sq: playedDestSq,
      symbol,
      label: style.label,
      color: style.color,
      text: style.text,
      cpLoss: Math.round(cpLoss)
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

  function drawAnnotationBadgeSvg(pt, symbol, style) {
    const r = Math.max(8, Math.min(13, pt.cellW * 0.21));
    const bx = pt.sqLeft + pt.cellW - r * 0.92;
    const by = pt.sqTop + r * 0.92;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", bx.toFixed(1));
    circle.setAttribute("cy", by.toFixed(1));
    circle.setAttribute("r", r.toFixed(1));
    circle.setAttribute("fill", style.color);
    circle.setAttribute("stroke", lastBoardTheme.arrowOutline);
    circle.setAttribute("stroke-width", "1.6");
    g.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", bx.toFixed(1));
    text.setAttribute("y", (by + r * 0.36).toFixed(1));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", style.text);
    text.setAttribute("font-size", Math.max(9, Math.round(r * 1.05)));
    text.setAttribute("font-weight", "900");
    text.textContent = symbol;
    g.appendChild(text);

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

    // Standard Chess Annotation Symbols on board squares (best engine move & last played move)
    if (config.showAnnotations) {
      const topDest = uciSquareToScreenCenter(top.uci.slice(2, 4), rect, isFlipped);
      if (topDest && top.annotation) {
        const st = annotationStyle(top.annotation);
        if (st) drawAnnotationBadgeSvg(topDest, top.annotation, st);
      }
      if (lastPlayedAnnotation && lastPlayedAnnotation.sq && lastPlayedAnnotation.sq !== top.uci.slice(2, 4)) {
        const playedDest = uciSquareToScreenCenter(lastPlayedAnnotation.sq, rect, isFlipped);
        if (playedDest) {
          drawAnnotationBadgeSvg(playedDest, lastPlayedAnnotation.symbol, lastPlayedAnnotation);
        }
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
    result.lines = classifyCandidateAnnotations(mapped);
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

  function publishResult(boardInfo, turn, result, playedDestSq) {
    if (lastAnalysis && lastAnalysis.fen !== result.fen) {
      prevAnalysisForAnnotation = lastAnalysis;
      lastPlayedAnnotation = evaluatePlayedMoveAnnotation(
        prevAnalysisForAnnotation,
        turn,
        result.lines,
        playedDestSq
      );
    }

    lastAnalysis = { fen: result.fen, turn, result };
    lastBoardTheme = detectBoardTheme(boardInfo);
    setStatus("IDLE");
    renderOverlay(boardInfo, result, turn);

    const payload = Object.assign({}, result, {
      status: "IDLE",
      boardTheme: {
        name: lastBoardTheme.name,
        isDark: lastBoardTheme.isDark,
        hue: lastBoardTheme.hue,
        accentHex: lastBoardTheme.hudBorder
      },
      lastMoveAnnotation: lastPlayedAnnotation,
      openingBook: lastOpeningBook
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
      config.practiceAutoPlay &&
      result.lines &&
      result.lines.length > 0 &&
      typeof window.__chessForgeMakePracticeMove === "function"
    ) {
      const baseDelay = Math.max(250, Math.min(2500, parseInt(config.practiceHumanDelayMs || 650, 10)));
      const jitter = Math.round((Math.random() - 0.5) * Math.min(240, baseDelay * 0.35));
      practiceAutoTimer = setTimeout(() => {
        if (config.enabled && config.practiceAutoPlay && boardInfo.isPracticeBoard === true) {
          window.__chessForgeMakePracticeMove(result.lines[0].uci);
        }
      }, baseDelay + jitter);
    }
  }

  function runAnalysis(force) {
    ensureOverlayUi();
    if (!config.enabled) {
      clearOverlayVisuals();
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
    const playedDestSq =
      lastPlacement && placement !== lastPlacement
        ? diffPlayedDestination(prevGridSnapshot, boardInfo.grid, turn === "w" ? "b" : "w")
        : null;

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
          publishResult(boardInfo, turn, lastAnalysis.result, playedDestSq);
        }
      });
    } else {
      lastOpeningBook = null;
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
              publishResult(boardInfo, turn, enriched, playedDestSq);
            } else {
              const fallback = runFallbackJsAnalysis(fen, turn);
              if (fallback) publishResult(boardInfo, turn, fallback, playedDestSq);
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
      publishResult(boardInfo, turn, fallback, playedDestSq);
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
          lastAnalysis: lastAnalysis ? Object.assign({}, lastAnalysis.result, { openingBook: lastOpeningBook, boardTheme: lastBoardTheme }) : null
        });
      } else if (msg.type === "UPDATE_CONFIG") {
        config = Object.assign({}, config, msg.config || {});
        if (hasChromeStorage()) chrome.storage.local.set(config);
        runAnalysis(true);
        sendResponse({ ok: true, engineStatus, lastAnalysis: lastAnalysis ? lastAnalysis.result : null });
      } else if (msg.type === "FORCE_ANALYZE") {
        runAnalysis(true);
        sendResponse({ ok: true, engineStatus, lastAnalysis: lastAnalysis ? lastAnalysis.result : null });
      }
    });
  }

  window.__chessForgeUpdateConfig = function (partial) {
    config = Object.assign({}, config, partial || {});
    runAnalysis(true);
  };

  loadConfig(() => {
    startObserving();
    scheduleAnalysis(140);
  });
})();
