package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.core.chess.ChessOpeningBook
import com.example.core.chess.ChessPosition
import com.example.core.chess.Square
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExampleRobolectricTest {

  @Test
  fun `read string from context`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("Chess Forge", appName)
  }

  @Test
  fun `test chess starting position FEN and legal moves`() {
    val pos = ChessPosition.fromFen(ChessPosition.STARTING_FEN)
    val legalMoves = pos.generateLegalMoves()
    // Starting position has exactly 20 legal moves (16 pawn moves + 4 knight moves)
    assertEquals(20, legalMoves.size)
  }

  @Test
  fun `test opening identification for Sicilian Defense`() {
    val moves = listOf("e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6")
    val opening = ChessOpeningBook.identifyOpening(moves)
    assertEquals("B90", opening.eco)
    assertTrue(opening.name.contains("Najdorf"))
  }
}
