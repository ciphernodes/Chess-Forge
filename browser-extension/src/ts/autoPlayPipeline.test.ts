import test from "node:test";
import assert from "node:assert/strict";

import {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  GenericDomBoardGeometryAdapter,
  GenericDomClockStateAdapter,
  parseClockDurationMs,
  type BoardBoundingRect,
  type BoardStateObserverPort,
  type BoardStateSnapshot,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EngineMultiPvPort,
  type EngineMultiPvQuery,
  type EngineMultiPvResult,
  type MultiPvCandidateLine,
  type PieceColor,
} from "./autoPlayPorts.ts";
import {
  HumanizerMoveSelector,
  computeInverseEloTemperature,
  computeWdlExpectedScoreDelta,
} from "./humanizerMoveSelector.ts";
import {
  KinematicPointerExecutor,
  computeSquareGeometry,
  computeSquareTargetPoint,
  generateCubicBezierTrajectory,
  minimumJerkProgress,
  minimumJerkVelocity,
  type FrameScheduler,
} from "./kinematicPointerExecutor.ts";
import {
  AutoPlayOrchestrator,
  computePositionComplexityMetrics,
  createHumanizedAutoPlaySystem,
  sampleComplexityThinkDelay,
} from "./autoPlayOrchestrator.ts";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MIDGAME_FEN = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 9";

class MockDomElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: MockDomElement[] = [];
  readonly dispatchedEvents: Array<{
    type: string;
    clientX?: number;
    clientY?: number;
    buttons?: number;
    button?: number;
  }> = [];
  textContent = "";
  ownerDocument: MockDocument | null = null;
  private rect: BoardBoundingRect;

  constructor(
    tagName: string,
    rect: BoardBoundingRect = { left: 100, top: 80, width: 400, height: 400 }
  ) {
    this.tagName = tagName;
    this.rect = rect;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect(): DOMRect {
    return {
      ...this.rect,
      right: this.rect.left + this.rect.width,
      bottom: this.rect.top + this.rect.height,
      x: this.rect.left,
      y: this.rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  querySelector(selector: string): Element | null {
    const sqMatch = selector.match(/\[data-square="([^"]+)"\]/);
    if (sqMatch) {
      return (
        (this.children.find(
          (c) => c.getAttribute("data-square") === sqMatch[1]
        ) as unknown as Element) ?? null
      );
    }
    const idMatch = selector.match(/^#(.+)$/);
    if (idMatch) {
      return (
        (this.children.find((c) => c.getAttribute("id") === idMatch[1]) as unknown as Element) ??
        null
      );
    }
    return null;
  }

  dispatchEvent(event: Event): boolean {
    const ev = event as unknown as {
      type: string;
      clientX?: number;
      clientY?: number;
      buttons?: number;
      button?: number;
    };
    this.dispatchedEvents.push({
      type: ev.type,
      clientX: ev.clientX,
      clientY: ev.clientY,
      buttons: ev.buttons,
      button: ev.button,
    });
    return true;
  }
}

class MockDocument {
  readonly listeners = new Map<string, Set<(ev: Event) => void>>();
  readonly root: MockDomElement;

  constructor(root: MockDomElement) {
    this.root = root;
    root.ownerDocument = this;
    root.children.forEach((c) => {
      c.ownerDocument = this;
    });
  }

  addEventListener(type: string, cb: (ev: Event) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  removeEventListener(type: string, cb: (ev: Event) => void): void {
    this.listeners.get(type)?.delete(cb);
  }

  emitUserEvent(type: string, isTrusted: boolean = true): void {
    const ev = { type, isTrusted } as unknown as Event;
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }

  elementFromPoint(): Element | null {
    return this.root as unknown as Element;
  }
}

function buildMock8x8DomBoard(isFlipped = false): {
  boardEl: MockDomElement;
  doc: MockDocument;
} {
  const boardRect: BoardBoundingRect = {
    left: 100,
    top: 80,
    width: 400,
    height: 400,
  };
  const boardEl = new MockDomElement("div", boardRect);
  boardEl.setAttribute("data-flipped", String(isFlipped));

  const files = "abcdefgh";
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = `${files[f]}${8 - r}`;
      const col = isFlipped ? 7 - f : f;
      const row = isFlipped ? 7 - r : r;
      const sqEl = new MockDomElement("div", {
        left: boardRect.left + col * 50,
        top: boardRect.top + row * 50,
        width: 50,
        height: 50,
      });
      sqEl.setAttribute("data-square", sq);
      boardEl.children.push(sqEl);
    }
  }
  const doc = new MockDocument(boardEl);
  return { boardEl, doc };
}

class VirtualFrameScheduler implements FrameScheduler {
  private currentMs = 0;
  readonly waitCalls: number[] = [];

  waitNextFrame(signal?: AbortSignal): Promise<number> {
    if (signal?.aborted) {
      return Promise.reject(new Error("ABORTED"));
    }
    this.currentMs += 16;
    return Promise.resolve(this.currentMs);
  }

  waitMs(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(new Error("ABORTED"));
    }
    this.waitCalls.push(ms);
    this.currentMs += ms;
    return Promise.resolve();
  }

  now(): number {
    return this.currentMs;
  }
}

class FixedClock implements ClockStatePort {
  remainingMs: number | null;

  constructor(remainingMs: number | null) {
    this.remainingMs = remainingMs;
  }

  readClockState(): ClockStateSnapshot {
    return {
      whiteRemainingMs: this.remainingMs,
      blackRemainingMs: this.remainingMs,
      activeRemainingMs: this.remainingMs,
      capturedAtMs: Date.now(),
    };
  }
}

class MockBoardObserver implements BoardStateObserverPort {
  private current: BoardStateSnapshot | null;
  private readonly listeners = new Set<(state: BoardStateSnapshot) => void>();

  constructor(initial: BoardStateSnapshot | null = null) {
    this.current = initial;
  }

  getCurrentBoardState(): BoardStateSnapshot | null {
    return this.current;
  }

  subscribe(onStateChange: (snapshot: BoardStateSnapshot) => void): () => void {
    this.listeners.add(onStateChange);
    return () => {
      this.listeners.delete(onStateChange);
    };
  }

  pushState(snapshot: BoardStateSnapshot): void {
    this.current = snapshot;
    this.listeners.forEach((cb) => cb(snapshot));
  }

  setStateQuietly(snapshot: BoardStateSnapshot): void {
    this.current = snapshot;
  }
}

function makeLine(
  rank: number,
  move: string,
  centipawns: number,
  wdl: readonly [number, number, number],
  extra: Partial<MultiPvCandidateLine> = {}
): MultiPvCandidateLine {
  return {
    rank,
    move,
    san: extra.san ?? move,
    centipawns,
    depth: extra.depth ?? 16,
    wdl,
    ...extra,
  };
}

test("HumanizerMoveSelector filters blunders & alien tactics (<0.03) except single non-losing recapture", () => {
  const selector = new HumanizerMoveSelector({
    ...ELO_1600_PRESET.selector,
    maxAllowedBlunderCp: 100,
    minHumanPriorProb: 0.03,
    criticalWdlThreshold: 0.14,
    randomFn: () => 0.15,
  });

  const lines = [
    makeLine(1, "f3g5", 160, [740, 180, 80]), // alien computer move: prior 0.01
    makeLine(2, "e2d3", 120, [520, 310, 170]), // human candidate: prior 0.62, cpLoss 40 <= 100
    makeLine(3, "b2b3", 95, [470, 330, 200]), // human candidate: prior 0.35, cpLoss 65 <= 100
    makeLine(4, "g2g4", -40, [260, 290, 450]), // blunder: cpLoss 200 > 100
  ];

  const res = selector.selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines,
    humanPriors: { f3g5: 0.01, e2d3: 0.62, b2b3: 0.35, g2g4: 0.02 },
    clockPort: new FixedClock(120_000),
  });

  assert.ok(res.selected);
  assert.ok(res.excludedComputerTactics.includes("f3g5"));
  assert.ok(res.excludedBlunderMoves.includes("g2g4"));
  assert.notEqual(res.selected.line.move, "f3g5");
  assert.notEqual(res.selected.line.move, "g2g4");
  assert.equal(res.recaptureExceptionApplied, false);

  // Exception case: only one non-losing recapture exists -> keep it even if prior < 0.03
  const recaptureOnly = selector.selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines: [
      makeLine(1, "c4d5", 210, [780, 150, 70], { san: "cxd5", isRecapture: true }),
      makeLine(2, "a2a3", -20, [320, 320, 360]), // cpLoss 230 > 100 (losing)
    ],
    humanPriors: { c4d5: 0.02, a2a3: 0.45 },
    clockPort: new FixedClock(120_000),
  });

  assert.ok(recaptureOnly.selected);
  assert.equal(recaptureOnly.selected.line.move, "c4d5");
  assert.equal(recaptureOnly.recaptureExceptionApplied, true);
  assert.equal(recaptureOnly.regime, "FORCED_RECAPTURE_EXCEPTION");
});

test("HumanizerMoveSelector applies Delta_E criticality gate, inverse-Elo Boltzmann rotation, and <15s time-trouble mode", () => {
  assert.ok(computeInverseEloTemperature(1200) > computeInverseEloTemperature(1600));
  assert.ok(computeInverseEloTemperature(1600) > computeInverseEloTemperature(2000));

  // Quiet position (Delta_E < 0.14): favors natural high-prior human move
  const quietLines = [
    makeLine(1, "a2a3", 60, [480, 360, 160]), // E = 0.66
    makeLine(2, "e2d3", 45, [450, 370, 180]), // E = 0.635 -> Delta_E = 0.025 < 0.14
    makeLine(3, "c4d5", 35, [430, 380, 190]),
  ];
  assert.ok(computeWdlExpectedScoreDelta(quietLines) < 0.14);

  const selector1600 = new HumanizerMoveSelector({
    ...ELO_1600_PRESET.selector,
    randomFn: () => 0.25,
  });
  const quietRes = selector1600.selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines: quietLines,
    humanPriors: { a2a3: 0.12, e2d3: 0.72, c4d5: 0.16 },
    clockPort: new FixedClock(180_000),
  });
  assert.equal(quietRes.isCriticalPosition, false);
  assert.equal(quietRes.regime, "QUIET_NATURAL_HUMAN");
  assert.equal(quietRes.distribution[0].line.move, "e2d3");

  // Critical position (Delta_E >= 0.14): Boltzmann top-1/2/3 rotation; higher Elo concentrates more on PV1
  const criticalLines = [
    makeLine(1, "c4d5", 170, [740, 180, 80]), // E = 0.83
    makeLine(2, "e2d3", 125, [470, 320, 210]), // E = 0.63 -> Delta_E = 0.20 >= 0.14
    makeLine(3, "b2b3", 90, [420, 340, 240]),
    makeLine(4, "h2h3", 75, [400, 350, 250]), // PV4 should not be in top-3 critical pool
  ];
  const priors = { c4d5: 0.45, e2d3: 0.35, b2b3: 0.14, h2h3: 0.06 };

  const res1200 = new HumanizerMoveSelector(ELO_1200_PRESET.selector).selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines: criticalLines,
    humanPriors: priors,
    clockPort: new FixedClock(180_000),
  });
  const res2000 = new HumanizerMoveSelector({
    ...ELO_2000_PRESET.selector,
    maxAllowedBlunderCp: 100,
  }).selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines: criticalLines,
    humanPriors: priors,
    clockPort: new FixedClock(180_000),
  });

  assert.equal(res1200.regime, "CRITICAL_BOLTZMANN_TOP3");
  assert.equal(res1200.distribution.length, 3);
  assert.ok(
    res2000.distribution[0].probability > res1200.distribution[0].probability,
    "Higher Elo must concentrate probability mass more tightly onto top move"
  );

  // Time-trouble mode (< 15,000 ms): reduces search depth/think time and boosts temperature T
  const troubleRes = selector1600.selectMove({
    fen: MIDGAME_FEN,
    turn: "w",
    lines: criticalLines,
    humanPriors: priors,
    clockPort: new FixedClock(9_000),
  });
  assert.equal(troubleRes.searchBudget.timeTroubleActive, true);
  assert.ok(
    troubleRes.searchBudget.recommendedDepth <
      ELO_1600_PRESET.selector.standardSearchDepth
  );
  assert.ok(
    troubleRes.searchBudget.recommendedThinkTimeMs <
      ELO_1600_PRESET.selector.standardThinkTimeMs
  );
  assert.ok(troubleRes.temperatureUsed > ELO_1600_PRESET.selector.baseTemperature);
});

test("KinematicPointerExecutor clamps 2D Gaussian jitter inside inner 60% of square, curves Bézier path with minimum-jerk velocity, and dispatches full Pointer/Mouse events", async () => {
  const { boardEl } = buildMock8x8DomBoard(false);
  const geomPort = new GenericDomBoardGeometryAdapter({ boardElement: boardEl as unknown as Element });
  const rect = geomPort.getBoardRect()!;
  const e2Geom = computeSquareGeometry("e2", rect, false);

  // Verify 2D Gaussian jitter stays strictly within inner 60% across 250 samples
  for (let i = 0; i < 250; i++) {
    const pt = computeSquareTargetPoint("e2", rect, false, ELO_1600_PRESET.executor);
    assert.ok(
      pt.x >= e2Geom.minInnerX - 0.01 && pt.x <= e2Geom.maxInnerX + 0.01,
      `x=${pt.x} outside inner 60% [${e2Geom.minInnerX}, ${e2Geom.maxInnerX}]`
    );
    assert.ok(
      pt.y >= e2Geom.minInnerY - 0.01 && pt.y <= e2Geom.maxInnerY + 0.01,
      `y=${pt.y} outside inner 60% [${e2Geom.minInnerY}, ${e2Geom.maxInnerY}]`
    );
  }

  // Verify minimum-jerk bell-curve velocity profile (slow start -> peak at tau=0.5 -> slow end)
  assert.equal(minimumJerkProgress(0), 0);
  assert.equal(minimumJerkProgress(1), 1);
  assert.equal(minimumJerkVelocity(0), 0);
  assert.equal(minimumJerkVelocity(1), 0);
  assert.ok(minimumJerkVelocity(0.5) > minimumJerkVelocity(0.15));
  assert.ok(minimumJerkVelocity(0.5) > minimumJerkVelocity(0.85));

  // Verify Bézier perpendicular arc curvature deviates from straight chord mid-flight
  const plan = generateCubicBezierTrajectory(
    { x: 325, y: 405 },
    { x: 325, y: 305 },
    220,
    ELO_1600_PRESET.executor
  );
  assert.ok(plan.waypoints.length >= 6);
  const mid = plan.waypoints[Math.floor(plan.waypoints.length / 2)];
  assert.ok(Math.abs(mid.x - 325) > 0.5, "Expected perpendicular arc curvature along Bézier curve");

  // Execute move e2 -> e4 with virtual frame scheduler
  const scheduler = new VirtualFrameScheduler();
  const executor = new KinematicPointerExecutor(
    geomPort,
    ELO_1600_PRESET.executor,
    scheduler
  );

  const result = await executor.executeMove("e2", "e4");
  assert.equal(result.executed, true);
  assert.equal(result.aborted, false);
  assert.ok(result.dwellDurationMs >= 40 && result.dwellDurationMs <= 110);

  const types = result.eventSequence.map((e) => e.type);
  assert.ok(types.includes("pointerover"));
  assert.ok(types.includes("pointerenter"));
  assert.ok(types.includes("pointermove"));
  assert.ok(types.includes("pointerdown"));
  assert.ok(types.includes("pointerup"));
  assert.ok(types.includes("mouseup"));
  assert.ok(types.includes("click"));
  assert.ok(
    scheduler.waitCalls.some((ms) => ms >= 40 && ms <= 110),
    "Expected dwell pause between 40 ms and 110 ms"
  );

  // Verify AbortSignal cancels execution cleanly
  const ac = new AbortController();
  ac.abort("TEST_CANCEL");
  const aborted = await executor.executeMove("e2", "e4", { signal: ac.signal });
  assert.equal(aborted.executed, false);
  assert.equal(aborted.aborted, true);
});

test("AutoPlayOrchestrator scales log-normal delays, compresses on low clock, and aborts on manual mouse move or FEN change", async () => {
  // 1. Verify complexity-scaled log-normal delay distributions
  const obviousComplexity = computePositionComplexityMetrics(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      isFlipped: false,
      legalMoveCount: 24,
      isRecaptureOpportunity: true,
      capturedAtMs: Date.now(),
    },
    {
      fen: MIDGAME_FEN,
      depth: 16,
      isRecaptureOpportunity: true,
      shallowDepth6: { depth: 6, bestMove: "c4d5", centipawns: 200 },
      deepDepth16: { depth: 16, bestMove: "c4d5", centipawns: 205 },
      lines: [makeLine(1, "c4d5", 205, [760, 170, 70], { isRecapture: true })],
    },
    new HumanizerMoveSelector(ELO_1600_PRESET.selector).selectMove({
      fen: MIDGAME_FEN,
      turn: "w",
      lines: [makeLine(1, "c4d5", 205, [760, 170, 70], { isRecapture: true })],
    })
  );

  const obviousDelay = sampleComplexityThinkDelay(
    obviousComplexity,
    { whiteRemainingMs: 180_000, blackRemainingMs: 180_000, activeRemainingMs: 180_000, capturedAtMs: Date.now() },
    { ...ELO_1600_PRESET.orchestrator, randomFn: () => 0.5 }
  );
  assert.ok(
    obviousDelay.delayMs >= 900 && obviousDelay.delayMs <= 1800,
    `Expected obvious recapture delay in 900..1800ms, got ${obviousDelay.delayMs}`
  );

  const complexComplexity = computePositionComplexityMetrics(
    {
      fen: MIDGAME_FEN,
      turn: "w",
      isFlipped: false,
      legalMoveCount: 44,
      availableChecksCount: 4,
      availableCapturesCount: 6,
      capturedAtMs: Date.now(),
    },
    {
      fen: MIDGAME_FEN,
      depth: 16,
      shallowDepth6: { depth: 6, bestMove: "a2a3", centipawns: -15 },
      deepDepth16: { depth: 16, bestMove: "f3g5", centipawns: 240 },
      lines: [
        makeLine(1, "f3g5", 240, [820, 120, 60]),
        makeLine(2, "e2d3", 70, [480, 320, 200]),
      ],
    },
    new HumanizerMoveSelector(ELO_1600_PRESET.selector).selectMove({
      fen: MIDGAME_FEN,
      turn: "w",
      lines: [
        makeLine(1, "f3g5", 240, [820, 120, 60]),
        makeLine(2, "e2d3", 70, [480, 320, 200]),
      ],
    })
  );

  const complexDelay = sampleComplexityThinkDelay(
    complexComplexity,
    { whiteRemainingMs: 180_000, blackRemainingMs: 180_000, activeRemainingMs: 180_000, capturedAtMs: Date.now() },
    { ...ELO_1600_PRESET.orchestrator, randomFn: () => 0.5 }
  );
  assert.ok(
    complexDelay.delayMs >= 3500 && complexDelay.delayMs <= 8500,
    `Expected complex middlegame delay in 3500..8500ms, got ${complexDelay.delayMs}`
  );

  const compressedLowClock = sampleComplexityThinkDelay(
    complexComplexity,
    { whiteRemainingMs: 8_000, blackRemainingMs: 120_000, activeRemainingMs: 8_000, capturedAtMs: Date.now() },
    { ...ELO_1600_PRESET.orchestrator, randomFn: () => 0.5 }
  );
  assert.ok(compressedLowClock.clockCompressionFactor < 0.5);
  assert.ok(compressedLowClock.delayMs < complexDelay.delayMs * 0.5);

  // 2. Integration wiring + pre-execution FEN mutation guard & manual mouse abort guard
  const { boardEl, doc } = buildMock8x8DomBoard(false);
  const boardGeometry = new GenericDomBoardGeometryAdapter({
    boardElement: boardEl as unknown as Element,
  });
  const boardObserver = new MockBoardObserver({
    fen: START_FEN,
    turn: "w",
    isFlipped: false,
    legalMoveCount: 20,
    capturedAtMs: Date.now(),
  });
  const clockPort = new FixedClock(180_000);
  const enginePort: EngineMultiPvPort = {
    async analyzeMultiPv(query: EngineMultiPvQuery): Promise<EngineMultiPvResult> {
      return {
        fen: query.fen,
        depth: query.maxDepth,
        lines: [
          makeLine(1, "e2e4", 45, [480, 360, 160], { san: "e4" }),
          makeLine(2, "d2d4", 40, [470, 365, 165], { san: "d4" }),
          makeLine(3, "g1f3", 25, [450, 370, 180], { san: "Nf3" }),
        ],
      };
    },
  };

  // Case A: Full end-to-end move execution via preset 1200 -> 2000
  const system = createHumanizedAutoPlaySystem({
    eloPreset: 1200,
    controlledSide: "w",
    boardGeometry,
    boardObserver,
    enginePort,
    clockPort,
    frameScheduler: new VirtualFrameScheduler(),
    delayWaiter: async () => {},
  });
  system.applyPreset(2000);
  assert.equal(system.preset.presetId, 2000);

  system.start();
  const executed = await system.orchestrator.handleBoardTransition(
    boardObserver.getCurrentBoardState()!
  );
  assert.equal(executed.status, "EXECUTED");
  assert.ok(executed.pointerResult?.executed);
  assert.ok(["e2e4", "d2d4", "g1f3"].includes(executed.selectedMoveUci ?? ""));

  // Case B: Manual mouse movement during think delay aborts immediately
  let resumeWait!: () => void;
  const hangingSystem = createHumanizedAutoPlaySystem({
    eloPreset: 1600,
    controlledSide: "w",
    boardGeometry,
    boardObserver,
    enginePort,
    clockPort,
    frameScheduler: new VirtualFrameScheduler(),
    delayWaiter: (_ms, signal) =>
      new Promise<void>((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("ABORTED")), {
          once: true,
        });
        resumeWait = resolve;
      }),
  });
  hangingSystem.start();

  const movePendingPromise = hangingSystem.orchestrator.handleBoardTransition({
    fen: MIDGAME_FEN,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  });
  boardObserver.setStateQuietly({
    fen: MIDGAME_FEN,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  });
  await new Promise((r) => setTimeout(r, 15));
  doc.emitUserEvent("mousemove", true);
  const abortedByMouse = await movePendingPromise;
  assert.equal(abortedByMouse.status, "ABORTED");
  assert.equal(abortedByMouse.reason, "USER_MOUSE_MOVEMENT");
  if (resumeWait) resumeWait();
  hangingSystem.dispose();

  // Case C: FEN changed during think delay -> abort before pointer trajectory executes
  const fenGuardSystem = createHumanizedAutoPlaySystem({
    eloPreset: 1600,
    controlledSide: "w",
    boardGeometry,
    boardObserver,
    enginePort,
    clockPort,
    frameScheduler: new VirtualFrameScheduler(),
    delayWaiter: async () => {
      boardObserver.setStateQuietly({
        fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 b - - 1 9",
        turn: "b",
        isFlipped: false,
        capturedAtMs: Date.now(),
      });
    },
  });
  boardObserver.setStateQuietly({
    fen: MIDGAME_FEN,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  });
  fenGuardSystem.start();
  const abortedByFen = await fenGuardSystem.orchestrator.handleBoardTransition({
    fen: MIDGAME_FEN,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  });
  assert.equal(abortedByFen.status, "ABORTED");
  assert.equal(abortedByFen.reason, "FEN_CHANGED_BEFORE_EXECUTION");

  // Case D: Clock adapter parses generic DOM timestamps cleanly
  assert.equal(parseClockDurationMs("05:12"), 312_000);
  assert.equal(parseClockDurationMs("00:08.6"), 8_600);
  const domClock = new GenericDomClockStateAdapter({
    whiteClockSelector: "#w",
    blackClockSelector: "#b",
    root: {
      querySelector(sel: string) {
        if (sel === "#w") return { textContent: "00:11.5" } as Element;
        if (sel === "#b") return { textContent: "01:45" } as Element;
        return null;
      },
    } as unknown as Document,
  });
  const parsedClock = domClock.readClockState("w" as PieceColor);
  assert.equal(parsedClock.activeRemainingMs, 11_500);

  system.dispose();
  fenGuardSystem.dispose();
});
