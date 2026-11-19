/**
 * Isolated-world SVG/Canvas overlay renderer using a closed Shadow DOM container,
 * adoptedStyleSheets, and document.documentElement mounting (zero document.body mutation).
 *
 * Implements OverlayRenderPort cleanly and defaults to `enabled: false` (explicit opt-in).
 */

import type { FairPlayMetricsSnapshot } from "./fairPlayModels.ts";
import type { OverlayDrawCommand, OverlayRenderPort } from "./ports.ts";

export interface StyleSheetLike {
  replaceSync(cssText: string): void;
}

export interface ShadowRootLike {
  readonly mode: "open" | "closed";
  adoptedStyleSheets: StyleSheetLike[];
  appendChild(node: OverlayNodeLike): OverlayNodeLike;
}

export interface OverlayNodeLike {
  id?: string;
  textContent: string | null;
  readonly style: Record<string, string>;
  readonly children?: OverlayNodeLike[];
  setAttribute(name: string, value: string): void;
  getAttribute?(name: string): string | null;
  appendChild(child: OverlayNodeLike): OverlayNodeLike;
  removeChild?(child: OverlayNodeLike): OverlayNodeLike;
  remove?(): void;
}

export interface OverlayHostElementLike extends OverlayNodeLike {
  readonly isConnected?: boolean;
  attachShadow(init: { mode: "closed" | "open" }): ShadowRootLike;
}

export interface OverlayDocumentLike {
  readonly documentElement: {
    appendChild(child: OverlayNodeLike): OverlayNodeLike;
    contains?(node: OverlayNodeLike | null): boolean;
  } | null;
  createElement(tagName: string): OverlayHostElementLike;
  createElementNS(namespaceURI: string, qualifiedName: string): OverlayNodeLike;
}

export interface BoardViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly isFlipped: boolean;
}

export interface IsolatedOverlayConfig {
  /** Explicit opt-in flag; defaults to false for full backward compatibility. */
  readonly enabled: boolean;
  readonly hostId?: string;
  readonly zIndex?: number;
  readonly containerDocument?: OverlayDocumentLike | null;
  readonly styleSheetFactory?: () => StyleSheetLike;
  readonly getBoardViewportRect?: () => BoardViewportRect | null;
}

export const DEFAULT_ISOLATED_OVERLAY_CONFIG: IsolatedOverlayConfig = {
  enabled: false,
  hostId: "cf-isolated-overlay-host",
  zIndex: 2147483640,
};

const SVG_NS = "http://www.w3.org/2000/svg";

const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483640;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}
.cf-root {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.cf-svg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.cf-badge {
  position: fixed;
  left: 10px;
  bottom: 12px;
  display: none;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(13, 17, 23, 0.92);
  border: 1.5px solid #10B981;
  color: #E6EDF3;
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}
.cf-badge[data-risk="ELEVATED"] {
  border-color: #F59E0B;
  color: #FDE68A;
}
.cf-badge[data-risk="LOCKOUT"] {
  border-color: #EF4444;
  color: #FCA5A5;
}
.cf-hint-hud {
  position: fixed;
  top: 12px;
  right: 12px;
  display: none;
  padding: 5px 10px;
  border-radius: 10px;
  background: rgba(13, 17, 23, 0.92);
  border: 1.5px solid #10B981;
  color: #E6EDF3;
  font-size: 11px;
  font-weight: 700;
  pointer-events: none;
}
`.trim();

/**
 * Isolated-world Shadow DOM SVG overlay implementing `OverlayRenderPort`.
 * Strictly mounts to `document.documentElement`, uses `{ mode: "closed" }` ShadowRoot
 * and `adoptedStyleSheets`, and never modifies `document.body`.
 */
export class IsolatedOverlayRenderer implements OverlayRenderPort {
  private enabled: boolean;
  private readonly hostId: string;
  private readonly zIndex: number;
  private readonly containerDoc: OverlayDocumentLike | null;
  private readonly styleSheetFactory: () => StyleSheetLike;
  private readonly getBoardViewportRect: () => BoardViewportRect | null;

  private hostEl: OverlayHostElementLike | null = null;
  private shadowRoot: ShadowRootLike | null = null;
  private svgLayer: OverlayNodeLike | null = null;
  private badgeEl: OverlayNodeLike | null = null;
  private hudEl: OverlayNodeLike | null = null;
  private mounted = false;
  private lastClearedReason: string | null = null;
  private lastCommand: OverlayDrawCommand | null = null;

  constructor(config: Partial<IsolatedOverlayConfig> = {}) {
    this.enabled = config.enabled ?? DEFAULT_ISOLATED_OVERLAY_CONFIG.enabled;
    this.hostId = config.hostId ?? DEFAULT_ISOLATED_OVERLAY_CONFIG.hostId!;
    this.zIndex = config.zIndex ?? DEFAULT_ISOLATED_OVERLAY_CONFIG.zIndex!;
    this.containerDoc =
      config.containerDocument !== undefined
        ? config.containerDocument
        : typeof document !== "undefined"
        ? (document as unknown as OverlayDocumentLike)
        : null;
    this.styleSheetFactory =
      config.styleSheetFactory ?? defaultStyleSheetFactory;
    this.getBoardViewportRect =
      config.getBoardViewportRect ??
      (() => ({
        left: 0,
        top: 0,
        width: 480,
        height: 480,
        isFlipped: false,
      }));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isMounted(): boolean {
    return this.mounted;
  }

  getLastClearedReason(): string | null {
    return this.lastClearedReason;
  }

  getLastDrawnCommand(): OverlayDrawCommand | null {
    return this.lastCommand;
  }

  setEnabled(next: boolean): void {
    this.enabled = next;
    if (!next) {
      this.clearOverlay("DISABLED");
      this.unmount();
    }
  }

  /**
   * Mounts closed Shadow DOM host directly onto `document.documentElement` (never `document.body`).
   * Uses `adoptedStyleSheets` exclusively for styling inside the closed shadow root.
   */
  mount(): boolean {
    if (!this.enabled) return false;
    if (this.mounted && this.hostEl) return true;
    const doc = this.containerDoc;
    if (!doc || !doc.documentElement) return false;

    const host = doc.createElement("div");
    host.id = this.hostId;
    host.setAttribute("data-cf-world", "isolated");
    host.setAttribute("aria-hidden", "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = String(this.zIndex);

    const shadow = host.attachShadow({ mode: "closed" });
    const sheet = this.styleSheetFactory();
    sheet.replaceSync(OVERLAY_CSS);
    shadow.adoptedStyleSheets = [sheet];

    const root = doc.createElement("div");
    root.setAttribute("class", "cf-root");
    root.style.pointerEvents = "none";

    const svg = doc.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "cf-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.pointerEvents = "none";

    const badge = doc.createElement("div");
    badge.setAttribute("class", "cf-badge");
    badge.style.pointerEvents = "none";

    const hud = doc.createElement("div");
    hud.setAttribute("class", "cf-hint-hud");
    hud.style.pointerEvents = "none";

    root.appendChild(svg);
    root.appendChild(badge);
    root.appendChild(hud);
    shadow.appendChild(root);

    // Mount exclusively on document.documentElement; never touch document.body.
    doc.documentElement.appendChild(host);

    this.hostEl = host;
    this.shadowRoot = shadow;
    this.svgLayer = svg;
    this.badgeEl = badge;
    this.hudEl = hud;
    this.mounted = true;
    return true;
  }

  drawOverlay(command: OverlayDrawCommand): void {
    if (!this.enabled) return;
    if (!this.mounted && !this.mount()) return;
    if (!this.containerDoc || !this.svgLayer) return;

    this.lastCommand = command;
    this.clearSvgChildren();

    const viewport = this.getBoardViewportRect() ?? {
      left: 0,
      top: 0,
      width: 480,
      height: 480,
      isFlipped: false,
    };

    const defs = this.containerDoc.createElementNS(SVG_NS, "defs");
    defs.appendChild(this.createArrowMarker("cf-arrow-primary", "#10B981"));
    defs.appendChild(this.createArrowMarker("cf-arrow-secondary", "#38BDF8"));
    this.svgLayer.appendChild(defs);

    const pool = command.candidatePool.slice(0, 2);
    const ordered = [
      command.selectedLine,
      ...pool.filter((l) => l.uci !== command.selectedLine.uci),
    ].slice(0, 2);

    ordered.forEach((line, idx) => {
      const fromSq = line.uci.slice(0, 2);
      const toSq = line.uci.slice(2, 4);
      const fromPt = squareCenterToViewport(fromSq, viewport);
      const toPt = squareCenterToViewport(toSq, viewport);
      if (!fromPt || !toPt) return;

      const isPrimary = idx === 0;
      const stroke = isPrimary ? "#10B981" : "#38BDF8";

      // Destination square bracket
      const sqSize = viewport.width / 8;
      const bracket = this.containerDoc!.createElementNS(SVG_NS, "rect");
      bracket.setAttribute("x", String(Math.round(toPt.x - sqSize * 0.46)));
      bracket.setAttribute("y", String(Math.round(toPt.y - sqSize * 0.46)));
      bracket.setAttribute("width", String(Math.round(sqSize * 0.92)));
      bracket.setAttribute("height", String(Math.round(sqSize * 0.92)));
      bracket.setAttribute("rx", "6");
      bracket.setAttribute("fill", "none");
      bracket.setAttribute("stroke", stroke);
      bracket.setAttribute("stroke-width", isPrimary ? "2.5" : "1.5");
      bracket.setAttribute("stroke-opacity", isPrimary ? "0.9" : "0.55");
      this.svgLayer!.appendChild(bracket);

      // Move vector arrow
      const arrow = this.containerDoc!.createElementNS(SVG_NS, "line");
      arrow.setAttribute("x1", String(Math.round(fromPt.x)));
      arrow.setAttribute("y1", String(Math.round(fromPt.y)));
      arrow.setAttribute("x2", String(Math.round(toPt.x)));
      arrow.setAttribute("y2", String(Math.round(toPt.y)));
      arrow.setAttribute("stroke", stroke);
      arrow.setAttribute("stroke-width", String(Math.max(4, Math.round(sqSize * (isPrimary ? 0.14 : 0.09)))));
      arrow.setAttribute("stroke-linecap", "round");
      arrow.setAttribute("stroke-opacity", isPrimary ? "0.86" : "0.52");
      arrow.setAttribute(
        "marker-end",
        `url(#${isPrimary ? "cf-arrow-primary" : "cf-arrow-secondary"})`
      );
      this.svgLayer!.appendChild(arrow);

      // Candidate annotation badge
      const badge = this.containerDoc!.createElementNS(SVG_NS, "text");
      badge.setAttribute("x", String(Math.round(toPt.x + sqSize * 0.25)));
      badge.setAttribute("y", String(Math.round(toPt.y - sqSize * 0.25)));
      badge.setAttribute("fill", stroke);
      badge.setAttribute("font-size", "12");
      badge.setAttribute("font-weight", "800");
      badge.textContent = isPrimary ? "★" : "!";
      this.svgLayer!.appendChild(badge);
    });

    if (this.hudEl) {
      this.hudEl.style.display = "block";
      this.hudEl.textContent = `${command.selectedLine.san || command.selectedLine.uci} • Hints ${command.hintsUsedInGame}/${command.maxHintsPerGame}`;
    }
  }

  clearOverlay(reason: string): void {
    this.lastClearedReason = reason;
    this.clearSvgChildren();
    if (this.hudEl) {
      this.hudEl.style.display = "none";
      this.hudEl.textContent = "";
    }
  }

  updateFairPlayBadge(snapshot: FairPlayMetricsSnapshot): void {
    if (!this.enabled) return;
    if (!this.mounted && !this.mount()) return;
    if (!this.badgeEl) return;

    this.badgeEl.setAttribute("data-risk", snapshot.riskLevel);
    this.badgeEl.style.display = "flex";
    this.badgeEl.textContent =
      snapshot.riskLevel === "LOCKOUT"
        ? `LOCKOUT • Z=${snapshot.zScore.toFixed(1)}σ`
        : snapshot.riskLevel === "ELEVATED"
        ? `ELEVATED • Z=${snapshot.zScore.toFixed(1)}σ`
        : `FairPlay: SAFE • ${snapshot.slidingWindowGames}g`;
  }

  unmount(): void {
    this.clearSvgChildren();
    if (this.hostEl && typeof this.hostEl.remove === "function") {
      this.hostEl.remove();
    }
    this.hostEl = null;
    this.shadowRoot = null;
    this.svgLayer = null;
    this.badgeEl = null;
    this.hudEl = null;
    this.mounted = false;
  }

  dispose(): void {
    this.clearOverlay("DISPOSED");
    this.unmount();
  }

  /** Test inspection helper only; closed shadow root is never exposed on DOM host. */
  hasClosedShadowRoot(): boolean {
    return this.shadowRoot !== null && this.shadowRoot.mode === "closed";
  }

  private createArrowMarker(id: string, color: string): OverlayNodeLike {
    const doc = this.containerDoc!;
    const marker = doc.createElementNS(SVG_NS, "marker");
    marker.setAttribute("id", id);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "4");
    marker.setAttribute("markerHeight", "4");
    marker.setAttribute("orient", "auto-start-reverse");

    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M 0 1 L 10 5 L 0 9 z");
    path.setAttribute("fill", color);
    marker.appendChild(path);
    return marker;
  }

  private clearSvgChildren(): void {
    const svg = this.svgLayer;
    if (!svg || !svg.children) return;
    if (typeof svg.removeChild === "function") {
      while (svg.children.length > 0) {
        svg.removeChild(svg.children[svg.children.length - 1]);
      }
    } else {
      svg.textContent = "";
    }
  }
}

function defaultStyleSheetFactory(): StyleSheetLike {
  if (typeof CSSStyleSheet !== "undefined") {
    return new CSSStyleSheet();
  }
  return {
    replaceSync(): void {
      // Headless fallback if global CSSStyleSheet is unavailable outside browser
    },
  };
}

function squareCenterToViewport(
  sq: string,
  rect: BoardViewportRect
): { readonly x: number; readonly y: number } | null {
  if (!/^[a-h][1-8]$/.test(sq)) return null;
  const fileIdx = "abcdefgh".indexOf(sq[0]);
  const rankIdx = 8 - parseInt(sq[1], 10);
  const col = rect.isFlipped ? 7 - fileIdx : fileIdx;
  const row = rect.isFlipped ? 7 - rankIdx : rankIdx;
  const sqW = rect.width / 8;
  const sqH = rect.height / 8;
  return {
    x: rect.left + (col + 0.5) * sqW,
    y: rect.top + (row + 0.5) * sqH,
  };
}
