(function () {
  "use strict";

  let worker = null;
  let ready = false;
  let initPromise = null;
  let currentSearch = null;
  let pendingQueue = null;
  let lastAppliedOptions = {
    hashMb: -1,
    skillLevel: -1,
    multiPv: -1
  };

  function cpToWinPct(cp) {
    const raw = 50 + 50 * ((2 / (1 + Math.exp(-0.00368208 * cp))) - 1);
    return Math.max(0.1, Math.min(99.9, raw));
  }

  function profileBudget(cpuProfile, maxDepth) {
    const requestedDepth = Math.max(2, Math.min(20, parseInt(maxDepth || 14, 10)));
    switch (cpuProfile) {
      case "eco":
        return { hashMb: 32, moveTimeMs: 360, depthCap: Math.min(requestedDepth, 10) };
      case "turbo":
        return { hashMb: 128, moveTimeMs: 2200, depthCap: Math.min(requestedDepth, 20) };
      case "balanced":
      default:
        return { hashMb: 64, moveTimeMs: 920, depthCap: Math.min(requestedDepth, 16) };
    }
  }

  function broadcastStatus(status, detail) {
    try {
      chrome.runtime.sendMessage({
        target: "background",
        type: "ENGINE_STATUS",
        status,
        detail: detail || "",
        backend: "Stockfish 19 WASM"
      });
    } catch (_) {
    }
  }

  function initWorker() {
    if (ready && worker) return Promise.resolve();
    if (initPromise) return initPromise;

    initPromise = new Promise((resolve, reject) => {
      broadcastStatus("LOADING", "Initializing Stockfish 19 WebAssembly…");
      try {
        const jsUrl = chrome.runtime.getURL("vendor/stockfish-19-lite-single.js");
        const wasmUrl = chrome.runtime.getURL("vendor/stockfish-19-lite-single.wasm");
        worker = new Worker(jsUrl + "#" + encodeURIComponent(wasmUrl));

        const timeout = setTimeout(() => {
          if (!ready) {
            broadcastStatus("ERROR", "Stockfish WASM init timeout");
            reject(new Error("Stockfish WASM init timeout"));
          }
        }, 12000);

        worker.onmessage = (ev) => {
          const line = typeof ev.data === "string" ? ev.data.trim() : "";
          if (!line) return;

          if (line === "uciok") {
            worker.postMessage("setoption name UCI_AnalyseMode value true");
            worker.postMessage("setoption name UCI_ShowWDL value true");
            worker.postMessage("setoption name MultiPV value 4");
            worker.postMessage("setoption name Move Overhead value 10");
            lastAppliedOptions.multiPv = 4;
            worker.postMessage("isready");
            return;
          }
          if (line === "readyok") {
            if (!ready) {
              ready = true;
              clearTimeout(timeout);
              broadcastStatus("IDLE", "Stockfish 19 WASM ready");
              resolve();
            }
            return;
          }
          handleUciLine(line);
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          ready = false;
          broadcastStatus("ERROR", err.message || "WASM worker error");
          reject(new Error(err.message || "WASM worker error"));
        };

        worker.postMessage("uci");
      } catch (e) {
        broadcastStatus("ERROR", e.message || "Unable to create WASM worker");
        reject(e);
      }
    }).catch((err) => {
      initPromise = null;
      throw err;
    });

    return initPromise;
  }

  function parseInfoLine(line) {
    if (!line.startsWith("info ")) return null;
    if (line.includes("upperbound") || line.includes("lowerbound")) return null;

    const scoreMatch = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)\b/);
    const pvMatch = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?(?:\s+[a-h][1-8][a-h][1-8][qrbn]?)*)/);
    if (!scoreMatch || !pvMatch) return null;

    const mpMatch = line.match(/\bmultipv\s+(\d+)\b/);
    const depthMatch = line.match(/\bdepth\s+(\d+)\b/);
    const selMatch = line.match(/\bseldepth\s+(\d+)\b/);
    const nodesMatch = line.match(/\bnodes\s+(\d+)\b/);
    const npsMatch = line.match(/\bnps\s+(\d+)\b/);
    const wdlMatch = line.match(/\bwdl\s+(\d+)\s+(\d+)\s+(\d+)\b/);

    const rank = mpMatch ? parseInt(mpMatch[1], 10) : 1;
    const scoreType = scoreMatch[1];
    const scoreVal = parseInt(scoreMatch[2], 10);
    const pvMoves = pvMatch[1].trim().split(/\s+/);
    const uci = pvMoves[0];
    if (!uci) return null;

    const isMate = scoreType === "mate";
    const centipawns = isMate ? null : scoreVal;
    const mate = isMate ? scoreVal : null;
    const winPct = isMate ? (scoreVal > 0 ? 99.9 : 0.1) : cpToWinPct(scoreVal);
    const wdl = wdlMatch
      ? [parseInt(wdlMatch[1], 10), parseInt(wdlMatch[2], 10), parseInt(wdlMatch[3], 10)]
      : null;

    return {
      rank,
      uci,
      san: uci,
      centipawns,
      mate,
      winPct,
      wdl,
      depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
      selDepth: selMatch ? parseInt(selMatch[1], 10) : 0,
      nodes: nodesMatch ? parseInt(nodesMatch[1], 10) : 0,
      nps: npsMatch ? parseInt(npsMatch[1], 10) : 0,
      pv: pvMoves.join(" ")
    };
  }

  function handleUciLine(line) {
    if (!currentSearch) return;

    if (line.startsWith("info ")) {
      const parsed = parseInfoLine(line);
      if (parsed) {
        currentSearch.linesByRank.set(parsed.rank, parsed);
        if (parsed.rank === 1 && parsed.depth > 0 && parsed.depth <= 6) {
          currentSearch.shallowDepth6 = {
            depth: parsed.depth,
            bestUci: parsed.uci,
            centipawns: parsed.centipawns,
            mate: parsed.mate,
            wdl: parsed.wdl
          };
        }
        if (parsed.depth > currentSearch.maxDepthSeen) {
          currentSearch.maxDepthSeen = parsed.depth;
        }
        if (parsed.nodes > currentSearch.nodes) {
          currentSearch.nodes = parsed.nodes;
        }
      }
      return;
    }

    if (line.startsWith("bestmove ")) {
      const bm = line.split(/\s+/)[1];
      const bestMove = bm && bm !== "(none)" && bm !== "0000" ? bm : null;
      const finished = currentSearch;
      currentSearch = null;
      clearTimeout(finished.timer);

      const lines = Array.from(finished.linesByRank.values())
        .sort((a, b) => a.rank - b.rank)
        .slice(0, finished.multiPv);

      if (lines.length === 0 && bestMove) {
        lines.push({
          rank: 1,
          uci: bestMove,
          san: bestMove,
          centipawns: 0,
          mate: null,
          winPct: 50.0,
          wdl: [250, 500, 250],
          depth: finished.maxDepthSeen || 1,
          selDepth: 0,
          nodes: finished.nodes,
          nps: 0,
          pv: bestMove
        });
      }

      broadcastStatus("IDLE", `D${finished.maxDepthSeen} complete`);
      finished.resolve({
        fen: finished.fen,
        lines,
        shallowDepth6: finished.shallowDepth6 || null,
        depth: finished.maxDepthSeen || 1,
        nodes: finished.nodes,
        elapsedMs: Date.now() - finished.startTime,
        engineBackend: "Stockfish 19 WASM",
        status: "IDLE"
      });

      if (pendingQueue) {
        const nextReq = pendingQueue;
        pendingQueue = null;
        startSearch(nextReq.fen, nextReq.config, nextReq.resolve, nextReq.reject);
      }
    }
  }

  async function startSearch(fen, config, resolve, reject) {
    try {
      await initWorker();
    } catch (e) {
      reject(e);
      return;
    }

    if (currentSearch) {
      pendingQueue = { fen, config, resolve, reject };
      worker.postMessage("stop");
      return;
    }

    const multiPv = Math.max(1, Math.min(4, parseInt(config.multiPv || 4, 10)));
    const skillLevel = Math.max(0, Math.min(20, parseInt(config.skillLevel ?? 20, 10)));
    const budget = profileBudget(config.cpuProfile || "balanced", parseInt(config.maxDepth || 14, 10));

    if (lastAppliedOptions.hashMb !== budget.hashMb) {
      worker.postMessage(`setoption name Hash value ${budget.hashMb}`);
      lastAppliedOptions.hashMb = budget.hashMb;
    }
    if (lastAppliedOptions.skillLevel !== skillLevel) {
      worker.postMessage(`setoption name Skill Level value ${skillLevel}`);
      lastAppliedOptions.skillLevel = skillLevel;
    }
    if (lastAppliedOptions.multiPv !== multiPv) {
      worker.postMessage(`setoption name MultiPV value ${multiPv}`);
      lastAppliedOptions.multiPv = multiPv;
    }

    broadcastStatus("CALCULATING", `Searching D${budget.depthCap}…`);

    const searchObj = {
      fen,
      multiPv,
      startTime: Date.now(),
      maxDepthSeen: 0,
      nodes: 0,
      shallowDepth6: null,
      linesByRank: new Map(),
      resolve,
      reject,
      timer: null
    };

    searchObj.timer = setTimeout(() => {
      if (currentSearch === searchObj && worker) {
        worker.postMessage("stop");
      }
    }, budget.moveTimeMs + 1500);

    currentSearch = searchObj;
    worker.postMessage(`position fen ${fen}`);
    worker.postMessage(`go depth ${budget.depthCap} movetime ${budget.moveTimeMs}`);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.target !== "offscreen") return;

    if (msg.type === "OFFSCREEN_WARMUP") {
      initWorker()
        .then(() => sendResponse({ ok: true, status: "IDLE", backend: "Stockfish 19 WASM" }))
        .catch((err) => sendResponse({ ok: false, status: "ERROR", error: err.message }));
      return true;
    }

    if (msg.type === "OFFSCREEN_ANALYZE") {
      startSearch(
        msg.fen,
        msg.config || {},
        (result) => sendResponse({ ok: true, result }),
        (err) => sendResponse({ ok: false, error: err ? err.message : "Search failed" })
      );
      return true;
    }
  });
})();
