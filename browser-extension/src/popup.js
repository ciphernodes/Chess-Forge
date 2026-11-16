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

  const elEnabled = document.getElementById("toggle-enabled");
  const elCpu = document.getElementById("select-cpu");
  const elDepth = document.getElementById("select-depth");
  const elSkill = document.getElementById("range-skill");
  const elSkillVal = document.getElementById("skill-val");
  const elMultiPv = document.getElementById("select-multipv");
  const elTurn = document.getElementById("select-turn");
  const elEvalBar = document.getElementById("toggle-evalbar");
  const elArrows = document.getElementById("toggle-arrows");
  const elAnnotations = document.getElementById("toggle-annotations");
  const elBook = document.getElementById("toggle-book");
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
    multiPv: 2,
    turnOverride: "auto",
    showEvalBar: true,
    showArrows: true,
    showAnnotations: true,
    showOpeningBook: true,
    autoAdaptTheme: true,
    showHud: true
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

  function renderResult(result) {
    if (!result || !result.lines || result.lines.length === 0) {
      elLines.innerHTML = '<p class="muted">No active Lichess/Chess.com board detected on current tab.</p>';
      elFen.textContent = "FEN: --";
      return;
    }

    if (result.boardTheme && result.boardTheme.name) {
      elThemeBadge.textContent = `Theme: ${result.boardTheme.name}`;
    }

    renderOpeningBook(result.openingBook);

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

    elLines.innerHTML = "";
    for (const line of result.lines) {
      const row = document.createElement("div");
      row.className = "line-row";

      const left = document.createElement("span");
      left.textContent = `#${line.rank}  ${line.san} (${line.uci})`;
      if (line.annotation) {
        const ann = document.createElement("span");
        ann.className = "ann-badge";
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
    elMultiPv.value = String(data.multiPv || 2);
    elTurn.value = data.turnOverride || "auto";
    elEvalBar.checked = data.showEvalBar !== false;
    elArrows.checked = data.showArrows !== false;
    elAnnotations.checked = data.showAnnotations !== false;
    elBook.checked = data.showOpeningBook !== false;
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
  elTurn.addEventListener("change", () => pushConfigToActiveTab({ turnOverride: elTurn.value }));
  elEvalBar.addEventListener("change", () => pushConfigToActiveTab({ showEvalBar: elEvalBar.checked }));
  elArrows.addEventListener("change", () => pushConfigToActiveTab({ showArrows: elArrows.checked }));
  elAnnotations.addEventListener("change", () => pushConfigToActiveTab({ showAnnotations: elAnnotations.checked }));
  elBook.addEventListener("change", () => pushConfigToActiveTab({ showOpeningBook: elBook.checked }));
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
