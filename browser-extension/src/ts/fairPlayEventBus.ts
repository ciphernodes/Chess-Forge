/**
 * FairPlay Event Bus & Privacy-Preserving Telemetry Storage (`fairPlayEventBus.ts`).
 *
 * - Provides typed `RiskLevelChanged` events emitted by `FairPlayAuditor` and consumed by
 *   `HumanizerController` and `AutoPlayOrchestrator`.
 * - Provides in-memory 5-game rolling storage (`MemoryOnlyFairPlayStorage`) eliminating plaintext
 *   `chrome.storage.local` writes of `chessForgeFairPlayWindowV1`.
 * - Provides Web Crypto AES-GCM encrypted persistence (`EncryptedFairPlayStorage`) derived from
 *   `chrome.storage.sync` secret + per-install `deviceId` when circuit-breaker persistence is needed.
 *
 * All new event-bus auto-reactions and encrypted persistence layers default to `enabled: false`
 * (explicit opt-in) to maintain backward compatibility with existing profiles and tests.
 */

import type {
  FairPlayMetricsSnapshot,
  FairPlayRiskLevel,
  FairPlayStorageAdapter,
} from "./fairPlayModels.ts";

export const FAIR_PLAY_PRIVACY_WINDOW_SIZE = 5;
export const ENCRYPTED_CIRCUIT_BREAKER_STORAGE_KEY = "cfEncryptedBreakerV1";

export interface RiskLevelChangedEvent {
  readonly type: "RiskLevelChanged";
  readonly previousLevel: FairPlayRiskLevel;
  readonly currentLevel: FairPlayRiskLevel;
  readonly snapshot: FairPlayMetricsSnapshot;
  readonly reason: string | null;
  readonly timestampMs: number;
}

export type RiskLevelChangedListener = (event: RiskLevelChangedEvent) => void;

/**
 * Typed event bus for FairPlayAuditor state transitions (`RiskLevelChanged`).
 */
export class FairPlayEventBus {
  private readonly listeners = new Set<RiskLevelChangedListener>();
  private lastEvent: RiskLevelChangedEvent | null = null;

  onRiskLevelChanged(listener: RiskLevelChangedListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emitRiskLevelChanged(event: RiskLevelChangedEvent): void {
    this.lastEvent = event;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch {
        // Isolate subscriber failures so all listeners and auditor continue cleanly
      }
    }
  }

  getLastEvent(): RiskLevelChangedEvent | null {
    return this.lastEvent;
  }

  getListenerCount(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
    this.lastEvent = null;
  }
}

/**
 * In-memory-only telemetry storage capping the rolling window cleanly without touching
 * `chrome.storage.local`. Defaults to a 5-game rolling window.
 */
export class MemoryOnlyFairPlayStorage implements FairPlayStorageAdapter {
  private readonly store = new Map<string, unknown>();
  readonly maxWindowGames: number;

  constructor(maxWindowGames: number = FAIR_PLAY_PRIVACY_WINDOW_SIZE) {
    this.maxWindowGames = Math.max(1, Math.round(maxWindowGames));
  }

  async get(key: string): Promise<unknown> {
    return this.store.get(key) ?? null;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      if (
        v &&
        typeof v === "object" &&
        "games" in v &&
        Array.isArray((v as { games?: unknown[] }).games)
      ) {
        const obj = v as { baselineElo?: number; games: unknown[] };
        this.store.set(k, {
          ...obj,
          games: obj.games.slice(-this.maxWindowGames),
        });
      } else {
        this.store.set(k, v);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export interface SyncKeyMaterialProvider {
  getSyncSecret(): Promise<string>;
  getDeviceId(): Promise<string>;
}

export interface EncryptedPayloadEnvelope {
  readonly v: 1;
  readonly alg: "AES-GCM";
  readonly kdf: "PBKDF2-SHA256";
  readonly ivB64: string;
  readonly saltB64: string;
  readonly ciphertextB64: string;
}

export interface EncryptedStorageConfig {
  /** Explicit opt-in flag; defaults to false to keep telemetry in-memory only unless enabled. */
  readonly enabled: boolean;
  readonly backingStorage: FairPlayStorageAdapter;
  readonly keyMaterial: SyncKeyMaterialProvider;
  readonly maxWindowGames?: number;
}

/**
 * Encrypts circuit-breaker telemetry using AES-GCM with a per-install key derived via PBKDF2
 * from `chrome.storage.sync` secret material + per-device install ID (`deviceId`).
 */
export class EncryptedFairPlayStorage implements FairPlayStorageAdapter {
  private enabled: boolean;
  private readonly backingStorage: FairPlayStorageAdapter;
  private readonly keyMaterial: SyncKeyMaterialProvider;
  private readonly maxWindowGames: number;
  private readonly memoryCache = new Map<string, unknown>();

  constructor(config: EncryptedStorageConfig) {
    this.enabled = config.enabled ?? false;
    this.backingStorage = config.backingStorage;
    this.keyMaterial = config.keyMaterial;
    this.maxWindowGames = Math.max(
      1,
      Math.round(config.maxWindowGames ?? FAIR_PLAY_PRIVACY_WINDOW_SIZE)
    );
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
  }

  async get(key: string): Promise<unknown> {
    if (!this.enabled) {
      return this.memoryCache.get(key) ?? null;
    }

    const storageKey = mapToEncryptedStorageKey(key);
    const raw = await this.backingStorage.get(storageKey);
    if (!raw || !isEncryptedEnvelope(raw)) {
      return this.memoryCache.get(key) ?? null;
    }

    const secret = await this.keyMaterial.getSyncSecret();
    const deviceId = await this.keyMaterial.getDeviceId();
    const decrypted = await decryptJsonWithAesGcm(raw, `${secret}:${deviceId}`);
    if (
      decrypted &&
      typeof decrypted === "object" &&
      "games" in decrypted &&
      Array.isArray((decrypted as { games?: unknown[] }).games)
    ) {
      const obj = decrypted as { baselineElo?: number; games: unknown[] };
      return {
        ...obj,
        games: obj.games.slice(-this.maxWindowGames),
      };
    }
    return decrypted;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [k, v] of Object.entries(items)) {
      const normalized = trimWindowPayload(v, this.maxWindowGames);
      this.memoryCache.set(k, normalized);

      if (!this.enabled) continue;

      const secret = await this.keyMaterial.getSyncSecret();
      const deviceId = await this.keyMaterial.getDeviceId();
      const envelope = await encryptJsonWithAesGcm(
        normalized,
        `${secret}:${deviceId}`
      );
      await this.backingStorage.set({
        [mapToEncryptedStorageKey(k)]: envelope,
      });
    }
  }
}

export function createChromeSyncKeyMaterialProvider(options: {
  readonly syncStorage?: {
    get(keys: Record<string, unknown>): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  } | null;
  readonly localStorage?: {
    get(keys: Record<string, unknown>): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  } | null;
} = {}): SyncKeyMaterialProvider {
  const SYNC_KEY = "cfInstallSyncSecretV1";
  const DEVICE_KEY = "cfInstallDeviceIdV1";
  let cachedSync = "";
  let cachedDevice = "";

  return {
    async getSyncSecret(): Promise<string> {
      if (cachedSync) return cachedSync;
      if (options.syncStorage) {
        const res = await options.syncStorage.get({ [SYNC_KEY]: "" });
        if (typeof res[SYNC_KEY] === "string" && res[SYNC_KEY]) {
          cachedSync = res[SYNC_KEY] as string;
          return cachedSync;
        }
        cachedSync = generateRandomHex(24);
        await options.syncStorage.set({ [SYNC_KEY]: cachedSync });
        return cachedSync;
      }
      cachedSync = generateRandomHex(24);
      return cachedSync;
    },
    async getDeviceId(): Promise<string> {
      if (cachedDevice) return cachedDevice;
      if (options.localStorage) {
        const res = await options.localStorage.get({ [DEVICE_KEY]: "" });
        if (typeof res[DEVICE_KEY] === "string" && res[DEVICE_KEY]) {
          cachedDevice = res[DEVICE_KEY] as string;
          return cachedDevice;
        }
        cachedDevice = generateRandomHex(16);
        await options.localStorage.set({ [DEVICE_KEY]: cachedDevice });
        return cachedDevice;
      }
      cachedDevice = generateRandomHex(16);
      return cachedDevice;
    },
  };
}

export async function encryptJsonWithAesGcm(
  value: unknown,
  passphrase: string
): Promise<EncryptedPayloadEnvelope> {
  const subtle = getWebCryptoSubtle();
  const salt = getRandomBytes(16);
  const iv = getRandomBytes(12);
  const key = await deriveAesGcmKey(subtle, passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipherBuffer = await subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  );
  return {
    v: 1,
    alg: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    ivB64: bytesToBase64(iv),
    saltB64: bytesToBase64(salt),
    ciphertextB64: bytesToBase64(new Uint8Array(cipherBuffer)),
  };
}

export async function decryptJsonWithAesGcm(
  envelope: EncryptedPayloadEnvelope,
  passphrase: string
): Promise<unknown> {
  const subtle = getWebCryptoSubtle();
  const salt = base64ToBytes(envelope.saltB64);
  const iv = base64ToBytes(envelope.ivB64);
  const ciphertext = base64ToBytes(envelope.ciphertextB64);
  const key = await deriveAesGcmKey(subtle, passphrase, salt);
  const plainBuffer = await subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext)
  );
  const text = new TextDecoder().decode(plainBuffer);
  return JSON.parse(text);
}

async function deriveAesGcmKey(
  subtle: SubtleCrypto,
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const keyMaterial = await subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function getWebCryptoSubtle(): SubtleCrypto {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!c || !c.subtle) {
    throw new Error("Web Crypto SubtleCrypto API unavailable");
  }
  return c.subtle;
}

function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < length; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

function generateRandomHex(bytes: number): string {
  return Array.from(getRandomBytes(bytes), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function mapToEncryptedStorageKey(rawKey: string): string {
  return rawKey === "chessForgeFairPlayWindowV1"
    ? ENCRYPTED_CIRCUIT_BREAKER_STORAGE_KEY
    : `${ENCRYPTED_CIRCUIT_BREAKER_STORAGE_KEY}:${rawKey}`;
}

function isEncryptedEnvelope(val: unknown): val is EncryptedPayloadEnvelope {
  if (!val || typeof val !== "object") return false;
  const obj = val as Partial<EncryptedPayloadEnvelope>;
  return (
    obj.v === 1 &&
    obj.alg === "AES-GCM" &&
    typeof obj.ivB64 === "string" &&
    typeof obj.saltB64 === "string" &&
    typeof obj.ciphertextB64 === "string"
  );
}

function trimWindowPayload(value: unknown, maxWindowGames: number): unknown {
  if (
    value &&
    typeof value === "object" &&
    "games" in value &&
    Array.isArray((value as { games?: unknown[] }).games)
  ) {
    const obj = value as { baselineElo?: number; games: unknown[] };
    return {
      ...obj,
      games: obj.games.slice(-maxWindowGames),
    };
  }
  return value;
}
