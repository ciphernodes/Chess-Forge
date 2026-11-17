import test from "node:test";
import assert from "node:assert/strict";

import {
  FairPlayAuditor,
  InMemoryFairPlayStorage,
  expectedScoreFromLine,
} from "./fairPlayAuditor.ts";
import { computeEloTemperature } from "./humanizerConfig.ts";
import {
  HumanizerController,
  computeClockHintProbability,
  computeExpectedScoreDelta,
  computePositionComplexity,
  sampleLogNormalDelayMs,
  selectHumanizedCandidate,
} from "./humanizerController.ts";
import { ChessForgeHumanizedPipeline } from "./integrationWiring.ts";
import {
  HeuristicPolicyAdapter,
  Maia2PolicyAdapter,
  parseClockTextToMs,
  type ClockSnapshot,
  type ClockTelemetryPort,
  type EngineAnalysis,
  type EngineLine,
  type EnginePort,
  type OnnxPolicyRunner,
  type OverlayDrawCommand,
  type OverlayRenderPort,
  type PolicyPort,
} from "./ports.ts";
import type { FairPlayMetricsSnapshot } from "./fairPlayModels.ts";

const MIDGAME_FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 9";
const SIX_PIECE_FEN = "8/8/4k3/3p4/3P4/4K3/8/8 w - - 0 1";

function makeLine(
  rank: number,
  uci: string,
  centipawns: number,
  wdl: readonly [number, number, number],
  depth: number = 16
): EngineLine {
  return {
    rank,
    uci,
    san: uci,
    centipawns,
    mate: null,
    winPct: 50,
    depth,
    wdl,
  };
}

class RecordingOverlayPort implements OverlayRenderPort {
  readonly drawn: OverlayDrawCommand[] = [];
  readonly clearedReasons: string[] = [];
  readonly badges: FairPlayMetricsSnapshot[] = [];

  drawOverlay(command: OverlayDrawCommand): void {
    this.drawn.push(command);
  }

  clearOverlay(reason: string): void {
    this.clearedReasons.push(reason);
  }

  updateFairPlayBadge(snapshot: FairPlayMetricsSnapshot): void {
    this.badges.push(snapshot);
  }
}

class FixedClockPort implements ClockTelemetryPort {
  activeMs: number | null;

  constructor(activeMs: number | null) {
    this.activeMs = activeMs;
  }

  readClocks(): ClockSnapshot {
    return {
      whiteRemainingMs: this.activeMs,
      blackRemainingMs: this.activeMs,
      activeRemainingMs: this.activeMs,
      capturedAtMs: Date.now(),
    };
  }
}

class StaticPolicyPort implements PolicyPort {
  private readonly map: ReadonlyMap<string, number>;

  constructor(entries: Record<string, number>) {
    this.map = new Map(Object.entries(entries));
  }

  async predictHumanPriors(): Promise<ReadonlyMap<string, number>> {
    return this.map;
  }
}

test("Maia2PolicyAdapter uses ONNX priors when provided and falls back cleanly on error", async () => {
  const lines = [
    makeLine(1, "c4d5", 90, [580, 320, 100]),
    makeLine(2, "e3e4", 60, [480, 380, 140]),
  ];

  const workingRunner: OnnxPolicyRunner = {
    async inferMoveProbs() {
      return new Map([
        ["c4d5", 0.72],
        ["e3e4", 0.28],
      ]);
    },
  };
  const maiaOk = new Maia2PolicyAdapter(workingRunner);
  const probsOk = await maiaOk.predictHumanPriors(MIDGAME_FEN, lines, 1500);
  assert.ok((probsOk.get("c4d5") ?? 0) > 0.7);

  const failingRunner: OnnxPolicyRunner = {
    async inferMoveProbs() {
      throw new Error("ONNX session not loaded");
    },
  };
  const maiaFallback = new Maia2PolicyAdapter(failingRunner);
  const probsFallback = await maiaFallback.predictHumanPriors(MIDGAME_FEN, lines, 1500);
  assert.ok(probsFallback.has("c4d5"));
  assert.ok((probsFallback.get("c4d5") ?? 0) > (probsFallback.get("e3e4") ?? 0));
});

test("HumanizerController discards alien non-human tactics below minHumanPriorProb (0.03)", async () => {
  const overlay = new RecordingOverlayPort();
  const clocks = new FixedClockPort(180_000);
  const auditor = new FairPlayAuditor({ baselineElo: 1400 });

  // PV1 is an alien engine sacrifice (prior 0.01 < 0.03), PV2 is human-plausible (prior 0.55)
  const policy = new StaticPolicyPort({
    f3g5: 0.01,
    e2d3: 0.55,
    b2b3: 0.25,
    a2a3: 0.19,
  });

  const controller = new HumanizerController(
    { targetElo: 1400, minHumanPriorProb: 0.03, criticalWdlThreshold: 0.14, randomFn: () => 0.1 },
    policy,
    clocks,
    overlay,
    auditor
  );

  const analysis: EngineAnalysis = {
    fen: MIDGAME_FEN,
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    lines: [
      makeLine(1, "f3g5", 160, [700, 220, 80]),
      makeLine(2, "e2d3", 120, [500, 320, 180]),
      makeLine(3, "b2b3", 95, [450, 340, 210]),
      makeLine(4, "a2a3", 80, [420, 350, 230]),
    ],
  };

  const decision = await controller.evaluateAndScheduleDraw(analysis, { immediateForTest: true });
  assert.equal(decision.status, "DRAWN");
  assert.ok(decision.command);
  assert.notEqual(decision.command.selectedLine.uci, "f3g5");
  assert.equal(decision.command.selectedLine.uci, "e2d3");

  // If ALL surviving candidates are below minHumanPriorProb, suppress hint completely
  const alienOnlyController = new HumanizerController(
    { targetElo: 1400, minHumanPriorProb: 0.03 },
    new StaticPolicyPort({ f3g5: 0.01, e2d3: 0.01 }),
    clocks,
    overlay,
    auditor
  );
  const suppressed = await alienOnlyController.evaluateAndScheduleDraw(analysis, { immediateForTest: true });
  assert.equal(suppressed.status, "SUPPRESSED");
  assert.equal(suppressed.reason, "NO_PLAUSIBLE_HUMAN_CANDIDATES");
});

test("HumanizerController suppresses opening book, forced recaptures, <=6 piece endgames, low WDL delta, and enforces hint budget", async () => {
  const overlay = new RecordingOverlayPort();
  const clocks = new FixedClockPort(180_000);
  const auditor = new FairPlayAuditor({ baselineElo: 1500 });
  const policy = new HeuristicPolicyAdapter();

  const controller = new HumanizerController(
    { targetElo: 1500, maxHintsPerGame: 2, criticalWdlThreshold: 0.14, randomFn: () => 0.2 },
    policy,
    clocks,
    overlay,
    auditor
  );

  // 1. Opening book suppression
  const bookDecision = await controller.evaluateAndScheduleDraw(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "Stockfish 19 WASM",
      isOpeningBook: true,
      lines: [makeLine(1, "c4d5", 150, [680, 240, 80]), makeLine(2, "e3e4", 30, [450, 350, 200])],
    },
    { immediateForTest: true }
  );
  assert.equal(bookDecision.status, "SUPPRESSED");
  assert.equal(bookDecision.reason, "OPENING_BOOK");

  // 2. Simplified endgame (<= 6 pieces)
  const tbDecision = await controller.evaluateAndScheduleDraw(
    {
      fen: SIX_PIECE_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "Stockfish 19 WASM",
      lines: [makeLine(1, "e3d4", 400, [950, 50, 0]), makeLine(2, "e3d3", 10, [400, 400, 200])],
    },
    { immediateForTest: true }
  );
  assert.equal(tbDecision.status, "SUPPRESSED");
  assert.equal(tbDecision.reason, "SIMPLIFIED_ENDGAME");

  // 3. Forced recapture (only one viable move >= 150 cp ahead)
  const forcedDecision = await controller.evaluateAndScheduleDraw(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "Stockfish 19 WASM",
      isRecaptureOpportunity: true,
      lines: [makeLine(1, "c4d5", 220, [750, 180, 70]), makeLine(2, "e2d3", 20, [430, 340, 230])],
    },
    { immediateForTest: true }
  );
  assert.equal(forcedDecision.status, "SUPPRESSED");
  assert.equal(forcedDecision.reason, "FORCED_RECAPTURE");

  // 4. Low WDL criticality delta (< 0.14)
  const quietDelta = computeExpectedScoreDelta([
    makeLine(1, "c4d5", 45, [480, 360, 160]), // E = 0.66
    makeLine(2, "e2d3", 30, [430, 380, 190]), // E = 0.62 -> delta = 0.04 < 0.14
  ]);
  assert.ok(quietDelta < 0.14);
  const lowWdlDecision = await controller.evaluateAndScheduleDraw(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "Stockfish 19 WASM",
      lines: [
        makeLine(1, "c4d5", 45, [480, 360, 160]),
        makeLine(2, "e2d3", 30, [430, 380, 190]),
      ],
    },
    { immediateForTest: true }
  );
  assert.equal(lowWdlDecision.status, "SUPPRESSED");
  assert.equal(lowWdlDecision.reason, "LOW_CRITICALITY_WDL");

  // 5. Per-game hint budget enforcement (maxHintsPerGame = 2)
  const criticalPos = (suffix: string): EngineAnalysis => ({
    fen: `r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 ${suffix}`,
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    lines: [
      makeLine(1, "c4d5", 160, [720, 200, 80]), // E = 0.82
      makeLine(2, "e2d3", 75, [480, 320, 200]), // E = 0.64 -> delta = 0.18 >= 0.14
    ],
  });
  const h1 = await controller.evaluateAndScheduleDraw(criticalPos("10"), { immediateForTest: true });
  const h2 = await controller.evaluateAndScheduleDraw(criticalPos("11"), { immediateForTest: true });
  const h3 = await controller.evaluateAndScheduleDraw(criticalPos("12"), { immediateForTest: true });
  assert.equal(h1.status, "DRAWN");
  assert.equal(h2.status, "DRAWN");
  assert.equal(h3.status, "SUPPRESSED");
  assert.equal(h3.reason, "HINT_BUDGET_EXHAUSTED");
});

test("Low-clock decay smoothly tapers hint probability and suppresses completely below 15,000 ms", async () => {
  assert.equal(computeClockHintProbability(30_000, 15_000, 25_000), 1);
  const midProb = computeClockHintProbability(20_000, 15_000, 25_000);
  assert.ok(midProb > 0 && midProb < 1);
  assert.equal(computeClockHintProbability(14_999, 15_000, 25_000), 0);
  assert.equal(computeClockHintProbability(5_000, 15_000, 25_000), 0);

  assert.equal(parseClockTextToMs("02:30"), 150_000);
  assert.equal(parseClockTextToMs("00:12.4"), 12_400);

  const overlay = new RecordingOverlayPort();
  const clocks = new FixedClockPort(14_200); // Below 15s cutoff
  const auditor = new FairPlayAuditor({ baselineElo: 1500 });
  const controller = new HumanizerController(
    { targetElo: 1500, lowClockCutoffMs: 15_000 },
    new HeuristicPolicyAdapter(),
    clocks,
    overlay,
    auditor
  );

  const decision = await controller.evaluateAndScheduleDraw(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "Stockfish 19 WASM",
      lines: [
        makeLine(1, "c4d5", 160, [720, 200, 80]),
        makeLine(2, "e2d3", 70, [480, 320, 200]),
      ],
    },
    { immediateForTest: true }
  );
  assert.equal(decision.status, "SUPPRESSED");
  assert.equal(decision.reason, "LOW_CLOCK_CUTOFF");
});

test("Complexity delay scales from quiet (0.8s-1.5s) to sharp tactical (4.0s-9.5s) and board mutation cancels pending timers", async () => {
  const quietAnalysis: EngineAnalysis = {
    fen: MIDGAME_FEN,
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    legalMoveCount: 16,
    tacticalMoveCount: 0,
    shallowDepth6: { depth: 6, bestUci: "c4d5", centipawns: 110, mate: null },
    lines: [makeLine(1, "c4d5", 110, [600, 280, 120]), makeLine(2, "e2d3", 70, [500, 320, 180])],
  };
  const sharpAnalysis: EngineAnalysis = {
    fen: MIDGAME_FEN,
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    legalMoveCount: 46,
    tacticalMoveCount: 14,
    shallowDepth6: { depth: 6, bestUci: "a2a3", centipawns: -20, mate: null },
    lines: [makeLine(1, "f3g5", 260, [860, 100, 40]), makeLine(2, "e2d3", 40, [460, 340, 200])],
  };

  const qScore = computePositionComplexity(quietAnalysis, 0.14);
  const sScore = computePositionComplexity(sharpAnalysis, 0.32);
  assert.ok(sScore > qScore + 0.4, `Expected sharp (${sScore}) >> quiet (${qScore})`);

  const quietDelay = sampleLogNormalDelayMs(0.0, {
    enabled: true,
    targetElo: 1500,
    maxAllowedBlunderCp: 130,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.14,
    maxHintsPerGame: 3,
    forcedRecaptureMarginCp: 150,
    endgamePieceCutoff: 6,
    lowClockCutoffMs: 15_000,
    lowClockTaperStartMs: 25_000,
    quietDelayMinMs: 800,
    quietDelayMaxMs: 1500,
    sharpDelayMinMs: 4000,
    sharpDelayMaxMs: 9500,
  }, () => 0.5);
  const sharpDelay = sampleLogNormalDelayMs(1.0, {
    enabled: true,
    targetElo: 1500,
    maxAllowedBlunderCp: 130,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.14,
    maxHintsPerGame: 3,
    forcedRecaptureMarginCp: 150,
    endgamePieceCutoff: 6,
    lowClockCutoffMs: 15_000,
    lowClockTaperStartMs: 25_000,
    quietDelayMinMs: 800,
    quietDelayMaxMs: 1500,
    sharpDelayMinMs: 4000,
    sharpDelayMaxMs: 9500,
  }, () => 0.5);
  assert.ok(quietDelay >= 800 && quietDelay <= 1500);
  assert.ok(sharpDelay >= 4000 && sharpDelay <= 9500);

  // Verify pending timer cancellation when board FEN mutates before delay elapses
  const overlay = new RecordingOverlayPort();
  const controller = new HumanizerController(
    {
      targetElo: 1500,
      quietDelayMinMs: 250,
      quietDelayMaxMs: 300,
      sharpDelayMinMs: 400,
      sharpDelayMaxMs: 500,
    },
    new StaticPolicyPort({ f3g5: 0.7, e2d3: 0.3 }),
    new FixedClockPort(180_000),
    overlay,
    new FairPlayAuditor({ baselineElo: 1500 })
  );

  const scheduled = await controller.evaluateAndScheduleDraw(sharpAnalysis);
  assert.equal(scheduled.status, "SCHEDULED");
  controller.onBoardMutated("8/8/8/8/8/8/4K3/4k3 b - - 0 1");
  await new Promise((r) => setTimeout(r, 60));
  controller.cancelPending("TEST_CLEANUP");
  assert.equal(overlay.drawn.length, 0);
});

test("Boltzmann temperature scales inversely with targetElo and concentrates higher Elo onto top move", () => {
  assert.ok(computeEloTemperature(900) > computeEloTemperature(2400));

  const lines = [
    makeLine(1, "c4d5", 130, [680, 220, 100]),
    makeLine(2, "e2d3", 95, [600, 260, 140]),
    makeLine(3, "b2b3", 70, [540, 290, 170]),
  ];
  const priors = new Map([
    ["c4d5", 0.45],
    ["e2d3", 0.35],
    ["b2b3", 0.2],
  ]);

  const lowElo = selectHumanizedCandidate(
    lines,
    priors,
    {
      enabled: true,
      targetElo: 900,
      maxAllowedBlunderCp: 130,
      minHumanPriorProb: 0.03,
      criticalWdlThreshold: 0.14,
      maxHintsPerGame: 3,
      forcedRecaptureMarginCp: 150,
      endgamePieceCutoff: 6,
      lowClockCutoffMs: 15_000,
      lowClockTaperStartMs: 25_000,
      quietDelayMinMs: 800,
      quietDelayMaxMs: 1500,
      sharpDelayMinMs: 4000,
      sharpDelayMaxMs: 9500,
    },
    computeEloTemperature(900),
    false,
    () => 0.1
  );

  const highElo = selectHumanizedCandidate(
    lines,
    priors,
    {
      enabled: true,
      targetElo: 2400,
      maxAllowedBlunderCp: 130,
      minHumanPriorProb: 0.03,
      criticalWdlThreshold: 0.14,
      maxHintsPerGame: 3,
      forcedRecaptureMarginCp: 150,
      endgamePieceCutoff: 6,
      lowClockCutoffMs: 15_000,
      lowClockTaperStartMs: 25_000,
      quietDelayMinMs: 800,
      quietDelayMaxMs: 1500,
      sharpDelayMinMs: 4000,
      sharpDelayMaxMs: 9500,
    },
    computeEloTemperature(2400),
    false,
    () => 0.1
  );

  const pTopLow = lowElo.distribution[0]?.probability ?? 0;
  const pTopHigh = highElo.distribution[0]?.probability ?? 0;
  assert.ok(pTopHigh > pTopLow, `Expected 2400 Elo top prob (${pTopHigh}) > 900 Elo (${pTopLow})`);
});

test("FairPlayAuditor detects rapid critical S_i spikes, raises ELEVATED (+0.08 WDL & 2x T), triggers LOCKOUT blocking all overlays, and persists 20-game window", async () => {
  const storage = new InMemoryFairPlayStorage();
  const auditor = new FairPlayAuditor({ baselineElo: 1200, storage });

  const trapAnalysis = (idx: number): EngineAnalysis => ({
    fen: `r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 ${idx + 10}`,
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    shallowDepth6: { depth: 6, bestUci: "e2d3", centipawns: 20, mate: null },
    lines: [
      makeLine(1, "f3g5", 240, [820, 120, 60]), // E = 0.88
      makeLine(2, "e2d3", 10, [480, 320, 200]), // E = 0.64 -> Delta_E = 0.24 >= 0.15
    ],
  });

  // First rapid low-prior deep critical match -> 1 S_i spike + ELEVATED check
  const rec1 = auditor.recordCompletedMove({
    fenBefore: trapAnalysis(1).fen,
    playedUci: "f3g5",
    analysisBefore: trapAnalysis(1),
    humanPrior: 0.08,
    elapsedMs: 1200,
    remainingClockMs: 160_000,
  });
  assert.ok(rec1 && rec1.isCriticalTrap && rec1.matchedDeepOnlyWin && rec1.isSiSpike);
  assert.equal(auditor.getSnapshot().currentGameSiSpikes, 1);

  // Verify ELEVATED tier boosts WDL threshold by +0.08 and doubles temperature T
  for (let i = 0; i < 6; i++) {
    auditor.recordCompletedMove({
      fenBefore: `${MIDGAME_FEN.slice(0, -1)}${i + 2}`,
      playedUci: "c4d5",
      analysisBefore: {
        fen: MIDGAME_FEN,
        turn: "w",
        depth: 16,
        engineBackend: "Stockfish 19 WASM",
        lines: [
          makeLine(1, "c4d5", 100, [620, 260, 120]),
          makeLine(2, "e2d3", 70, [560, 280, 160]),
        ],
      },
      humanPrior: 0.4,
      elapsedMs: 3200,
      remainingClockMs: 140_000,
    });
  }

  const snapBeforeSecondSpike = auditor.getSnapshot();
  assert.ok(
    snapBeforeSecondSpike.riskLevel === "ELEVATED" || snapBeforeSecondSpike.riskLevel === "LOCKOUT"
  );
  if (snapBeforeSecondSpike.riskLevel === "ELEVATED") {
    const elevatedPolicy = auditor.getRiskPolicy();
    assert.equal(elevatedPolicy.temperatureMultiplier, 2.0);
    assert.equal(elevatedPolicy.criticalWdlDeltaAdd, 0.08);
    assert.equal(elevatedPolicy.blockAllOverlays, false);
  }

  // Second rapid critical S_i spike in same game -> GUARANTEED LOCKOUT
  const rec2 = auditor.recordCompletedMove({
    fenBefore: trapAnalysis(2).fen,
    playedUci: "f3g5",
    analysisBefore: trapAnalysis(2),
    humanPrior: 0.06,
    elapsedMs: 1100,
    remainingClockMs: 155_000,
  });
  assert.ok(rec2 && rec2.isSiSpike);

  const lockSnap = auditor.getSnapshot();
  assert.equal(lockSnap.riskLevel, "LOCKOUT");
  assert.equal(lockSnap.lockedOut, true);
  assert.ok(lockSnap.warnings.some((w) => w.code === "LOCKOUT_SPIKE_LIMIT"));
  assert.equal(auditor.getRiskPolicy().blockAllOverlays, true);

  // Wire into HumanizerController and verify LOCKOUT blocks every overlay draw call
  const overlay = new RecordingOverlayPort();
  const controller = new HumanizerController(
    { targetElo: 1200, criticalWdlThreshold: 0.14 },
    new StaticPolicyPort({ f3g5: 0.65, e2d3: 0.35 }),
    new FixedClockPort(180_000),
    overlay,
    auditor
  );
  const blockedDecision = await controller.evaluateAndScheduleDraw(trapAnalysis(3), {
    immediateForTest: true,
  });
  assert.equal(blockedDecision.status, "SUPPRESSED");
  assert.equal(blockedDecision.reason, "LOCKOUT");
  assert.equal(overlay.drawn.length, 0);
  assert.ok(overlay.clearedReasons.includes("LOCKOUT"));

  // Persist finished games into 20-game sliding window and reload in fresh auditor instance
  for (let g = 0; g < 22; g++) {
    auditor.recordCompletedMove({
      fenBefore: MIDGAME_FEN,
      playedUci: "c4d5",
      analysisBefore: {
        fen: MIDGAME_FEN,
        turn: "w",
        depth: 16,
        engineBackend: "Stockfish 19 WASM",
        lines: [makeLine(1, "c4d5", 80, [560, 300, 140]), makeLine(2, "e2d3", 60, [520, 320, 160])],
      },
      humanPrior: 0.5,
      elapsedMs: 2500,
      remainingClockMs: 120_000,
    });
    await auditor.finishGame(`game-${g}`);
  }

  const reloaded = new FairPlayAuditor({ baselineElo: 1200, storage });
  await reloaded.loadPersistedWindow();
  assert.equal(reloaded.getSnapshot().slidingWindowGames, 20);
  assert.ok(expectedScoreFromLine(makeLine(1, "c4d5", 80, [600, 200, 200])) === 0.7);
});

test("ChessForgeHumanizedPipeline coordinates move auditing, HumanizerController, and circuit breaker end-to-end", async () => {
  const overlay = new RecordingOverlayPort();
  const engine: EnginePort = {
    async analyze(fen) {
      return {
        fen,
        turn: "w",
        depth: 16,
        engineBackend: "Stockfish 19 WASM",
        shallowDepth6: { depth: 6, bestUci: "e2d3", centipawns: 25, mate: null },
        lines: [
          makeLine(1, "c4d5", 170, [740, 180, 80]),
          makeLine(2, "e2d3", 65, [480, 320, 200]),
        ],
      };
    },
  };

  const pipeline = new ChessForgeHumanizedPipeline({
    enginePort: engine,
    policyPort: new HeuristicPolicyAdapter(),
    clockPort: new FixedClockPort(180_000),
    overlayPort: overlay,
    storage: new InMemoryFairPlayStorage(),
    config: { targetElo: 1500, criticalWdlThreshold: 0.14, maxHintsPerGame: 2 },
  });

  await pipeline.initialize();
  const d1 = await pipeline.onBoardStateObserved(
    MIDGAME_FEN,
    null,
    { multiPv: 4, maxDepth: 16, skillLevel: 20, cpuProfile: "balanced" },
    { isHumanTurn: true, immediateForTest: true }
  );
  assert.equal(d1.status, "DRAWN");
  assert.equal(overlay.drawn.length, 1);

  const nextFen = "r1bq1rk1/pp2bppp/2n1pn2/3P4/3P4/2N1PN2/PP2BPPP/R1BQ1RK1 b - - 0 9";
  await pipeline.onBoardStateObserved(
    nextFen,
    "c4d5",
    { multiPv: 4, maxDepth: 16, skillLevel: 20, cpuProfile: "balanced" },
    { isHumanTurn: false, immediateForTest: true }
  );
  assert.equal(pipeline.getFairPlaySnapshot().currentGameMoves, 1);
  pipeline.dispose();
});
