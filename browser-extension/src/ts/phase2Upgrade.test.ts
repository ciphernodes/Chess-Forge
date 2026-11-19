import test from "node:test";
import assert from "node:assert/strict";

import {
  ELO_1600_PRESET,
  GenericDomBoardGeometryAdapter,
  type BoardStateSnapshot,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EngineMultiPvPort,
  type EngineMultiPvResult,
  type MultiPvCandidateLine,
} from "./autoPlayPorts.ts";
import { HumanizerMoveSelector } from "./humanizerMoveSelector.ts";
import {
  GradualRatingCalibrator,
  OpeningPreferenceEngine,
} from "./openingPreferenceMatrix.ts";
import {
  BookAndTablebaseRouter,
  type BookMoveCandidate,
  type OpeningBookPort,
} from "./bookAndTablebaseRouter.ts";
import { BehavioralStateMachine } from "./behavioralStateMachine.ts";
import {
  MonotonicClockTracker,
  SessionPacingManager,
  computeEffectiveTimeMs,
  computeTimeControlTroubleCurve,
} from "./clockAndSessionManager.ts";
import { FairPlayAuditor } from "./fairPlayAuditor.ts";
import { AutoPlayOrchestrator } from "./autoPlayOrchestrator.ts";
import { KinematicPointerExecutor } from "./kinematicPointerExecutor.ts";
import type { OnnxPolicyRunner } from "./ports.ts";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

test("HumanizerMoveSelector wires OnnxPolicyRunner directly without synthetic fallback when ONNX succeeds across 1200/1600/2000", async () => {
  const observedElos: number[] = [];
  const fakeOnnx: OnnxPolicyRunner = {
    async inferMoveProbs(_fen, targetElo, candidateUcis) {
      observedElos.push(targetElo);
      const probs = new Map<string, number>();
      // Authentic rating-conditioned ONNX output:
      // 1200 favors e2e4 overwhelmingly, while giving d2d4 negligible 0.005 probability (< 0.03 minHumanPriorProb)
      // 2000 favors c2c4 cleanly while also scoring d2d4 high
      for (const uci of candidateUcis) {
        if (targetElo <= 1250) {
          probs.set(uci, uci === "e2e4" ? 0.92 : uci === "d2d4" ? 0.005 : 0.075);
        } else if (targetElo <= 1650) {
          probs.set(uci, uci === "d2d4" ? 0.72 : uci === "e2e4" ? 0.25 : 0.03);
        } else {
          probs.set(uci, uci === "c2c4" ? 0.65 : uci === "d2d4" ? 0.30 : 0.05);
        }
      }
      return probs;
    },
  };

  // Lines constructed so d2d4 is a central move that synthetic heuristic fallback WOULD boost above 0.03!
  const lines: MultiPvCandidateLine[] = [
    { rank: 1, move: "d2d4", san: "d4", centipawns: 35, depth: 16, wdl: [430, 410, 160] },
    { rank: 2, move: "e2e4", san: "e4", centipawns: 32, depth: 16, wdl: [425, 410, 165] },
    { rank: 3, move: "c2c4", san: "c4", centipawns: 28, depth: 16, wdl: [415, 420, 165] },
  ];

  // Disabled by default -> falls back to heuristic priors unless opted in
  const defaultSelector = new HumanizerMoveSelector(
    { targetElo: 1200, randomFn: () => 0.1 },
    { onnxRunner: fakeOnnx }
  );
  assert.equal(defaultSelector.isOnnxPolicyEnabled(), false);
  const heuristicRes = await defaultSelector.selectMoveWithOnnx({
    fen: START_FEN,
    turn: "w",
    lines,
  });
  assert.equal(heuristicRes.priorSource, "HEURISTIC_FALLBACK");
  assert.equal(observedElos.length, 0);

  // Opt-in ONNX active for 1200/1600/2000: pure ONNX priors without heuristic mixing
  const onnxSelector = new HumanizerMoveSelector(
    { targetElo: 1200, minHumanPriorProb: 0.03, randomFn: () => 0.05 },
    { onnxRunner: fakeOnnx, useOnnxPolicy: true }
  );
  assert.equal(onnxSelector.isOnnxPolicyEnabled(), true);

  const res1200 = await onnxSelector.selectMoveWithOnnx({ fen: START_FEN, turn: "w", lines });
  assert.equal(res1200.priorSource, "ONNX_MAIA2");
  // d2d4 had 0.005 from ONNX -> strictly excluded because synthetic fallback wasn't mixed in
  assert.ok(res1200.excludedComputerTactics.includes("d2d4"));
  assert.equal(res1200.selected?.line.move, "e2e4");

  onnxSelector.updateConfig({ targetElo: 1600 });
  const res1600 = await onnxSelector.selectMoveWithOnnx({ fen: START_FEN, turn: "w", lines });
  assert.equal(res1600.priorSource, "ONNX_MAIA2");
  assert.equal(res1600.selected?.line.move, "d2d4");

  onnxSelector.updateConfig({ targetElo: 2000 });
  const res2000 = await onnxSelector.selectMoveWithOnnx({ fen: START_FEN, turn: "w", lines });
  assert.equal(res2000.priorSource, "ONNX_MAIA2");
  assert.equal(res2000.selected?.line.move, "c2c4");
  assert.deepEqual(observedElos, [1200, 1600, 2000]);

  // Falls back cleanly only if ONNX throws or returns empty
  const failingOnnx: OnnxPolicyRunner = {
    async inferMoveProbs() {
      throw new Error("ONNX runtime unavailable");
    },
  };
  onnxSelector.setOnnxRunner(failingOnnx, true);
  const fallbackOnError = await onnxSelector.selectMoveWithOnnx({
    fen: START_FEN,
    turn: "w",
    lines,
  });
  assert.equal(fallbackOnError.priorSource, "HEURISTIC_FALLBACK");
  assert.ok(fallbackOnError.selected !== null);
});

test("OpeningPreferenceEngine weights 1200/1600/2000 opening repertoires cleanly and defaults to enabled: false", async () => {
  const defaultEngine = new OpeningPreferenceEngine();
  assert.equal(defaultEngine.isEnabled(), false);

  const italianOrScotchCandidates: BookMoveCandidate[] = [
    { uci: "f1b5", san: "Bb5", games: 180_000, white: 68_000, draws: 68_000, black: 44_000 },
    { uci: "f1c4", san: "Bc4", games: 100_000, white: 38_000, draws: 35_000, black: 27_000 },
    { uci: "d2d4", san: "d4", games: 60_000, white: 23_000, draws: 21_000, black: 16_000 },
  ];

  // Disabled -> exact 1.0 identity multipliers
  const disabledWeighted = defaultEngine.weightBookCandidates(italianOrScotchCandidates, {
    targetElo: 1200,
    turn: "w",
    eco: "C44",
    historyUcis: ["e2e4", "e7e5", "g1f3", "b8c6"],
  });
  assert.ok(disabledWeighted.every((w) => w.repertoireMultiplier === 1.0));

  const enabledEngine = new OpeningPreferenceEngine({ enabled: true, topK: 3 });

  // 1200 boosts Italian (f1c4) & Scotch (d2d4) over Ruy Lopez (f1b5)
  const weights1200 = enabledEngine.weightBookCandidates(italianOrScotchCandidates, {
    targetElo: 1200,
    turn: "w",
    eco: "C44",
    openingName: "King's Knight",
    historyUcis: ["e2e4", "e7e5", "g1f3", "b8c6"],
  });
  const bc4_1200 = weights1200.find((w) => w.candidate.uci === "f1c4")!;
  const d4_1200 = weights1200.find((w) => w.candidate.uci === "d2d4")!;
  assert.ok(bc4_1200.repertoireMultiplier > 2.0);
  assert.ok(d4_1200.repertoireMultiplier > 1.8);

  // 1600 boosts QGD (e7e6) and Sicilian Najdorf (c7c5 / a7a6)
  const blackAfterD4: BookMoveCandidate[] = [
    { uci: "g8f6", san: "Nf6", games: 200_000, white: 72_000, draws: 75_000, black: 53_000 },
    { uci: "e7e6", san: "e6", games: 150_000, white: 55_000, draws: 58_000, black: 37_000 },
    { uci: "d7d5", san: "d5", games: 150_000, white: 56_000, draws: 57_000, black: 37_000 },
  ];
  const weights1600Qgd = enabledEngine.weightBookCandidates(blackAfterD4, {
    targetElo: 1600,
    turn: "b",
    eco: "D06",
    openingName: "Queen's Gambit",
  });
  assert.ok(weights1600Qgd.find((w) => w.candidate.uci === "e7e6")!.repertoireMultiplier > 1.8);

  // 2000 boosts Berlin Defense (3...Nf6 vs Bb5) & Grünfeld (d7d5 after Nf6 g6)
  const ruyLopezReplies: BookMoveCandidate[] = [
    { uci: "a7a6", san: "a6", games: 140_000, white: 52_000, draws: 56_000, black: 32_000 },
    { uci: "g8f6", san: "Nf6", games: 55_000, white: 19_000, draws: 24_000, black: 12_000 },
  ];
  const weights2000Berlin = enabledEngine.weightBookCandidates(ruyLopezReplies, {
    targetElo: 2000,
    turn: "b",
    eco: "C60",
    openingName: "Ruy Lopez",
    historyUcis: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
  });
  const berlinNf6 = weights2000Berlin.find((w) => w.candidate.uci === "g8f6")!;
  assert.ok(berlinNf6.repertoireMultiplier >= 2.5);

  // Wire into BookAndTablebaseRouter and verify Berlin pick for 2000 profile
  const fakeBookPort: OpeningBookPort = {
    async lookup() {
      return {
        inBook: true,
        eco: "C60",
        opening: "Ruy Lopez",
        source: "OFFLINE_ECO",
        moves: ruyLopezReplies,
      };
    },
  };
  const router = new BookAndTablebaseRouter(
    { openingBookPort: fakeBookPort, openingPreferenceEngine: enabledEngine },
    { enabled: true, randomFn: () => 0.9 }
  );
  const routed = await router.resolveTurn(
    "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
    "b",
    3,
    {
      targetElo: 2000,
      historyUcis: ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"],
    }
  );
  assert.equal(routed.handled, true);
  assert.equal(routed.selectedMoveUci, "g8f6");
});

test("GradualRatingCalibrator starts at userCurrentRating + 50, ramps over 100 games, and clamps single-session jumps < 300 points", () => {
  const disabledCal = new GradualRatingCalibrator({
    userCurrentRating: 1100,
    targetElo: 1800,
  });
  assert.equal(disabledCal.isEnabled(), false);
  assert.equal(disabledCal.getEffectiveRating(), 1800);

  const cal = new GradualRatingCalibrator({
    enabled: true,
    userCurrentRating: 1100,
    targetElo: 1850,
    rampGames: 100,
    maxSingleSessionJump: 500, // deliberately excessive -> strictly clamped to 299
  });

  // Game 0: strictly starts at userCurrentRating + 50 = 1150
  assert.equal(cal.getEffectiveRating(), 1150);

  // Even after completing 100 games in a single session, jump from session anchor (1150) stays < 300 (<= 1449)
  cal.recordGamesCompleted(100);
  const afterSingleSession = cal.getSnapshot();
  assert.equal(afterSingleSession.clampedBySessionLimit, true);
  assert.ok(
    Math.abs(afterSingleSession.effectiveRating - 1150) < 300,
    `Single-session rating jump ${afterSingleSession.effectiveRating - 1150} must be < 300`
  );
  assert.equal(afterSingleSession.effectiveRating, 1449);

  // Smooth multi-session ramp reaches target 1850 cleanly over separate sessions
  cal.startNewSession();
  const s2 = cal.getSnapshot();
  assert.equal(s2.effectiveRating, 1748);
  cal.startNewSession();
  assert.equal(cal.getEffectiveRating(), 1850);
});

test("BehavioralStateMachine seeds crypto entropy + sinusoidal fatigue, randomizes Stockfish hash ±10%, triggers 2-in-5 blunder tilt (-200 Elo for 10 moves), confidence boost, and hotkey/chat panic reset", () => {
  let fakeTime = 1_700_000_000_000;
  const auditor = new FairPlayAuditor({ baselineElo: 1600 });

  // Defaults to disabled
  const disabledBsm = new BehavioralStateMachine();
  assert.equal(disabledBsm.isEnabled(), false);
  assert.equal(disabledBsm.getRandomizedStockfishHashMb(64), 64);
  assert.equal(disabledBsm.getEffectiveProfile(1600).effectiveElo, 1600);

  let clearedCount = 0;
  const bsm = new BehavioralStateMachine({
    enabled: true,
    nowMs: () => fakeTime,
    onClearTelemetry: () => {
      clearedCount++;
    },
  });
  bsm.attachFairPlayAuditor(auditor);

  // Crypto entropy seed & ±10% Stockfish hash allocation
  const seed1 = bsm.getSessionEntropy();
  assert.equal(seed1.sessionSeedHex.length, 32);
  const hash100 = bsm.getRandomizedStockfishHashMb(100);
  assert.ok(hash100 >= 90 && hash100 <= 110, `Expected 90..110 MB, got ${hash100}`);

  // Sinusoidal fatigue wave drifts across moves & elapsed minutes
  const fatigueStart = bsm.computeSinusoidalFatigueState();
  fakeTime += 25 * 60_000;
  for (let i = 0; i < 6; i++) {
    bsm.recordMoveOutcome({ cpLoss: 15 });
  }
  const fatigueLater = bsm.computeSinusoidalFatigueState();
  assert.notEqual(fatigueStart.phaseRad, fatigueLater.phaseRad);
  assert.ok(fatigueLater.delayMultiplier >= 0.88 && fatigueLater.delayMultiplier <= 1.3);

  // Slight positive confidence boost after winning material
  bsm.recordMoveOutcome({ cpLoss: 5, materialGainCp: 320 });
  const confident = bsm.getEffectiveProfile(1600);
  assert.ok(confident.effectiveElo > 1600 && confident.effectiveElo <= 1660);
  assert.equal(confident.isTilted, false);

  // 2 blunders (>= 150 cpLoss) within 5 moves -> Tilt (-200 Elo for next 10 moves)
  bsm.recordMoveOutcome({ cpLoss: 185 });
  assert.equal(bsm.getEffectiveProfile(1600).isTilted, false); // only 1 blunder
  bsm.recordMoveOutcome({ cpLoss: 20 });
  bsm.recordMoveOutcome({ cpLoss: 210 }); // 2nd blunder within 5 moves!
  const tilted = bsm.getEffectiveProfile(1600);
  assert.equal(tilted.isTilted, true);
  assert.equal(tilted.tiltMovesRemaining, 10);
  assert.equal(tilted.effectiveElo, 1400);

  // Record a move on auditor so we verify immediate telemetry clearing on panic reset
  auditor.recordCompletedMove({
    fenBefore: START_FEN,
    playedUci: "e2e4",
    analysisBefore: {
      fen: START_FEN,
      turn: "w",
      depth: 16,
      engineBackend: "mock",
      lines: [
        { rank: 1, uci: "e2e4", san: "e4", centipawns: 35, mate: null, winPct: 54, depth: 16 },
      ],
    },
    humanPrior: 0.45,
    elapsedMs: 1200,
    remainingClockMs: 180_000,
  });
  assert.equal(auditor.getSnapshot().currentGameMoves, 1);

  // Manual hotkey (Ctrl+Shift+X) or chat keyword panic reset
  const hotkeyFired = bsm.handleKeyDown({ key: "x", ctrlKey: true, shiftKey: true });
  assert.equal(hotkeyFired, true);
  assert.equal(clearedCount, 1);
  assert.equal(auditor.getSnapshot().currentGameMoves, 0);

  const panicState = bsm.getEffectiveProfile(1600);
  assert.equal(panicState.isPanicMode, true);
  assert.equal(panicState.panicMovesRemaining, 10);
  assert.ok(panicState.temperatureMultiplier >= 2.0);
  assert.ok(panicState.thinkTimeMultiplier >= 1.5);
  assert.ok(panicState.blunderCapAddCp >= 100);
  assert.ok(panicState.effectiveElo < 1600);

  // Counts down over 10 moves
  for (let m = 0; m < 10; m++) {
    bsm.recordMoveOutcome({ cpLoss: 40 });
  }
  assert.equal(bsm.getEffectiveProfile(1600).isPanicMode, false);

  // Chat keyword trigger
  const chatTriggered = bsm.inspectChatMessage("Wait, panic mode now!");
  assert.equal(chatTriggered, true);
  assert.equal(bsm.getEffectiveProfile(1600).isPanicMode, true);
  assert.equal(bsm.getPanicResetCount(), 2);
});

test("HumanizerMoveSelector low-clock error model injects 5% (<10s) and 12% (<5s) blunders overriding maxAllowedBlunderCp when enabled", () => {
  const lines: MultiPvCandidateLine[] = [
    { rank: 1, move: "e2e4", san: "e4", centipawns: 80, depth: 14, wdl: [520, 340, 140] },
    { rank: 2, move: "d2d4", san: "d4", centipawns: 70, depth: 14, wdl: [510, 345, 145] },
    { rank: 3, move: "g1h3", san: "Nh3", centipawns: -120, depth: 14, wdl: [210, 290, 500] }, // cpLoss = 200 >= 150!
  ];

  // Disabled by default -> g1h3 strictly excluded by 60cp blunder cap even at 3,000ms clock
  const defaultSelector = new HumanizerMoveSelector({
    targetElo: 2000,
    maxAllowedBlunderCp: 60,
    randomFn: () => 0.01,
  });
  const normalAt3s = defaultSelector.selectMove({
    fen: START_FEN,
    turn: "w",
    lines,
    clockSnapshot: {
      whiteRemainingMs: 3_000,
      blackRemainingMs: 120_000,
      activeRemainingMs: 3_000,
      capturedAtMs: Date.now(),
    },
  });
  assert.equal(normalAt3s.lowClockBlunderInjected, false);
  assert.ok(normalAt3s.excludedBlunderMoves.includes("g1h3"));

  // Enabled with fixed roll = 0.08: triggers at <5s (12% > 8%) but NOT at 8s (<10s is 5% < 8%)
  const selector = new HumanizerMoveSelector(
    { targetElo: 2000, maxAllowedBlunderCp: 60, randomFn: () => 0.08 },
    {
      lowClockErrorConfig: {
        enabled: true,
        randomFn: () => 0.08,
      },
    }
  );

  const at8s = selector.selectMove({
    fen: START_FEN,
    turn: "w",
    lines,
    clockSnapshot: {
      whiteRemainingMs: 8_000,
      blackRemainingMs: 120_000,
      activeRemainingMs: 8_000,
      capturedAtMs: Date.now(),
    },
  });
  assert.equal(at8s.lowClockBlunderInjected, false);

  const at4s = selector.selectMove({
    fen: START_FEN,
    turn: "w",
    lines,
    clockSnapshot: {
      whiteRemainingMs: 4_000,
      blackRemainingMs: 120_000,
      activeRemainingMs: 4_000,
      capturedAtMs: Date.now(),
    },
  });
  assert.equal(at4s.lowClockBlunderInjected, true);
  assert.equal(at4s.regime, "LOW_CLOCK_BLUNDER_INJECTION");
  assert.equal(at4s.selected?.line.move, "g1h3");

  // With roll = 0.03: triggers both at 8s (<10s: 5% > 3%) and at 4s
  selector.updateLowClockErrorConfig({ randomFn: () => 0.03 });
  const at8sTriggered = selector.selectMove({
    fen: START_FEN,
    turn: "w",
    lines,
    clockSnapshot: {
      whiteRemainingMs: 8_000,
      blackRemainingMs: 120_000,
      activeRemainingMs: 8_000,
      capturedAtMs: Date.now(),
    },
  });
  assert.equal(at8sTriggered.lowClockBlunderInjected, true);
  assert.equal(at8sTriggered.selected?.line.move, "g1h3");
});

test("MonotonicClockTracker uses performance.now() ignoring spoofed DOM labels, models effectiveTime + increment vs non-increment curves", () => {
  let monoNow = 10_000;
  const tracker = new MonotonicClockTracker({
    enabled: true,
    initialWhiteMs: 180_000,
    initialBlackMs: 180_000,
    incrementMs: 2_000,
    activeTurn: "w",
    nowMonotonicMs: () => monoNow,
  });

  // Store completely bogus DOM strings strictly as display metadata -> monotonic clock ignores them
  tracker.setDisplayClockLabels({
    whiteDisplayText: "00:01",
    blackDisplayText: "99:99",
  });
  assert.equal(tracker.getDisplayClockLabels().whiteDisplayText, "00:01");

  // White thinks for 4,500ms monotonically -> 180,000 - 4,500 + 2,000 = 177,500ms
  monoNow += 4_500;
  const afterWhite = tracker.recordMoveTimestamp("w");
  assert.equal(afterWhite.elapsedMs, 4_500);
  const wSnap = tracker.readClockState("w");
  assert.equal(wSnap.whiteRemainingMs, 177_500);

  // Black runs for 6,000ms without recording yet -> active black clock reads 174,000ms
  monoNow += 6_000;
  const bSnap = tracker.readClockState("b");
  assert.equal(bSnap.activeRemainingMs, 174_000);

  // Effective time formula: remaining + increment * 0.6
  assert.equal(computeEffectiveTimeMs(10_000, 5_000), 13_000);

  // Increment vs non-increment curves differ cleanly at identical raw remaining time (8s)
  const withInc = computeTimeControlTroubleCurve(8_000, 3_000);
  const noInc = computeTimeControlTroubleCurve(8_000, 0);
  assert.equal(withInc.mode, "INCREMENT");
  assert.equal(noInc.mode, "NO_INCREMENT");
  assert.equal(withInc.effectiveTimeMs, 9_800);
  assert.equal(noInc.effectiveTimeMs, 8_000);
  assert.ok(
    withInc.compressionFactor > noInc.compressionFactor,
    "Increment time trouble retains higher thinking floor than sudden-death 0s increment"
  );
});

test("SessionPacingManager enforces opening floors, opponentElo & circadian scaling, sufficiency checks, classical -300 step-down, 30g/4h/2h caps, post-game review, and optional chat", () => {
  let wallMs = 1_700_000_000_000;
  let localHour = 14; // daytime
  const flaggedEvents: number[] = [];

  // Defaults to enabled: false
  const disabledPacing = new SessionPacingManager();
  assert.equal(disabledPacing.isEnabled(), false);
  assert.equal(disabledPacing.sampleOpeningPacingFloorMs(1), 0);
  assert.equal(disabledPacing.planChatMessage("GAME_START").send, false);

  const pacing = new SessionPacingManager({
    enabled: true,
    nowWallMs: () => wallMs,
    getLocalHour: () => localHour,
    randomFn: () => 0.5,
    onSufficiencyAnomaly: (chk) => flaggedEvents.push(chk.elapsedMs),
  });

  // Opening move pacing minimums
  const m1 = pacing.sampleOpeningPacingFloorMs(1);
  const m3 = pacing.sampleOpeningPacingFloorMs(3);
  const m10 = pacing.sampleOpeningPacingFloorMs(10);
  assert.ok(m1 >= 3_000 && m1 <= 8_000, `Move 1 expected 3..8s, got ${m1}`);
  assert.ok(m3 >= 2_000 && m3 <= 5_000, `Move 3 expected 2..5s, got ${m3}`);
  assert.ok(m10 < m3 && m10 < 500, `Move 10 expected natural taper <500ms, got ${m10}`);

  // Opponent Elo & circadian (00:00-06:00) scaling
  assert.ok(
    pacing.computeOpponentEloMultiplier(1500, 1950) >
      pacing.computeOpponentEloMultiplier(1500, 1150)
  );
  assert.equal(pacing.computeCircadianMultiplier(14), 1.0);
  localHour = 3;
  assert.ok(pacing.computeCircadianMultiplier() >= 1.2);
  localHour = 14;

  // Think-time sufficiency check (elapsed < minimumTime * 0.7 flagged repeatedly)
  const minReq = pacing.computeMinimumThinkTimeMs(16, 0.8);
  const fastThreshold = Math.round(minReq * 0.7) - 50;
  assert.equal(pacing.recordThinkTimeObservation(fastThreshold, 16, 0.8).anomalyFlagged, false);
  assert.equal(pacing.recordThinkTimeObservation(fastThreshold, 16, 0.8).anomalyFlagged, false);
  const thirdFast = pacing.recordThinkTimeObservation(fastThreshold, 16, 0.8);
  assert.equal(thirdFast.isInsufficient, true);
  assert.equal(thirdFast.anomalyFlagged, true);
  assert.equal(flaggedEvents.length, 1);

  // Time-control classification & classical -300 Elo step-down
  assert.equal(pacing.classifyTimeControl(60_000, 1_000).isRecommended, true); // bullet
  assert.equal(pacing.classifyTimeControl(180_000, 2_000).isRecommended, true); // blitz
  const classical = pacing.classifyTimeControl(1_800_000, 30_000);
  assert.equal(classical.category, "classical");
  assert.equal(classical.isRecommended, false);
  assert.equal(classical.eloStepDown, 300);

  // Post-game review wait in [30_000, 120_000]
  const reviewMs = pacing.samplePostGameReviewWaitMs();
  assert.ok(reviewMs >= 30_000 && reviewMs <= 120_000);

  // Optional rate-limited chat disabled by default, then verified when opted in
  assert.equal(pacing.planChatMessage("GAME_START").send, false);
  pacing.updateConfig({
    chat: {
      enabled: true,
      maxMidGameMessagesPerGame: 1,
      minCooldownBetweenMessagesMs: 45_000,
      midGameTriggerProbability: 1.0,
    },
  });
  pacing.recordGameStarted();
  assert.equal(pacing.planChatMessage("GAME_START").message, "gl hf");
  assert.equal(pacing.planChatMessage("GAME_START").send, false); // cooldown + duplicate block
  wallMs += 50_000;
  const mid1 = pacing.planChatMessage("MID_GAME");
  assert.equal(mid1.send, true);
  wallMs += 50_000;
  assert.equal(pacing.planChatMessage("MID_GAME").send, false); // capped at 1 per game
  assert.equal(pacing.planChatMessage("GAME_END").message, "gg");

  // Session caps: 30 games/day & 4h session -> mandatory 2h cooldown
  for (let g = 0; g < 30; g++) {
    pacing.recordGameCompleted();
  }
  const cappedByGames = pacing.canStartNewGame();
  assert.equal(cappedByGames.allowed, false);
  assert.equal(cappedByGames.cooldownRemainingMs, 2 * 60 * 60 * 1000);

  // Advance 1h -> still locked in mandatory 2h cooldown
  wallMs += 60 * 60 * 1000;
  assert.equal(pacing.canStartNewGame().allowed, false);

  // Advance past 2h + 24h roll-over -> resumes cleanly, then test 4h continuous session cap
  wallMs += 24 * 60 * 60 * 1000;
  assert.equal(pacing.canStartNewGame().allowed, true);
  wallMs += 4 * 60 * 60 * 1000 + 1000;
  const cappedByDuration = pacing.canStartNewGame();
  assert.equal(cappedByDuration.allowed, false);
  assert.equal(cappedByDuration.reason, "SESSION_DURATION_LIMIT");
  assert.equal(cappedByDuration.cooldownRemainingMs, 2 * 60 * 60 * 1000);
});

test("AutoPlayOrchestrator integrates Phase 2 ONNX, Tilt/Calibration, MonotonicClock, and SessionCooldown end-to-end", async () => {
  let monoNow = 1_000;
  let wallMs = 1_700_000_000_000;
  const observedOnnxElos: number[] = [];

  const boardElem = {
    getAttribute: () => "false",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    querySelector: () => null,
    dispatchEvent: () => true,
    ownerDocument: null,
  } as unknown as Element;

  const geometry = new GenericDomBoardGeometryAdapter({ boardElement: boardElem });
  const executor = new KinematicPointerExecutor(geometry, {
    ...ELO_1600_PRESET.executor,
    approachMinMs: 5,
    approachMaxMs: 5,
    dwellMinMs: 2,
    dwellMaxMs: 2,
    dragMinMs: 5,
    dragMaxMs: 5,
    preferAnimationFrame: false,
  });

  const selector = new HumanizerMoveSelector(
    { ...ELO_1600_PRESET.selector, randomFn: () => 0.1 },
    {
      useOnnxPolicy: true,
      onnxRunner: {
        async inferMoveProbs(_fen, targetElo, ucis) {
          observedOnnxElos.push(targetElo);
          const m = new Map<string, number>();
          ucis.forEach((u, i) => m.set(u, i === 0 ? 0.85 : 0.15 / Math.max(1, ucis.length - 1)));
          return m;
        },
      },
    }
  );

  const monotonicClock = new MonotonicClockTracker({
    enabled: true,
    initialWhiteMs: 120_000,
    initialBlackMs: 120_000,
    incrementMs: 2_000,
    nowMonotonicMs: () => monoNow,
  });

  const pacing = new SessionPacingManager({
    enabled: true,
    nowWallMs: () => wallMs,
    getLocalHour: () => 14,
    randomFn: () => 0.5,
  });

  const bsm = new BehavioralStateMachine({ enabled: true, nowMs: () => wallMs });
  // Trigger tilt (-200 Elo)
  bsm.recordMoveOutcome({ cpLoss: 190 });
  bsm.recordMoveOutcome({ cpLoss: 200 });

  const calibrator = new GradualRatingCalibrator({
    enabled: true,
    userCurrentRating: 1550,
    targetElo: 1800,
    rampGames: 100,
  });

  let currentBoard: BoardStateSnapshot = {
    fen: START_FEN,
    turn: "w",
    isFlipped: false,
    moveNumber: 1,
    capturedAtMs: wallMs,
  };

  const enginePort: EngineMultiPvPort = {
    async analyzeMultiPv(): Promise<EngineMultiPvResult> {
      return {
        fen: currentBoard.fen,
        depth: 16,
        lines: [
          { rank: 1, move: "e2e4", san: "e4", centipawns: 35, depth: 16, wdl: [430, 410, 160] },
          { rank: 2, move: "d2d4", san: "d4", centipawns: 30, depth: 16, wdl: [420, 415, 165] },
        ],
      };
    },
  };

  const fallbackClockPort: ClockStatePort = {
    readClockState(): ClockStateSnapshot {
      return {
        whiteRemainingMs: 120_000,
        blackRemainingMs: 120_000,
        activeRemainingMs: 120_000,
        capturedAtMs: wallMs,
      };
    },
  };

  const orchestrator = new AutoPlayOrchestrator(
    {
      boardObserver: {
        getCurrentBoardState: () => currentBoard,
        subscribe: () => () => {},
      },
      boardGeometry: geometry,
      enginePort,
      clockPort: fallbackClockPort,
      moveSelector: selector,
      pointerExecutor: executor,
      behavioralStateMachine: bsm,
      sessionPacingManager: pacing,
      monotonicClockTracker: monotonicClock,
      ratingCalibrator: calibrator,
    },
    {
      controlledSide: "w",
      enabled: true,
      useOnnxPolicy: true,
      opponentElo: 1800,
      timeControl: { initialTimeMs: 1_800_000, incrementMs: 30_000 }, // classical -> -300 Elo
      delayWaiter: async () => {},
    }
  );

  const cycle1 = await orchestrator.handleBoardTransition(currentBoard);
  assert.equal(cycle1.status, "EXECUTED");
  assert.equal(cycle1.selection?.priorSource, "ONNX_MAIA2");
  // Expected effective Elo fed into ONNX:
  // calibrator start = 1550+50 = 1600 -> classical (-300) = 1300 -> tilt (-200) = 1100!
  assert.equal(observedOnnxElos[0], 1100);
  // Move 1 opening floor [3000, 8000] enforced
  assert.ok((cycle1.delayCalculation?.delayMs ?? 0) >= 3_000);

  // Now simulate hitting 4h continuous session duration -> orchestrator skips under SESSION_COOLDOWN_ACTIVE
  wallMs += 4 * 60 * 60 * 1000 + 5000;
  currentBoard = {
    ...currentBoard,
    fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
    moveNumber: 2,
  };
  const skipped = await orchestrator.handleBoardTransition(currentBoard);
  assert.equal(skipped.status, "SKIPPED");
  assert.equal(skipped.reason, "SESSION_COOLDOWN_ACTIVE");

  orchestrator.dispose();
});
