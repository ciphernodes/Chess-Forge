package com.example

import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessOpeningBook
import com.example.core.chess.ChessPosition
import com.example.core.chess.Square
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExampleUnitTest {
  @Test
  fun addition_isCorrect() {
    assertEquals(4, 2 + 2)
  }

  @Test
  fun testStartingPositionLegalMoves() {
    val pos = ChessPosition.fromFen(ChessPosition.STARTING_FEN)
    val legalMoves = pos.generateLegalMoves()
    // Standard starting position has exactly 20 legal moves (16 pawn moves + 4 knight moves)
    assertEquals(20, legalMoves.size)
  }

  @Test
  fun testOpeningIdentification() {
    val moves = listOf("e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6")
    val opening = ChessOpeningBook.identifyOpening(moves)
    assertEquals("B90", opening.eco)
    assertTrue(opening.name.contains("Najdorf"))
  }

  @Test
  fun testAccuracyCalculation() {
    val engine = ChessEngine()
    val drops = listOf(0.05f, 0.10f, 0.20f)
    val acc = engine.calculateGameAccuracy(drops)
    assertTrue(acc > 90f)
  }
}
