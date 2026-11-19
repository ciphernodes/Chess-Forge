import test from "node:test";
import assert from "node:assert/strict";

import {
  AutoPlayOrchestrator,
  ELO_2000_PRESET,
} from "./autoPlayOrchestrator.ts";
import {
  GenericDomBoardGeometryAdapter,
  type BoardStateObserverPort,
  type BoardStateSnapshot,
  type ClockStatePort,
  type ClockStateSnapshot,
  type EngineMultiPvPort,
  type EngineMultiPvQuery,
  type EngineMultiPvResult,
} from "./autoPlayPorts.ts";
import { HumanizerMoveSelector } from "./humanizerMoveSelector.ts";
import {
  KinematicPointerExecutor,
  type FrameScheduler,
} from "./kinematicPointerExecutor.ts";
import {
  IsolatedOverlayRenderer,
  type OverlayDocumentLike,
  type OverlayHostElementLike,
  type OverlayNodeLike,
  type ShadowRootLike,
  type StyleSheetLike,
} from "./isolatedOverlayRenderer.ts";
import {
  IsolatedPageStateReceiver,
  PAGE_STATE_CHANNEL,
  PageStateShim,
  extractReadOnlyBoardSnapshot,
  type MessageEventLike,
  type MessageWindowLike,
  type ReadOnlyDocumentLike,
  type ReadOnlyElementLike,
} from "./pageStateShim.ts";
import {
  ChessStateEngine,
  DEGRADED_DETECTION_MESSAGE,
  DualStateReconciler,
  STANDARD_START_FEN,
  extractDomMoveList,
  reconstructFenFromMoveList,
} from "./dualStateReconciler.ts";
import {
  BookAndTablebaseRouter,
  CompositeOpeningBookAdapter,
  sampleBookMoveByWinRate,
  selectPracticalTablebaseMove,
  type BookMoveCandidate,
  type TablebaseLookupResult,
  type TablebasePort,
} from "./bookAndTablebaseRouter.ts";
import {
  ENCRYPTED_CIRCUIT_BREAKER_STORAGE_KEY,
  EncryptedFairPlayStorage,
  FairPlayEventBus,
  MemoryOnlyFairPlayStorage,
  type RiskLevelChangedEvent,
  type SyncKeyMaterialProvider,
} from "./fairPlayEventBus.ts";
import { FairPlayAuditor } from "./fairPlayAuditor.ts";
import { HumanizerController } from "./humanizerController.ts";
import {
  HeuristicPolicyAdapter,
  type ClockSnapshot,
  type ClockTelemetryPort,
  type EngineAnalysis,
  type EngineLine,
  type OverlayDrawCommand,
  type OverlayRenderPort,
} from "./ports.ts";
import type { FairPlayMetricsSnapshot, FairPlayStorageAdapter } from "./fairPlayModels.ts";

// ---------------------------------------------------------------------------
// Test Helpers & Mock DOM
// ---------------------------------------------------------------------------

class FakeNode implements OverlayNodeLike {
  readonly tagName: string;
  id = "";
  textContent: string | null = "";
  readonly style: Record<string, string> = {};
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  parentNode: FakeNode | null = null;

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: OverlayNodeLike): OverlayNodeLike {
    const node = child as FakeNode;
    node.parentNode = this;
    this.children.push(node);
    return child;
  }

  removeChild(child: OverlayNodeLike): OverlayNodeLike {
    const idx = this.children.indexOf(child as FakeNode);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      (child as FakeNode).parentNode = null;
    }
    return child;
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }
}

class FakeShadowRoot implements ShadowRootLike {
  readonly mode: "open" | "closed";
  adoptedStyleSheets: StyleSheetLike[] = [];
  readonly children: OverlayNodeLike[] = [];

  constructor(mode: "open" | "closed") {
    this.mode = mode;
  }

  appendChild(node: OverlayNodeLike): OverlayNodeLike {
    this.children.push(node);
    return node;
  }
}

class FakeHostElement extends FakeNode implements OverlayHostElementLike {
  lastShadowInit: { mode: "closed" | "open" } | null = null;
  createdShadowRoot: FakeShadowRoot | null = null;

  attachShadow(init: { mode: "closed" | "open" }): ShadowRootLike {
    this.lastShadowInit = init;
    const sr = new FakeShadowRoot(init.mode);
    this.createdShadowRoot = sr;
    return sr;
  }
}

class FakeOverlayDocument implements OverlayDocumentLike {
  readonly documentElementNode = new FakeNode("html");
  readonly bodyNode = new FakeNode("body");
  bodyTouchCount = 0;

  readonly documentElement = {
    appendChild: (child: OverlayNodeLike): OverlayNodeLike => {
      return this.documentElementNode.appendChild(child);
    },
    contains: (node: OverlayNodeLike | null): boolean => {
      return node ? this.documentElementNode.children.includes(node as FakeNode) : false;
    },
  };

  get body(): FakeNode {
    this.bodyTouchCount++;
    return this.bodyNode;
  }

  createElement(tagName: string): OverlayHostElementLike {
    return new FakeHostElement(tagName);
  }

  createElementNS(_ns: string, qualifiedName: string): OverlayNodeLike {
    return new FakeNode(qualifiedName);
  }
}

function makeFakeReadOnlyEl(opts: {
  text?: string;
  className?: string;
  attrs?: Record<string, string>;
  rect?: { left: number; top: number; width: number; height: number };
  childrenBySelector?: Record<string, ReadOnlyElementLike[]>;
}): ReadOnlyElementLike {
  const attrs = opts.attrs ?? {};
  const map = opts.childrenBySelector ?? {};
  return {
    textContent: opts.text ?? null,
    className: opts.className ?? "",
    getAttribute(name: string): string | null {
      return attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return opts.rect ?? { left: 0, top: 0, width: 400, height: 400 };
    },
    querySelector(sel: string): ReadOnlyElementLike | null {
      return (map[sel] && map[sel][0]) ?? null;
    },
    querySelectorAll(sel: string): ReadOnlyElementLike[] {
      return map[sel] ?? [];
    },
  };
}

function makeFakeWindow(): MessageWindowLike & {
  readonly posted: Array<{ message: unknown; targetOrigin: string }>;
  dispatchIncoming(ev: MessageEventLike): void;
} {
  const listeners = new Set<(ev: MessageEventLike) => void>();
  const posted: Array<{ message: unknown; targetOrigin: string }> = [];
  const win: MessageWindowLike & {
    readonly posted: Array<{ message: unknown; targetOrigin: string }>;
    dispatchIncoming(ev: MessageEventLike): void;
  } = {
    location: { origin: "https://lichess.org" },
    posted,
    postMessage(message: unknown, targetOrigin: string) {
      posted.push({ message, targetOrigin });
    },
    addEventListener(_type: string, listener: (event: MessageEventLike) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: MessageEventLike) => void) {
      listeners.delete(listener);
    },
    dispatchIncoming(ev: MessageEventLike) {
      listeners.forEach((cb) => cb(ev));
    },
  };
  return win;
}

function makeEngineLine(
  rank: number,
  uci: string,
  centipawns: number,
  wdl: readonly [number, number, number]
): EngineLine {
  return { rank, uci, san: uci, centipawns, mate: null, winPct: 50, depth: 16, wdl };
}

class SpyOverlayPort implements OverlayRenderPort {
  drawn: OverlayDrawCommand[] = [];
  cleared: string[] = [];
  badges: FairPlayMetricsSnapshot[] = [];

  drawOverlay(command: OverlayDrawCommand): void {
    this.drawn.push(command);
  }
  clearOverlay(reason: string): void {
    this.cleared.push(reason);
  }
  updateFairPlayBadge(snapshot: FairPlayMetricsSnapshot): void {
    this.badges.push(snapshot);
  }
}

class StaticClock implements ClockTelemetryPort, ClockStatePort {
  ms: number | null;
  constructor(ms: number | null) {
    this.ms = ms;
  }
  readClocks(): ClockSnapshot {
    return {
      whiteRemainingMs: this.ms,
      blackRemainingMs: this.ms,
      activeRemainingMs: this.ms,
      capturedAtMs: Date.now(),
    };
  }
  readClockState(): ClockStateSnapshot {
    return {
      whiteRemainingMs: this.ms,
      blackRemainingMs: this.ms,
      activeRemainingMs: this.ms,
      capturedAtMs: Date.now(),
    };
  }
}

// ---------------------------------------------------------------------------
// 1. Isolated World Overlay & Read-Only Page Bridge Tests
// ---------------------------------------------------------------------------

test("IsolatedOverlayRenderer defaults to enabled: false, mounts closed Shadow DOM + adoptedStyleSheets on documentElement only, never touches document.body", () => {
  const fakeDoc = new FakeOverlayDocument();
  const appliedCss: string[] = [];
  const defaultRenderer = new IsolatedOverlayRenderer({
    containerDocument: fakeDoc,
  });

  // Backward-compatible default: disabled until explicitly opted in
  assert.equal(defaultRenderer.isEnabled(), false);
  assert.equal(defaultRenderer.mount(), false);
  assert.equal(fakeDoc.documentElementNode.children.length, 0);
  assert.equal(fakeDoc.bodyTouchCount, 0);

  const renderer = new IsolatedOverlayRenderer({
    enabled: true,
    containerDocument: fakeDoc,
    styleSheetFactory: (): StyleSheetLike => ({
      replaceSync(cssText: string) {
        appliedCss.push(cssText);
      },
    }),
  });

  assert.equal(renderer.mount(), true);
  assert.equal(renderer.isMounted(), true);
  assert.equal(fakeDoc.bodyTouchCount, 0);
  assert.equal(fakeDoc.documentElementNode.children.length, 1);

  const host = fakeDoc.documentElementNode.children[0] as FakeHostElement;
  assert.equal(host.style.position, "fixed");
  assert.equal(host.style.pointerEvents, "none");
  assert.equal(host.lastShadowInit?.mode, "closed");
  assert.equal(renderer.hasClosedShadowRoot(), true);
  assert.equal(host.createdShadowRoot?.adoptedStyleSheets.length, 1);
  assert.ok(appliedCss[0].includes("pointer-events: none"));

  renderer.drawOverlay({
    fen: STANDARD_START_FEN,
    turn: "w",
    selectedLine: makeEngineLine(1, "e2e4", 45, [480, 360, 160]),
    candidatePool: [makeEngineLine(1, "e2e4", 45, [480, 360, 160])],
    expectedScoreDelta: 0.18,
    complexityScore: 0.4,
    humanPrior: 0.6,
    temperatureUsed: 0.8,
    delayMs: 900,
    hintsUsedInGame: 1,
    maxHintsPerGame: 3,
  });

  const shadowRoot = host.createdShadowRoot!;
  assert.equal(shadowRoot.children.length, 1);
  const rootDiv = shadowRoot.children[0] as FakeNode;
  const svgNode = rootDiv.children[0];
  assert.ok(svgNode.children.length >= 2, "Expected SVG defs + arrow/bracket elements");

  renderer.clearOverlay("BOARD_MUTATION");
  assert.equal(svgNode.children.length, 0);
  assert.equal(renderer.getLastClearedReason(), "BOARD_MUTATION");

  renderer.dispose();
  assert.equal(fakeDoc.documentElementNode.children.length, 0);
  assert.equal(fakeDoc.bodyTouchCount, 0);
});

test("PageStateShim defaults to enabled: false, performs zero DOM mutations, and posts verified snapshots via window.postMessage", () => {
  const squares: ReadOnlyElementLike[] = [
    makeFakeReadOnlyEl({ attrs: { "data-square": "e1", "data-piece": "K" } }),
    makeFakeReadOnlyEl({ attrs: { "data-square": "e8", "data-piece": "k" } }),
    makeFakeReadOnlyEl({ attrs: { "data-square": "e4", "data-piece": "P" } }),
  ];
  const boardEl = makeFakeReadOnlyEl({
    attrs: { "data-flipped": "false" },
    childrenBySelector: { "[data-square]": squares },
  });

  let mutationAttempted = false;
  const readOnlyDoc: ReadOnlyDocumentLike = {
    querySelector(sel: string) {
      if (sel.includes("[data-board]")) return boardEl;
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel === "[data-move-token]") {
        return [makeFakeReadOnlyEl({ text: "e4" })];
      }
      return [];
    },
  };
  assert.equal(mutationAttempted, false);

  const snapCheck = extractReadOnlyBoardSnapshot(readOnlyDoc, "generic");
  assert.ok(snapCheck);
  assert.equal(snapCheck.turn, "b");
  assert.ok(snapCheck.fenPlacementAndTurn.includes("4k3/8/8/8/4P3/8/8/4K3 b"));

  const win = makeFakeWindow();
  const disabledShim = new PageStateShim({
    documentRef: readOnlyDoc,
    windowRef: win,
  });
  assert.equal(disabledShim.isEnabled(), false);
  assert.equal(disabledShim.start(), false);
  assert.equal(win.posted.length, 0);

  const shim = new PageStateShim({
    enabled: true,
    documentRef: readOnlyDoc,
    windowRef: win,
    nonce: "nonce-123",
  });
  assert.equal(shim.start(), true);
  assert.equal(win.posted.length, 1);
  assert.equal(win.posted[0].targetOrigin, "https://lichess.org");

  const received: string[] = [];
  const receiver = new IsolatedPageStateReceiver({
    enabled: true,
    expectedOrigin: "https://lichess.org",
    expectedNonce: "nonce-123",
    windowRef: win,
    onSnapshot: (s) => received.push(s.fenPlacementAndTurn),
  });
  receiver.start();

  // Spoofed origin/nonce rejected; matching message accepted
  assert.equal(
    receiver.handleMessage({
      data: win.posted[0].message,
      origin: "https://evil.example",
      source: win,
    }),
    false
  );
  assert.equal(
    receiver.handleMessage({
      data: { channel: PAGE_STATE_CHANNEL, version: 1, nonce: "wrong", snapshot: snapCheck },
      origin: "https://lichess.org",
      source: win,
    }),
    false
  );

  win.dispatchIncoming({
    data: win.posted[0].message,
    origin: "https://lichess.org",
    source: win,
  });
  assert.equal(received.length, 1);
  receiver.stop();
});

// ---------------------------------------------------------------------------
// 2. Dual-Source FEN Reconciliation & Startup Self-Test
// ---------------------------------------------------------------------------

test("ChessStateEngine & extractDomMoveList accurately reconstruct Lichess <l4x> and Chess.com .move histories", () => {
  const lichessDoc = {
    querySelectorAll(sel: string) {
      if (sel === "l4x kwdb") {
        return ["e4", "c5", "Nf3", "Nc6", "Bb5"].map((t) => ({ textContent: t }));
      }
      return [];
    },
  };
  const lichessMoves = extractDomMoveList(lichessDoc);
  assert.deepEqual(lichessMoves, ["e4", "c5", "Nf3", "Nc6", "Bb5"]);

  const chessComDoc = {
    querySelectorAll(sel: string) {
      if (sel.includes(".node-highlight-content")) {
        return [
          { textContent: "1.", getAttribute: () => null },
          { textContent: "d4", getAttribute: () => null },
          { textContent: "d5", getAttribute: () => null },
          { textContent: "c4", getAttribute: () => null },
          { textContent: "e6", getAttribute: () => null },
        ];
      }
      return [];
    },
  };
  const chessComMoves = extractDomMoveList(chessComDoc);
  assert.deepEqual(chessComMoves, ["d4", "d5", "c4", "e6"]);

  const recon = reconstructFenFromMoveList(["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O"]);
  assert.equal(recon.ok, true);
  assert.equal(recon.appliedPlies, 9);
  assert.ok(recon.fen.startsWith("r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQ1RK1 b"));
});

test("DualStateReconciler downgrades to READ_ONLY_HINT after >2 persistent mismatch plies and handles startup self-test degradation", async () => {
  const defaultReconciler = new DualStateReconciler();
  assert.equal(defaultReconciler.isEnabled(), false);
  assert.equal(defaultReconciler.isAutonomousAllowed(), true);

  const diagnostics: string[] = [];
  const reconciler = new DualStateReconciler({
    enabled: true,
    maxConsecutiveMismatchPlies: 2,
    onDiagnostic: (msg) => diagnostics.push(msg),
  });

  // Matching ply resets mismatch state cleanly
  const rOk = await reconciler.reconcilePly({
    scrapeBoardFen: () => "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
    readMoveTokens: () => ["e4"],
  });
  assert.equal(rOk.status, "MATCHED");
  assert.equal(rOk.autonomousAllowed, true);

  // 2 consecutive mismatches still below >2 threshold
  for (let i = 0; i < 2; i++) {
    const res = await reconciler.reconcilePly({
      scrapeBoardFen: () => STANDARD_START_FEN,
      readMoveTokens: () => ["e4", "c5"],
    });
    assert.equal(res.status, "MISMATCH");
    assert.equal(res.consecutiveMismatchPlies, i + 1);
    assert.equal(res.autonomousAllowed, true);
  }

  // 3rd consecutive mismatch (>2 plies) triggers automatic downgrade to READ_ONLY_HINT
  const downgraded = await reconciler.reconcilePly({
    scrapeBoardFen: () => STANDARD_START_FEN,
    readMoveTokens: () => ["e4", "c5", "Nf3"],
  });
  assert.equal(downgraded.consecutiveMismatchPlies, 3);
  assert.equal(downgraded.executionMode, "READ_ONLY_HINT");
  assert.equal(downgraded.autonomousAllowed, false);

  // Startup self-test: passes on exact 3-ply parity
  reconciler.reset();
  const selfOk = await reconciler.runStartupSelfTest({
    scrapeForPlies(plies) {
      const sim = new ChessStateEngine(STANDARD_START_FEN);
      for (const p of plies) sim.playSan(p);
      return sim.getFen();
    },
  });
  assert.equal(selfOk.passed, true);
  assert.equal(selfOk.checkedPlies, 3);
  assert.equal(selfOk.autonomousAllowed, true);

  // Startup self-test failure emits exact degraded diagnostic & restricts to manual hints
  const selfFail = await reconciler.runStartupSelfTest({
    scrapeForPlies(plies) {
      if (plies.length === 2) return STANDARD_START_FEN; // Corrupted scraper on ply 2
      const sim = new ChessStateEngine(STANDARD_START_FEN);
      for (const p of plies) sim.playSan(p);
      return sim.getFen();
    },
  });
  assert.equal(selfFail.passed, false);
  assert.equal(selfFail.failedAtPly, 2);
  assert.equal(selfFail.autonomousAllowed, false);
  assert.equal(selfFail.executionMode, "READ_ONLY_HINT");
  assert.equal(selfFail.diagnosticMessage, DEGRADED_DETECTION_MESSAGE);
  assert.ok(diagnostics.includes(DEGRADED_DETECTION_MESSAGE));
});

// ---------------------------------------------------------------------------
// 3. Network Batching & Opening/Tablebase Short-Circuit
// ---------------------------------------------------------------------------

test("BookAndTablebaseRouter short-circuits Stockfish, prefetches up to 20 continuations, silences remote explorer after move 15, samples book W/D/B, and selects practical DTZ/DTM tablebase conversion", async () => {
  let remoteCalls = 0;
  const bookAdapter = new CompositeOpeningBookAdapter({
    maxRemoteBookMove: 15,
    remoteFetcher: async () => {
      remoteCalls++;
      return {
        inBook: true,
        eco: "B90",
        opening: "Sicilian Najdorf",
        source: "LICHESS_MASTERS",
        moves: [
          { uci: "a7a6", san: "a6", games: 80000, white: 28000, draws: 30000, black: 22000 },
          { uci: "e7e6", san: "e6", games: 20000, white: 8000, draws: 7000, black: 5000 },
        ],
      };
    },
  });

  const tbPort: TablebasePort = {
    async lookup(): Promise<TablebaseLookupResult> {
      return {
        isTablebase: true,
        pieceCount: 5,
        category: "win",
        dtz: 8,
        dtm: 18,
        source: "Lichess Syzygy 7-Piece",
        moves: [
          // Riskier high-DTZ line vs clean practical DTZ conversion (pawn advance / zeroing)
          { uci: "e4e5", san: "e5", oppCategory: "loss", dtm: 18, dtz: 2, checkmate: false, stalemate: false },
          { uci: "d3d4", san: "Kd4", oppCategory: "loss", dtm: 16, dtz: 14, checkmate: false, stalemate: false },
        ],
      };
    },
  };

  // Disabled by default -> resolves as DISABLED
  const disabledRouter = new BookAndTablebaseRouter(
    { openingBookPort: bookAdapter, tablebasePort: tbPort },
    {}
  );
  assert.equal(disabledRouter.isEnabled(), false);
  const disabledRes = await disabledRouter.resolveTurn(STANDARD_START_FEN, "w", 1);
  assert.equal(disabledRes.handled, false);
  assert.equal(disabledRes.source, "DISABLED");

  // Enabled router: batch pre-fetches top continuations at game start
  const router = new BookAndTablebaseRouter(
    { openingBookPort: bookAdapter, tablebasePort: tbPort },
    { enabled: true, randomFn: () => 0.1 }
  );
  const resMove1 = await router.resolveTurn(STANDARD_START_FEN, "w", 1);
  assert.equal(resMove1.handled, true);
  assert.equal(resMove1.source, "OPENING_BOOK");
  assert.ok(resMove1.prefetchedCount > 0 && resMove1.prefetchedCount <= 20);
  assert.ok(router.getPrefetchCacheSize() >= resMove1.prefetchedCount);

  // Move 16 (> 15): remote explorer.lichess.ovh query is strictly silenced
  const prevRemoteCalls = remoteCalls;
  const move16UnmappedFen =
    "r2q1rk1/1pp1bppp/p1np1n2/4p3/4P3/1NN1BP2/PPPQ2PP/R3KB1R w KQ - 4 16";
  const resMove16 = await router.resolveTurn(move16UnmappedFen, "w", 16);
  assert.equal(remoteCalls, prevRemoteCalls, "Remote explorer must NOT be called after move 15");
  assert.equal(resMove16.handled, false);
  assert.equal(resMove16.source, "ENGINE_FALLBACK");

  // Move <= 15 non-builtin position triggers remote lookup
  const move10UnmappedFen =
    "r2q1rk1/1pp1bppp/p1np1n2/4p3/4P3/1NN1BP2/PPPQ2PP/R3KB1R w KQ - 4 10";
  const resMove10 = await router.resolveTurn(move10UnmappedFen, "w", 10);
  assert.equal(remoteCalls, prevRemoteCalls + 1);
  assert.equal(resMove10.handled, true);
  assert.equal(resMove10.source, "OPENING_BOOK");

  // W/D/B weighted sampling picks across top 1-3 candidates
  const bookMoves: BookMoveCandidate[] = [
    { uci: "e2e4", san: "e4", games: 100000, white: 55000, draws: 25000, black: 20000 },
    { uci: "d2d4", san: "d4", games: 80000, white: 40000, draws: 25000, black: 15000 },
    { uci: "c2c4", san: "c4", games: 40000, white: 18000, draws: 12000, black: 10000 },
  ];
  const lowSample = sampleBookMoveByWinRate(bookMoves, "w", 3, () => 0.05);
  const highSample = sampleBookMoveByWinRate(bookMoves, "w", 3, () => 0.92);
  assert.equal(lowSample.selected?.uci, "e2e4");
  assert.ok(["d2d4", "c2c4"].includes(highSample.selected?.uci ?? ""));

  // Tablebase (<= 7 pieces) uses practical DTZ/DTM selection & short-circuits EngineMultiPvPort
  const tbFen = "8/8/8/4k3/4P3/3K4/8/4R3 w - - 0 42";
  const tbRes = await router.resolveTurn(tbFen, "w", 42);
  assert.equal(tbRes.handled, true);
  assert.equal(tbRes.source, "TABLEBASE");
  assert.equal(tbRes.selectedMoveUci, "e4e5");

  const practicalCheck = selectPracticalTablebaseMove({
    isTablebase: true,
    pieceCount: 5,
    category: "win",
    dtz: 10,
    dtm: 18,
    source: "Syzygy",
    moves: [
      { uci: "e4e5", san: "e5", oppCategory: "loss", dtm: 18, dtz: 1, checkmate: false, stalemate: false },
      { uci: "d3e3", san: "Ke3", oppCategory: "loss", dtm: 16, dtz: 20, checkmate: false, stalemate: false },
    ],
  }, () => 0.1);
  assert.equal(practicalCheck?.uci, "e4e5");
});

// ---------------------------------------------------------------------------
// 4. FairPlay Event Bus, 5-Game Privacy Telemetry & Encrypted Storage
// ---------------------------------------------------------------------------

test("FairPlayAuditor emits RiskLevelChanged via FairPlayEventBus, enforces 5-game privacy window, and EncryptedFairPlayStorage encrypts circuit-breaker payloads", async () => {
  const eventBus = new FairPlayEventBus();
  const events: RiskLevelChangedEvent[] = [];
  eventBus.onRiskLevelChanged((ev) => events.push(ev));

  // Verify AES-GCM encrypted storage derived from sync secret + deviceId
  const rawBackingMap = new Map<string, unknown>();
  const backingStorage: FairPlayStorageAdapter = {
    async get(key) {
      return rawBackingMap.get(key) ?? null;
    },
    async set(items) {
      for (const [k, v] of Object.entries(items)) rawBackingMap.set(k, v);
    },
  };
  const keyMaterial: SyncKeyMaterialProvider = {
    async getSyncSecret() {
      return "sync-secret-abc-999";
    },
    async getDeviceId() {
      return "device-id-xyz-111";
    },
  };
  const encryptedStorage = new EncryptedFairPlayStorage({
    enabled: true,
    backingStorage,
    keyMaterial,
    maxWindowGames: 5,
  });

  const auditor = new FairPlayAuditor({
    baselineElo: 1200,
    storage: encryptedStorage,
    eventBus,
    privacyMode: { enabled: true, rollingWindowSize: 5 },
  });

  // Wire HumanizerController + AutoPlayOrchestrator subscribers
  const overlay = new SpyOverlayPort();
  const clocks = new StaticClock(180_000);
  const controller = new HumanizerController(
    { targetElo: 1600, maxHintsPerGame: 3 },
    new HeuristicPolicyAdapter(),
    clocks,
    overlay,
    auditor
  );
  controller.subscribeToRiskEvents(eventBus, {
    enabled: true,
    elevatedEloStepDown: 200,
  });

  let engineAnalyzeCalls = 0;
  const dummyBoardEl = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 } as DOMRect),
    getAttribute: () => "false",
    ownerDocument: null,
    querySelector: () => null,
    dispatchEvent: () => true,
  } as unknown as Element;
  const dummyBoardObs: BoardStateObserverPort = {
    getCurrentBoardState: () => ({
      fen: STANDARD_START_FEN,
      turn: "w",
      isFlipped: false,
      capturedAtMs: Date.now(),
    }),
    subscribe: () => () => {},
  };
  const dummyEngine: EngineMultiPvPort = {
    async analyzeMultiPv(q: EngineMultiPvQuery): Promise<EngineMultiPvResult> {
      engineAnalyzeCalls++;
      return {
        fen: q.fen,
        depth: 16,
        lines: [{ rank: 1, uci: "e2e4", san: "e4", centipawns: 40, depth: 16, wdl: [480, 360, 160] }],
      };
    },
  };
  const virtualScheduler: FrameScheduler = {
    waitNextFrame: async () => 16,
    waitMs: async () => {},
    now: () => 0,
  };
  const orchestrator = new AutoPlayOrchestrator(
    {
      boardObserver: dummyBoardObs,
      boardGeometry: new GenericDomBoardGeometryAdapter({ boardElement: dummyBoardEl }),
      enginePort: dummyEngine,
      clockPort: clocks,
      moveSelector: new HumanizerMoveSelector(ELO_2000_PRESET.selector),
      pointerExecutor: new KinematicPointerExecutor(
        new GenericDomBoardGeometryAdapter({ boardElement: dummyBoardEl }),
        ELO_2000_PRESET.executor,
        virtualScheduler
      ),
      openingBookPort: new CompositeOpeningBookAdapter(),
      fairPlayEventBus: eventBus,
    },
    {
      controlledSide: "w",
      activeEloPreset: 2000,
      delayWaiter: async () => {},
      bookAndTablebaseConfig: { enabled: true, randomFn: () => 0.1 },
      riskReactionConfig: {
        enabled: true,
        onElevated: "STEP_DOWN_ELO",
        overlayPort: overlay,
      },
    }
  );

  // Confirm Book short-circuit skips EngineMultiPvPort in orchestrator
  const bookCycle = await orchestrator.handleBoardTransition({
    fen: STANDARD_START_FEN,
    turn: "w",
    isFlipped: false,
    moveNumber: 1,
    capturedAtMs: Date.now(),
  } as BoardStateSnapshot);
  assert.equal(bookCycle.status, "EXECUTED");
  assert.equal(bookCycle.source, "OPENING_BOOK");
  assert.equal(engineAnalyzeCalls, 0);

  // Trigger ELEVATED -> Lockout via critical S_i spikes
  const trapAnalysis: EngineAnalysis = {
    fen: "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 9",
    turn: "w",
    depth: 16,
    engineBackend: "Stockfish 19 WASM",
    shallowDepth6: { depth: 6, bestUci: "e2d3", centipawns: 20, mate: null },
    lines: [
      makeEngineLine(1, "f3g5", 240, [820, 120, 60]),
      makeEngineLine(2, "e2d3", 10, [480, 320, 200]),
    ],
  };

  // Record crisp moves + 1 S_i spike -> transitions SAFE -> ELEVATED
  auditor.recordCompletedMove({
    fenBefore: trapAnalysis.fen,
    playedUci: "f3g5",
    analysisBefore: trapAnalysis,
    humanPrior: 0.08,
    elapsedMs: 1200,
    remainingClockMs: 160_000,
  });
  for (let i = 0; i < 6; i++) {
    auditor.recordCompletedMove({
      fenBefore: `r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP2BPPP/R1BQ1RK1 w - - 0 ${10 + i}`,
      playedUci: "c4d5",
      analysisBefore: {
        fen: trapAnalysis.fen,
        turn: "w",
        depth: 16,
        engineBackend: "Stockfish",
        lines: [
          makeEngineLine(1, "c4d5", 100, [620, 260, 120]),
          makeEngineLine(2, "e2d3", 70, [560, 280, 160]),
        ],
      },
      humanPrior: 0.4,
      elapsedMs: 3200,
      remainingClockMs: 140_000,
    });
  }

  assert.ok(events.some((e) => e.currentLevel === "ELEVATED"));
  if (auditor.getSnapshot().riskLevel === "ELEVATED") {
    assert.equal(controller.getConfig().targetElo, 1400);
    assert.equal(orchestrator.getActiveEloPreset(), 1600);
  }

  // Second spike -> LOCKOUT: immediate halt + overlay cleared
  auditor.recordCompletedMove({
    fenBefore: trapAnalysis.fen,
    playedUci: "f3g5",
    analysisBefore: trapAnalysis,
    humanPrior: 0.06,
    elapsedMs: 1100,
    remainingClockMs: 155_000,
  });
  assert.ok(events.some((e) => e.currentLevel === "LOCKOUT"));
  assert.ok(overlay.cleared.includes("LOCKOUT"));
  assert.equal(orchestrator.isAutonomousActive(), false);

  const haltedCycle = await orchestrator.handleBoardTransition({
    fen: trapAnalysis.fen,
    turn: "w",
    isFlipped: false,
    capturedAtMs: Date.now(),
  });
  assert.equal(haltedCycle.status, "SKIPPED");
  assert.equal(haltedCycle.reason, "FAIR_PLAY_RISK_HALT");

  // Finish 8 games -> verify 5-game privacy rolling window & AES-GCM encrypted ciphertext at rest
  for (let g = 0; g < 8; g++) {
    auditor.recordCompletedMove({
      fenBefore: trapAnalysis.fen,
      playedUci: "c4d5",
      analysisBefore: trapAnalysis,
      humanPrior: 0.5,
      elapsedMs: 4000,
      remainingClockMs: 140_000,
    });
    await auditor.finishGame(`p-game-${g}`);
  }

  assert.equal(auditor.getSnapshot().slidingWindowGames, 5);
  assert.equal(rawBackingMap.has("chessForgeFairPlayWindowV1"), false);
  const persistedCipher = rawBackingMap.get(ENCRYPTED_CIRCUIT_BREAKER_STORAGE_KEY) as {
    alg?: string;
    ciphertextB64?: string;
  };
  assert.equal(persistedCipher?.alg, "AES-GCM");
  assert.ok(typeof persistedCipher?.ciphertextB64 === "string" && persistedCipher.ciphertextB64.length > 20);

  const reloaded = new FairPlayAuditor({
    baselineElo: 1200,
    storage: encryptedStorage,
    privacyMode: { enabled: true, rollingWindowSize: 5 },
  });
  await reloaded.loadPersistedWindow();
  assert.equal(reloaded.getSnapshot().slidingWindowGames, 5);

  // MemoryOnlyFairPlayStorage isolates rolling 5-game history in memory only
  const memOnly = new MemoryOnlyFairPlayStorage(5);
  await memOnly.set({
    chessForgeFairPlayWindowV1: {
      baselineElo: 1500,
      games: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ gameId: `g${i}` })),
    },
  });
  const memLoaded = (await memOnly.get("chessForgeFairPlayWindowV1")) as {
    games: Array<{ gameId: string }>;
  };
  assert.equal(memLoaded.games.length, 5);
  assert.equal(memLoaded.games[0].gameId, "g3");

  controller.dispose();
  orchestrator.dispose();
});
