package com.example.chessoverlay.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowserConfigAndPresetsTest {

    @Test
    fun `default extension config keeps all auto-execution toggles disabled`() {
        val cfg = BrowserExtensionConfig()
        assertFalse(cfg.autonomousMode)
        assertFalse(cfg.onlineAutoPlay)
        assertFalse(cfg.puzzleSolverEnabled)
        assertFalse(cfg.puzzleAutoSolve)
        assertFalse(cfg.puzzleAutoNext)
        assertFalse(cfg.practiceAutoPlay)
        assertEquals(1600, cfg.autonomousEloProfile)
        assertEquals(PuzzleLevelMode.ALL, cfg.puzzleLevelMode)
        assertEquals(450, cfg.puzzleSolveDelayMs)
    }

    @Test
    fun `supported Elo profiles span 800 to 2800 and serialize to JS config literal`() {
        assertEquals(
            listOf(800, 1000, 1200, 1600, 2000, 2400, 2800),
            AutonomousEloProfile.supportedElos
        )

        AutonomousEloProfile.supportedElos.forEach { elo ->
            val js = BrowserExtensionConfig(
                onlineAutoPlay = true,
                autonomousEloProfile = elo,
                puzzleSolverEnabled = true,
                puzzleAutoSolve = true,
                puzzleAutoNext = true,
                puzzleLevelMode = PuzzleLevelMode.MASTER,
                puzzleSolveDelayMs = 200
            ).toJsObjectLiteral()

            assertTrue(js.contains("onlineAutoPlay:true"))
            assertTrue(js.contains("autonomousEloProfile:$elo"))
            assertTrue(js.contains("puzzleSolverEnabled:true"))
            assertTrue(js.contains("puzzleAutoSolve:true"))
            assertTrue(js.contains("puzzleAutoNext:true"))
            assertTrue(js.contains("puzzleLevelMode:'master'"))
            assertTrue(js.contains("puzzleSolveDelayMs:200"))
        }

        val fallbackJs = BrowserExtensionConfig(
            autonomousEloProfile = 9999,
            puzzleSolveDelayMs = 9999
        ).toJsObjectLiteral()
        assertTrue(fallbackJs.contains("autonomousEloProfile:1600"))
        assertTrue(fallbackJs.contains("puzzleSolveDelayMs:1500"))
    }

    @Test
    fun `site presets and puzzle level modes resolve expected routes and keys`() {
        assertEquals("https://lichess.org/", BrowserSitePreset.LICHESS_PLAY.url)
        assertEquals("https://lichess.org/training", BrowserSitePreset.LICHESS_PUZZLES.url)
        assertEquals("https://www.chess.com/play/online", BrowserSitePreset.CHESS_COM_PLAY.url)
        assertEquals("https://www.chess.com/play/computer", BrowserSitePreset.CHESS_COM_BOTS.url)
        assertEquals("https://www.chess.com/puzzles", BrowserSitePreset.CHESS_COM_PUZZLES.url)
        assertEquals("https://lichess.org/analysis", BrowserSitePreset.LICHESS.url)
        assertEquals("https://www.chess.com/analysis", BrowserSitePreset.CHESS_COM.url)

        assertEquals(PuzzleLevelMode.ALL, PuzzleLevelMode.fromKey("unknown"))
        assertEquals(PuzzleLevelMode.EASY, PuzzleLevelMode.fromKey("easy"))
        assertEquals(PuzzleLevelMode.MEDIUM, PuzzleLevelMode.fromKey("medium"))
        assertEquals(PuzzleLevelMode.HARD, PuzzleLevelMode.fromKey("hard"))
        assertEquals(PuzzleLevelMode.MASTER, PuzzleLevelMode.fromKey("master"))
    }
}
