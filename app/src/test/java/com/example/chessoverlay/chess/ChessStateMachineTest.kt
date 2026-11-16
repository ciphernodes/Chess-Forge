package com.example.chessoverlay.chess

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChessStateMachineTest {

    private fun placementToGrid(placement: String, flipped: Boolean = false): Array<Array<Char>> {
        val grid = Array(8) { Array(8) { '.' } }
        val ranks = placement.split('/')
        for (r in 0 until 8) {
            var c = 0
            for (ch in ranks[r]) {
                if (ch in '1'..'8') {
                    c += (ch - '0')
                } else {
                    grid[r][c] = ch
                    c++
                }
            }
        }
        if (!flipped) return grid
        val rotated = Array(8) { Array(8) { '.' } }
        for (r in 0 until 8) {
            for (c in 0 until 8) {
                rotated[7 - r][7 - c] = grid[r][c]
            }
        }
        return rotated
    }

    @Test
    fun `gridToPlacement converts standard and flipped starting grid accurately`() {
        val startPlacement = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
        val normalGrid = placementToGrid(startPlacement, flipped = false)
        assertEquals(startPlacement, ChessStateMachine.gridToPlacement(normalGrid, isFlipped = false))

        val flippedGrid = placementToGrid(startPlacement, flipped = true)
        assertEquals(startPlacement, ChessStateMachine.gridToPlacement(flippedGrid, isFlipped = true))
    }

    @Test
    fun `temporal debounce requires 2 consecutive observations before accepting move`() {
        val fsm = ChessStateMachine()
        val startGrid = placementToGrid("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
        // Observe startpos twice
        assertNull(fsm.observeGrid(startGrid))
        assertNotNull(fsm.observeGrid(startGrid))

        // Play 1. e4 -> 1st observation must return null (debounced)
        val e4Grid = placementToGrid("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR")
        assertNull(fsm.observeGrid(e4Grid))

        // 2nd consecutive observation accepts legal move and advances FEN turn to black
        val fenAfterE4 = fsm.observeGrid(e4Grid)
        assertNotNull(fenAfterE4)
        assertTrue(fenAfterE4!!.contains(" b "))
        assertTrue(fenAfterE4.startsWith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR"))

        // 3rd identical observation does not re-emit duplicate FEN
        assertNull(fsm.observeGrid(e4Grid))
    }

    @Test
    fun `legal move diffing handles pawn promotion and uciToSan`() {
        val prePromoFen = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1"
        val fsm = ChessStateMachine(initialFen = prePromoFen)

        val afterPromoGrid = placementToGrid("Q3k3/8/8/8/8/8/8/4K3")
        assertNull(fsm.observeGrid(afterPromoGrid))
        val newFen = fsm.observeGrid(afterPromoGrid)
        assertNotNull(newFen)
        assertTrue(newFen!!.startsWith("Q3k3/8/8/8/8/8/8/4K3 b"))

        val san = fsm.uciToSan(prePromoFen, "a7a8q")
        assertEquals("a8=Q+", san)
    }

    @Test
    fun `invalid placement with missing king is rejected cleanly`() {
        val fsm = ChessStateMachine()
        val missingBlackKing = placementToGrid("rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")
        assertNull(fsm.observeGrid(missingBlackKing))
        assertNull(fsm.observeGrid(missingBlackKing))
    }

    @Test
    fun `fallback FEN reconstruction infers side to move when opponent king is in check`() {
        val fsm = ChessStateMachine()
        // White queen on e7 gives check to Black king on e8 -> Black MUST be to move
        val midGameCheckGrid = placementToGrid("4k3/4Q3/8/8/8/8/8/4K3")
        assertNull(fsm.observeGrid(midGameCheckGrid))
        val fen = fsm.observeGrid(midGameCheckGrid)
        assertNotNull(fen)
        assertTrue(fen!!.contains(" b "))
    }
}
