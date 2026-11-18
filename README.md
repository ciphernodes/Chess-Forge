# Chess Forge

**Chess Forge** is a cross-platform chess analysis, board-overlay, and behavioral telemetry suite built as two tightly integrated deliverables in one repository:

1. **Manifest V3 Browser Extension (`browser-extension/`)**: Runs **Stockfish 19 Lite Single (WebAssembly)** locally inside an MV3 Offscreen Document (`MultiPV 4`, `UCI_ShowWDL true`) with a zero-dependency JavaScript alpha-beta fallback engine (`chess-engine.js`), Master Opening Book lookup, 7-piece Syzygy Endgame Tablebase integration, Chess.com-style move classification badges, dynamic board-theme contrast adaptation, and click-through SVG arrow overlays.
2. **Android Companion App (`app/`)**: Built in **Kotlin & Jetpack Compose (Material 3)** (`compileSdk 36.1`, `minSdk 26`). Bundles and exports `chess-forge-browser-extension.zip` for mobile Chromium browsers (**Kiwi Browser** / **Edge Canary**), provides an embedded responsive **WebView Workspace** with an offline practice sparring board (`practice_board.html`), exposes a JS-to-Kotlin `ChessForgeAndroidBridge`, and persists engine, guardrail, and autonomous Elo profiles via **Jetpack DataStore**.
3. **Behavioral Guardrail & Kinematic TypeScript Subsystems (`browser-extension/src/ts/`)**: Strictly typed modules implementing dual-engine human-prior filtering (`HumanizerController`), 20-game statistical anti-cheat telemetry & circuit-breaker protection (`FairPlayAuditor`), and coordinate-based generic 8×8 autonomous move selection & minimum-jerk kinematic pointer execution (`HumanizerMoveSelector`, `KinematicPointerExecutor`, `AutoPlayOrchestrator`).

---

## Table of Contents

1. [System Architecture & Data Flow](#1-system-architecture--data-flow)
2. [Manifest V3 Browser Extension](#2-manifest-v3-browser-extension)
   - [Stockfish 19 WASM Offscreen Worker & Fallback Engine](#stockfish-19-wasm-offscreen-worker--fallback-engine)
   - [Master Opening Book (`opening-book.js`)](#master-opening-book-opening-bookjs)
   - [Syzygy 7-Piece Endgame Tablebase (`syzygy-tablebase.js`)](#syzygy-7-piece-endgame-tablebase-syzygy-tablebasejs)
   - [Chess.com-Style Move Annotations & Palette](#chesscom-style-move-annotations--palette)
   - [Board Color Theme Detection & Contrast Adaptation](#board-color-theme-detection--contrast-adaptation)
   - [DOM Readers, SVG Arrows & Evaluation Bar](#dom-readers-svg-arrows--evaluation-bar)
   - [MV3 Permissions & Message Bus Reference](#mv3-permissions--message-bus-reference)
3. [HumanizerController & FairPlayAuditor Guardrails](#3-humanizercontroller--fairplayauditor-guardrails)
   - [Port Interfaces (`ports.ts`) & Maia-2 Policy Adapter](#port-interfaces-portsts--maia-2-policy-adapter)
   - [Humanizer Filtering, Suppression Gates & Delays](#humanizer-filtering-suppression-gates--delays)
   - [FairPlayAuditor Metrics, Warnings & Circuit Breaker](#fairplayauditor-metrics-warnings--circuit-breaker)
   - [Adaptive Risk Policy Modifiers (`SAFE` / `ELEVATED` / `LOCKOUT`)](#adaptive-risk-policy-modifiers-safe--elevated--lockout)
4. [Generic 8×8 Autonomous & Kinematic Subsystems](#4-generic-8x8-autonomous--kinematic-subsystems)
   - [Generic Port Contracts (`autoPlayPorts.ts`)](#generic-port-contracts-autoplayportsts)
   - [Move Selector (`humanizerMoveSelector.ts`) & Time-Trouble Mode](#move-selector-humanizermoveselectorts--time-trouble-mode)
   - [Kinematic Pointer Executor (`kinematicPointerExecutor.ts`)](#kinematic-pointer-executor-kinematicpointerexecutorts)
   - [Orchestrator (`autoPlayOrchestrator.ts`) & Safety Aborts](#orchestrator-autoPlayorchestratorts--safety-aborts)
   - [Autonomous Elo Profiles (1200 / 1600 / 2000)](#autonomous-elo-profiles-1200--1600--2000)
5. [Android Companion Application (`com.example.chessoverlay`)](#5-android-companion-application-comexamplechessoverlay)
   - [Screens & Navigation](#screens--navigation)
   - [UI Components & Responsive Design](#ui-components--responsive-design)
   - [WebView Bridge & Asset Packaging](#webview-bridge--asset-packaging)
   - [Jetpack DataStore Keys & Persistence Schema](#jetpack-datastore-keys--persistence-schema)
   - [Chess State Machine & UCI Parser](#chess-state-machine--uci-parser)
6. [Complete Repository Map](#6-complete-repository-map)
7. [Installation & Usage](#7-installation--usage)
8. [GitHub Actions CI/CD Workflow](#8-github-actions-cicd-workflow)
9. [Local Build & Test Verification](#9-local-build--test-verification)
10. [Tech Stack & Dependencies](#10-tech-stack--dependencies)

---

## 1. System Architecture & Data Flow

```text
+=============================================================================+
|                      ANDROID COMPANION APP (Kotlin / Compose)               |
|                                                                             |
|  PreferencesRepository (DataStore) <---> MainViewModel (StateFlow MVVM)     |
|           |                                       |                         |
|           v                                       v                         |
|  [Extension Tab]    [Browser Tab (WebView)]    [Settings Tab]               |
|  - Export .ZIP      - Practice / Lichess /     - FairPlayAuditor Toggle     |
|  - Share .ZIP         Chess.com Presets        - HumanizerController Toggle |
|  - Install Steps    - ChessForgeAndroidBridge  - Clear Telemetry Storage    |
|                     - FairPlayStatusIndicator  - Autonomous Mode (1200/     |
|                     - Live EvalBar & Lines       1600/2000 Elo Profiles)    |
+=============================================================================+
                                      |
            bundles & exports         | injects into WebView
     chess-forge-browser-extension.zip| (engine, book, tablebase, content.js)
                                      v
+=============================================================================+
|                   MANIFEST V3 BROWSER EXTENSION (v2.1.0)                    |
|                                                                             |
|  DOM Board Observer (Lichess / Chess.com / Practice Board)                  |
|         |                                                                   |
|         v                                                                   |
|  content.js  ---[OPENING_BOOK_LOOKUP / TABLEBASE_LOOKUP]---> background.js  |
|         |                                                         |         |
|         +-------[STOCKFISH_ANALYZE]---> background.js             |         |
|         |                                     |                   v         |
|         |                                     v             Lichess APIs    |
|         |                              offscreen.js         (Masters DB /   |
|         |                         (Stockfish 19 WASM        Syzygy 7-Piece) |
|         |                          MultiPV 4 + UCI_ShowWDL)                 |
|         |                                                                   |
|         +---> Fallback Local JS Engine (chess-engine.js)                    |
|         |                                                                   |
|         v                                                                   |
|  HumanizerController & FairPlayAuditor (src/ts/* & runtime bridge)          |
|         |                                                                   |
|         v                                                                   |
|  Adaptive Contrast SVG Overlay Renderer                                     |
|  (Multi-PV Arrows + Chess.com Badges + Vertical/Horizontal EvalBar + HUD)   |
+=============================================================================+
```

---

## 2. Manifest V3 Browser Extension

### Stockfish 19 WASM Offscreen Worker & Fallback Engine

- **Primary Engine (`src/offscreen.html` + `src/offscreen.js` + `vendor/stockfish-19-lite-single.*`)**:
  - Hosted in a Manifest V3 Offscreen Document (`reasons: ["WORKERS"]`) to comply with MV3 service-worker restrictions while permitting WebAssembly via CSP `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`.
  - On `uciok`, initializes:
    ```uci
    setoption name UCI_AnalyseMode value true
    setoption name UCI_ShowWDL value true
    setoption name MultiPV value 4
    setoption name Move Overhead value 10
    isready
    ```
  - Captures both the final depth search lines (`1..MultiPV`) **and** an intermediate `shallowDepth6` snapshot (`depth <= 6`, rank 1) used by the complexity estimator and `FairPlayAuditor` trap detector.
  - Converts centipawns to win probability using the standard logistic formula:
    $$\text{Win\%}(cp) = \text{clamp}\!\left(50 + 50 \cdot \left(\frac{2}{1 + e^{-0.00368208 \cdot cp}} - 1\right),\; 0.1,\; 99.9\right)$$
  - Dynamically applies resource budgets based on the active CPU profile:

| CPU Profile (`cpuProfile`) | Hash (`MB`) | WASM Movetime (`ms`) | WASM Depth Cap | JS Fallback Depth Cap |
| --- | --- | --- | --- | --- |
| `eco` | `32` | `360` | `min(maxDepth, 10)` | `3` |
| `balanced` | `64` | `920` | `min(maxDepth, 16)` | `4` |
| `turbo` | `128` | `2200` | `min(maxDepth, 20)` | `6` |

- **Fallback Local JS Engine (`src/chess-engine.js`)**:
  - Zero-dependency chess engine supporting complete legal move generation (castling, en passant, promotions, check/mate detection), iterative-deepening alpha-beta search with quiescence search, MVV-LVA capture ordering, piece-square tables (`PST_PAWN`..`PST_KING`), transposition caching, Multi-PV root analysis, and SAN formatting (`uciToSan`).
  - Activates automatically inside WebView (where MV3 `chrome.offscreen` is absent) or if WebAssembly initialization fails/times out (12 s timeout).

### Master Opening Book (`opening-book.js`)

- Uses a two-tier lookup keyed transposition-safely by `<piece-placement> <turn>` (LRU cache capped at 150 entries):
  1. **Offline Built-In Master ECO Dictionary**: Zero-latency preloaded theory covering major openings (`A00` Starting Position, `B00`, `A40`, `B20`/`B27`/`B50` Sicilian lines, `C20`/`C40`/`C44`/`C50` Italian/`C60` Ruy Lopez, `C00` French, `B10` Caro-Kann, `A45`/`A50`/`E00` Indian defenses, `D00`/`D06` Queen's Gambit, `A10` English, `A04` Reti/Zukertort) with historical game counts and W/D/B totals.
  2. **Live Lichess Masters Explorer**: Queries `https://explorer.lichess.ovh/masters?fen=<FEN>&moves=4&topGames=0` (`2200 ms` AbortController timeout) via `background.js` (`OPENING_BOOK_LOOKUP`) to return ECO code, opening name, game counts, White%, Draw%, and Black% for the top 4 continuations.

### Syzygy 7-Piece Endgame Tablebase (`syzygy-tablebase.js`)

- Automatically triggers when piece count parsed from the FEN placement field is **`<= 7`**.
- Queries `https://tablebase.lichess.ovh/standard?fen=<FEN>` via `background.js` (`TABLEBASE_LOOKUP`, `2800 ms` timeout, LRU cache up to 150/200 positions).
- Computes exact mover-perspective outcome (`win` / `draw` / `loss`), `DTZ` (Distance to Zeroing), `DTM` (Distance to Mate), checkmate/stalemate flags, and per-move quality annotations (`!!`, `!`, `?!`, `=`, `?`, `??`), sorting winning continuations by checkmate -> shortest DTM -> shortest DTZ and losing defenses by longest resistance.
- Includes an **offline fundamental endgame solver** (`Syzygy Offline Base`) for `K vs K`, insufficient material (`K+N/B vs K`), and basic `KQ/KR vs K` endgames when offline.

### Chess.com-Style Move Annotations & Palette

Both candidate engine lines (`classifyCandidateAnnotations`) and newly played moves (`evaluatePlayedMoveAnnotation`) are classified using Chess.com Game Review symbols, colors, and SVG badge glyphs in `content.js`:

| Symbol | Label | Badge Hex Color | Text Color | Classification Logic |
| --- | --- | --- | --- | --- |
| `!!` | Brilliant | `#1BACA6` | `#FFFFFF` | Top/near-top move (`winPctLoss <= 1.2`) involving a material sacrifice (`>= 2` pawn units) with `currMoverWinPct >= 58%` (or candidate mate `<= 5` / `winGap >= 18%`). |
| `!` | Great | `#5C8BB0` | `#FFFFFF` | Only/near-only move maintaining edge (`winGapOverSecond >= 11%` or turnaround `prev <= 52% -> curr >= 62%`). |
| `★` | Best | `#81B64C` | `#FFFFFF` | Engine top move or `winPctLoss <= 0.6%`. |
| `+` | Excellent | `#96BC4B` | `#042F2E` | `winPctLoss <= 2.2%` and `cpLoss <= 25`. |
| `✓` | Good | `#95B776` | `#042F2E` | `winPctLoss <= 5.2%` and `cpLoss <= 55`. |
| `Book` | Book | `#A88865` | `#FFFFFF` | Move matches active Master Opening Book with `winPctLoss <= 4.0%`. |
| `?!` | Inaccuracy | `#F7C631` | `#451A03` | `winPctLoss <= 10.5%` and `cpLoss <= 115`. |
| `?` | Mistake | `#E6912C` | `#FFFFFF` | `winPctLoss <= 20.5%` and `cpLoss <= 245`. |
| `✕` | Miss | `#FF7769` | `#FFFFFF` | Dropped a clear winning advantage (`prev >= 74%`, `winPctLoss >= 12%`, `42% <= curr < 62%`) without losing outright. |
| `??` | Blunder | `#CA3431` | `#FFFFFF` | Severe loss exceeding mistake thresholds. |

### Board Color Theme Detection & Contrast Adaptation

`detectBoardTheme(boardInfo)` in `content.js` inspects computed `document.body` background luminance (`relativeLuminance < 0.35`), dark-mode CSS classes, square RGB samples (`.sq.dark`, `.square-dark`), and class tokens (`green`, `blue`, `icy`, etc.) to select an adaptive high-contrast arrow & HUD palette:

| Detected Board Theme | Primary Arrow | Secondary Arrow | Tertiary Arrow | HUD Accent Border |
| --- | --- | --- | --- | --- |
| **Emerald Slate / Dark Adaptive** | Emerald `#10B981` | Amber `#F59E0B` | Sky `#38BDF8` | `#10B981` |
| **Green Board (Dark / Light UI)** | Luminous Cyan `#22D3EE` | Gold `#FACC15` | Pink `#F472B6` | `#06B6D4` |
| **Blue / Icy Board** | Gold `#FACC15` | Mint `#34D399` | Orange `#FB923C` | `#F59E0B` |
| **Light Contrast** | Deep Emerald `#059669` | Amber `#D97706` | Royal Blue `#2563EB` | `#059669` |

### DOM Readers, SVG Arrows & Evaluation Bar

- **DOM Board Scrapers (`readActiveBoard`)**:
  - **Lichess (`readLichessBoard`)**: Reads `cg-board` children `<piece>` CSS `translate(...)` transforms or coordinates and orientation classes (`.orientation-black`).
  - **Chess.com (`readChessComBoard`)**: Reads `<chess-board>` / `.board` pieces (`.piece.square-XY` classes) and `.flipped` orientation.
  - **Practice / Generic Board (`readCustomPracticeBoard`)**: Reads `[data-square]` cells on `#cf-practice-board` for local offline sparring.
- **Click-Through Overlay Host**:
  - Renders a `pointer-events: none` SVG canvas aligned to the board `getBoundingClientRect()` with PV1–PV3 arrows, square highlight rings, move annotation badges, responsive **Vertical/Horizontal Evaluation Bar**, floating `CF: ON/OFF` toggle pill, and compact `FairPlayPill` badge.

### MV3 Permissions & Message Bus Reference

- **Permissions (`manifest.json` v2.1.0)**: `storage`, `activeTab`, `offscreen`.
- **Host Permissions**: `https://lichess.org/*`, `https://*.lichess.org/*`, `https://www.chess.com/*`, `https://*.chess.com/*`, `https://explorer.lichess.ovh/*`, `https://tablebase.lichess.ovh/*`.
- **Runtime Messages**:
  - `GET_ENGINE_STATUS` / `ENGINE_STATUS`: Syncs `LOADING` / `CALCULATING` / `IDLE` / `ERROR` status between offscreen, background, and popup.
  - `STOCKFISH_ANALYZE`: Content script -> `background.js` -> `offscreen.js` (`OFFSCREEN_ANALYZE`).
  - `OPENING_BOOK_LOOKUP`: Content script -> `background.js` -> `explorer.lichess.ovh/masters`.
  - `TABLEBASE_LOOKUP`: Content script -> `background.js` -> `tablebase.lichess.ovh/standard`.

---

## 3. HumanizerController & FairPlayAuditor Guardrails

Implemented in strictly typed TypeScript (`browser-extension/src/ts/`) and mirrored in the live `content.js` runtime bridge (`window.__ChessForgeHumanizer`).

### Port Interfaces (`ports.ts`) & Maia-2 Policy Adapter

- `EnginePort`: Asynchronous Stockfish Multi-PV (`>= 4`) + WDL + `shallowDepth6` provider.
- `PolicyPort`: Predicts human move priors $P_{\text{human}}(\text{move} \mid \text{fen}, \text{targetElo})$.
  - `Maia2PolicyAdapter` delegates to an optional quantized **Maia-2 ONNX Runtime Web** runner (`OnnxPolicyRunner`) and falls back transparently to `HeuristicPolicyAdapter` (weighting captures `1.35×`, checks `1.25×`, central squares `[c-f][3-6]` `1.15×`, and Rating-scaled eval/rank exponential decay).
- `ClockTelemetryPort`: `DomClockTelemetryAdapter` parses `hh:mm:ss`, `mm:ss`, and sub-minute `ss.d` clocks from DOM selectors into milliseconds.
- `OverlayRenderPort`: Emits `drawOverlay(command)`, `clearOverlay(reason)`, and `updateFairPlayBadge(snapshot)`.

### Humanizer Filtering, Suppression Gates & Delays

`HumanizerController` (`humanizerConfig.ts`, `humanizerController.ts`) evaluates a strict sequence of pre-display gates before any hint arrow is rendered:

1. **Circuit Breaker & Config Check**: Blocks immediately on `LOCKOUT` or `enabled === false`.
2. **Natural-Play Suppressors**:
   - `OPENING_BOOK`: Suppresses hints when the position/move lies inside active Master Book theory.
   - `SIMPLIFIED_ENDGAME`: Suppresses automated hints when remaining board pieces `<= 6` (`endgamePieceCutoff`).
   - `FORCED_RECAPTURE`: Suppresses when PV1 leads PV2 by `>= 150 cp` (`forcedRecaptureMarginCp`) on a clear recapture.
   - `HINT_BUDGET_EXHAUSTED`: Enforces per-game hint cap (`maxHintsPerGame`, default `3`).
3. **WDL Criticality Gate**:
   $$\Delta_E = (W_1 + 0.5\,D_1) - (W_2 + 0.5\,D_2)$$
   Suppresses (`LOW_CRITICALITY_WDL`) unless $\Delta_E \ge \text{criticalWdlThreshold} + \Delta_{\text{risk}}$ (`0.14` baseline, `+0.08` under `ELEVATED`).
4. **Low-Clock Decay**:
   - Soft smoothstep taper across `[25,000 ms .. 15,000 ms]` (`lowClockTaperStartMs` -> `lowClockCutoffMs`).
   - Complete overlay suppression below `15,000 ms` (`LOW_CLOCK_CUTOFF`).
5. **Candidate Filtering & Boltzmann Dispersion**:
   - Prunes blunders exceeding `computeEffectiveBlunderCapCp(config)` and excludes computer-only tactics with $P_{\text{human}} < 0.03$.
   - Samples candidate line using:
     $$P(m) \propto \exp\!\left(\frac{\log P_{\text{human}}(m) - \lambda(\text{Elo}) \cdot \text{cpLoss}(m)}{T(\text{Elo}) \cdot \text{mult}_{\text{risk}}}\right)$$
     where $\lambda(\text{Elo}) \in [0.004, 0.032]$ and $T(\text{Elo}) \in [1.35 \text{ at 600 Elo} \to 0.40 \text{ at 2800 Elo}]$.
6. **Complexity-Scaled Log-Normal Display Delay**:
   - Quiet positions delay between `800–1,500 ms`; sharp tactical positions scale up to `4,000–9,500 ms`.
   - Any board FEN mutation (`onBoardMutated`) immediately cancels pending draw timers (`FEN_MUTATED_BEFORE_DRAW`) and clears stale visuals.

### FairPlayAuditor Metrics, Warnings & Circuit Breaker

`FairPlayAuditor` (`fairPlayModels.ts`, `fairPlayAuditor.ts`) records completed moves against the pre-move Multi-PV + `shallowDepth6` analysis and persists a **20-game sliding window** under storage key `chessForgeFairPlayWindowV1`:

- **Partial Credit & ACPL**: Computes move `cpLoss`, `wdlLoss`, and fractional credit (`1.0` for top-1 match, otherwise `0.5 * exp(-cpLoss / 70) + 0.5 * clamp(1 - 2.1 * wdlLoss, 0, 1)`).
- **Speed-Adjusted Criticality ($S_i$ Spikes)**: Flags critical traps (`depth >= 14` where `shallowDepth6` disagrees with `PV1` and `deltaE >= 0.15`, or `deltaE >= 0.22`). Computes $S_i$ from expected human think time vs. actual `elapsedMs` and prior novelty; flags a spike when `humanPrior <= 0.28`, `elapsedMs <= 0.55 * expectedHumanMs`, and `siScore >= 2.0`.
- **IPR & Z-Score**: Computes `observedIpr`, `sigmaIpr`, and statistical deviation `zScore = (observedIpr - baselineElo) / sigmaIpr`.
- **Diagnostic Warning Codes**:
  - `RAPID_CRITICAL_MATCH` (`WARN`) — 1 $S_i$ spike detected
  - `LOCKOUT_SPIKE_LIMIT` (`CRITICAL`) — `>= 2` $S_i$ spikes in a single game
  - `FLAT_MOVE_CADENCE` (`WARN`) — Move-time coefficient of variation `< 0.20` (`>= 6` moves)
  - `SUB_15S_ENGINE_PRECISION` (`CRITICAL`) — Sub-15s mean partial credit `>= 0.88` (`>= 3` moves)
  - `ELEVATED_IPR_ZSCORE` (`WARN`) — $Z \ge 1.8\sigma$
  - `CRITICAL_IPR_ZSCORE` (`CRITICAL`) — $Z \ge 2.5\sigma$

### Adaptive Risk Policy Modifiers (`SAFE` / `ELEVATED` / `LOCKOUT`)

| Risk Level | Trigger Condition | `blockAllOverlays` | `temperatureMultiplier` | `criticalWdlDeltaAdd` | `minDelayBoostMs` |
| --- | --- | --- | --- | --- | --- |
| **`SAFE`** | Default ($Z < 1.8\sigma$ and `< 2` spikes) | `false` | `1.0×` | `+0.00` | `0 ms` |
| **`ELEVATED`** | $Z \ge 1.8\sigma$ (or $1$ spike with $Z \ge 1.25\sigma$) | `false` | `2.0×` | `+0.08` | `1200 ms` |
| **`LOCKOUT`** | $Z \ge 2.5\sigma$ **or** $\ge 2$ $S_i$ spikes | `true` | `3.0×` | `+0.25` | `0 ms` (blocked) |

---

## 4. Generic 8×8 Autonomous & Kinematic Subsystems

Designed strictly against generic coordinate ports with zero commercial site targeting for local practice sparring, automated UI/engine testing, and motor-accessibility harnesses.

### Generic Port Contracts (`autoPlayPorts.ts`)

- `BoardGeometryPort`: Returns `{ left, top, width, height }`, board flip state (`isFlipped()`), container element, target `Document`, and optional element hit-testing.
- `EngineMultiPvPort`: Asynchronous `analyzeMultiPv({ fen, multiPv, maxDepth, movetimeMs, signal })` provider returning `MultiPvCandidateLine[]` plus `shallowDepth6` / `deepDepth16` metadata.
- `ClockStatePort`: Reads `whiteRemainingMs`, `blackRemainingMs`, `activeRemainingMs`, and `incrementMs`.
- `BoardStateObserverPort`: Subscribes to FEN / turn / orientation updates.

### Move Selector (`humanizerMoveSelector.ts`) & Time-Trouble Mode

- Accepts Stockfish `MultiPV 4` lines (with WDL triples or logistic cp fallback) and optional `HumanPriorsInput` (synthesizing fallback human priors when ONNX predictions are omitted).
- **Filtering**: Discards moves above `maxAllowedBlunderCp` and excludes computer-only tactics (`P_human < 0.03`), with a **sole non-losing recapture exception** (`FORCED_RECAPTURE_EXCEPTION`) when only a recapture on the opponent's last destination square remains playable.
- **Regime Switching**:
  - Below `criticalWdlThreshold` (`QUIET_NATURAL_HUMAN`): Favors natural high-prior moves.
  - Critical positions (`CRITICAL_BOLTZMANN_TOP3`): Samples across top-1, top-2, and top-3 via Boltzmann softmax with inverse-Elo temperature $T$.
- **Time-Trouble Mode (`< 15,000 ms`)**: Proportionally compresses `recommendedDepth` (down toward depth 4) and `recommendedThinkTimeMs`, while amplifying softmax temperature (`timeTroubleTempMultiplier`, with an extra `1.2×` heat factor below `5,000 ms`).

### Kinematic Pointer Executor (`kinematicPointerExecutor.ts`)

- **Square Targeting**: Computes origin (`e2`) and destination (`e4`) square geometry accounting for `isFlipped`, samples 2D Box-Muller Gaussian offsets (`sampleGaussian2D`), and clamps target coordinates strictly inside the **inner 60%** (`center ± 0.3 * squareSize`) so pointer events never touch square borders.
- **Cubic Bézier Trajectories & Micro-Tremor**: Generates smooth approach (`cursor -> origin`) and drag (`origin -> destination`) cubic Bézier curves with perpendicular arc curvature (`arcCurvatureMin..Max`) and sinusoidal + Gaussian micro-tremor (`0.65–1.1 px`).
- **Minimum-Jerk Velocity Profile**: Warps normalized time $\tau \in [0, 1]$ using:
  $$s(\tau) = 10\tau^3 - 15\tau^4 + 6\tau^5, \qquad \frac{ds}{d\tau} = 30\tau^2(1 - \tau)^2$$
  producing zero start/end velocity, peak mid-flight speed at $\tau = 0.5$, and smooth target deceleration via `requestAnimationFrame` (or timer fallback).
- **Pre-Release Dwell & Event Lifecycle**: Holds `40–110 ms` between `pointerdown` and drag/release and dispatches complete `pointerover`, `pointerenter`, `pointermove`, `mousedown`, `pointerdown`, drag `pointermove`/`mousemove` steps, `pointerup`, `mouseup`, and `click` events.

### Orchestrator (`autoPlayOrchestrator.ts`) & Safety Aborts

- Computes normalized positional complexity $C \in [0, 1]$ from branching factor (`legalMoveCount`), tactical density (`checks + captures`), and depth-6 vs. depth-16 divergence (capped low `<= 0.16` on obvious recaptures).
- Samples think latency from a **log-normal distribution** scaled by $C$ and compressed proportionally when clock drops below `45,000 ms` (`clockCompressionStartMs`) and `< 15,000 ms`.
- **Pre-Commit Guards & Aborts**: Cancels cleanly on `USER_MOUSE_MOVEMENT` (trusted human `mousemove`/`pointerdown`/`touchstart` events), `FEN_CHANGED_DURING_ANALYSIS`, `FEN_CHANGED_BEFORE_EXECUTION`, `CONTROLLER_PAUSED`, or `NOT_CONTROLLED_TURN`.

### Autonomous Elo Profiles (1200 / 1600 / 2000)

Defined identically in `autoPlayPorts.ts` and Android `AutonomousEloProfile` (`ChessModels.kt`):

| Profile (`presetId`) | Label | Blunder Cap (`cp`) | Base Temp ($T$) | Standard Depth | Time-Trouble Depth | Gaussian Jitter ($\sigma$) | Approach / Drag (`ms`) | Dwell (`ms`) | Micro-Tremor (`px`) | Complex Delay (`ms`) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **`1200`** | Club Novice | `165` | `1.08` | `14` | `8` | `0.120` | `150–280` / `200–390` | `45–110` | `1.10` | `3,600–8,500` |
| **`1600`** *(default)* | Intermediate | `105` | `0.78` | `16` | `10` | `0.105` | `125–245` / `170–335` | `42–105` | `0.85` | `3,500–8,300` |
| **`2000`** | Expert Candidate | `60` | `0.50` | `18` | `12` | `0.090` | `105–210` / `145–285` | `40–95` | `0.65` | `3,500–7,900` |

---

## 5. Android Companion Application (`com.example.chessoverlay`)

### Screens & Navigation

`ChessForgeScreen.kt` hosts a dark-themed Material 3 `Scaffold` (`WindowInsets.safeDrawing` edge-to-edge) with a bottom `NavigationBar` (`Extension`, `Browser`, `Settings`) and `BackHandler` returning non-root tabs to `WorkspaceTab.EXTENSION`:

1. **Extension Hub (`WorkspaceTab.EXTENSION`)**:
   - Hero card with custom generated illustration, engine status pill, and quick `.zip` verification indicator.
   - Action buttons (`testTag`s `export_zip_button`, `share_zip_button`, `open_browser_button`) using Storage Access Framework (`CreateDocument("application/zip")`) and `FileProvider` sharing (`${applicationId}.fileprovider`).
   - Built-in Kiwi Browser / Edge Canary installation walkthrough.
2. **Browser Workspace (`WorkspaceTab.BROWSER` — `BrowserTabScreen.kt`)**:
   - Top bar with URL input (`url_input_field`), presets (**Practice**, **Lichess**, **Chess.com**), Focus Mode toggle (`browser_focus_toggle`), and compact `FairPlayStatusIndicator` (`browser_fairplay_overlay_indicator`).
   - Adaptive `EvaluationBar` (`Vertical` on wide/horizontal split or `Horizontal` strip), expandable `live_web_eval_strip` showing Multi-PV lines, Opening Book ECO & master stats, Syzygy Tablebase WDL/DTZ/DTM moves, detected board theme badge, and last-move Chess.com annotation pill.
3. **Engine & Overlay Settings (`WorkspaceTab.SETTINGS` — `SettingsScreen.kt`)**:
   - **FairPlay & Humanizer Guardrails Card**: Live `FairPlayStatusIndicator`, IPR/Z-score/$S_i$/ACPL telemetry box, toggles for `FairPlayAuditor` (`settings_switch_fairplay_auditor`) and `HumanizerController` (`settings_switch_humanizer`), Target Calibration Rating chips (`1000`–`2400`), and **Clear Session Telemetry Storage** button (`settings_clear_telemetry_button`).
   - **Autonomous Mode & Move Selector Profile Card**: `Autonomous Mode` switch (`settings_switch_autonomous_mode`), **1200 / 1600 / 2000 Elo** selector cards (`settings_autonomous_elo_1200` / `1600` / `2000`), and active profile summary (`settings_autonomous_profile_info`).
   - **Engine Strength & Overlay Controls**: CPU Profile (`Eco` / `Balanced` / `Turbo`), Analysis Depth slider/presets, Difficulty Skill Level (`0–20`), Multi-PV (`1–4`), Eval Bar Orientation (`Vertical` / `Horizontal`), toggles for SVG Arrows, Annotations, Opening Book, Syzygy Tablebase, Auto-Adapt Board Colors, HUD, Side-to-Move override (`auto` / `w` / `b`), and Offline Practice Auto-Play + Human Delay (`250–2500 ms`).

### UI Components & Responsive Design

- **`FairPlayStatusIndicator.kt`**: Animated spring color transitions between **SAFE** (`TacticalEmerald`), **ELEVATED** (`TacticalAmber`), and **LOCKOUT** (`TacticalRed`) with compact mode for the Browser Workspace bar and full mode in Settings.
- **`EvaluationBar.kt`**: Smoothly animated White/Black advantage bar displaying mate scores (`+M3`) or pawn advantage (`+1.4`).
- **`EngineStatusIndicator.kt`**: Live pill indicator (`Loading`, `Calculating`, `Idle`, `Error`).
- **Adaptive Width**: All scrollable panels constrain width with `Modifier.widthIn(max = 600.dp)` and centered alignment for tablets/foldables, using `BoxWithConstraints` in `BrowserTabScreen.kt` for multi-window responsiveness.

### WebView Bridge & Asset Packaging

- `AssetManagerHelper.kt` reads `extension/*.js` and `chess-forge-browser-extension.zip` directly from `app/src/main/assets/`.
- `BrowserTabScreen.kt` injects `chess-engine.js`, `opening-book.js`, `syzygy-tablebase.js`, and `content.js` into loaded pages and pushes live config updates via `window.__chessForgeUpdateConfig(...)` and telemetry resets via `window.__ChessForgeHumanizer.clearSessionTelemetry()`.
- JS pushes snapshots back to Kotlin cleanly through `@JavascriptInterface fun onAnalysisUpdate(json: String)` on `ChessForgeAndroidBridge`.

### Jetpack DataStore Keys & Persistence Schema

Stored in `chess_forge_ext_prefs` (`PreferencesRepository.kt`):

| Key Name | Type | Default | Description |
| --- | --- | --- | --- |
| `ext_enabled` | `Boolean` | `true` | Master extension overlay toggle |
| `ext_show_arrows` | `Boolean` | `true` | Render SVG best-move arrows |
| `ext_show_hud` | `Boolean` | `true` | Render floating evaluation HUD |
| `ext_show_eval_bar` | `Boolean` | `true` | Render Eval Bar overlay |
| `ext_show_annotations` | `Boolean` | `true` | Chess.com-style move quality badges |
| `ext_show_opening_book` | `Boolean` | `true` | Master Opening Book card & badge |
| `ext_show_tablebase` | `Boolean` | `true` | Syzygy 7-piece tablebase analysis |
| `ext_auto_adapt_theme` | `Boolean` | `true` | Automatic contrast adaptation |
| `ext_eval_orientation` | `String` | `"vertical"` | `"vertical"` or `"horizontal"` |
| `ext_multi_pv` | `Int` | `2` | Lines (`1..4`) |
| `ext_max_depth` | `Int` | `14` | Depth cap (`2..20`) |
| `ext_skill_level` | `Int` | `20` | Stockfish Skill Level (`0..20`) |
| `ext_cpu_profile` | `String` | `"balanced"` | `"eco"`, `"balanced"`, or `"turbo"` |
| `ext_turn_override` | `String` | `"auto"` | `"auto"`, `"w"`, or `"b"` |
| `ext_fair_play_enabled` | `Boolean` | `true` | `FairPlayAuditor` guardrail switch |
| `ext_humanizer_enabled` | `Boolean` | `true` | `HumanizerController` gating switch |
| `ext_target_elo` | `Int` | `1500` | Humanizer baseline rating (`400..3000`) |
| `ext_max_hints` | `Int` | `3` | Hint budget per game (`1..5`) |
| `ext_practice_auto` | `Boolean` | `false` | Offline practice board auto-sparring |
| `ext_practice_delay` | `Int` | `650` | Offline practice delay (`250..2500 ms`) |
| `ext_autonomous_mode` | `Boolean` | `false` | Generic 8×8 Autonomous Mode toggle |
| `ext_autonomous_elo_profile` | `Int` | `1600` | Selected Elo profile (`1200` / `1600` / `2000`) |
| `ext_telemetry_window_json` / `ext_telemetry_last_reset_ms` | `String` | *(cleared on reset)* | Session telemetry storage keys cleared by `clearSessionTelemetryStorage()` |

### Chess State Machine & UCI Parser

- **`ChessStateMachine.kt`**: Thread-safe board tracker backed by `bhlangonijr/chesslib` (`1.3.4`). Uses multi-frame stability debouncing (`REQUIRED_STABLE_FRAMES`), legal-move placement diffing to preserve castling/en passant/halfmove clocks, FEN validation/reconstruction fallback, and UCI-to-SAN conversion.
- **`UciParser.kt`**: Regex-based parser extracting `multipv`, `depth`, `seldepth`, `cp`/`mate`, `wdl` permilles, `nodes`, `nps`, `pv`, and `bestmove`, converting WDL or centipawns into normalized win percentages.

---

## 6. Complete Repository Map

```text
Chess-Forge/
├── .github/workflows/build.yml                 # Dual CI: Extension (.zip) + Android (.apk)
├── README.md                                   # Complete project documentation
├── metadata.json                               # Project metadata ("Chess Forge")
├── settings.gradle.kts / build.gradle.kts      # Root Gradle configuration
├── gradle/libs.versions.toml                   # Shared dependency version catalog
├── app/
│   ├── build.gradle.kts                        # Android app config (Compose, DataStore, chesslib, Robolectric)
│   └── src/
│       ├── main/
│       │   ├── AndroidManifest.xml             # INTERNET permission, MainActivity, FileProvider
│       │   ├── assets/
│       │   │   ├── chess-forge-browser-extension.zip
│       │   │   ├── extension/                  # WebView-injected JS extension mirror
│       │   │   ├── practice_board.html         # Self-contained offline 8x8 practice & test board
│       │   │   └── board_classifier.tflite
│       │   ├── java/com/example/chessoverlay/
│       │   │   ├── ChessForgeApp.kt
│       │   │   ├── MainActivity.kt
│       │   │   ├── chess/ChessStateMachine.kt
│       │   │   ├── engine/UciParser.kt
│       │   │   ├── model/ChessModels.kt
│       │   │   ├── ui/
│       │   │   │   ├── ChessForgeScreen.kt
│       │   │   │   ├── BrowserTabScreen.kt
│       │   │   │   ├── SettingsScreen.kt
│       │   │   │   ├── MainViewModel.kt
│       │   │   │   └── components/
│       │   │   │       ├── EngineStatusIndicator.kt
│       │   │   │       ├── EvaluationBar.kt
│       │   │   │       └── FairPlayStatusIndicator.kt
│       │   │   ├── ui/theme/                   # Obsidian/Carbon/Tactical Emerald Material 3 palette
│       │   │   └── util/
│       │   │       ├── AppLogger.kt
│       │   │       ├── AssetManagerHelper.kt
│       │   │       └── PreferencesRepository.kt
│       │   └── res/                            # Adaptive launcher icons, hero illustration, strings.xml
│       └── test/java/com/example/chessoverlay/
│           ├── ChessForgeRobolectricTest.kt    # End-to-end Compose UI, ZIP integrity & ViewModel tests
│           ├── chess/                          # ChessStateMachine unit tests
│           └── engine/                         # UciParser unit tests
└── browser-extension/
    ├── manifest.json                           # Chrome Manifest V3 (v2.1.0)
    ├── README.md                               # Concise extension install card
    ├── icons/                                  # 16px, 48px, 128px PNG icons
    ├── vendor/
    │   ├── stockfish-19-lite-single.js
    │   ├── stockfish-19-lite-single.wasm
    │   └── LICENSE-STOCKFISH.txt
    └── src/
        ├── background.js                       # MV3 service worker (offscreen host, Lichess APIs, caching)
        ├── offscreen.html / offscreen.js       # Stockfish 19 WASM Web Worker host
        ├── chess-engine.js                     # Offline alpha-beta JS fallback engine & SAN converter
        ├── opening-book.js                     # Built-in ECO book + Lichess Masters Explorer client
        ├── syzygy-tablebase.js                 # Syzygy 7-piece tablebase client + offline endgame solver
        ├── content.js                          # DOM scraper, theme detector, SVG arrows, HUD & guardrail bridge
        ├── popup.html / popup.css / popup.js   # Extension popup UI & chrome.storage sync
        └── ts/
            ├── ports.ts                        # EnginePort, PolicyPort (Maia-2 + fallback), ClockTelemetryPort, OverlayRenderPort
            ├── humanizerConfig.ts              # Rating curves & HumanizerConfig validation
            ├── humanizerController.ts          # Gate evaluation, Boltzmann dispersion & complexity delays
            ├── fairPlayModels.ts               # Sliding window telemetry & threshold constants
            ├── fairPlayAuditor.ts              # IPR Z-score, S_i spike tracking & LOCKOUT circuit breaker
            ├── integrationWiring.ts            # ChessForgeHumanizedPipeline coordinator
            ├── autoPlayPorts.ts                # BoardGeometryPort, EngineMultiPvPort, ClockStatePort & 1200/1600/2000 presets
            ├── humanizerMoveSelector.ts        # Candidate filtering, Delta_E gating & <15s time-trouble selector
            ├── kinematicPointerExecutor.ts     # Inner-60% 2D Gaussian jitter, cubic Bézier & minimum-jerk drag/click
            ├── autoPlayOrchestrator.ts         # Log-normal think pacing, FEN validation & manual-input abort
            ├── humanizerAndAuditor.test.ts     # 8 unit tests for HumanizerController, FairPlayAuditor & pipeline
            └── autoPlayPipeline.test.ts        # 4 unit tests for selector, kinematic pointer & orchestrator
```

---

## 7. Installation & Usage

### Desktop Browsers (Chrome / Edge / Brave)
1. Download the `chess-forge-pc-extension` artifact from GitHub Actions or clone this repository.
2. Navigate to `chrome://extensions` (or `edge://extensions`) and toggle **Developer mode** on.
3. Click **Load unpacked** and choose `browser-extension/` (or drag and drop `chess-forge-browser-extension.zip`).
4. Pin **Chess Forge** to open the live analysis popup on Lichess.org or Chess.com.

### Android Browsers (Kiwi Browser / Edge Canary)
1. Install `app-debug.apk` from the `chess-forge-mobile-apk` GitHub Actions artifact (or build locally).
2. Open the **Extension** tab inside the app and tap **Download .ZIP** or **Share to Browser** to export `chess-forge-browser-extension.zip`.
3. In Kiwi Browser or Edge Canary, open **Extensions**, enable **Developer mode**, tap **+ (from .zip/.crx/.user.js)**, and select `chess-forge-browser-extension.zip`.

### In-App Practice & WebView Analysis (No External Browser Required)
1. Open the **Browser** tab in the Chess Forge Android app.
2. Select **Practice** (`file:///android_asset/practice_board.html`), **Lichess**, or **Chess.com** (or enter any URL).
3. Adjust Guardrails, Elo profiles, CPU depth, and overlay toggles in the **Settings** tab; updates take effect immediately across the injected WebView bridge and persist in DataStore.

---

## 8. GitHub Actions CI/CD Workflow

Defined in `.github/workflows/build.yml` (runs on `push` / `pull_request` to `main` & `master`, plus manual `workflow_dispatch`):

| Job | Steps | Outputs / Artifacts |
| --- | --- | --- |
| **`pc-browser-extension`** | Validates `manifest.json` MV3 schema -> runs `node --check` on all 7 `.js` scripts -> runs `node --test browser-extension/src/ts/humanizerAndAuditor.test.ts` -> builds & tests `.zip` integrity | Artifact: `chess-forge-pc-extension` (`browser-extension/`) |
| **`mobile-android-apk`** | Packages `browser-extension/` into `app/src/main/assets/chess-forge-browser-extension.zip` -> sets up JDK 17, Gradle & Android SDK `36.1` -> restores/generates debug keystore -> builds `assembleDebug` -> runs JVM unit tests (`chess.*`, `engine.*`) and `ChessForgeRobolectricTest` | Artifact: `chess-forge-mobile-apk` (`app/build/outputs/apk/debug/app-debug.apk`) |

---

## 9. Local Build & Test Verification

### Browser Extension & TypeScript Suites (Node.js 22+)
```bash
# Validate MV3 JavaScript syntax
node --check browser-extension/src/background.js \
  && node --check browser-extension/src/offscreen.js \
  && node --check browser-extension/src/chess-engine.js \
  && node --check browser-extension/src/opening-book.js \
  && node --check browser-extension/src/syzygy-tablebase.js \
  && node --check browser-extension/src/content.js \
  && node --check browser-extension/src/popup.js

# Run all 12 TypeScript unit tests (HumanizerController, FairPlayAuditor, MoveSelector, KinematicPointer, Orchestrator)
node --test browser-extension/src/ts/humanizerAndAuditor.test.ts browser-extension/src/ts/autoPlayPipeline.test.ts
```

### Android Build & JVM / Robolectric Suites
```bash
# Assemble debug APK
gradle assembleDebug

# Run all unit & Compose Robolectric tests
gradle :app:testDebugUnitTest --console=plain

# Run only core chess/engine JVM tests
gradle :app:testDebugUnitTest --tests "com.example.chessoverlay.chess.*" --tests "com.example.chessoverlay.engine.*"
```

---

## 10. Tech Stack & Dependencies

| Layer | Technologies & Exact Versions (`gradle/libs.versions.toml` / `manifest.json`) |
| --- | --- |
| **Android App** | Kotlin `2.2.10`, Android Gradle Plugin `9.1.1`, `compileSdk 36.1` (`minSdk 26`, `targetSdk 36`), Jetpack Compose BOM `2024.09.00`, Material 3, Material Icons Extended, Lifecycle ViewModel/Runtime Compose `2.8.7`, Activity Compose `1.10.1`, Navigation Compose `2.8.9`, Coroutines `1.9.0`, Jetpack DataStore Preferences `1.1.7`, `com.github.bhlangonijr:chesslib:1.3.4`, Robolectric `4.16.1`, JUnit 4 |
| **Browser Extension** | Chrome Manifest V3 (`v2.1.0`), Offscreen Documents API, `chrome.storage.local`, Stockfish 19 Lite Single WASM (`stockfish-19-lite-single.wasm`), Shadow/SVG DOM Overlays |
| **TypeScript Subsystems** | Strict TypeScript ESM (`node --test` native runner on Node `v22+`), Box-Muller Gaussian sampling, Minimum-Jerk kinematics, Boltzmann softmax dispersion, 20-game IPR Z-score telemetry |
| **External APIs (Optional / Cached)** | `explorer.lichess.ovh/masters` (Opening Book), `tablebase.lichess.ovh/standard` (Syzygy 7-Piece Tablebase) — both with offline built-in fallbacks |
