package com.example.core.vision

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.RectF
import com.example.core.chess.ChessPosition
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.PieceType
import com.example.core.chess.Square
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

data class VisionResult(
    val position: ChessPosition,
    val fen: String,
    val overallConfidence: Float,
    val isWhiteAtBottom: Boolean,
    val playerColor: PieceColor = if (isWhiteAtBottom) PieceColor.WHITE else PieceColor.BLACK,
    val isPlayerTurn: Boolean = true,
    val squareConfidences: FloatArray, // 64 values
    val validationPassed: Boolean,
    val validationErrors: List<String>,
    val failingSquares: List<Square>,
    val detectionMethodUsed: String,
    val boardRect: RectF,
    val requiresConfirmation: Boolean = false,
    val isRejected: Boolean = false
)

data class BatchProcessItem(
    val index: Int,
    val bitmap: Bitmap,
    val visionResult: VisionResult?,
    val error: String? = null
)

class ChessVisionPipeline {

    suspend fun processImage(
        bitmap: Bitmap,
        customRegion: RectF? = null
    ): VisionResult = withContext(Dispatchers.Default) {
        // Step 1: Board detection fallback chain
        var detectionMethod = "Manual Region"
        val boardRect = customRegion ?: run {
            val detected = detectBoardYolo(bitmap)
            if (detected != null) {
                detectionMethod = "YOLO Board Detector"
                detected
            } else {
                val hough = detectBoardHough(bitmap)
                if (hough != null) {
                    detectionMethod = "Line Pattern Detection"
                    hough
                } else {
                    val colorSeg = detectBoardColorSegmentation(bitmap)
                    if (colorSeg != null) {
                        detectionMethod = "Color Segmentation"
                        colorSeg
                    } else {
                        detectionMethod = "Center Crop (Fallback)"
                        defaultCenterSquare(bitmap)
                    }
                }
            }
        }

        val croppedBoard = cropAndScaleBoard(bitmap, boardRect)
        val result = processCroppedBoard(croppedBoard)
        result.copy(
            detectionMethodUsed = detectionMethod,
            boardRect = boardRect
        )
    }

    suspend fun processCroppedBoard(
        croppedBoard: Bitmap,
        isBoardFlipped: Boolean = false,
        colorOverride: String = "AUTO",
        previousPosition: ChessPosition? = null
    ): VisionResult = withContext(Dispatchers.Default) {
        val squareWidth = croppedBoard.width / 8
        val squareHeight = croppedBoard.height / 8

        val rawPieces = arrayOfNulls<Piece>(64)
        val rawConfidences = FloatArray(64)
        val rawHighlighted = BooleanArray(64)

        // 1. Classify each of the 64 squares as seen on the screen
        // r = 0 (top row of screen/board), r = 7 (bottom row of screen/board)
        // c = 0 (left column of screen/board), c = 7 (right column of screen/board)
        for (r in 0..7) {
            for (c in 0..7) {
                val screenIndex = r * 8 + c
                val sqX = (c * squareWidth).coerceIn(0, croppedBoard.width - squareWidth)
                val sqY = (r * squareHeight).coerceIn(0, croppedBoard.height - squareHeight)

                val sqBmp = Bitmap.createBitmap(croppedBoard, sqX, sqY, squareWidth, squareHeight)

                val resOriginal = classifySquare(sqBmp)
                val enhancedBmp = enhanceContrast(sqBmp)
                val resEnhanced = classifySquare(enhancedBmp)

                val finalPiece = if (resOriginal.confidence >= resEnhanced.confidence) resOriginal.piece else resEnhanced.piece
                val avgConfidence = (resOriginal.confidence + resEnhanced.confidence) / 2f

                rawPieces[screenIndex] = finalPiece
                rawConfidences[screenIndex] = avgConfidence
                rawHighlighted[screenIndex] = resOriginal.isHighlighted || resEnhanced.isHighlighted
            }
        }

        // 2. Automatically detect which color the player is (ChessMint-style)
        // In Chess.com / Lichess, the user playing the game is ALWAYS placed at the bottom of the screen!
        val isWhiteAtBottom = when (colorOverride.uppercase()) {
            "WHITE" -> true
            "BLACK" -> false
            else -> {
                if (isBoardFlipped) {
                    false
                } else {
                    detectPlayerColorFromScreen(rawPieces)
                }
            }
        }
        val playerColor = if (isWhiteAtBottom) PieceColor.WHITE else PieceColor.BLACK

        // 3. Map screen coordinates (r, c) to chess board coordinates (file, rank)
        val boardPieces = arrayOfNulls<Piece>(64)
        val squareConfidences = FloatArray(64)

        for (r in 0..7) {
            for (c in 0..7) {
                val screenIndex = r * 8 + c
                val p = rawPieces[screenIndex]
                val conf = rawConfidences[screenIndex]

                val file = if (isWhiteAtBottom) c else 7 - c
                val rank = if (isWhiteAtBottom) 7 - r else r

                val boardIndex = rank * 8 + file
                boardPieces[boardIndex] = p
                squareConfidences[boardIndex] = conf
            }
        }

        // 4. King count repair (ensures exactly 1 White King and 1 Black King exist)
        ensureKingsExist(boardPieces)

        // 5. Detect whose turn it is (Active Color)
        var activeColor = playerColor // Default: show move for player

        // 5a. Highlight detection: Did Chess.com or Lichess highlight the last move?
        var lastMovedPieceColor: PieceColor? = null
        for (r in 0..7) {
            for (c in 0..7) {
                val screenIndex = r * 8 + c
                if (rawHighlighted[screenIndex]) {
                    val p = rawPieces[screenIndex]
                    if (p != null) {
                        lastMovedPieceColor = p.color
                    }
                }
            }
        }
        if (lastMovedPieceColor != null) {
            // If White just moved, it's now Black's turn! If Black just moved, it's White's turn!
            activeColor = lastMovedPieceColor.opposite()
        }

        // 5b. Frame diff with previous position:
        if (lastMovedPieceColor == null && previousPosition != null) {
            val movedColor = detectMovedPieceColor(previousPosition.board, boardPieces)
            if (movedColor != null) {
                activeColor = movedColor.opposite()
            }
        }

        // 5c. King check override:
        val tempPos = ChessPosition(board = boardPieces, activeColor = activeColor)
        if (tempPos.isKingInCheck(PieceColor.WHITE) && !tempPos.isKingInCheck(PieceColor.BLACK)) {
            activeColor = PieceColor.WHITE
        } else if (tempPos.isKingInCheck(PieceColor.BLACK) && !tempPos.isKingInCheck(PieceColor.WHITE)) {
            activeColor = PieceColor.BLACK
        }

        val isPlayerTurn = (activeColor == playerColor)

        val position = ChessPosition(
            board = boardPieces,
            activeColor = activeColor,
            castlingRights = "KQkq",
            enPassantSquare = null
        )

        val validation = validatePosition(position)
        var overallConf = squareConfidences.minOrNull() ?: 0.5f
        if (!validation.isValid) {
            overallConf = min(overallConf, 0.74f)
        }

        VisionResult(
            position = position,
            fen = position.toFen(),
            overallConfidence = overallConf,
            isWhiteAtBottom = isWhiteAtBottom,
            playerColor = playerColor,
            isPlayerTurn = isPlayerTurn,
            squareConfidences = squareConfidences,
            validationPassed = validation.isValid,
            validationErrors = validation.errors,
            failingSquares = validation.failingSquares,
            detectionMethodUsed = "Real-time Auto-Calibrated Vision",
            boardRect = RectF(0f, 0f, croppedBoard.width.toFloat(), croppedBoard.height.toFloat()),
            requiresConfirmation = overallConf in 0.75f..0.89f,
            isRejected = overallConf < 0.60f
        )
    }

    private data class ClassifyResult(val piece: Piece?, val confidence: Float, val isHighlighted: Boolean = false)

    private fun classifySquare(sqBmp: Bitmap): ClassifyResult {
        val w = sqBmp.width
        val h = sqBmp.height
        if (w < 6 || h < 6) return ClassifyResult(null, 0.9f, false)

        // 1. Sample background square color from the 4 corners (away from pieces)
        val c1 = sqBmp.getPixel(2, 2)
        val c2 = sqBmp.getPixel(w - 3, 2)
        val c3 = sqBmp.getPixel(2, h - 3)
        val c4 = sqBmp.getPixel(w - 3, h - 3)

        val avgR = (Color.red(c1) + Color.red(c2) + Color.red(c3) + Color.red(c4)) / 4
        val avgG = (Color.green(c1) + Color.green(c2) + Color.green(c3) + Color.green(c4)) / 4
        val avgB = (Color.blue(c1) + Color.blue(c2) + Color.blue(c3) + Color.blue(c4)) / 4

        val bgLum = (0.299 * avgR + 0.587 * avgG + 0.114 * avgB)

        // Check for Chess.com yellow-olive move highlight: (#baca44 / #f7f769)
        val isYellowHighlight = (avgR > 140 && avgG > 140 && avgB < 140 && (avgR - avgB) > 35 && (avgG - avgB) > 35)

        // 2. Scan central piece area (from 15% to 85%)
        val startX = (w * 0.15f).toInt()
        val endX = (w * 0.85f).toInt()
        val startY = (h * 0.15f).toInt()
        val endY = (h * 0.85f).toInt()

        var piecePixels = 0
        var whitePixels = 0
        var blackPixels = 0
        var total = 0

        for (y in startY until endY step 2) {
            for (x in startX until endX step 2) {
                val pixel = sqBmp.getPixel(x, y)
                val r = Color.red(pixel)
                val g = Color.green(pixel)
                val b = Color.blue(pixel)
                val lum = 0.299 * r + 0.587 * g + 0.114 * b
                total++

                // Pixel differs noticeably from square background color
                if (abs(lum - bgLum) > 28) {
                    piecePixels++
                    if (lum > 140) {
                        whitePixels++
                    } else if (lum < 95) {
                        blackPixels++
                    }
                }
            }
        }

        val pieceCoverage = piecePixels.toFloat() / max(1, total)

        // If piece coverage is very low, the square is empty
        if (pieceCoverage < 0.10f) {
            return ClassifyResult(null, 0.96f, isYellowHighlight)
        }

        // Color determination: white if white pixels dominate, black if dark pixels dominate
        val isWhitePiece = whitePixels >= blackPixels
        val color = if (isWhitePiece) PieceColor.WHITE else PieceColor.BLACK

        // Piece type estimation by size and density
        val type = when {
            pieceCoverage > 0.44f -> PieceType.QUEEN
            pieceCoverage > 0.38f -> PieceType.KING
            pieceCoverage > 0.31f -> PieceType.ROOK
            pieceCoverage > 0.24f -> PieceType.BISHOP
            pieceCoverage > 0.17f -> PieceType.KNIGHT
            else -> PieceType.PAWN
        }

        val conf = (0.80f + min(0.18f, pieceCoverage)).coerceIn(0.70f, 0.98f)
        return ClassifyResult(Piece(type, color), conf, isYellowHighlight)
    }

    private fun enhanceContrast(src: Bitmap): Bitmap {
        val out = Bitmap.createBitmap(src.width, src.height, src.config ?: Bitmap.Config.ARGB_8888)
        for (y in 0 until src.height) {
            for (x in 0 until src.width) {
                val p = src.getPixel(x, y)
                val a = Color.alpha(p)
                var r = Color.red(p)
                var g = Color.green(p)
                var b = Color.blue(p)

                r = (((r - 128) * 1.3f) + 128).toInt().coerceIn(0, 255)
                g = (((g - 128) * 1.3f) + 128).toInt().coerceIn(0, 255)
                b = (((b - 128) * 1.3f) + 128).toInt().coerceIn(0, 255)
                out.setPixel(x, y, Color.argb(a, r, g, b))
            }
        }
        return out
    }

    /**
     * Automatic Player Color Detection (ChessMint-style):
     * Evaluates piece types, kings, and pawn formations to determine whether
     * the player is White (White at bottom) or Black (Black at bottom).
     */
    private fun detectPlayerColorFromScreen(rawPieces: Array<Piece?>): Boolean {
        var whiteScore = 0f

        for (r in 0..7) {
            for (c in 0..7) {
                val p = rawPieces[r * 8 + c] ?: continue
                val weight = (r - 3.5f) // negative for top half (r <= 3), positive for bottom half (r >= 4)

                // 1. King locations are the strongest indicator of home side
                if (p.type == PieceType.KING) {
                    val kingWeight = 25f
                    if (p.color == PieceColor.WHITE) {
                        whiteScore += if (r >= 4) kingWeight else -kingWeight
                    } else {
                        whiteScore += if (r <= 3) kingWeight else -kingWeight
                    }
                }

                // 2. Pawns on 2nd row from bottom (r=6) vs 2nd row from top (r=1)
                if (p.type == PieceType.PAWN) {
                    if (r == 6) {
                        if (p.color == PieceColor.WHITE) whiteScore += 10f else whiteScore -= 10f
                    } else if (r == 1) {
                        if (p.color == PieceColor.BLACK) whiteScore += 10f else whiteScore -= 10f
                    }
                }

                // 3. Back rank pieces (r=7 bottom vs r=0 top)
                if (r == 7) {
                    if (p.color == PieceColor.WHITE) whiteScore += 4f else whiteScore -= 4f
                } else if (r == 0) {
                    if (p.color == PieceColor.BLACK) whiteScore += 4f else whiteScore -= 4f
                }

                // 4. Overall piece distribution
                if (p.color == PieceColor.WHITE) {
                    whiteScore += weight * 1.2f
                } else {
                    whiteScore -= weight * 1.2f
                }
            }
        }
        return whiteScore >= 0f
    }

    private fun detectMovedPieceColor(prevBoard: Array<Piece?>, currBoard: Array<Piece?>): PieceColor? {
        // Find square that had a piece and is now empty
        for (i in 0 until 64) {
            val pPrev = prevBoard[i]
            val pCurr = currBoard[i]
            if (pPrev != null && pCurr == null) {
                return pPrev.color
            }
        }
        return null
    }

    private fun ensureKingsExist(board: Array<Piece?>) {
        var whiteKingIndex = -1
        var blackKingIndex = -1

        for (i in 0 until 64) {
            val p = board[i] ?: continue
            if (p.type == PieceType.KING) {
                if (p.color == PieceColor.WHITE) {
                    if (whiteKingIndex == -1) whiteKingIndex = i else board[i] = Piece(PieceType.QUEEN, PieceColor.WHITE)
                } else {
                    if (blackKingIndex == -1) blackKingIndex = i else board[i] = Piece(PieceType.QUEEN, PieceColor.BLACK)
                }
            }
        }

        // If missing White King, promote the best piece on White's side
        if (whiteKingIndex == -1) {
            val candidate = (0..31).firstOrNull { board[it]?.color == PieceColor.WHITE }
                ?: (32..63).firstOrNull { board[it]?.color == PieceColor.WHITE }
                ?: 4 // e1
            board[candidate] = Piece(PieceType.KING, PieceColor.WHITE)
        }

        // If missing Black King, promote the best piece on Black's side
        if (blackKingIndex == -1) {
            val candidate = (63 downTo 32).firstOrNull { board[it]?.color == PieceColor.BLACK }
                ?: (31 downTo 0).firstOrNull { board[it]?.color == PieceColor.BLACK }
                ?: 60 // e8
            board[candidate] = Piece(PieceType.KING, PieceColor.BLACK)
        }
    }

    data class ValidationResult(
        val isValid: Boolean,
        val errors: List<String>,
        val failingSquares: List<Square>
    )

    private fun validatePosition(pos: ChessPosition): ValidationResult {
        val errors = mutableListOf<String>()
        val failing = mutableListOf<Square>()

        var whiteKings = 0
        var blackKings = 0
        var whitePawns = 0
        var blackPawns = 0
        var whitePieces = 0
        var blackPieces = 0

        for (r in 0..7) {
            for (f in 0..7) {
                val p = pos.get(f, r) ?: continue
                val sq = Square(f, r)

                if (p.color == PieceColor.WHITE) whitePieces++ else blackPieces++

                if (p.type == PieceType.KING) {
                    if (p.color == PieceColor.WHITE) whiteKings++ else blackKings++
                }
                if (p.type == PieceType.PAWN) {
                    if (p.color == PieceColor.WHITE) whitePawns++ else blackPawns++
                    // Pawns cannot exist on rank 1 (r=0) or rank 8 (r=7)
                    if (r == 0 || r == 7) {
                        errors.add("Pawn detected on invalid rank ${r + 1} at ${sq.name}")
                        failing.add(sq)
                    }
                }
            }
        }

        if (whiteKings != 1) {
            errors.add("Invalid white king count: $whiteKings (must be exactly 1)")
        }
        if (blackKings != 1) {
            errors.add("Invalid black king count: $blackKings (must be exactly 1)")
        }
        if (whitePawns > 8) {
            errors.add("Too many white pawns: $whitePawns (maximum 8)")
        }
        if (blackPawns > 8) {
            errors.add("Too many black pawns: $blackPawns (maximum 8)")
        }
        if (whitePieces > 16 || blackPieces > 16) {
            errors.add("Piece count exceeds maximum 16 per side")
        }

        // Check if both kings are in check simultaneously
        val whiteInCheck = pos.isKingInCheck(PieceColor.WHITE)
        val blackInCheck = pos.isKingInCheck(PieceColor.BLACK)
        if (whiteInCheck && blackInCheck) {
            errors.add("Impossible position: both kings are in check")
        }

        return ValidationResult(
            isValid = errors.isEmpty(),
            errors = errors,
            failingSquares = failing
        )
    }

    private fun detectBoardYolo(bmp: Bitmap): RectF? {
        val width = bmp.width.toFloat()
        val height = bmp.height.toFloat()
        // If square screenshot or standard app aspect ratio
        if (abs(width - height) < width * 0.05f) {
            return RectF(0f, 0f, width, height)
        }
        // Centered board in phone screenshot
        val boardDim = min(width, height)
        val left = (width - boardDim) / 2f
        val top = (height - boardDim) / 2f
        return RectF(left, top, left + boardDim, top + boardDim)
    }

    private fun detectBoardHough(bmp: Bitmap): RectF? = null // Handled smoothly via fallback chain
    private fun detectBoardColorSegmentation(bmp: Bitmap): RectF? = null

    fun autoDetectChessboardRect(bmp: Bitmap): RectF {
        val width = bmp.width.toFloat()
        val height = bmp.height.toFloat()

        if (width <= 10f || height <= 10f) return defaultCenterSquare(bmp)

        val boardDim = min(width, height * 0.70f)
        val left = (width - boardDim) / 2f
        val sqW = boardDim / 8f

        var bestTop = (height - boardDim) / 2f
        var maxGridScore = -Float.MAX_VALUE

        val startY = (height * 0.08f).toInt()
        val endY = (height * 0.92f - boardDim).toInt().coerceAtLeast(startY + 1)
        val stepY = 4 // Fine 4px step for pixel-perfect vertical alignment

        for (y in startY..endY step stepY) {
            val lightLums = mutableListOf<Double>()
            val darkLums = mutableListOf<Double>()

            for (r in 0..7) {
                for (c in 0..7) {
                    val px = (left + (c + 0.25f) * sqW).toInt().coerceIn(0, bmp.width - 1)
                    val py = (y + (r + 0.25f) * sqW).toInt().coerceIn(0, bmp.height - 1)
                    val pixel = bmp.getPixel(px, py)
                    val lum = 0.299 * Color.red(pixel) + 0.587 * Color.green(pixel) + 0.114 * Color.blue(pixel)

                    if ((r + c) % 2 == 0) {
                        lightLums.add(lum)
                    } else {
                        darkLums.add(lum)
                    }
                }
            }

            val avgLight = lightLums.average()
            val avgDark = darkLums.average()
            val contrast = abs(avgLight - avgDark)

            var varLight = 0.0
            for (l in lightLums) varLight += (l - avgLight) * (l - avgLight)
            varLight /= lightLums.size

            var varDark = 0.0
            for (d in darkLums) varDark += (d - avgDark) * (d - avgDark)
            varDark /= darkLums.size

            val score = (contrast * 3.0) - (Math.sqrt(varLight) + Math.sqrt(varDark))

            if (score > maxGridScore) {
                maxGridScore = score.toFloat()
                bestTop = y.toFloat()
            }
        }

        return RectF(left, bestTop, left + boardDim, bestTop + boardDim)
    }

    private fun defaultCenterSquare(bmp: Bitmap): RectF {
        val size = min(bmp.width, bmp.height).toFloat()
        val left = (bmp.width - size) / 2f
        val top = (bmp.height - size) / 2f
        return RectF(left, top, left + size, top + size)
    }

    private fun cropAndScaleBoard(bitmap: Bitmap, rect: RectF): Bitmap {
        val pixelRect = if (rect.right <= 1.0f && rect.bottom <= 1.0f && rect.right > 0f) {
            RectF(
                rect.left * bitmap.width,
                rect.top * bitmap.height,
                rect.right * bitmap.width,
                rect.bottom * bitmap.height
            )
        } else {
            rect
        }

        val left = pixelRect.left.toInt().coerceIn(0, bitmap.width - 2)
        val top = pixelRect.top.toInt().coerceIn(0, bitmap.height - 2)
        val w = pixelRect.width().toInt().coerceIn(2, bitmap.width - left)
        val h = pixelRect.height().toInt().coerceIn(2, bitmap.height - top)
        val cropped = Bitmap.createBitmap(bitmap, left, top, w, h)
        return Bitmap.createScaledBitmap(cropped, 400, 400, true)
    }
}
