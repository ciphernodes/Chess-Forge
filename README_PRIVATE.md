# ChessForge Private Architecture & Opt-In Flag Reference

ChessForge is an MV3 browser extension, Go native messaging host, and Android companion bridge built on strict hexagonal ports/adapters (`browser-extension/src/ts/`, `native-host/`, `app/src/main/java/com/example/chessoverlay/`).

All behavioral, kinematic, watchdog, OS input, and update-verification modules added across Phases 1–4 default to **`enabled: false` (explicit opt-in)** to preserve backward compatibility with baseline Elo profiles.

---

## Architecture Overview

1. **Phase 1 — Isolation & Dual-Source Verification**
   - **`isolatedOverlayRenderer.ts` & `pageStateShim.ts`**: Renders SVG/Canvas overlays inside a `closed` Shadow DOM (`adoptedStyleSheets`) mounted on `document.documentElement` within Chrome's `ISOLATED` content-script world; page shim posts read-only board snapshots via `window.postMessage` without mutating the page DOM.
   - **`dualStateReconciler.ts`**: Reconstructs board FEN from DOM move histories (`<l4x>` / `.move`) independently of visual piece scraping and downgrades to `READ_ONLY_HINT` after persistent mismatches.
   - **`bookAndTablebaseRouter.ts`**: Short-circuits local Stockfish on known ECO opening continuations (prefetches up to 20 continuations; stops explorer queries after move 15) and Syzygy 7-piece endgames.
   - **`fairPlayEventBus.ts`**: In-memory 5-game FairPlay telemetry bus + `AES-GCM` encrypted circuit-breaker persistence (`EncryptedFairPlayStorage`).

2. **Phase 2 — Maia-2 Policy, Behavioral Modeling & Monotonic Clocks**
   - **`humanizerMoveSelector.ts` & `openingPreferenceMatrix.ts`**: Wires `OnnxPolicyRunner` (Maia-2 ONNX) directly without synthetic priors when loaded; applies rating-specific opening matrices (1200/1600/2000) and gradual rating calibration (`userCurrentRating + 50`, 100-game ramp, `<300` Elo clamp).
   - **`behavioralStateMachine.ts`**: Mixes `crypto.getRandomValues()` session entropy with sinusoidal fatigue, randomizes Stockfish hash `±10%`, models tilt (`-200` Elo for 10 moves after 2 blunders in 5 moves) / confidence bursts, and supports panic/reset shortcuts.
   - **`clockAndSessionManager.ts`**: Tracks move elapsed time strictly via `performance.now()`, models increment vs non-increment low-clock pacing, circadian/opponent-rating scaling, and `30g/4h/2h` session caps.

3. **Phase 3 — Refined HCI Kinematics, Input Modes & Watchdogs**
   - **`kinematicPointerExecutor.ts`**: Adds accumulating dominant-side motor drift across `gamePly`, Perlin/fractal drag displacement (`0.5–1.5 px`), post-approach micro-corrections (`1–3` moves, `30–60 ms` pauses), criticality dwell boost (`+20 ms`), and `2%` destination micro-double-tap after pre-movement think delays.
   - **`inputModeController.ts` & `promotionHandler.ts`**: Samples `70% click / 30% drag` shifting toward clicks under time pressure; supports Lichess premoves (`1200: 30%`, `1600: 10%`, `2000: 5%` miss/fallback) and Lichess `#promotion-choice` / Chess.com auto-queen handling with `200–400 ms` recognition pauses and `2%` non-losing rook underpromotions at 1200 Elo.
   - **`environmentWatchdog.ts`**: Monitors `document.hidden`, `visibilityState`, and WebSocket status; pauses immediately with `TAB_FOCUS_ALERT` and resumes only after verified dual-source parity on the user's turn.

4. **Phase 4 — OS Trusted Input, Android Bridge & Signed Rollouts**
   - **`desktopInputDrivers.ts` & `native-host/native_input_host.go`**: Dispatches Bézier trajectories via Chrome DevTools Protocol (`chrome.debugger` `Input.dispatchMouseEvent`) or Chrome Native Messaging to Windows `SendInput()` (`MOUSEEVENTF_MOVE`).
   - **`ChessForgeAndroidBridge.kt` & `FairPlayStatusIndicator.kt`**: Exposes `AccessibilityDispatcher` (`GestureDescription`), `@JavascriptInterface onFairPlayTelemetry` (`FairPlayTelemetryModel`), live `S_i` spikes / IPR Z-score / ACPL UI rendering in `BrowserTabScreen`, and WebView UA + `chrome.runtime`/`chrome.storage` polyfills while defaulting to `NATIVE_ACCESSIBILITY_OVERLAY`.
   - **`updateVerifier.ts`**: Cryptographic update manifest verifier (`ECDSA-P256-SHA256` / `Ed25519` + SHA-256), key rotation (`active` / `grace` / `revoked`), rollback protection, and deterministic canary cohort bucketing.

---

## Opt-In Feature Flags Registry (All Default `false`)

| Module / Component | Flag / Field | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `IsolatedOverlayRenderer` | `config.enabled` | `false` | Enables closed Shadow DOM + `adoptedStyleSheets` isolated rendering |
| `PageStateShim` | `config.enabled` | `false` | Enables read-only `window.postMessage` page board bridge |
| `DualStateReconciler` | `config.enabled` | `false` | Enables strict DOM vs move-list FEN parity checks |
| `BookAndTablebaseRouter` | `config.enabled` | `false` | Enables opening book & Syzygy engine short-circuiting |
| `FairPlayEventBus` / `EncryptedFairPlayStorage` | `config.enabled` | `false` | Enables 5-game memory bus & encrypted lockout storage |
| `OpeningPreferenceEngine` | `config.enabled` | `false` | Enables rating-weighted ECO repertoire bias |
| `GradualRatingCalibrator` | `config.enabled` | `false` | Enables smooth 100-game `+50` Elo ramp calibration |
| `BehavioralStateMachine` | `config.enabled` | `false` | Enables sinusoidal fatigue, `±10%` hash entropy, and tilt state |
| `MonotonicClockTracker` | `config.enabled` | `false` | Enables `performance.now()` pacing independent of spoofed DOM clocks |
| `SessionPacingManager` | `config.enabled` | `false` | Enables session caps, circadian scaling, and cooldown gates |
| `RefinedKinematicProfileConfig` | `refinedProfile.enabled` | `false` | Enables dominant-side motor drift, fractal noise, corrections & double-tap |
| `InputModeController` | `config.enabled` | `false` | Enables `70/30` click/drag sampling & rating-calibrated premoves |
| `PromotionHandler` | `config.enabled` | `false` | Enables promotion dialog wait + 2% novice rook underpromotion |
| `EnvironmentWatchdog` | `config.enabled` | `false` | Enables visibility/socket pause alerts & parity-gated resume |
| `CdpTrustedInputDriver` | `config.enabled` | `false` | Enables `chrome.debugger` `Input.dispatchMouseEvent` trajectory driver |
| `NativeMessagingInputDriver` | `config.enabled` | `false` | Enables Chrome native messaging dispatch to `native_input_host.go` |
| `native_input_host.go` | `--enable` / `HostConfig.Enabled` | `false` | Gates Windows `SendInput()` OS mouse injection |
| `UpdateManifestVerifier` | `config.enabled` | `false` | Enables signed manifest + canary cohort rollout verification |
| `AccessibilityDispatcher` (Android) | `accessibilityDispatcherEnabled` | `false` | Enables `GestureDescription` strokes (native Chrome overlay mode default) |

---

## Local Verification Commands

```bash
# TypeScript unit suites (Node 22+)
node --test browser-extension/src/ts/*.test.ts

# Strict TypeScript check (requires TypeScript installed in browser-extension)
npm --prefix browser-extension run typecheck

# Go Native Host checks (Linux test + Windows cross-build)
(cd native-host && go vet ./... && go test -v ./... && GOOS=windows GOARCH=amd64 go build ./...)

# Android Kotlin compile & unit tests
gradle :app:compileDebugKotlin :app:testDebugUnitTest
```
