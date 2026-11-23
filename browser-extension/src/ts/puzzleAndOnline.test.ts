import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ONLINE_AUTOPLAY_CONFIG,
  DEFAULT_PUZZLE_SOLVER_CONFIG,
  buildPresetForOnlineElo,
  classifySiteAndPuzzleMode,
  evaluateExecutionAction,
  getOnlineEloProfile,
  normalizeOnlineEloLevel,
  resolvePuzzleSearchProfile,
  selectBestPuzzleMoveLine,
} from "./puzzleAndOnlineController.ts";

describe("Online Auto-Play & All-Level Puzzle Solver Controller", () => {
  it("defaults auto-play and puzzle auto-solve flags strictly to false", () => {
    assert.equal(DEFAULT_ONLINE_AUTOPLAY_CONFIG.enabled, false);
    assert.equal(DEFAULT_PUZZLE_SOLVER_CONFIG.enabled, false);
    assert.equal(DEFAULT_PUZZLE_SOLVER_CONFIG.autoSolve, false);
    assert.equal(DEFAULT_PUZZLE_SOLVER_CONFIG.autoNext, false);
  });

  it("supports full all-level online Elo spectrum (800..2800)", () => {
    assert.equal(normalizeOnlineEloLevel(750), 800);
    assert.equal(normalizeOnlineEloLevel(1600), 1600);
    assert.equal(normalizeOnlineEloLevel(2900), 2800);

    const p800 = getOnlineEloProfile(800);
    const p2800 = getOnlineEloProfile(2800);
    assert.ok(p800.searchDepth < p2800.searchDepth);
    assert.ok(p800.blunderCapCp > p2800.blunderCapCp);
    assert.equal(p800.bypassHumanizerAtMax, false);
    assert.equal(p2800.bypassHumanizerAtMax, true);

    const gmPreset = buildPresetForOnlineElo(2800);
    assert.equal(gmPreset.selector.targetElo, 2800);
    assert.equal(gmPreset.selector.standardSearchDepth, 20);
  });

  it("classifies Lichess & Chess.com puzzles (training, storm, streak, racer, rush, battle, daily) and live online games", () => {
    const lichessTraining = classifySiteAndPuzzleMode({
      hostname: "lichess.org",
      pathname: "/training/AbCdE",
      puzzleRatingText: "Rating: 2140",
      isBoardFlipped: true,
      currentTurn: "b",
    });
    assert.equal(lichessTraining.site, "lichess");
    assert.equal(lichessTraining.isPuzzle, true);
    assert.equal(lichessTraining.isOnlineGame, false);
    assert.equal(lichessTraining.puzzleMode, "training");
    assert.equal(lichessTraining.puzzleRating, 2140);
    assert.equal(lichessTraining.playerColor, "b");
    assert.equal(lichessTraining.puzzleStatus, "SOLVING");

    const chessComRush = classifySiteAndPuzzleMode({
      hostname: "www.chess.com",
      pathname: "/puzzles/rush",
      puzzleFeedbackText: "Puzzle Solved!",
      isBoardFlipped: false,
      currentTurn: "w",
    });
    assert.equal(chessComRush.site, "chesscom");
    assert.equal(chessComRush.isPuzzle, true);
    assert.equal(chessComRush.puzzleMode, "rush");
    assert.equal(chessComRush.puzzleStatus, "SOLVED");

    const lichessLive = classifySiteAndPuzzleMode({
      hostname: "lichess.org",
      pathname: "/xYz12345",
      isBoardFlipped: false,
      currentTurn: "b",
    });
    assert.equal(lichessLive.isPuzzle, false);
    assert.equal(lichessLive.isOnlineGame, true);
    assert.equal(lichessLive.playerColor, "w");
  });

  it("adapts puzzle depth & pacing across all levels (easy/speed to 2400+ GM) and picks shortest forced mate", () => {
    const gmCtx = classifySiteAndPuzzleMode({
      hostname: "lichess.org",
      pathname: "/training",
      puzzleRatingText: "2550",
      currentTurn: "w",
    });
    const autoGm = resolvePuzzleSearchProfile(gmCtx, DEFAULT_PUZZLE_SOLVER_CONFIG);
    assert.equal(autoGm.searchDepth, 20);

    const stormCtx = classifySiteAndPuzzleMode({
      hostname: "lichess.org",
      pathname: "/storm",
      currentTurn: "w",
    });
    const autoStorm = resolvePuzzleSearchProfile(stormCtx, {
      ...DEFAULT_PUZZLE_SOLVER_CONFIG,
      solveDelayMs: 650,
    });
    assert.equal(autoStorm.searchDepth, 12);
    assert.ok(autoStorm.delayMs <= 260);

    const best = selectBestPuzzleMoveLine([
      { rank: 1, move: "d1h5", centipawns: 820, mate: null, depth: 16 },
      { rank: 2, move: "f3g5", centipawns: 9900, mate: 4, depth: 16 },
      { rank: 3, move: "d1d8", centipawns: 9990, mate: 1, depth: 16 },
    ]);
    assert.equal(best?.move, "d1d8");
  });

  it("gates online auto-play cleanly on turn ownership, game over, and puzzle auto-next", () => {
    const onlineCtx = classifySiteAndPuzzleMode({
      hostname: "www.chess.com",
      pathname: "/game/live/123456",
      isBoardFlipped: true, // Black at bottom
      currentTurn: "w", // White to move -> opponent's turn
    });

    const oppTurnDecision = evaluateExecutionAction({
      context: onlineCtx,
      puzzleConfig: DEFAULT_PUZZLE_SOLVER_CONFIG,
      onlineConfig: { enabled: true, eloLevel: 1600, turnOverride: "auto" },
      practiceAutoPlay: false,
      practiceDelayMs: 650,
      autonomousMode: true,
      fairPlayLockedOut: false,
      candidateLines: [{ rank: 1, move: "e2e4", centipawns: 20, depth: 14 }],
    });
    assert.equal(oppTurnDecision.action, "NONE");
    assert.equal(oppTurnDecision.reason, "OPPONENT_TURN");

    const myTurnCtx = { ...onlineCtx, currentTurn: "b" as const };
    const myTurnDecision = evaluateExecutionAction({
      context: myTurnCtx,
      puzzleConfig: DEFAULT_PUZZLE_SOLVER_CONFIG,
      onlineConfig: { enabled: true, eloLevel: 2400, turnOverride: "auto" },
      practiceAutoPlay: false,
      practiceDelayMs: 650,
      autonomousMode: false,
      fairPlayLockedOut: false,
      candidateLines: [{ rank: 1, move: "e7e5", centipawns: 15, depth: 18 }],
    });
    assert.equal(myTurnDecision.action, "ONLINE_MOVE");
    assert.equal(myTurnDecision.selectedMoveUci, "e7e5");

    const gameOverDecision = evaluateExecutionAction({
      context: { ...myTurnCtx, isGameOver: true },
      puzzleConfig: DEFAULT_PUZZLE_SOLVER_CONFIG,
      onlineConfig: { enabled: true, eloLevel: 2800, turnOverride: "auto" },
      practiceAutoPlay: false,
      practiceDelayMs: 650,
      autonomousMode: true,
      fairPlayLockedOut: false,
      candidateLines: [{ rank: 1, move: "e7e5", centipawns: 15, depth: 20 }],
    });
    assert.equal(gameOverDecision.action, "NONE");
    assert.equal(gameOverDecision.reason, "ONLINE_GAME_OVER");

    const solvedPuzzleNext = evaluateExecutionAction({
      context: classifySiteAndPuzzleMode({
        hostname: "lichess.org",
        pathname: "/training",
        puzzleFeedbackText: "Puzzle Solved",
        currentTurn: "w",
      }),
      puzzleConfig: {
        enabled: true,
        autoSolve: true,
        autoNext: true,
        levelMode: "all",
        solveDelayMs: 400,
      },
      onlineConfig: DEFAULT_ONLINE_AUTOPLAY_CONFIG,
      practiceAutoPlay: false,
      practiceDelayMs: 650,
      autonomousMode: false,
      fairPlayLockedOut: false,
      candidateLines: [],
    });
    assert.equal(solvedPuzzleNext.action, "PUZZLE_NEXT");
  });
});
