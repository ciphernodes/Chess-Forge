package com.example.chessoverlay.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class UciParserTest {

    @Test
    fun `cpToWinPct matches Stockfish logistic formula`() {
        // cp = 0 => exactly 50.0%
        assertEquals(50.0f, UciParser.cpToWinPct(0), 0.01f)
        // Positive advantage (+100 cp ~ 59.1%)
        assertEquals(59.1f, UciParser.cpToWinPct(100), 0.2f)
        // Negative advantage (-100 cp ~ 40.9%)
        assertEquals(40.9f, UciParser.cpToWinPct(-100), 0.2f)
    }

    @Test
    fun `mateToWinPct returns 99_9 for winning mate and 0_1 for losing mate`() {
        assertEquals(99.9f, UciParser.mateToWinPct(3), 0.001f)
        assertEquals(0.1f, UciParser.mateToWinPct(-2), 0.001f)
    }

    @Test
    fun `parseInfoLine parses MultiPV cp and mate lines accurately`() {
        val line1 = "info depth 14 seldepth 20 multipv 1 score cp 42 wdl 180 790 30 nodes 15200 nps 120000 pv e2e4 e7e5 g1f3"
        val parsed1 = UciParser.parseInfoLine(line1)
        assertNotNull(parsed1)
        assertEquals(1, parsed1!!.rank)
        assertEquals("e2e4", parsed1.uci)
        assertEquals(14, parsed1.depth)
        assertEquals(20, parsed1.selDepth)
        assertEquals(42, parsed1.centipawns)
        assertEquals(180, parsed1.wdlWin)
        assertEquals(790, parsed1.wdlDraw)
        assertEquals(30, parsed1.wdlLoss)
        assertEquals(15200L, parsed1.nodes)
        assertEquals(120000L, parsed1.nps)
        assertNull(parsed1.mate)
        // WDL (180 + 790 * 0.5) / 1000 * 100 = 57.5%
        assertEquals(57.5f, parsed1.winPct, 0.05f)

        val line2 = "info depth 14 seldepth 18 multipv 2 score mate -4 nodes 15200 pv a7a8q e8f7"
        val parsed2 = UciParser.parseInfoLine(line2)
        assertNotNull(parsed2)
        assertEquals(2, parsed2!!.rank)
        assertEquals("a7a8q", parsed2.uci)
        assertEquals(-4, parsed2.mate)
        assertEquals(0.1f, parsed2.winPct, 0.001f)

        // Ignore upperbound/lowerbound aspiration noise
        val boundLine = "info depth 14 multipv 1 score cp 60 upperbound pv d2d4"
        assertNull(UciParser.parseInfoLine(boundLine))
    }

    @Test
    fun `wdlOrCpWinPct falls back to cp logistic curve when WDL is absent`() {
        assertEquals(UciParser.cpToWinPct(100), UciParser.wdlOrCpWinPct(false, 100, -1, -1, -1), 0.01f)
        assertEquals(99.9f, UciParser.wdlOrCpWinPct(true, 5, 500, 500, 0), 0.01f)
        assertEquals(75.0f, UciParser.wdlOrCpWinPct(false, 0, 600, 300, 100), 0.01f)
    }

    @Test
    fun `parseBestMove extracts uci move or null for none`() {
        assertEquals("g1f3", UciParser.parseBestMove("bestmove g1f3 ponder e7e5"))
        assertNull(UciParser.parseBestMove("bestmove (none)"))
    }
}
