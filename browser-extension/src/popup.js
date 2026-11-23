(function () {
  "use strict";

  const elStatusDot = document.getElementById("status-dot");
  const elStatusLabel = document.getElementById("status-label");
  const elEvalFill = document.getElementById("eval-fill");
  const elEvalScore = document.getElementById("eval-score");
  const elBackendLabel = document.getElementById("backend-label");
  const elThemeBadge = document.getElementById("theme-badge");
  const elBookHeader = document.getElementById("book-header");
  const elBookMoves = document.getElementById("book-moves");
  const elTablebaseCard = document.getElementById("tablebase-card");
  const elTbBadge = document.getElementById("tb-badge");
  const elTbHeader = document.getElementById("tb-header");
  const elTbMoves = document.getElementById("tb-moves");
  const elLastMoveBadge = document.getElementById("last-move-badge");
  const elFairPlayBadge = document.getElementById("fairplay-badge");
  const elFairPlaySummary = document.getElementById("fairplay-summary");

  function annotationColors(symbol) {
    switch (symbol) {
      case "!!": return { bg: "rgba(27,172,166,0.22)", fg: "#1BACA6" };
      case "!": return { bg: "rgba(92,139,176,0.25)", fg: "#5C8BB0" };
      case "★": return { bg: "rgba(129,182,76,0.22)", fg: "#81B64C" };
      case "+": return { bg: "rgba(150,188,75,0.22)", fg: "#96BC4B" };
      case "✓": return { bg: "rgba(149,183,118,0.22)", fg: "#95B776" };
      case "Book": return { bg: "rgba(168,136,101,0.25)", fg: "#D5A46C" };
      case "?!": return { bg: "rgba(247,198,49,0.22)", fg: "#F7C631" };
      case "?": return { bg: "rgba(230,145,44,0.24)", fg: "#E6912C" };
      case "✕": return { bg: "rgba(255,119,105,0.24)", fg: "#FF7769" };
      case "??": return { bg: "rgba(202,52,49,0.25)", fg: "#CA3431" };
      default: return { bg: "rgba(16,185,129,0.22)", fg: "#10B981" };
    }
  }

  const elEnabled = document.getElementById("toggle-enabled");
  const elCpu = document.getElementById("select-cpu");
  const elDepth = document.getElementById("select-depth");
  const elSkill = document.getElementById("range-skill");
  const elSkillVal = document.getElementById("skill-val");
  const elMultiPv = document.getElementById("select-multipv");
  const elElo = document.getElementById("select-elo");
  const elHumanizer = document.getElementById("toggle-humanizer");
  const elAutonomous = document.getElementById("toggle-autonomous");
  const elOnlineAutoPlay = document.getElementById("toggle-online-autoplay");
  const elOnlineAutoBadge = document.getElementById("online-auto-badge");
  const elOnlineAutoSummary = document.getElementById("online-auto-summary");
  const elAutonomousElo = document.getElementById("select-autonomous-elo");
  const elPuzzleBadge = document.getElementById("puzzle-badge");
  const elPuzzleSummary = document.getElementById("puzzle-summary");
  const elPuzzleSolver = document.getElementById("toggle-puzzle-solver");
  const elPuzzleAutoSolve = document.getElementById("toggle-puzzle-autosolve");
  const elPuzzleLevel = document.getElementById("select-puzzle-level");
  const elPuzzleDelay = document.getElementById("range-puzzle-delay");
  const elPuzzleDelayVal = document.getElementById("puzzle-delay-val");
  const elPuzzleAutoNext = document.getElementById("toggle-puzzle-autonext");
  const elFairPlayToggle = document.getElementById("toggle-fairplay");
  const elClearTelemetry = document.getElementById("btn-clear-telemetry");
  const elTurn = document.getElementById("select-turn");
  const elEvalBar = document.getElementById("toggle-evalbar");
  const elArrows = document.getElementById("toggle-arrows");
  const elAnnotations = document.getElementById("toggle-annotations");
  const elBook = document.getElementById("toggle-book");
  const elTablebase = document.getElementById("toggle-tablebase");
  const elTheme = document.getElementById("toggle-theme");
  const elHud = document.getElementById("toggle-hud");
  const elAnalyze = document.getElementById("btn-reanalyze");
  const elLines = document.getElementById("lines-container");
  const elFen = document.getElementById("fen-box");

  const defaults = {
    enabled: true,
    cpuProfile: "balanced",
    maxDepth: 14,
    skillLevel: 20,
    multiPv: 4,
    targetElo: 1500,
    fairPlayAuditorEnabled: true,
    humanizerEnabled: true,
    turnOverride: "auto",
    showEvalBar: true,
    showArrows: true,
    showAnnotations: true,
    showOpeningBook: true,
    showTablebase: true,
    autoAdaptTheme: true,
    showHud: true,
    autonomousMode: false,
    onlineAutoPlay: false,
    autonomousEloProfile: 1600,
    puzzleSolverEnabled: false,
    puzzleAutoSolve: false,
    puzzleAutoNext: false,
    puzzleLevelMode: "all",
    puzzleSolveDelayMs: 450
  };

  function renderStatus(status, backend) {
    const clean = (status || "IDLE").toUpperCase();
    elStatusDot.className = "dot " + clean.toLowerCase();
    const labelMap = {
      LOADING: "Loading WASM…",
      CALCULATING: "Calculating…",
      IDLE: "Ready",
      ERROR: "Error"
    };
    elStatusLabel.textContent = `${backend || "Stockfish 19 WASM"} • ${labelMap[clean] || clean}`;
  }

  function renderOpeningBook(book) {
    if (!book || (!book.opening && (!book.moves || book.moves.length === 0))) {
      elBookHeader.textContent = "Out of Opening Book";
      elBookMoves.innerHTML = '<p class="muted">No master database games for this exact position.</p>';
      return;
    }
    const prefix = book.eco ? `[${book.eco}] ` : "";
    elBookHeader.textContent = `${prefix}${book.opening || "Master Theory"} (${book.source || "Masters"})`;
    elBookMoves.innerHTML = "";
    const moves = book.moves || [];
    if (moves.length === 0) {
      elBookMoves.innerHTML = '<p class="muted">Named variation reached — follow engine lines below.</p>';
      return;
    }
    for (const m of moves.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = "line-row";

      const left = document.createElement("span");
      left.textContent = `${m.san} (${m.games.toLocaleString()})`;

      const right = document.createElement("div");
      right.style.cssText = "display:flex;align-items:center;gap:6px;";
      const pctTxt = document.createElement("span");
      pctTxt.style.cssText = "font-size:10px;color:#8b949e;";
      pctTxt.textContent = `${m.whitePct}/${m.drawPct}/${m.blackPct}`;

      const bar = document.createElement("div");
      bar.className = "wdl-bar";
      bar.innerHTML =
        `<div class="wdl-w" style="width:${m.whitePct}%"></div>` +
        `<div class="wdl-d" style="width:${m.drawPct}%"></div>` +
        `<div class="wdl-b" style="width:${m.blackPct}%"></div>`;

      right.appendChild(pctTxt);
      right.appendChild(bar);
      row.appendChild(left);
      row.appendChild(right);
      elBookMoves.appendChild(row);
    }
  }

  function renderTablebase(tb) {
    if (!elTablebaseCard) return;
    if (!tb || !tb.isTablebase) {
      elTablebaseCard.style.display = "none";
      return;
    }
    elTablebaseCard.style.display = "block";
    const color = tb.category === "win" ? "#10b981" : (tb.category === "loss" ? "#ef4444" : "#f59e0b");
    elTbBadge.textContent = tb.scoreBadge || tb.outcome;
    elTbBadge.style.borderColor = color;
    elTbBadge.style.color = color;
    elTbHeader.textContent = `Syzygy 7-Piece • ${tb.outcome} (${tb.scoreBadge})`;
    elTbHeader.style.color = color;
    elTbMoves.innerHTML = "";
    const moves = tb.moves || [];
    if (moves.length === 0) {
      elTbMoves.innerHTML = '<p class="muted">Theoretical conclusion reached.</p>';
      return;
    }
    for (const m of moves.slice(0, 4)) {
      const row = document.createElement("div");
      row.className = "line-row";
      const left = document.createElement("span");
      left.textContent = `${m.san} (${m.uci})`;
      if (m.annotation) {
        const ann = document.createElement("span");
        ann.className = "ann-badge";
        ann.textContent = m.annotation;
        left.appendChild(ann);
      }
      const right = document.createElement("span");
      right.className = m.quality === "win" ? "score-primary" : "score-secondary";
      const dtmText = m.checkmate ? "Mate" : (m.stalemate ? "Stalemate" : (m.dtm !== null ? `DTM ${m.dtm}` : (m.dtz !== null ? `DTZ ${m.dtz}` : m.quality)));
      right.textContent = dtmText;
      row.appendChild(left);
      row.appendChild(right);
      elTbMoves.appendChild(row);
    }
  }

  function renderFairPlay(fp) {
    if (!elFairPlayBadge || !elFairPlaySummary || !fp) return;
    const risk = fp.riskLevel || "SAFE";
    const color = risk === "LOCKOUT" ? "#EF4444" : risk === "ELEVATED" ? "#F59E0B" : "#10B981";
    elFairPlayBadge.textContent = `${risk} • ${fp.observedIpr || 1500} IPR`;
    elFairPlayBadge.style.borderColor = color;
    elFairPlayBadge.style.color = color;
    const warnText = fp.warnings && fp.warnings.length > 0 ? ` • ${fp.warnings[0].message}` : "";
    elFairPlaySummary.textContent = `Z=${(fp.zScore || 0).toFixed(2)}σ • ${fp.currentGameSiSpikes || 0} S_i spikes • ACPL ${fp.acpl || 0}${warnText}`;
  }

  function renderResult(result) {
    if (!result || !result.lines || result.lines.length === 0) {
      elLines.innerHTML = '<p class="muted">No active Lichess/Chess.com board detected on current tab.</p>';
      elFen.textContent = "FEN: --";
      if (elTablebaseCard) elTablebaseCard.style.display = "none";
      return;
    }

    if (result.boardTheme && result.boardTheme.name) {
      elThemeBadge.textContent = `Theme: ${result.boardTheme.name}`;
    }

    renderFairPlay(result.fairPlay);
    renderOpeningBook(result.openingBook);
    renderTablebase(result.tablebase);
    if (elOnlineAutoBadge && elOnlineAutoSummary) {
      const ctx = result.boardContext || {};
      const onlineOn = Boolean((elOnlineAutoPlay && elOnlineAutoPlay.checked) || (elAutonomous && elAutonomous.checked));
      const eloVal = elAutonomousElo ? elAutonomousElo.value : "1600";
      const sideLabel = ctx.playerColor === "b" ? "Black" : "White";
      if (!onlineOn) {
        elOnlineAutoBadge.textContent = `OFF • ${eloVal} Elo`;
        elOnlineAutoBadge.style.borderColor = "#30363d";
        elOnlineAutoBadge.style.color = "#8b949e";
        elOnlineAutoSummary.textContent = ctx.isOnlineGame
          ? `Normal game detected (${sideLabel}). Toggle above to auto-play.`
          : ctx.isPracticeBoard
          ? `Practice board detected (${sideLabel}). Toggle above to auto-play.`
          : "Auto-plays your moves in live, bot, daily & practice games.";
      } else if (ctx.isPuzzle) {
        elOnlineAutoBadge.textContent = `ARMED • ${eloVal} Elo`;
        elOnlineAutoBadge.style.borderColor = "#f59e0b";
        elOnlineAutoBadge.style.color = "#f59e0b";
        elOnlineAutoSummary.textContent = "Puzzle page active — Puzzle Solver controls puzzle boards.";
      } else if (ctx.isAnalysisBoard) {
        elOnlineAutoBadge.textContent = `ARMED (ANALYSIS)`;
        elOnlineAutoBadge.style.borderColor = "#f59e0b";
        elOnlineAutoBadge.style.color = "#f59e0b";
        elOnlineAutoSummary.textContent = "Open a Lichess/Chess.com live or bot game to auto-play moves.";
      } else if (ctx.isGameOver) {
        elOnlineAutoBadge.textContent = `GAME OVER`;
        elOnlineAutoBadge.style.borderColor = "#8b949e";
        elOnlineAutoBadge.style.color = "#8b949e";
        elOnlineAutoSummary.textContent = "Game finished — waiting for next game.";
      } else if (ctx.isOnlineGame || ctx.isPracticeBoard) {
        const myTurn = ctx.currentTurn === ctx.playerColor;
        elOnlineAutoBadge.textContent = `${myTurn ? "PLAYING" : "WAITING"} • ${eloVal} Elo`;
        elOnlineAutoBadge.style.borderColor = "#10b981";
        elOnlineAutoBadge.style.color = "#10b981";
        elOnlineAutoSummary.textContent = `Active as ${sideLabel} • ${myTurn ? "Computing & executing move…" : "Waiting for opponent move."}`;
      } else {
        elOnlineAutoBadge.textContent = `ARMED • ${eloVal} Elo`;
        elOnlineAutoBadge.style.borderColor = "#10b981";
        elOnlineAutoBadge.style.color = "#10b981";
        elOnlineAutoSummary.textContent = "Ready — open a Lichess, Chess.com, or Practice game.";
      }
    }
    if (elPuzzleBadge && elPuzzleSummary) {
      const ctx = result.boardContext || {};
      const solverOn = elPuzzleSolver ? elPuzzleSolver.checked : false;
      const autoOn = elPuzzleAutoSolve ? elPuzzleAutoSolve.checked : false;
      if (ctx.isPuzzle) {
        const modeTag = (ctx.puzzleMode || "puzzle").toUpperCase();
        const ratingTag = ctx.puzzleRating ? ` • ${ctx.puzzleRating}` : "";
        elPuzzleBadge.textContent = `${modeTag}${ratingTag} • ${ctx.puzzleStatus || "SOLVING"}`;
        elPuzzleBadge.style.borderColor = solverOn ? "#38bdf8" : "#30363d";
        elPuzzleBadge.style.color = solverOn ? "#38bdf8" : "#8b949e";
        elPuzzleSummary.textContent = autoOn
          ? `Auto-Solve ACTIVE (${ctx.playerColor === "b" ? "Black" : "White"} to solve)`
          : (solverOn ? "Puzzle Hint highlight ACTIVE — enable Auto-Solve to execute moves." : "Puzzle detected on board. Toggle Enable Puzzle Solver above.");
      } else {
        elPuzzleBadge.textContent = solverOn ? (autoOn ? "AUTO ARMED" : "HINT ARMED") : "OFF • Lichess & Chess.com";
        elPuzzleBadge.style.borderColor = solverOn ? "#38bdf8" : "#30363d";
        elPuzzleBadge.style.color = solverOn ? "#38bdf8" : "#8b949e";
        elPuzzleSummary.textContent = "Supports Rated, Storm, Streak, Racer & Puzzle Rush/Battle.";
      }
    }

    const top = result.lines[0];
    const pct = top.whiteWinPct !== undefined ? top.whiteWinPct : top.winPct;
    elEvalFill.style.width = `${Math.max(3, Math.min(97, pct)).toFixed(1)}%`;

    const wMate = top.whiteMate !== undefined ? top.whiteMate : top.mate;
    const wCp = top.whiteCp !== undefined ? top.whiteCp : top.centipawns;
    elEvalScore.textContent =
      wMate !== null && wMate !== undefined
        ? `${wMate > 0 ? "+M" : "-M"}${Math.abs(wMate)}`
        : (wCp >= 0 ? `+${(wCp / 100).toFixed(2)}` : (wCp / 100).toFixed(2));

    elBackendLabel.textContent = result.engineBackend || "Stockfish 19 WASM";
    renderStatus(result.status || "IDLE", result.engineBackend || "Stockfish 19 WASM");

    if (elLastMoveBadge) {
      const lm = result.lastMoveAnnotation;
      if (lm && lm.symbol) {
        const pal = annotationColors(lm.symbol);
        elLastMoveBadge.style.display = "inline-block";
        elLastMoveBadge.textContent = `${lm.sq} ${lm.symbol} ${lm.label || ""}`.trim();
        elLastMoveBadge.style.borderColor = pal.fg;
        elLastMoveBadge.style.color = pal.fg;
        elLastMoveBadge.style.background = pal.bg;
      } else {
        elLastMoveBadge.style.display = "none";
      }
    }

    elLines.innerHTML = "";
    for (const line of result.lines) {
      const row = document.createElement("div");
      row.className = "line-row";

      const left = document.createElement("span");
      left.textContent = `#${line.rank}  ${line.san} (${line.uci})`;
      if (line.annotation) {
        const pal = annotationColors(line.annotation);
        const ann = document.createElement("span");
        ann.className = "ann-badge";
        ann.style.background = pal.bg;
        ann.style.color = pal.fg;
        ann.textContent = line.annotation;
        left.appendChild(ann);
      }

      const right = document.createElement("span");
      right.className = line.rank === 1 ? "score-primary" : "score-secondary";
      const score =
        line.mate !== null && line.mate !== undefined
          ? `M${Math.abs(line.mate)}`
          : (line.centipawns >= 0 ? `+${(line.centipawns / 100).toFixed(2)}` : (line.centipawns / 100).toFixed(2));
      right.textContent = `${score} • D${line.depth || result.depth || 1}`;

      row.appendChild(left);
      row.appendChild(right);
      elLines.appendChild(row);
    }
    elFen.textContent = `FEN: ${result.fen || "--"}`;
  }

  function pushConfigToActiveTab(partial) {
    chrome.storage.local.set(partial, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: "UPDATE_CONFIG", config: partial }, (resp) => {
          if (chrome.runtime.lastError) return;
          if (resp && resp.lastAnalysis) renderResult(resp.lastAnalysis);
        });
      });
    });
  }

  chrome.storage.local.get(Object.assign({}, defaults, { lastResult: null, engineStatus: null }), (data) => {
    elEnabled.checked = data.enabled !== false;
    elCpu.value = data.cpuProfile || "balanced";
    elDepth.value = String(data.maxDepth || 14);
    elSkill.value = String(data.skillLevel ?? 20);
    elSkillVal.textContent = elSkill.value;
    elMultiPv.value = String(data.multiPv || 4);
    if (elElo) elElo.value = String(data.targetElo || 1500);
    if (elHumanizer) elHumanizer.checked = data.humanizerEnabled !== false;
    if (elAutonomous) elAutonomous.checked = data.autonomousMode === true;
    if (elOnlineAutoPlay) elOnlineAutoPlay.checked = data.onlineAutoPlay === true;
    if (elAutonomousElo) elAutonomousElo.value = String(data.autonomousEloProfile || 1600);
    if (elPuzzleSolver) elPuzzleSolver.checked = data.puzzleSolverEnabled === true;
    if (elPuzzleAutoSolve) elPuzzleAutoSolve.checked = data.puzzleAutoSolve === true;
    if (elPuzzleLevel) elPuzzleLevel.value = data.puzzleLevelMode || "all";
    if (elPuzzleDelay) {
      elPuzzleDelay.value = String(data.puzzleSolveDelayMs || 450);
      if (elPuzzleDelayVal) elPuzzleDelayVal.textContent = elPuzzleDelay.value;
    }
    if (elPuzzleAutoNext) elPuzzleAutoNext.checked = data.puzzleAutoNext === true;
    if (elFairPlayToggle) elFairPlayToggle.checked = data.fairPlayAuditorEnabled !== false;
    elTurn.value = data.turnOverride || "auto";
    elEvalBar.checked = data.showEvalBar !== false;
    elArrows.checked = data.showArrows !== false;
    elAnnotations.checked = data.showAnnotations !== false;
    elBook.checked = data.showOpeningBook !== false;
    if (elTablebase) elTablebase.checked = data.showTablebase !== false;
    elTheme.checked = data.autoAdaptTheme !== false;
    elHud.checked = data.showHud !== false;

    if (data.engineStatus) {
      renderStatus(data.engineStatus.status, data.engineStatus.backend);
    }
    if (data.lastResult) renderResult(data.lastResult);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "GET_STATE" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.engineStatus) renderStatus(resp.engineStatus);
        if (resp && resp.fairPlay) renderFairPlay(resp.fairPlay);
        if (resp && resp.lastAnalysis) renderResult(resp.lastAnalysis);
      });
    });
  });

  elEnabled.addEventListener("change", () => pushConfigToActiveTab({ enabled: elEnabled.checked }));
  elCpu.addEventListener("change", () => pushConfigToActiveTab({ cpuProfile: elCpu.value }));
  elDepth.addEventListener("change", () => pushConfigToActiveTab({ maxDepth: parseInt(elDepth.value, 10) }));
  elSkill.addEventListener("input", () => {
    elSkillVal.textContent = elSkill.value;
  });
  elSkill.addEventListener("change", () => pushConfigToActiveTab({ skillLevel: parseInt(elSkill.value, 10) }));
  elMultiPv.addEventListener("change", () => pushConfigToActiveTab({ multiPv: parseInt(elMultiPv.value, 10) }));
  if (elElo) elElo.addEventListener("change", () => pushConfigToActiveTab({ targetElo: parseInt(elElo.value, 10) }));
  if (elHumanizer) elHumanizer.addEventListener("change", () => pushConfigToActiveTab({ humanizerEnabled: elHumanizer.checked }));
  if (elOnlineAutoPlay) elOnlineAutoPlay.addEventListener("change", () => pushConfigToActiveTab({ onlineAutoPlay: elOnlineAutoPlay.checked }));
  if (elAutonomous) elAutonomous.addEventListener("change", () => pushConfigToActiveTab({ autonomousMode: elAutonomous.checked }));
  if (elAutonomousElo) elAutonomousElo.addEventListener("change", () => pushConfigToActiveTab({ autonomousEloProfile: parseInt(elAutonomousElo.value, 10) }));
  if (elPuzzleSolver) elPuzzleSolver.addEventListener("change", () => pushConfigToActiveTab({ puzzleSolverEnabled: elPuzzleSolver.checked }));
  if (elPuzzleAutoSolve) elPuzzleAutoSolve.addEventListener("change", () => pushConfigToActiveTab({ puzzleAutoSolve: elPuzzleAutoSolve.checked }));
  if (elPuzzleLevel) elPuzzleLevel.addEventListener("change", () => pushConfigToActiveTab({ puzzleLevelMode: elPuzzleLevel.value }));
  if (elPuzzleDelay) {
    elPuzzleDelay.addEventListener("input", () => {
      if (elPuzzleDelayVal) elPuzzleDelayVal.textContent = elPuzzleDelay.value;
    });
    elPuzzleDelay.addEventListener("change", () => pushConfigToActiveTab({ puzzleSolveDelayMs: parseInt(elPuzzleDelay.value, 10) }));
  }
  if (elPuzzleAutoNext) elPuzzleAutoNext.addEventListener("change", () => pushConfigToActiveTab({ puzzleAutoNext: elPuzzleAutoNext.checked }));
  if (elFairPlayToggle) elFairPlayToggle.addEventListener("change", () => pushConfigToActiveTab({ fairPlayAuditorEnabled: elFairPlayToggle.checked }));
  if (elClearTelemetry) {
    elClearTelemetry.addEventListener("click", () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) return;
        chrome.tabs.sendMessage(tabs[0].id, { type: "CLEAR_FAIRPLAY_TELEMETRY" }, (resp) => {
          if (chrome.runtime.lastError) return;
          if (resp && resp.fairPlay) renderFairPlay(resp.fairPlay);
        });
      });
    });
  }
  elTurn.addEventListener("change", () => pushConfigToActiveTab({ turnOverride: elTurn.value }));
  elEvalBar.addEventListener("change", () => pushConfigToActiveTab({ showEvalBar: elEvalBar.checked }));
  elArrows.addEventListener("change", () => pushConfigToActiveTab({ showArrows: elArrows.checked }));
  elAnnotations.addEventListener("change", () => pushConfigToActiveTab({ showAnnotations: elAnnotations.checked }));
  elBook.addEventListener("change", () => pushConfigToActiveTab({ showOpeningBook: elBook.checked }));
  if (elTablebase) elTablebase.addEventListener("change", () => pushConfigToActiveTab({ showTablebase: elTablebase.checked }));
  elTheme.addEventListener("change", () => pushConfigToActiveTab({ autoAdaptTheme: elTheme.checked }));
  elHud.addEventListener("change", () => pushConfigToActiveTab({ showHud: elHud.checked }));

  elAnalyze.addEventListener("click", () => {
    renderStatus("CALCULATING", "Stockfish 19 WASM");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, { type: "FORCE_ANALYZE" }, (resp) => {
        if (chrome.runtime.lastError) return;
        if (resp && resp.lastAnalysis) renderResult(resp.lastAnalysis);
      });
    });
  });
})();
