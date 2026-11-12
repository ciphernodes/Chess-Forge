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

  @Test
  fun `test Stockfish JNI engine best move and evaluation calculation`() = kotlinx.coroutines.runBlocking {
    val engine = com.example.core.chess.StockfishJniEngine()
    val pos = ChessPosition.fromFen(ChessPosition.STARTING_FEN)
    val result = engine.calculateBestMove(pos, depth = 8, movetimeMs = 150L)
    assertNotNull(result.bestMove)
    assertNotNull(result.displayScore)
    assertTrue(result.bestMoveSan.isNotEmpty())
  }

  @Test
  fun `test vision module 64 square classification on synthetic board`() {
    val cvModule = com.example.core.vision.ChessVisionTFLiteModule()
    val bmp = android.graphics.Bitmap.createBitmap(240, 240, android.graphics.Bitmap.Config.ARGB_8888)
    val canvas = android.graphics.Canvas(bmp)
    val lightPaint = android.graphics.Paint().apply { color = android.graphics.Color.rgb(238, 238, 210) }
    val darkPaint = android.graphics.Paint().apply { color = android.graphics.Color.rgb(118, 150, 86) }
    val sq = 240 / 8
    for (r in 0..7) {
      for (c in 0..7) {
        val paint = if ((r + c) % 2 == 0) lightPaint else darkPaint
        canvas.drawRect((c * sq).toFloat(), (r * sq).toFloat(), ((c + 1) * sq).toFloat(), ((r + 1) * sq).toFloat(), paint)
      }
    }
    val result = cvModule.processBoardBitmap(bmp)
    assertNotNull(result.position)
    assertTrue(result.confidence > 0.5f)
  }

  @Test
  fun `test battery saver capture frequency settings`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val repo = com.example.data.repository.SettingsRepository(context)
    val defaultFps = repo.settings.value.overlayFps
    assertEquals(5, defaultFps)

    repo.updateSettings(repo.settings.value.copy(overlayFps = 2))
    assertEquals(2, repo.settings.value.overlayFps)

    repo.updateSettings(repo.settings.value.copy(overlayFps = 10))
    assertEquals(10, repo.settings.value.overlayFps)
  }
}
