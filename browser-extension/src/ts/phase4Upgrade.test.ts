import test from "node:test";
import assert from "node:assert/strict";

import {
  ELO_1600_PRESET,
  GenericDomBoardGeometryAdapter,
} from "./autoPlayPorts.ts";
import { generateCubicBezierTrajectory } from "./kinematicPointerExecutor.ts";
import {
  CdpTrustedInputDriver,
  NativeMessagingInputDriver,
  type CdpDebugTarget,
  type DebuggerTransportPort,
  type NativeInputBatchRequest,
  type NativeMessagingPort,
} from "./desktopInputDrivers.ts";
import {
  UpdateManifestVerifier,
  buildCanonicalManifestSigningString,
  computeCanaryBucketBps,
  encryptUpdatePayload,
  sha256Hex,
  uint8ArrayToBase64,
  type SignedUpdateManifest,
  type TrustedSigningKey,
} from "./updateVerifier.ts";

function createFakeBoardElement(): Element {
  return {
    getAttribute: () => "false",
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 400, height: 400 }),
    querySelector: () => null,
    dispatchEvent: () => true,
    ownerDocument: null,
  } as unknown as Element;
}

test("CdpTrustedInputDriver defaults to enabled: false and dispatches Input.dispatchMouseEvent along Bezier waypoints when opted in", async () => {
  const geometry = new GenericDomBoardGeometryAdapter({
    boardElement: createFakeBoardElement(),
  });
  const calls: Array<{
    op: string;
    tabId: number;
    method?: string;
    params?: Record<string, unknown>;
  }> = [];

  const mockTransport: DebuggerTransportPort = {
    async attach(target: CdpDebugTarget, requiredVersion: string) {
      calls.push({ op: `attach:${requiredVersion}`, tabId: target.tabId });
    },
    async detach(target: CdpDebugTarget) {
      calls.push({ op: "detach", tabId: target.tabId });
    },
    async sendCommand(target, method, commandParams) {
      calls.push({ op: "cmd", tabId: target.tabId, method, params: commandParams });
      return {};
    },
  };

  const disabledDriver = new CdpTrustedInputDriver(geometry, mockTransport);
  assert.equal(disabledDriver.isEnabled(), false);
  const disabledRes = await disabledDriver.executeMove({
    tabId: 42,
    fromSquare: "e2",
    toSquare: "e4",
  });
  assert.equal(disabledRes.executed, false);
  assert.equal(disabledRes.reason, "CDP_DRIVER_DISABLED");
  assert.equal(calls.length, 0);

  let virtualTime = 500;
  const driver = new CdpTrustedInputDriver(geometry, mockTransport, {
    enabled: true,
    autoDetachAfterMove: true,
    kinematicConfig: {
      ...ELO_1600_PRESET.executor,
      dragMinMs: 96,
      dragMaxMs: 96,
      dwellMinMs: 40,
      dwellMaxMs: 40,
      randomFn: () => 0.5,
    },
    waitMs: async (ms) => {
      virtualTime += ms;
    },
    nowMs: () => virtualTime,
  });

  const plan = generateCubicBezierTrajectory(
    { x: 325, y: 405 },
    { x: 325, y: 305 },
    96,
    ELO_1600_PRESET.executor,
    () => 0.5,
    16
  );

  let releasedAt = 0;
  const res = await driver.executeMove({
    tabId: 42,
    fromSquare: "e2",
    toSquare: "e4",
    mode: "drag",
    precomputedOrigin: { x: 325, y: 405 },
    precomputedDragWaypoints: plan.waypoints,
    onImmediateRelease: (ts) => {
      releasedAt = ts;
    },
  });

  assert.equal(res.executed, true);
  assert.equal(res.mode, "drag");
  assert.ok(releasedAt > 500);
  assert.equal(calls[0].op, "attach:1.3");
  assert.equal(calls[calls.length - 1].op, "detach");

  const mouseCommands = calls.filter(
    (c) => c.op === "cmd" && c.method === "Input.dispatchMouseEvent"
  );
  assert.equal(mouseCommands[0].params?.type, "mouseMoved");
  assert.equal(mouseCommands[1].params?.type, "mousePressed");
  assert.equal(mouseCommands[mouseCommands.length - 1].params?.type, "mouseReleased");
  assert.ok(mouseCommands.length >= plan.waypoints.length + 2);
});

test("NativeMessagingInputDriver defaults to enabled: false and sends screen_px JSON waypoint batches for native_input_host.go", async () => {
  const geometry = new GenericDomBoardGeometryAdapter({
    boardElement: createFakeBoardElement(),
  });

  const sentBatches: Array<{ hostName: string; payload: NativeInputBatchRequest }> = [];
  const mockNativePort: NativeMessagingPort = {
    async sendNativeMessage(hostName, payload) {
      sentBatches.push({ hostName, payload });
      return {
        ok: true,
        batchId: payload.batchId,
        dispatchedEvents: payload.waypoints.length,
        simulated: true,
      };
    },
  };

  const disabledNative = new NativeMessagingInputDriver(geometry, mockNativePort);
  assert.equal(disabledNative.isEnabled(), false);
  const skip = await disabledNative.executeMove({
    fromSquare: "g1",
    toSquare: "f3",
  });
  assert.equal(skip.ok, false);
  assert.equal(skip.error, "NATIVE_DRIVER_DISABLED");
  assert.equal(sentBatches.length, 0);

  const activeNative = new NativeMessagingInputDriver(geometry, mockNativePort, {
    enabled: true,
    screenOffsetPx: { x: 20, y: 120 },
    devicePixelRatio: 1.5,
    kinematicConfig: {
      ...ELO_1600_PRESET.executor,
      dragMinMs: 80,
      dragMaxMs: 80,
      dwellMinMs: 45,
      dwellMaxMs: 45,
      randomFn: () => 0.5,
    },
    nowMs: () => 10_000,
  });

  const res = await activeNative.executeMove({
    fromSquare: "g1",
    toSquare: "f3",
    mode: "drag",
    batchId: "batch-test-1",
  });
  assert.equal(res.ok, true);
  assert.equal(res.batchId, "batch-test-1");
  assert.equal(sentBatches.length, 1);
  assert.equal(sentBatches[0].hostName, "com.chessforge.native_input_host");
  const wp = sentBatches[0].payload.waypoints;
  assert.equal(sentBatches[0].payload.type, "DISPATCH_TRAJECTORY");
  assert.equal(sentBatches[0].payload.coordinateSpace, "screen_px");
  assert.equal(wp[0].action, "move");
  assert.equal(wp[1].action, "left_down");
  assert.equal(wp[wp.length - 1].action, "left_up");
  assert.ok(wp[0].x > 400 && wp[0].y > 500);
});

async function signTestManifest(
  keyPair: CryptoKeyPair,
  keyId: string,
  base: Omit<SignedUpdateManifest, "keyId" | "algorithm" | "signatureBase64">
): Promise<{ manifest: SignedUpdateManifest; spkiBase64: string }> {
  const spki = await globalThis.crypto.subtle.exportKey("spki", keyPair.publicKey);
  const spkiBase64 = uint8ArrayToBase64(new Uint8Array(spki));
  const unsigned: Omit<SignedUpdateManifest, "signatureBase64"> = {
    ...base,
    keyId,
    algorithm: "ECDSA-P256-SHA256",
  };
  const msg = new TextEncoder().encode(buildCanonicalManifestSigningString(unsigned));
  const sig = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    msg
  );
  return {
    manifest: {
      ...unsigned,
      signatureBase64: uint8ArrayToBase64(new Uint8Array(sig)),
    },
    spkiBase64,
  };
}

test("UpdateManifestVerifier defaults to enabled: false, verifies ECDSA signatures, key rotation, rollback protection, and staged canary rollouts", async () => {
  const kp1 = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const kp2 = await globalThis.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const artifact = new TextEncoder().encode("chessforge-bundle-2.2.0-bytes");
  const artifactSha = await sha256Hex(artifact);
  const now = 1_700_000_000_000;

  const { manifest: m1, spkiBase64: spki1 } = await signTestManifest(kp1, "key-2026-01", {
    schemaVersion: 1,
    releaseId: "rel-2.2.0",
    version: "2.2.0",
    monotonicSequence: 12,
    channel: "stable",
    canaryPercentage: 100,
    artifactUrl: "https://updates.example.invalid/chessforge-2.2.0.zip",
    artifactSha256Hex: artifactSha,
    issuedAtMs: now - 10_000,
    expiresAtMs: now + 3_600_000,
  });

  const { manifest: m2, spkiBase64: spki2 } = await signTestManifest(kp2, "key-2026-02", {
    schemaVersion: 1,
    releaseId: "rel-2.2.1-canary",
    version: "2.2.1",
    monotonicSequence: 13,
    channel: "canary",
    canaryPercentage: 10,
    artifactUrl: "https://updates.example.invalid/chessforge-2.2.1.zip",
    artifactSha256Hex: artifactSha,
    issuedAtMs: now - 5_000,
    expiresAtMs: now + 3_600_000,
  });

  const keys: TrustedSigningKey[] = [
    {
      keyId: "key-2026-01",
      algorithm: "ECDSA-P256-SHA256",
      publicKeySpkiBase64: spki1,
      status: "grace",
      expiresAtMs: now + 86_400_000,
    },
    {
      keyId: "key-2026-02",
      algorithm: "ECDSA-P256-SHA256",
      publicKeySpkiBase64: spki2,
      status: "active",
    },
  ];

  const disabledVerifier = new UpdateManifestVerifier({ trustedKeys: keys });
  assert.equal(disabledVerifier.isEnabled(), false);
  const disabledResult = await disabledVerifier.verifyUpdate(m1, artifact);
  assert.equal(disabledResult.accepted, false);
  assert.equal(disabledResult.reasonCode, "VERIFIER_DISABLED");

  // Enable verifier: grace key accepts m1
  const verifier = new UpdateManifestVerifier({
    enabled: true,
    currentVersion: "2.1.0",
    currentMonotonicSequence: 10,
    channel: "stable",
    installId: "install-alpha",
    trustedKeys: keys,
    nowMs: () => now,
  });
  const ok1 = await verifier.verifyUpdate(m1, artifact);
  assert.equal(ok1.accepted, true);
  assert.equal(ok1.verifiedSignature, true);
  assert.equal(ok1.verifiedArtifactDigest, true);
  assert.equal(ok1.usedGraceKey, true);

  // Tampered artifact fails SHA-256 digest check
  const badDigest = await verifier.verifyUpdate(m1, "tampered-zip-payload");
  assert.equal(badDigest.accepted, false);
  assert.equal(badDigest.reasonCode, "ARTIFACT_DIGEST_MISMATCH");

  // Tampered manifest fails ECDSA signature
  const tamperedManifest: SignedUpdateManifest = {
    ...m1,
    canaryPercentage: 99,
  };
  const badSig = await verifier.verifyUpdate(tamperedManifest, artifact);
  assert.equal(badSig.accepted, false);
  assert.equal(badSig.reasonCode, "INVALID_SIGNATURE");

  // Rollback protection blocks older sequence
  const rollbackVerifier = new UpdateManifestVerifier({
    enabled: true,
    currentVersion: "2.3.0",
    currentMonotonicSequence: 15,
    channel: "stable",
    installId: "install-alpha",
    trustedKeys: keys,
    nowMs: () => now,
  });
  const rollback = await rollbackVerifier.verifyUpdate(m1, artifact);
  assert.equal(rollback.accepted, false);
  assert.equal(rollback.reasonCode, "ROLLBACK_DETECTED");

  // Key rotation revocation blocks previously valid grace key
  verifier.rotateTrustedKeys([
    { ...keys[0], status: "revoked" },
    keys[1],
  ]);
  const revoked = await verifier.verifyUpdate(m1, artifact);
  assert.equal(revoked.accepted, false);
  assert.equal(revoked.reasonCode, "KEY_REVOKED");

  // Staged canary rollout deterministically gates cohorts by 10% bucket
  let chosenInCohort = "";
  let chosenOutCohort = "";
  for (let i = 0; i < 200; i++) {
    const id = `install-${i}`;
    const b = computeCanaryBucketBps(id, m2.releaseId);
    if (b < 1000 && !chosenInCohort) chosenInCohort = id;
    if (b >= 1000 && !chosenOutCohort) chosenOutCohort = id;
    if (chosenInCohort && chosenOutCohort) break;
  }
  assert.ok(chosenInCohort && chosenOutCohort);

  const inCohortVerifier = new UpdateManifestVerifier({
    enabled: true,
    currentVersion: "2.1.0",
    currentMonotonicSequence: 10,
    channel: "canary",
    installId: chosenInCohort,
    trustedKeys: keys,
    nowMs: () => now,
  });
  const outCohortVerifier = new UpdateManifestVerifier({
    enabled: true,
    currentVersion: "2.1.0",
    currentMonotonicSequence: 10,
    channel: "canary",
    installId: chosenOutCohort,
    trustedKeys: keys,
    nowMs: () => now,
  });

  const canaryHit = await inCohortVerifier.verifyUpdate(m2, artifact);
  assert.equal(canaryHit.accepted, true);
  assert.equal(canaryHit.eligibleForRollout, true);

  const canaryMiss = await outCohortVerifier.verifyUpdate(m2, artifact);
  assert.equal(canaryMiss.accepted, false);
  assert.equal(canaryMiss.reasonCode, "NOT_IN_CANARY_COHORT");

  // Encrypted AES-256-GCM update payload round-trip + tamper rejection
  const aesKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(aesKey);
  const encryptedBundle = await encryptUpdatePayload(artifact, aesKey, m1.releaseId);

  // Restore active key1 on verifier for encrypted bundle test
  verifier.rotateTrustedKeys(keys);
  const decOk = await verifier.verifyAndDecryptUpdate(m1, encryptedBundle, aesKey);
  assert.equal(decOk.accepted, true);
  assert.equal(decOk.verifiedSignature, true);
  assert.equal(decOk.verifiedArtifactDigest, true);
  assert.equal(
    new TextDecoder().decode(decOk.decryptedArtifactBytes ?? new Uint8Array()),
    "chessforge-bundle-2.2.0-bytes"
  );

  // Wrong AES key rejects with PAYLOAD_DECRYPTION_FAILED
  const wrongKey = new Uint8Array(32).fill(7);
  const decFail = await verifier.verifyAndDecryptUpdate(m1, encryptedBundle, wrongKey);
  assert.equal(decFail.accepted, false);
  assert.equal(decFail.reasonCode, "PAYLOAD_DECRYPTION_FAILED");
  assert.equal(decFail.decryptedArtifactBytes, null);

  // Disabled verifier refuses decryption
  const disabledEncRes = await disabledVerifier.verifyAndDecryptUpdate(
    m1,
    encryptedBundle,
    aesKey
  );
  assert.equal(disabledEncRes.accepted, false);
  assert.equal(disabledEncRes.reasonCode, "VERIFIER_DISABLED");
});
