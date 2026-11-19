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
} from "./autoPlayPorts.ts";
import {
  KinematicPointerExecutor,
  computeAccumulatedMotorDrift,
  generateCubicBezierTrajectory,
  type FrameScheduler,
} from "./kinematicPointerExecutor.ts";
import {
  InputModeController,
  LichessPremoveScheduler,
  getPremoveCalibrationForElo,
} from "./inputModeController.ts";
import {
  DomPromotionAdapter,
  PromotionHandler,
  type PromotionDomDocument,
} from "./promotionHandler.ts";
import {
  EnvironmentWatchdog,
  ObservableWebSocketMonitor,
  type BridgeAlertPort,
  type DocumentVisibilityMonitorTarget,
  type TabFocusAlertPayload,
} from "./environmentWatchdog.ts";
import { DualStateReconciler, STANDARD_START_FEN } from "./dualStateReconciler.ts";
import { HumanizerMoveSelector } from "./humanizerMoveSelector.ts";
import { AutoPlayOrchestrator } from "./autoPlayOrchestrator.ts";

function createFakeBoardElement(): Element {
  return {
    getAttribute: () => "false",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
    querySelector: () => null,
    dispatchEvent: () => true,
    ownerDocument: null,
  } as unknown as Element;
}

function createVirtualScheduler(): {
  readonly scheduler: FrameScheduler;
  readonly getClock: () => number;
  readonly waits: number[];
} {
  let virtualNow = 1_000;
  const waits: number[] = [];
  const scheduler: FrameScheduler = {
    now: () => virtualNow,
    async waitMs(ms, signal) {
      if (signal?.aborted) throw new Error("ABORTED");
      waits.push(ms);
      virtualNow += Math.max(0, ms);
    },
    async waitNextFrame(signal) {
      if (signal?.aborted) throw new Error("ABORTED");
      virtualNow += 16;
      return virtualNow;
    },
  };
  return { scheduler, getClock: () => virtualNow, waits };
}

test("Refined KinematicPointerExecutor defaults to enabled: false and preserves baseline kinematics until opted in", async () => {
  const { scheduler } = createVirtualScheduler();
  const geometry = new GenericDomBoardGeometryAdapter({
    boardElement: createFakeBoardElement(),
  });
  const executor = new KinematicPointerExecutor(
    geometry,
    { ...ELO_1600_PRESET.executor, randomFn: () => 0.4 },
    scheduler
  );

  assert.equal(executor.getRefinedProfile().enabled, false);
  const baseline = await executor.executeMove("e2", "e4", { gamePly: 40, positionCriticality: 0.95 });
  assert.equal(baseline.executed, true);
  assert.deepEqual(baseline.appliedMotorDrift, { x: 0, y: 0 });
  assert.equal(baseline.correctionMovements, 0);
  assert.equal(baseline.microDoubleTapApplied, false);
});

test("Refined KinematicPointerExecutor applies accumulating dominant-side motor drift, fractal trajectory noise, 1-3 post-approach corrections (30-60ms pauses), sharp-position +20ms dwell, and 2% micro-double-tap", async () => {
  const { scheduler, waits } = createVirtualScheduler();
  const geometry = new GenericDomBoardGeometryAdapter({
    boardElement: createFakeBoardElement(),
  });

  // 1. Motor drift accumulates across gamePly toward configurable dominant side
  const driftRight0 = computeAccumulatedMotorDrift(
    20,
    { ...new KinematicPointerExecutor(geometry).getRefinedProfile(), enabled: true, dominantSide: "right" },
    () => 0.5
  );
  const driftRight40 = computeAccumulatedMotorDrift(
    40,
    { ...new KinematicPointerExecutor(geometry).getRefinedProfile(), enabled: true, dominantSide: "right" },
    () => 0.5
  );
  const driftLeft40 = computeAccumulatedMotorDrift(
    40,
    { ...new KinematicPointerExecutor(geometry).getRefinedProfile(), enabled: true, dominantSide: "left" },
    () => 0.5
  );
  assert.ok(driftRight40.x > driftRight0.x && driftRight40.x > 0);
  assert.ok(driftLeft40.x < 0);

  // 2. Perlin/fractal drag-path displacement deviates smoothly from pure minimum-jerk Bezier curve
  const basePlan = generateCubicBezierTrajectory(
    { x: 100, y: 300 },
    { x: 250, y: 120 },
    260,
    { ...ELO_1600_PRESET.executor, microTremorPx: 0 },
    () => 0.5,
    16
  );
  const fractalPlan = generateCubicBezierTrajectory(
    { x: 100, y: 300 },
    { x: 250, y: 120 },
    260,
    { ...ELO_1600_PRESET.executor, microTremorPx: 0 },
    () => 0.5,
    16,
    {
      ...new KinematicPointerExecutor(geometry).getRefinedProfile(),
      enabled: true,
      fractalAmplitudeMinPx: 0.8,
      fractalAmplitudeMaxPx: 1.5,
    }
  );
  let maxDeviation = 0;
  for (let i = 1; i < basePlan.waypoints.length - 1; i++) {
    const d = Math.hypot(
      fractalPlan.waypoints[i].x - basePlan.waypoints[i].x,
      fractalPlan.waypoints[i].y - basePlan.waypoints[i].y
    );
    if (d > maxDeviation) maxDeviation = d;
  }
  assert.ok(maxDeviation > 0.15 && maxDeviation <= 2.2, `Expected fractal deviation, got ${maxDeviation}`);
  assert.deepEqual(
    { x: fractalPlan.waypoints[0].x, y: fractalPlan.waypoints[0].y },
    { x: 100, y: 300 }
  );

  // 3. Sharp criticality dwell boost (+20ms), post-approach corrections (1-3 steps, 30-60ms pauses), and 2% micro-double-tap
  const quietExecutor = new KinematicPointerExecutor(
    geometry,
    { ...ELO_1600_PRESET.executor, dwellMinMs: 60, dwellMaxMs: 60, randomFn: () => 0.5 },
    createVirtualScheduler().scheduler,
    { enabled: true, dominantSide: "right", microDoubleTapProbability: 0 }
  );
  const quietMove = await quietExecutor.executeMove("e2", "e4", {
    gamePly: 10,
    positionCriticality: 0.1,
  });

  const sharpExecutor = new KinematicPointerExecutor(
    geometry,
    { ...ELO_1600_PRESET.executor, dwellMinMs: 60, dwellMaxMs: 60, randomFn: () => 0.5 },
    scheduler,
    { enabled: true, dominantSide: "right", microDoubleTapProbability: 0.02 }
  );
  let releaseCallbackTime = 0;
  const sharpMove = await sharpExecutor.executeMove("e2", "e4", {
    gamePly: 30,
    positionCriticality: 1.0,
    onImmediatePointerRelease: (ts) => {
      releaseCallbackTime = ts;
    },
  });

  assert.equal(sharpMove.executed, true);
  assert.equal(sharpMove.dwellDurationMs, quietMove.dwellDurationMs + 20);
  assert.ok((sharpMove.correctionMovements ?? 0) >= 2);
  assert.ok(waits.some((w) => w >= 30 && w <= 60));
  assert.equal(sharpMove.microDoubleTapApplied, false);
  assert.ok(releaseCallbackTime > 0 && sharpMove.releasedAtMs === releaseCallbackTime);

  // Verify 2% micro-double-tap triggers deterministically when random roll < 0.02
  const microTapExecutor = new KinematicPointerExecutor(
    geometry,
    { ...ELO_1600_PRESET.executor, dwellMinMs: 60, dwellMaxMs: 60, randomFn: () => 0.01 },
    createVirtualScheduler().scheduler,
    { enabled: true, dominantSide: "right", microDoubleTapProbability: 0.02 }
  );
  const microTapMove = await microTapExecutor.executeMove("e2", "e4", {
    gamePly: 30,
    positionCriticality: 1.0,
  });
  assert.equal(microTapMove.microDoubleTapApplied, true);
  const clickEvents = microTapMove.eventSequence.filter((e) => e.type === "click");
  assert.equal(clickEvents.length, 2);
});

test("InputModeController samples 70/30 click/drag shifting toward clicks under low time, and Lichess premoves honor 1200:30%, 1600:10%, 2000:5% miss/fallback rates", async () => {
  const disabledCtrl = new InputModeController();
  assert.equal(disabledCtrl.isEnabled(), false);
  assert.equal(
    disabledCtrl.selectInputMode({ targetElo: 1600, remainingClockMs: 120_000 }).inputMode,
    "drag"
  );

  // Verify exact 70% normal click rate and low-time shift toward clicks
  let roll = 0.72;
  const ctrl = new InputModeController({
    enabled: true,
    randomFn: () => roll,
  });
  assert.equal(ctrl.computeClickProbability(120_000), 0.7);
  assert.ok(ctrl.computeClickProbability(3_000) > 0.88);

  // Roll = 0.72 -> drag at normal 120s clock (0.72 >= 0.70), click at 3s clock (0.72 < ~0.89)
  assert.equal(
    ctrl.selectInputMode({ targetElo: 1600, remainingClockMs: 120_000 }).inputMode,
    "drag"
  );
  assert.equal(
    ctrl.selectInputMode({ targetElo: 1600, remainingClockMs: 3_000 }).inputMode,
    "click"
  );

  // Rating-calibrated premove miss/fallback benchmarks
  assert.equal(getPremoveCalibrationForElo(1200).premoveMissFallbackRate, 0.3);
  assert.equal(getPremoveCalibrationForElo(1600).premoveMissFallbackRate, 0.1);
  assert.equal(getPremoveCalibrationForElo(2000).premoveMissFallbackRate, 0.05);

  // 1200 skips speculative non-obvious premoves completely
  const skipNonObvious1200 = ctrl.selectInputMode({
    targetElo: 1200,
    remainingClockMs: 60_000,
    isOpponentTurn: true,
    isObviousRecaptureOrForced: false,
    candidatePremoveUci: "d8d5",
  });
  assert.equal(skipNonObvious1200.premoveScheduled, false);

  // r1200 consumes 3 rolls (attempt=0.05, miss=0.20 < 0.30, fallbackMode=0.10);
  // r1600 consumes 2 rolls (attempt=0.05 < 0.38, miss=0.20 >= 0.10)
  let idx = 0;
  const rolls = [0.05, 0.2, 0.1, 0.05, 0.2];
  const schedulerCtrl = new InputModeController({
    enabled: true,
    randomFn: () => rolls[idx++ % rolls.length],
  });
  const executor = new KinematicPointerExecutor(
    new GenericDomBoardGeometryAdapter({ boardElement: createFakeBoardElement() }),
    { ...ELO_1600_PRESET.executor, approachMinMs: 2, approachMaxMs: 2, dragMinMs: 2, dragMaxMs: 2, dwellMinMs: 2, dwellMaxMs: 2, preferAnimationFrame: false },
    createVirtualScheduler().scheduler
  );
  const premoveScheduler = new LichessPremoveScheduler(schedulerCtrl, executor);

  // At 1200 (30% miss): miss roll 0.20 < 0.30 -> miss/fallback
  const r1200 = await premoveScheduler.trySchedulePremove({
    targetElo: 1200,
    remainingClockMs: 60_000,
    candidateUci: "d8d5",
    isObviousRecaptureOrForced: true,
  });
  assert.equal(r1200.decision.premoveMissFallbackApplied, true);
  assert.equal(r1200.executed, null);

  // At 1600 (10% miss): miss roll 0.20 >= 0.10 -> premove scheduled & executed
  const r1600 = await premoveScheduler.trySchedulePremove({
    targetElo: 1600,
    remainingClockMs: 60_000,
    candidateUci: "d8d5",
    isObviousRecaptureOrForced: true,
  });
  assert.equal(r1600.decision.inputMode, "premove");
  assert.equal(r1600.decision.premoveScheduled, true);
  assert.equal(r1600.executed?.executed, true);
});

test("PromotionHandler detects Lichess dialogs & Chess.com auto-queen, applies 200-400ms recognition pause, and injects 2% non-losing rook underpromotion at 1200 Elo", async () => {
  const clickedSelectors: string[] = [];
  const lichessDoc: PromotionDomDocument = {
    querySelector(sel: string) {
      if (sel.includes("#promotion-choice")) {
        return {
          querySelector(innerSel: string) {
            return {
              click() {
                clickedSelectors.push(innerSel);
              },
            } as unknown as Element;
          },
        } as unknown as Element;
      }
      return null;
    },
  };

  // Disabled by default
  const disabledHandler = new PromotionHandler(
    new DomPromotionAdapter({ doc: lichessDoc, platform: "lichess" })
  );
  assert.equal(disabledHandler.isEnabled(), false);
  const disabledRes = await disabledHandler.handlePostMovePromotion({
    uciMove: "e7e8q",
    turn: "w",
    targetElo: 1200,
  });
  assert.equal(disabledRes.handled, false);
  assert.equal(disabledRes.reason, "DISABLED_DEFAULT");

  // Lichess dialog with 200-400 ms recognition pause + 2% non-losing rook underpromotion at 1200 Elo
  const observedWaits: number[] = [];
  const handler = new PromotionHandler(
    new DomPromotionAdapter({ doc: lichessDoc, platform: "lichess" }),
    {
      enabled: true,
      randomFn: () => 0.01, // < 0.02 -> triggers 2% rook underpromotion when non-losing
      waitMs: async (ms) => {
        observedWaits.push(ms);
      },
    }
  );

  const rookPromoRes = await handler.handlePostMovePromotion({
    uciMove: "e7e8q",
    turn: "w",
    targetElo: 1200,
    candidateLines: [
      { rank: 1, move: "e7e8q", centipawns: 950, depth: 14 },
      { rank: 2, move: "e7e8r", centipawns: 520, depth: 14 },
    ],
  });
  assert.equal(rookPromoRes.handled, true);
  assert.equal(rookPromoRes.chosenPiece, "r");
  assert.equal(rookPromoRes.underpromotionApplied, true);
  assert.equal(rookPromoRes.effectiveUciMove, "e7e8r");
  assert.ok(
    rookPromoRes.recognitionPauseMs >= 200 && rookPromoRes.recognitionPauseMs <= 400
  );
  assert.equal(observedWaits[0], rookPromoRes.recognitionPauseMs);
  assert.ok(clickedSelectors[0].includes("rook"));

  // Non-winning/losing rook promotion must NOT underpromote to rook even if RNG < 0.02
  const unsafeRes = await handler.handlePostMovePromotion({
    uciMove: "e7e8q",
    turn: "w",
    targetElo: 1200,
    candidateLines: [
      { rank: 1, move: "e7e8q", centipawns: 180, depth: 14 },
      { rank: 2, move: "e7e8r", centipawns: -250, depth: 14 }, // losing if rook!
    ],
  });
  assert.equal(unsafeRes.chosenPiece, "q");
  assert.equal(unsafeRes.underpromotionApplied, false);

  // Chess.com auto-queen bypasses dialog click immediately
  const autoQueenHandler = new PromotionHandler(
    new DomPromotionAdapter({
      platform: "chesscom",
      readChessComAutoQueen: () => true,
    }),
    { enabled: true, randomFn: () => 0.5 }
  );
  const autoRes = await autoQueenHandler.handlePostMovePromotion({
    uciMove: "a7a8q",
    turn: "w",
    targetElo: 1600,
  });
  assert.equal(autoRes.handled, true);
  assert.equal(autoRes.usedAutoQueen, true);
  assert.equal(autoRes.recognitionPauseMs, 0);
});

test("EnvironmentWatchdog pauses immediately + alerts bridge on document.hidden or socket disconnect, and resumes on reconnect ONLY after dual-source parity verification on user's turn", async () => {
  let pausedCalls = 0;
  let resumedCalls = 0;
  let active = true;
  const alerts: TabFocusAlertPayload[] = [];
  let visibilityListeners: Array<() => void> = [];

  const mockDoc: DocumentVisibilityMonitorTarget & {
    hidden: boolean;
    visibilityState: string;
  } = {
    hidden: false,
    visibilityState: "visible",
    addEventListener(type, listener) {
      if (type === "visibilitychange") visibilityListeners.push(listener);
    },
    removeEventListener(type, listener) {
      if (type === "visibilitychange") {
        visibilityListeners = visibilityListeners.filter((l) => l !== listener);
      }
    },
  };

  const socketMonitor = new ObservableWebSocketMonitor(true);
  const bridgeAlertPort: BridgeAlertPort = {
    sendTabFocusAlert(payload) {
      alerts.push(payload);
    },
  };

  let scrapedBoard: BoardStateSnapshot = {
    fen: STANDARD_START_FEN,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  };
  let domMoves: string[] = [];

  const reconciler = new DualStateReconciler({ enabled: true });
  const watchdog = new EnvironmentWatchdog(
    {
      orchestrator: {
        pause: () => {
          pausedCalls++;
          active = false;
        },
        resume: () => {
          resumedCalls++;
          active = true;
        },
        isAutonomousActive: () => active,
      },
      documentSource: mockDoc,
      socketSource: socketMonitor,
      bridgeAlertPort,
      reconcileHooks: {
        controlledSide: "w",
        dualStateReconciler: reconciler,
        scrapeBoardState: () => scrapedBoard,
        readMoveTokens: () => domMoves,
      },
    },
    { enabled: false, bridgeTarget: "android" }
  );

  // Disabled by default -> no pause or alert
  assert.equal(watchdog.isEnabled(), false);
  await watchdog.handleVisibilityUpdate(true, "hidden");
  assert.equal(pausedCalls, 0);
  assert.equal(alerts.length, 0);

  // Enable and start monitoring
  watchdog.setEnabled(true);
  mockDoc.hidden = false;
  mockDoc.visibilityState = "visible";
  watchdog.start();

  // 1. Simulate document.hidden === true -> pauses immediately + dispatches TAB_FOCUS_ALERT
  mockDoc.hidden = true;
  mockDoc.visibilityState = "hidden";
  for (const l of visibilityListeners) l();
  await Promise.resolve();
  assert.equal(pausedCalls, 1);
  assert.equal(active, false);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].reason, "TAB_HIDDEN");
  assert.equal(alerts[0].bridgeTarget, "android");

  // 2. Restore tab while state has a DOM vs MoveList parity mismatch -> MUST NOT RESUME
  scrapedBoard = {
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", // after 1. e4
    turn: "b",
    isFlipped: false,
    capturedAtMs: Date.now(),
  };
  domMoves = []; // stale move list disagrees!
  mockDoc.hidden = false;
  mockDoc.visibilityState = "visible";
  const mismatchRecovery = await watchdog.handleVisibilityUpdate(false, "visible");
  assert.equal(mismatchRecovery?.status, "PARITY_MISMATCH");
  assert.equal(mismatchRecovery?.resumed, false);
  assert.equal(resumedCalls, 0);

  // 3. Reconcile parity matches ("1. e4 c5" -> White's turn) on socket disconnect -> wait for reconnect
  socketMonitor.setConnected(false, "WS_CLOSE_1006");
  await Promise.resolve();
  assert.equal(alerts[alerts.length - 1].reason, "WEBSOCKET_DISCONNECTED");

  // Parity verified, BUT turn is Black ("b") while user plays White ("w") -> MUST NOT RESUME
  scrapedBoard = {
    fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    turn: "b",
    isFlipped: false,
    capturedAtMs: Date.now(),
  };
  domMoves = ["e4"];
  socketMonitor.setConnected(true);
  const wrongTurnRecovery = await watchdog.attemptVerifiedResume();
  assert.equal(wrongTurnRecovery.status, "NOT_USER_TURN");
  assert.equal(wrongTurnRecovery.parityVerified, true);
  assert.equal(wrongTurnRecovery.resumed, false);
  assert.equal(resumedCalls, 0);

  // 4. Reconnect with full parity verified AND it is still White's ("w") turn -> RESUMES cleanly!
  scrapedBoard = {
    fen: "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  };
  domMoves = ["e4", "c5"];
  const okRecovery = await watchdog.attemptVerifiedResume();
  assert.equal(okRecovery.status, "RESUMED");
  assert.equal(okRecovery.parityVerified, true);
  assert.equal(okRecovery.isUsersTurn, true);
  assert.equal(okRecovery.resumed, true);
  assert.equal(resumedCalls, 1);
  assert.equal(active, true);

  watchdog.dispose();
});

test("AutoPlayOrchestrator executes all think-time delays BEFORE pointer movement starts with zero post-release buffering", async () => {
  const { scheduler } = createVirtualScheduler();
  const geometry = new GenericDomBoardGeometryAdapter({
    boardElement: createFakeBoardElement(),
  });
  const executor = new KinematicPointerExecutor(
    geometry,
    {
      ...ELO_1600_PRESET.executor,
      approachMinMs: 20,
      approachMaxMs: 20,
      dragMinMs: 20,
      dragMaxMs: 20,
      dwellMinMs: 40,
      dwellMaxMs: 40,
      preferAnimationFrame: false,
      randomFn: () => 0.5,
    },
    scheduler,
    { enabled: true, microDoubleTapProbability: 0 }
  );

  const timeline: string[] = [];
  const origExecute = executor.executeMove.bind(executor);
  executor.executeMove = async (from, to, opts) => {
    timeline.push("POINTER_START");
    const res = await origExecute(from, to, {
      ...opts,
      onImmediatePointerRelease: () => {
        timeline.push("POINTER_RELEASE_IMMEDIATE_SEND");
      },
    });
    timeline.push("POINTER_END");
    return res;
  };

  const boardSnap: BoardStateSnapshot = {
    fen: STANDARD_START_FEN,
    turn: "w",
    isFlipped: false,
    moveNumber: 1,
    capturedAtMs: Date.now(),
  };

  const enginePort: EngineMultiPvPort = {
    async analyzeMultiPv(): Promise<EngineMultiPvResult> {
      return {
        fen: boardSnap.fen,
        depth: 16,
        lines: [
          { rank: 1, move: "e2e4", san: "e4", centipawns: 35, depth: 16, wdl: [430, 410, 160] },
          { rank: 2, move: "d2d4", san: "d4", centipawns: 30, depth: 16, wdl: [420, 415, 165] },
        ],
      };
    },
  };

  const clockPort: ClockStatePort = {
    readClockState(): ClockStateSnapshot {
      return {
        whiteRemainingMs: 180_000,
        blackRemainingMs: 180_000,
        activeRemainingMs: 180_000,
        capturedAtMs: Date.now(),
      };
    },
  };

  const inputModeController = new InputModeController({
    enabled: true,
    normalClickRatio: 1.0,
    randomFn: () => 0.2,
  });

  const orchestrator = new AutoPlayOrchestrator(
    {
      boardObserver: {
        getCurrentBoardState: () => boardSnap,
        subscribe: () => () => {},
      },
      boardGeometry: geometry,
      enginePort,
      clockPort,
      moveSelector: new HumanizerMoveSelector({
        ...ELO_1600_PRESET.selector,
        randomFn: () => 0.1,
      }),
      pointerExecutor: executor,
      inputModeController,
    },
    {
      controlledSide: "w",
      enabled: true,
      delayWaiter: async (ms) => {
        timeline.push(`THINK_WAIT:${ms}`);
      },
    }
  );

  const cycle = await orchestrator.handleBoardTransition(boardSnap);
  assert.equal(cycle.status, "EXECUTED");
  assert.equal(cycle.inputModeDecision?.inputMode, "click");
  assert.ok(timeline[0].startsWith("THINK_WAIT:"));
  assert.equal(timeline[1], "POINTER_START");
  assert.equal(timeline[2], "POINTER_RELEASE_IMMEDIATE_SEND");
  assert.equal(timeline[3], "POINTER_END");

  orchestrator.dispose();
});
