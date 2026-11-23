/**
 * Online Auto-Play & All-Level Puzzle Solver Controller (`puzzleAndOnlineController.ts`).
 *
 * Covers:
 * 1. All-Level Online Auto-Play Calibration (800 Beginner -> 2800 Max GM) for Lichess.org and Chess.com.
 * 2. Platform-aware board context detection (live online game vs. puzzle modes: Training, Storm,
 *    Streak, Racer, Rated Puzzles, Puzzle Rush, Puzzle Battle, Daily Puzzle).
 * 3. Tactical Puzzle Solver move prioritization (bypassing opening-book / endgame hint caps,
 *    preferring shortest checkmates and crisp winning tactics across all puzzle levels).
 * 4. Turn-ownership & game-over safety gates.
 *
 * All execution switches default to `false` (explicit opt-in) for backward compatibility.
 */

import {
  ELO_1200_PRESET,
  ELO_1600_PRESET,
  ELO_2000_PRESET,
  type HumanizedAutoPlayPreset,
  type MultiPvCandidateLine,
  type PieceColor,
} from "./autoPlayPorts.ts";
import { lineToComparableCp } from "./humanizerMoveSelector.ts";

export type OnlineEloLevel = 800 | 1000 | 1200 | 1600 | 2000 | 2400 | 2800;

export type PuzzleLevelMode = "all" | "easy" | "medium" | "hard" | "master";

export type PlatformSite = "lichess" | "chesscom" | "practice" | "unknown";

export type PuzzleSubMode =
  | "training"
  | "storm"
  | "streak"
  | "racer"
  | "rush"
  | "battle"
  | "daily"
  | "rated"
  | "standard";

export type PuzzlePlayStatus = "SOLVING" | "WAITING_OPPONENT" | "SOLVED" | "FAILED" | "NONE";

export interface DetectedBoardContext {
  readonly site: PlatformSite;
  readonly isOnlineGame: boolean;
  readonly isPuzzle: boolean;
  readonly isPracticeBoard: boolean;
  readonly isGameOver: boolean;
  readonly puzzleMode: PuzzleSubMode | null;
  readonly puzzleStatus: PuzzlePlayStatus;
  readonly puzzleRating: number | null;
  readonly playerColor: PieceColor;
  readonly currentTurn: PieceColor;
}

export interface OnlineAutoPlayLevelProfile {
  readonly elo: OnlineEloLevel;
  readonly label: string;
  readonly shortLabel: string;
  readonly searchDepth: number;
  readonly skillLevel: number;
  readonly blunderCapCp: number;
  readonly baseTemp: number;
  readonly thinkDelayMinMs: number;
  readonly thinkDelayMaxMs: number;
  readonly bypassHumanizerAtMax: boolean;
}

export interface PuzzleSolverConfig {
  /** Show puzzle tactical highlight / overlay (default false). */
  readonly enabled: boolean;
  /** Automatically execute puzzle solution moves on board (default false). */
  readonly autoSolve: boolean;
  /** Automatically click Next/Continue when puzzle is solved (default false). */
  readonly autoNext: boolean;
  /** All-level difficulty/depth mode ("all" auto-adapts across speed/rated puzzles). */
  readonly levelMode: PuzzleLevelMode;
  /** Base execution delay before dispatching a puzzle move (ms). */
  readonly solveDelayMs: number;
}

export const DEFAULT_PUZZLE_SOLVER_CONFIG: PuzzleSolverConfig = {
  enabled: false,
  autoSolve: false,
  autoNext: false,
  levelMode: "all",
  solveDelayMs: 450,
};

export interface OnlineAutoPlayConfig {
  /** Explicit opt-in flag to auto-play live Lichess/Chess.com games (default false). */
  readonly enabled: boolean;
  /** Target strength across full spectrum (800..2800). */
  readonly eloLevel: OnlineEloLevel;
  /** Explicit turn override ("auto" matches detected bottom board color). */
  readonly turnOverride: "auto" | PieceColor;
}

export const DEFAULT_ONLINE_AUTOPLAY_CONFIG: OnlineAutoPlayConfig = {
  enabled: false,
  eloLevel: 1600,
  turnOverride: "auto",
};

export const ONLINE_ELO_PROFILES: Readonly<Record<OnlineEloLevel, OnlineAutoPlayLevelProfile>> = {
  800: {
    elo: 800,
    label: "800 Elo (Beginner)",
    shortLabel: "800 Beginner",
    searchDepth: 8,
    skillLevel: 4,
    blunderCapCp: 260,
    baseTemp: 1.38,
    thinkDelayMinMs: 700,
    thinkDelayMaxMs: 2400,
    bypassHumanizerAtMax: false,
  },
  1000: {
    elo: 1000,
    label: "1000 Elo (Casual)",
    shortLabel: "1000 Casual",
    searchDepth: 10,
    skillLevel: 7,
    blunderCapCp: 210,
    baseTemp: 1.22,
    thinkDelayMinMs: 650,
    thinkDelayMaxMs: 2200,
    bypassHumanizerAtMax: false,
  },
  1200: {
    elo: 1200,
    label: "1200 Elo (Club Novice)",
    shortLabel: "1200 Novice",
    searchDepth: 14,
    skillLevel: 10,
    blunderCapCp: 165,
    baseTemp: 1.08,
    thinkDelayMinMs: 650,
    thinkDelayMaxMs: 2100,
    bypassHumanizerAtMax: false,
  },
  1600: {
    elo: 1600,
    label: "1600 Elo (Intermediate)",
    shortLabel: "1600 Interm.",
    searchDepth: 16,
    skillLevel: 14,
    blunderCapCp: 105,
    baseTemp: 0.78,
    thinkDelayMinMs: 600,
    thinkDelayMaxMs: 1950,
    bypassHumanizerAtMax: false,
  },
  2000: {
    elo: 2000,
    label: "2000 Elo (Expert Candidate)",
    shortLabel: "2000 Expert",
    searchDepth: 18,
    skillLevel: 17,
    blunderCapCp: 60,
    baseTemp: 0.5,
    thinkDelayMinMs: 550,
    thinkDelayMaxMs: 1800,
    bypassHumanizerAtMax: false,
  },
  2400: {
    elo: 2400,
    label: "2400 Elo (Master / IM)",
    shortLabel: "2400 Master",
    searchDepth: 19,
    skillLevel: 19,
    blunderCapCp: 35,
    baseTemp: 0.28,
    thinkDelayMinMs: 450,
    thinkDelayMaxMs: 1500,
    bypassHumanizerAtMax: false,
  },
  2800: {
    elo: 2800,
    label: "2800 Elo (Max GM Engine)",
    shortLabel: "2800 Max GM",
    searchDepth: 20,
    skillLevel: 20,
    blunderCapCp: 20,
    baseTemp: 0.16,
    thinkDelayMinMs: 320,
    thinkDelayMaxMs: 1100,
    bypassHumanizerAtMax: true,
  },
};

export function normalizeOnlineEloLevel(elo: number): OnlineEloLevel {
  const levels: readonly OnlineEloLevel[] = [800, 1000, 1200, 1600, 2000, 2400, 2800];
  let best: OnlineEloLevel = 1600;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const lvl of levels) {
    const d = Math.abs(lvl - elo);
    if (d < bestDist) {
      bestDist = d;
      best = lvl;
    }
  }
  return best;
}

export function getOnlineEloProfile(elo: number): OnlineAutoPlayLevelProfile {
  return ONLINE_ELO_PROFILES[normalizeOnlineEloLevel(elo)];
}

/**
 * Maps any OnlineEloLevel to the closest structural preset (1200 / 1600 / 2000)
 * while preserving the requested Elo target & skill scaling.
 */
export function buildPresetForOnlineElo(elo: number): HumanizedAutoPlayPreset {
  const normalized = normalizeOnlineEloLevel(elo);
  const profile = ONLINE_ELO_PROFILES[normalized];
  const base =
    normalized <= 1200
      ? ELO_1200_PRESET
      : normalized <= 1800
      ? ELO_1600_PRESET
      : ELO_2000_PRESET;

  return {
    ...base,
    label: profile.label,
    selector: {
      ...base.selector,
      targetElo: profile.elo,
      maxAllowedBlunderCp: profile.blunderCapCp,
      baseTemperature: profile.baseTemp,
      standardSearchDepth: profile.searchDepth,
    },
  };
}

/**
 * Parses URL pathname + optional DOM hints to classify whether the page is an online game
 * or one of Lichess / Chess.com's puzzle modes (Training, Storm, Streak, Racer, Rush, Battle, Daily).
 */
export function classifySiteAndPuzzleMode(input: {
  readonly hostname: string;
  readonly pathname: string;
  readonly isPracticeBoard?: boolean;
  readonly hasPuzzleDom?: boolean;
  readonly hasGameOverDom?: boolean;
  readonly puzzleFeedbackText?: string;
  readonly puzzleRatingText?: string;
  readonly isBoardFlipped?: boolean;
  readonly currentTurn: PieceColor;
}): DetectedBoardContext {
  const host = (input.hostname || "").toLowerCase();
  const path = (input.pathname || "").toLowerCase();

  let site: PlatformSite = "unknown";
  if (input.isPracticeBoard) {
    site = "practice";
  } else if (host.includes("lichess")) {
    site = "lichess";
  } else if (host.includes("chess.com")) {
    site = "chesscom";
  }

  let puzzleMode: PuzzleSubMode | null = null;
  if (site === "lichess") {
    if (path.includes("/storm")) puzzleMode = "storm";
    else if (path.includes("/streak")) puzzleMode = "streak";
    else if (path.includes("/racer")) puzzleMode = "racer";
    else if (path.includes("/training") || input.hasPuzzleDom) puzzleMode = "training";
  } else if (site === "chesscom") {
    if (path.includes("/puzzles/rush") || path.includes("/rush")) puzzleMode = "rush";
    else if (path.includes("/puzzles/battle") || path.includes("/battle")) puzzleMode = "battle";
    else if (path.includes("/daily-chess-puzzle") || path.includes("/daily")) puzzleMode = "daily";
    else if (path.includes("/puzzles/rated")) puzzleMode = "rated";
    else if (path.includes("/puzzles") || input.hasPuzzleDom) puzzleMode = "standard";
  }

  const isPuzzle = puzzleMode !== null;
  const feedback = (input.puzzleFeedbackText || "").toLowerCase();
  let puzzleStatus: PuzzlePlayStatus = "NONE";
  if (isPuzzle) {
    if (
      feedback.includes("puzzle solved") ||
      feedback.includes("success") ||
      feedback.includes("correct!") ||
      feedback.includes("well done") ||
      feedback.includes("victory") ||
      feedback.includes("solved")
    ) {
      puzzleStatus = "SOLVED";
    } else if (
      feedback.includes("puzzle failed") ||
      feedback.includes("incorrect") ||
      feedback.includes("wrong move") ||
      feedback.includes("try again") ||
      feedback.includes("failed")
    ) {
      puzzleStatus = "FAILED";
    } else {
      const playerColor: PieceColor = input.isBoardFlipped ? "b" : "w";
      puzzleStatus = input.currentTurn === playerColor ? "SOLVING" : "WAITING_OPPONENT";
    }
  }

  const ratingMatch = (input.puzzleRatingText || "").match(/\d{3,4}/);
  const puzzleRating = ratingMatch ? parseInt(ratingMatch[0], 10) : null;
  const playerColor: PieceColor = input.isBoardFlipped ? "b" : "w";

  const isOnlineGame =
    !isPuzzle &&
    !input.isPracticeBoard &&
    (site === "lichess" || site === "chesscom") &&
    !path.includes("/analysis") &&
    !path.includes("/editor") &&
    !path.includes("/study");

  return {
    site,
    isOnlineGame,
    isPuzzle,
    isPracticeBoard: Boolean(input.isPracticeBoard),
    isGameOver: Boolean(input.hasGameOverDom),
    puzzleMode,
    puzzleStatus,
    puzzleRating,
    playerColor,
    currentTurn: input.currentTurn,
  };
}

/**
 * Recommends search depth and move pacing for any puzzle across all rating tiers
 * (from 400 beginner mate-in-1 through 3200 GM studies and timed Puzzle Storm/Rush).
 */
export function resolvePuzzleSearchProfile(
  context: DetectedBoardContext,
  solverConfig: PuzzleSolverConfig
): {
  readonly searchDepth: number;
  readonly delayMs: number;
  readonly multiPv: number;
} {
  const isSpeedMode =
    context.puzzleMode === "storm" ||
    context.puzzleMode === "racer" ||
    context.puzzleMode === "rush" ||
    context.puzzleMode === "battle";

  const baseDelay = Math.max(80, Math.min(2500, Math.round(solverConfig.solveDelayMs)));

  switch (solverConfig.levelMode) {
    case "easy":
      return { searchDepth: 8, delayMs: isSpeedMode ? Math.min(baseDelay, 220) : baseDelay, multiPv: 2 };
    case "medium":
      return { searchDepth: 12, delayMs: isSpeedMode ? Math.min(baseDelay, 280) : baseDelay, multiPv: 2 };
    case "hard":
      return { searchDepth: 16, delayMs: isSpeedMode ? Math.min(baseDelay, 340) : baseDelay, multiPv: 2 };
    case "master":
      return { searchDepth: 20, delayMs: isSpeedMode ? Math.min(baseDelay, 420) : baseDelay, multiPv: 3 };
    case "all":
    default: {
      if (isSpeedMode) {
        return {
          searchDepth: 12,
          delayMs: Math.max(120, Math.min(baseDelay, 260)),
          multiPv: 2,
        };
      }
      const rating = context.puzzleRating ?? 1600;
      const adaptiveDepth =
        rating >= 2300 ? 20 : rating >= 1800 ? 17 : rating >= 1300 ? 14 : 11;
      return {
        searchDepth: adaptiveDepth,
        delayMs: baseDelay,
        multiPv: 2,
      };
    }
  }
}

/**
 * Ranks engine lines for tactical puzzles:
 * 1) Shortest positive forced mate wins immediately.
 * 2) Avoid negative mates.
 * 3) Highest centipawn tactical line.
 */
export function selectBestPuzzleMoveLine(
  lines: readonly MultiPvCandidateLine[]
): MultiPvCandidateLine | null {
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => {
    const aPosMate = a.mate !== null && a.mate !== undefined && a.mate > 0;
    const bPosMate = b.mate !== null && b.mate !== undefined && b.mate > 0;
    if (aPosMate && bPosMate) {
      return (a.mate as number) - (b.mate as number);
    }
    if (aPosMate !== bPosMate) {
      return aPosMate ? -1 : 1;
    }
    return lineToComparableCp(b) - lineToComparableCp(a);
  });
  return sorted[0] ?? null;
}

export interface AutoActionDecision {
  readonly action: "NONE" | "PUZZLE_MOVE" | "PUZZLE_NEXT" | "ONLINE_MOVE" | "PRACTICE_MOVE";
  readonly selectedMoveUci: string | null;
  readonly delayMs: number;
  readonly reason: string;
}

/**
 * Single deterministic decision gate determining whether the runtime should auto-execute
 * a puzzle move, advance to the next puzzle, play an online game move, or spar on Practice Board.
 */
export function evaluateExecutionAction(params: {
  readonly context: DetectedBoardContext;
  readonly puzzleConfig: PuzzleSolverConfig;
  readonly onlineConfig: OnlineAutoPlayConfig;
  readonly practiceAutoPlay: boolean;
  readonly practiceDelayMs: number;
  readonly autonomousMode: boolean;
  readonly fairPlayLockedOut: boolean;
  readonly candidateLines: readonly MultiPvCandidateLine[];
  readonly selectedOnlineMoveUci?: string | null;
  readonly onlineDelayMs?: number;
}): AutoActionDecision {
  const { context, puzzleConfig, onlineConfig, candidateLines } = params;

  if (context.isPuzzle) {
    if (!puzzleConfig.enabled || !puzzleConfig.autoSolve) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "PUZZLE_AUTOSOLVE_OFF" };
    }
    if (context.puzzleStatus === "SOLVED") {
      if (puzzleConfig.autoNext) {
        return {
          action: "PUZZLE_NEXT",
          selectedMoveUci: null,
          delayMs: Math.max(450, Math.min(2000, puzzleConfig.solveDelayMs + 350)),
          reason: "PUZZLE_SOLVED_AUTO_NEXT",
        };
      }
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "PUZZLE_SOLVED" };
    }
    if (context.puzzleStatus === "FAILED") {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "PUZZLE_FAILED" };
    }
    if (context.currentTurn !== context.playerColor) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "PUZZLE_WAIT_OPPONENT" };
    }
    const bestPuzzle = selectBestPuzzleMoveLine(candidateLines);
    if (!bestPuzzle) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "NO_PUZZLE_LINES" };
    }
    const profile = resolvePuzzleSearchProfile(context, puzzleConfig);
    return {
      action: "PUZZLE_MOVE",
      selectedMoveUci: bestPuzzle.move,
      delayMs: profile.delayMs,
      reason: `PUZZLE_${(context.puzzleMode || "training").toUpperCase()}_D${profile.searchDepth}`,
    };
  }

  if (context.isPracticeBoard) {
    if (!(params.practiceAutoPlay || params.autonomousMode)) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "PRACTICE_AUTO_OFF" };
    }
    if (candidateLines.length === 0) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "NO_LINES" };
    }
    return {
      action: "PRACTICE_MOVE",
      selectedMoveUci: candidateLines[0].move,
      delayMs: Math.max(250, Math.min(2500, params.practiceDelayMs)),
      reason: "PRACTICE_AUTO_SPARRING",
    };
  }

  if (context.isOnlineGame) {
    if (context.isGameOver) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "ONLINE_GAME_OVER" };
    }
    if (!onlineConfig.enabled && !params.autonomousMode) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "ONLINE_AUTOPLAY_OFF" };
    }
    if (params.fairPlayLockedOut && onlineConfig.eloLevel < 2800) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "FAIRPLAY_LOCKOUT" };
    }
    const controlledSide =
      onlineConfig.turnOverride === "w" || onlineConfig.turnOverride === "b"
        ? onlineConfig.turnOverride
        : context.playerColor;
    if (context.currentTurn !== controlledSide) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "OPPONENT_TURN" };
    }
    const uci = params.selectedOnlineMoveUci ?? candidateLines[0]?.move ?? null;
    if (!uci) {
      return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "NO_ONLINE_MOVE" };
    }
    const prof = getOnlineEloProfile(onlineConfig.eloLevel);
    return {
      action: "ONLINE_MOVE",
      selectedMoveUci: uci,
      delayMs: params.onlineDelayMs ?? Math.round((prof.thinkDelayMinMs + prof.thinkDelayMaxMs) / 2),
      reason: `ONLINE_${prof.elo}_ELO`,
    };
  }

  return { action: "NONE", selectedMoveUci: null, delayMs: 0, reason: "NON_INTERACTIVE_BOARD" };
}
