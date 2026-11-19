/**
 * Signed Manifest / Update Payload Verifier (`updateVerifier.ts`).
 *
 * Implements:
 * 1. Cryptographic signature verification (ECDSA P-256 SHA-256 and Ed25519 via WebCrypto)
 *    and SHA-256 artifact digest verification.
 * 2. Key rotation support (`active`, `grace`, `revoked`) with time-bounded `notBeforeMs`
 *    and `expiresAtMs` validation.
 * 3. Staged canary rollout cohort evaluation (deterministic installId bucketing in basis
 *    points, channel matching, allowlist/denylist, and monotonic rollback protection).
 *
 * Defaults to `enabled: false` (explicit opt-in).
 */

export type SignatureAlgorithm = "ECDSA-P256-SHA256" | "Ed25519";

export type KeyRotationStatus = "active" | "grace" | "revoked";

export type RolloutChannel = "stable" | "beta" | "canary";

export interface TrustedSigningKey {
  readonly keyId: string;
  readonly algorithm: SignatureAlgorithm;
  /** Base64-encoded SubjectPublicKeyInfo (SPKI) DER public key. */
  readonly publicKeySpkiBase64: string;
  readonly status: KeyRotationStatus;
  readonly notBeforeMs?: number;
  readonly expiresAtMs?: number;
}

export interface SignedUpdateManifest {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly version: string;
  readonly monotonicSequence: number;
  readonly channel: RolloutChannel;
  /** Canary rollout percentage in [0, 100]. */
  readonly canaryPercentage: number;
  readonly artifactUrl: string;
  readonly artifactSha256Hex: string;
  readonly minExtensionVersion?: string;
  readonly cohortAllowlist?: readonly string[];
  readonly cohortDenylist?: readonly string[];
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly keyId: string;
  readonly algorithm: SignatureAlgorithm;
  /** Base64-encoded raw signature over `buildCanonicalManifestSigningString(manifest)`. */
  readonly signatureBase64: string;
}

export interface UpdateVerifierConfig {
  /** Explicit opt-in flag; defaults to false. */
  readonly enabled: boolean;
  readonly currentVersion: string;
  readonly currentMonotonicSequence: number;
  readonly channel: RolloutChannel;
  readonly installId: string;
  readonly trustedKeys: readonly TrustedSigningKey[];
  readonly nowMs?: () => number;
}

export const DEFAULT_UPDATE_VERIFIER_CONFIG: UpdateVerifierConfig = {
  enabled: false,
  currentVersion: "2.1.0",
  currentMonotonicSequence: 1,
  channel: "stable",
  installId: "default-install",
  trustedKeys: [],
};

export type UpdateVerificationRejectionCode =
  | "VERIFIER_DISABLED"
  | "EXPIRED_MANIFEST"
  | "ROLLBACK_DETECTED"
  | "VERSION_TOO_OLD"
  | "CHANNEL_MISMATCH"
  | "UNKNOWN_KEY"
  | "KEY_REVOKED"
  | "KEY_NOT_YET_VALID"
  | "KEY_EXPIRED"
  | "ALGORITHM_MISMATCH"
  | "INVALID_SIGNATURE"
  | "ARTIFACT_DIGEST_MISMATCH"
  | "NOT_IN_CANARY_COHORT";

export interface UpdateVerificationResult {
  readonly accepted: boolean;
  readonly verifiedSignature: boolean;
  readonly verifiedArtifactDigest: boolean;
  readonly eligibleForRollout: boolean;
  readonly usedGraceKey: boolean;
  readonly keyId: string;
  readonly cohortBucketBps: number;
  readonly reasonCode: UpdateVerificationRejectionCode | "VERIFIED_AND_ELIGIBLE";
  readonly detail: string;
}

function getSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is unavailable in this runtime");
  }
  return subtle;
}

export function base64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.trim();
  let binary: string;
  if (typeof atob === "function") {
    binary = atob(clean);
  } else {
    binary = Buffer.from(clean, "base64").toString("binary");
  }
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let bin = "";
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin);
  }
  return Buffer.from(bytes).toString("base64");
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const raw =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = new ArrayBuffer(raw.byteLength);
  new Uint8Array(buf).set(raw);
  const digest = await getSubtleCrypto().digest("SHA-256", buf);
  return bytesToHex(new Uint8Array(digest));
}

/**
 * Deterministic canonical string over all immutable manifest fields excluding `signatureBase64`.
 */
export function buildCanonicalManifestSigningString(
  manifest: Omit<SignedUpdateManifest, "signatureBase64">
): string {
  const payload = {
    schemaVersion: manifest.schemaVersion,
    releaseId: manifest.releaseId,
    version: manifest.version,
    monotonicSequence: manifest.monotonicSequence,
    channel: manifest.channel,
    canaryPercentage: manifest.canaryPercentage,
    artifactUrl: manifest.artifactUrl,
    artifactSha256Hex: manifest.artifactSha256Hex.toLowerCase(),
    minExtensionVersion: manifest.minExtensionVersion ?? "",
    cohortAllowlist: manifest.cohortAllowlist
      ? [...manifest.cohortAllowlist].sort()
      : [],
    cohortDenylist: manifest.cohortDenylist
      ? [...manifest.cohortDenylist].sort()
      : [],
    issuedAtMs: manifest.issuedAtMs,
    expiresAtMs: manifest.expiresAtMs,
    keyId: manifest.keyId,
    algorithm: manifest.algorithm,
  };
  return JSON.stringify(payload);
}

/**
 * Compares dotted semantic versions (e.g., "2.1.0" vs "2.0.9").
 * Returns -1 if a < b, 0 if equal, +1 if a > b.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a
    .replace(/^v/i, "")
    .split(".")
    .map((x) => Number.parseInt(x, 10) || 0);
  const pb = b
    .replace(/^v/i, "")
    .split(".")
    .map((x) => Number.parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

/**
 * Deterministic FNV-1a 32-bit cohort hash mapped into basis points [0, 9999].
 */
export function computeCanaryBucketBps(
  installId: string,
  releaseId: string
): number {
  const input = `${installId}:${releaseId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10_000;
}

function channelAllows(
  deviceChannel: RolloutChannel,
  manifestChannel: RolloutChannel
): boolean {
  if (deviceChannel === "canary") return true;
  if (deviceChannel === "beta") {
    return manifestChannel === "beta" || manifestChannel === "stable";
  }
  return manifestChannel === "stable";
}

export async function verifyManifestCryptoSignature(
  manifest: SignedUpdateManifest,
  key: TrustedSigningKey
): Promise<boolean> {
  const subtle = getSubtleCrypto();
  const spkiBytes = base64ToUint8Array(key.publicKeySpkiBase64);
  const sigBytes = base64ToUint8Array(manifest.signatureBase64);
  const msgRaw = new TextEncoder().encode(
    buildCanonicalManifestSigningString(manifest)
  );
  const msgBuf = new ArrayBuffer(msgRaw.byteLength);
  new Uint8Array(msgBuf).set(msgRaw);

  if (key.algorithm === "ECDSA-P256-SHA256") {
    const cryptoKey = await subtle.importKey(
      "spki",
      spkiBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      sigBytes,
      msgBuf
    );
  }

  const cryptoKey = await subtle.importKey(
    "spki",
    spkiBytes,
    { name: "Ed25519" },
    false,
    ["verify"]
  );
  return subtle.verify({ name: "Ed25519" }, cryptoKey, sigBytes, msgBuf);
}

export class UpdateManifestVerifier {
  private config: UpdateVerifierConfig;

  constructor(config: Partial<UpdateVerifierConfig> = {}) {
    this.config = {
      ...DEFAULT_UPDATE_VERIFIER_CONFIG,
      ...config,
      trustedKeys: config.trustedKeys ?? DEFAULT_UPDATE_VERIFIER_CONFIG.trustedKeys,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.config = { ...this.config, enabled };
  }

  rotateTrustedKeys(nextKeys: readonly TrustedSigningKey[]): void {
    this.config = { ...this.config, trustedKeys: [...nextKeys] };
  }

  getTrustedKeys(): readonly TrustedSigningKey[] {
    return this.config.trustedKeys;
  }

  async verifyUpdate(
    manifest: SignedUpdateManifest,
    artifactBytes?: Uint8Array | string
  ): Promise<UpdateVerificationResult> {
    const bucketBps = computeCanaryBucketBps(
      this.config.installId,
      manifest.releaseId
    );
    const makeReject = (
      reasonCode: UpdateVerificationRejectionCode,
      detail: string,
      verifiedSignature = false,
      verifiedArtifactDigest = false,
      usedGraceKey = false
    ): UpdateVerificationResult => ({
      accepted: false,
      verifiedSignature,
      verifiedArtifactDigest,
      eligibleForRollout: false,
      usedGraceKey,
      keyId: manifest.keyId,
      cohortBucketBps: bucketBps,
      reasonCode,
      detail,
    });

    if (!this.config.enabled) {
      return makeReject(
        "VERIFIER_DISABLED",
        "Update verification is disabled (opt-in required)"
      );
    }

    const now = this.config.nowMs?.() ?? Date.now();
    if (manifest.expiresAtMs <= now) {
      return makeReject(
        "EXPIRED_MANIFEST",
        `Manifest expired at ${manifest.expiresAtMs} (now=${now})`
      );
    }

    if (
      manifest.monotonicSequence <= this.config.currentMonotonicSequence ||
      compareSemver(manifest.version, this.config.currentVersion) < 0
    ) {
      return makeReject(
        "ROLLBACK_DETECTED",
        `Rollback blocked: manifest seq=${manifest.monotonicSequence} v=${manifest.version} <= current seq=${this.config.currentMonotonicSequence} v=${this.config.currentVersion}`
      );
    }

    if (
      manifest.minExtensionVersion &&
      compareSemver(this.config.currentVersion, manifest.minExtensionVersion) < 0
    ) {
      return makeReject(
        "VERSION_TOO_OLD",
        `Current version ${this.config.currentVersion} below required ${manifest.minExtensionVersion}`
      );
    }

    if (!channelAllows(this.config.channel, manifest.channel)) {
      return makeReject(
        "CHANNEL_MISMATCH",
        `Device channel '${this.config.channel}' cannot accept '${manifest.channel}' manifest`
      );
    }

    const key = this.config.trustedKeys.find(
      (k) => k.keyId === manifest.keyId
    );
    if (!key) {
      return makeReject("UNKNOWN_KEY", `Unknown keyId '${manifest.keyId}'`);
    }
    if (key.status === "revoked") {
      return makeReject("KEY_REVOKED", `Signing key '${key.keyId}' is revoked`);
    }
    if (key.notBeforeMs !== undefined && now < key.notBeforeMs) {
      return makeReject(
        "KEY_NOT_YET_VALID",
        `Signing key '${key.keyId}' not valid before ${key.notBeforeMs}`
      );
    }
    if (key.expiresAtMs !== undefined && now > key.expiresAtMs) {
      return makeReject(
        "KEY_EXPIRED",
        `Signing key '${key.keyId}' expired at ${key.expiresAtMs}`
      );
    }
    if (key.algorithm !== manifest.algorithm) {
      return makeReject(
        "ALGORITHM_MISMATCH",
        `Key algorithm '${key.algorithm}' != manifest '${manifest.algorithm}'`
      );
    }

    const usedGraceKey = key.status === "grace";

    let sigOk = false;
    try {
      sigOk = await verifyManifestCryptoSignature(manifest, key);
    } catch {
      sigOk = false;
    }
    if (!sigOk) {
      return makeReject(
        "INVALID_SIGNATURE",
        `Cryptographic signature failed for release '${manifest.releaseId}'`,
        false,
        false,
        usedGraceKey
      );
    }

    let digestVerified = false;
    if (artifactBytes !== undefined) {
      const actualHex = await sha256Hex(artifactBytes);
      if (actualHex !== manifest.artifactSha256Hex.toLowerCase()) {
        return makeReject(
          "ARTIFACT_DIGEST_MISMATCH",
          `Artifact SHA-256 mismatch: expected ${manifest.artifactSha256Hex}, got ${actualHex}`,
          true,
          false,
          usedGraceKey
        );
      }
      digestVerified = true;
    }

    // Evaluate staged canary cohort eligibility
    if (manifest.cohortDenylist?.includes(this.config.installId)) {
      return makeReject(
        "NOT_IN_CANARY_COHORT",
        `Install '${this.config.installId}' is excluded by cohortDenylist`,
        true,
        digestVerified,
        usedGraceKey
      );
    }

    const allowlisted = Boolean(
      manifest.cohortAllowlist?.includes(this.config.installId)
    );
    const pctClamped = Math.max(0, Math.min(100, manifest.canaryPercentage));
    const thresholdBps = Math.round(pctClamped * 100);
    const eligible = allowlisted || bucketBps < thresholdBps;

    if (!eligible) {
      return makeReject(
        "NOT_IN_CANARY_COHORT",
        `Cohort bucket ${bucketBps} >= canary threshold ${thresholdBps} (${pctClamped}%)`,
        true,
        digestVerified,
        usedGraceKey
      );
    }

    return {
      accepted: true,
      verifiedSignature: true,
      verifiedArtifactDigest: digestVerified,
      eligibleForRollout: true,
      usedGraceKey,
      keyId: key.keyId,
      cohortBucketBps: bucketBps,
      reasonCode: "VERIFIED_AND_ELIGIBLE",
      detail: usedGraceKey
        ? `Verified via rotating grace key '${key.keyId}'`
        : `Verified via active key '${key.keyId}'`,
    };
  }
}
