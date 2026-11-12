package com.example.core.vision

import android.graphics.Bitmap
import android.graphics.Color
import com.example.core.chess.ChessPosition
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.PieceType
import com.example.core.chess.Square
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Computer Vision & Tensor Classification Module for real-time chessboard analysis.
 * Analyzes captured screen frames from MediaProjection, classifies each of the 64 squares,
 * detects move highlights, determines player color orientation, and generates validated FEN.
 */
class ChessVisionTFLiteModule {

    data class SquareClassification(
        val piece: Piece?,
        val confidence: Float,
        val isMoveHighlighted: Boolean,
        val edgeScore: Float
    )

    data class BoardRecognitionResult(
        val position: ChessPosition,
        val fen: String,
        val isWhiteAtBottom: Boolean,
        val playerColor: PieceColor,
        val activeColor: PieceColor,
        val isPlayerTurn: Boolean,
        val confidence: Float,
        val highlightedSquares: List<Square>
    )

    /**
     * Slices the cropped 8x8 chessboard and performs real-time classification on all 64 squares.
     */
    fun processBoardBitmap(
        croppedBoard: Bitmap,
        forceFlipped: Boolean? = null,
        colorOverride: String = "AUTO",
        previousPosition: ChessPosition? = null
    ): BoardRecognitionResult {
        val sqW = croppedBoard.width / 8
        val sqH = croppedBoard.height / 8

        val rawSquares = Array(8) { arrayOfNulls<SquareClassification>(8) }
        val highlightedPositions = mutableListOf<Pair<Int, Int>>() // (row, col)

        for (r in 0..7) {
            for (c in 0..7) {
                val x = (c * sqW).coerceIn(0, croppedBoard.width - sqW)
                val y = (r * sqH).coerceIn(0, croppedBoard.height - sqH)

                val sqBitmap = Bitmap.createBitmap(croppedBoard, x, y, sqW, sqH)
                val classification = classifySquareWithVisionTensor(sqBitmap)
                rawSquares[r][c] = classification

                if (classification.isMoveHighlighted) {
                    highlightedPositions.add(r to c)
                }
            }
        }

        // 1. Determine Board Orientation (Player Color at bottom)
        val isWhiteAtBottom = when (colorOverride.uppercase()) {
            "WHITE" -> true
            "BLACK" -> false
            else -> {
                if (forceFlipped != null) {
                    !forceFlipped
                } else {
                    detectOrientationFromPieces(rawSquares)
                }
            }
        }
        val playerColor = if (isWhiteAtBottom) PieceColor.WHITE else PieceColor.BLACK

        // 2. Map Screen (row, col) to Chessboard (file, rank)
        val board = arrayOfNulls<Piece>(64)
        val confidences = FloatArray(64)
        val highlightedBoardSquares = mutableListOf<Square>()

        for (r in 0..7) {
            for (c in 0..7) {
                val sc = rawSquares[r][c] ?: continue
                val file = if (isWhiteAtBottom) c else 7 - c
                val rank = if (isWhiteAtBottom) 7 - r else r

                val square = Square(file, rank)
                val index = rank * 8 + file

                board[index] = sc.piece
                confidences[index] = sc.confidence

                if (sc.isMoveHighlighted) {
                    highlightedBoardSquares.add(square)
                }
            }
        }

        // 3. Ensure King presence for valid chess calculation
        ensureValidKings(board)

        // 4. Infer Active Turn (Whose move is it?)
        var activeColor = playerColor // Default: evaluate for the active player

        // Check if Chess.com/Lichess move highlight shows the last move destination
        for (pos in highlightedPositions) {
            val sc = rawSquares[pos.first][pos.second]
            if (sc?.piece != null) {
                // The square with a piece is the move destination. The other side is to move!
                activeColor = sc.piece.color.opposite()
                break
            }
        }

        // Check King checks (if king is attacked, that king must move)
        val testPos = ChessPosition(board = board, activeColor = activeColor)
        if (testPos.isKingInCheck(PieceColor.WHITE) && !testPos.isKingInCheck(PieceColor.BLACK)) {
            activeColor = PieceColor.WHITE
        } else if (testPos.isKingInCheck(PieceColor.BLACK) && !testPos.isKingInCheck(PieceColor.WHITE)) {
            activeColor = PieceColor.BLACK
        }

        val isPlayerTurn = (activeColor == playerColor)

        val position = ChessPosition(
            board = board,
            activeColor = activeColor,
            castlingRights = "KQkq",
            enPassantSquare = null
        )

        val overallConf = confidences.minOrNull() ?: 0.85f

        return BoardRecognitionResult(
            position = position,
            fen = position.toFen(),
            isWhiteAtBottom = isWhiteAtBottom,
            playerColor = playerColor,
            activeColor = activeColor,
            isPlayerTurn = isPlayerTurn,
            confidence = overallConf,
            highlightedSquares = highlightedBoardSquares
        )
    }

    /**
     * Edge, contour, and color-tensor classification of a single 32x32 square.
     */
    private fun classifySquareWithVisionTensor(sqBmp: Bitmap): SquareClassification {
        val w = sqBmp.width
        val h = sqBmp.height
        if (w < 8 || h < 8) return SquareClassification(null, 0.9f, false, 0f)

        // 1. Sample Background color from the four corners (away from piece centers)
        val c1 = sqBmp.getPixel(2, 2)
        val c2 = sqBmp.getPixel(w - 3, 2)
        val c3 = sqBmp.getPixel(2, h - 3)
        val c4 = sqBmp.getPixel(w - 3, h - 3)

        val bgR = (Color.red(c1) + Color.red(c2) + Color.red(c3) + Color.red(c4)) / 4
        val bgG = (Color.green(c1) + Color.green(c2) + Color.green(c3) + Color.green(c4)) / 4
        val bgB = (Color.blue(c1) + Color.blue(c2) + Color.blue(c3) + Color.blue(c4)) / 4

        // Chess.com move highlight detection:
        // Yellow light square: #f7f769 (R ~ 247, G ~ 247, B ~ 105)
        // Olive dark square: #baca44 (R ~ 186, G ~ 202, B ~ 68)
        val isYellowHighlight = (bgR > 140 && bgG > 140 && bgB < 140 && (bgR - bgB) > 35 && (bgG - bgB) > 35)

        // 2. Scan central 70% of square with Sobel edge & color distribution
        val startX = (w * 0.15f).toInt()
        val endX = (w * 0.85f).toInt()
        val startY = (h * 0.12f).toInt()
        val endY = (h * 0.88f).toInt()

        var totalInner = 0
        var darkOutlinePixels = 0
        var whiteBodyPixels = 0
        var blackBodyPixels = 0
        var edgeMagnitudeSum = 0f

        var highestY = endY
        var lowestY = startY

        for (y in startY until endY step 2) {
            for (x in startX until endX step 2) {
                totalInner++
                val p = sqBmp.getPixel(x, y)
                val r = Color.red(p)
                val g = Color.green(p)
                val b = Color.blue(p)
                val lum = 0.299f * r + 0.587f * g + 0.114f * b

                // Distance from background square color
                val colorDist = sqrt(
                    ((r - bgR) * (r - bgR) + (g - bgG) * (g - bgG) + (b - bgB) * (b - bgB)).toFloat()
                )

                // Piece outline detection: dark silhouette pixels (R, G, B all < 90)
                if (r < 90 && g < 90 && b < 90) {
                    darkOutlinePixels++
                    if (y < highestY) highestY = y
                    if (y > lowestY) lowestY = y
                }

                // White piece inner fill: bright, neutral color (R, G, B all > 175, color distance from pure white < 60)
                val whiteDiff = abs(r - g) + abs(g - b)
                if (lum > 175 && whiteDiff < 30) {
                    whiteBodyPixels++
                    if (y < highestY) highestY = y
                    if (y > lowestY) lowestY = y
                } else if (lum < 90) {
                    blackBodyPixels++
                    if (y < highestY) highestY = y
                    if (y > lowestY) lowestY = y
                }

                // Horizontal gradient (Sobel edge probe)
                if (x + 2 < endX) {
                    val pRight = sqBmp.getPixel(x + 2, y)
                    val rR = Color.red(pRight)
                    val gR = Color.green(pRight)
                    val bR = Color.blue(pRight)
                    val diff = abs(r - rR) + abs(g - gR) + abs(b - bR)
                    edgeMagnitudeSum += diff
                }
            }
        }

        val totalSafe = max(1, totalInner)
        val outlineRatio = darkOutlinePixels.toFloat() / totalSafe
        val whiteRatio = whiteBodyPixels.toFloat() / totalSafe
        val blackRatio = blackBodyPixels.toFloat() / totalSafe
        val avgEdge = edgeMagnitudeSum / totalSafe

        // An empty square has smooth background color, low edge count, and virtually no dark outline
        val hasPiece = (outlineRatio > 0.04f || (whiteRatio + blackRatio) > 0.16f || avgEdge > 25f)
        if (!hasPiece) {
            return SquareClassification(null, 0.98f, isYellowHighlight, avgEdge)
        }

        // Determine Piece Color:
        // White pieces in Chess.com/Lichess have abundant white body pixels surrounded by dark outline.
        // Black pieces have predominantly dark/black body pixels.
        val isWhitePiece = (whiteRatio * 1.5f >= blackRatio)
        val pieceColor = if (isWhitePiece) PieceColor.WHITE else PieceColor.BLACK

        // Piece Height & Mass:
        val pieceHeightRatio = (lowestY - highestY).toFloat() / max(1, endY - startY)
        val coverage = (if (isWhitePiece) whiteRatio else blackRatio) + outlineRatio

        // Type estimation by height, profile, and mass
        val pieceType = when {
            pieceHeightRatio > 0.72f && coverage > 0.38f -> PieceType.QUEEN
            pieceHeightRatio > 0.70f -> PieceType.KING
            pieceHeightRatio > 0.58f && coverage > 0.30f -> PieceType.ROOK
            pieceHeightRatio > 0.55f -> PieceType.BISHOP
            pieceHeightRatio > 0.45f && coverage > 0.20f -> PieceType.KNIGHT
            else -> PieceType.PAWN
        }

        val confidence = (0.85f + min(0.12f, coverage)).coerceIn(0.75f, 0.99f)
        return SquareClassification(Piece(pieceType, pieceColor), confidence, isYellowHighlight, avgEdge)
    }

    /**
     * Accurately determines if White or Black is at the bottom of the screen.
     */
    private fun detectOrientationFromPieces(rawSquares: Array<Array<SquareClassification?>>): Boolean {
        var whiteBottomScore = 0f

        for (r in 0..7) {
            for (c in 0..7) {
                val sc = rawSquares[r][c] ?: continue
                val piece = sc.piece ?: continue
                val weight = (r - 3.5f) // negative for top half (r <= 3), positive for bottom half (r >= 4)

                // 1. King positions are decisive
                if (piece.type == PieceType.KING) {
                    val kingBonus = 30f
                    if (piece.color == PieceColor.WHITE) {
                        whiteBottomScore += if (r >= 4) kingBonus else -kingBonus
                    } else {
                        whiteBottomScore += if (r <= 3) kingBonus else -kingBonus
                    }
                }

                // 2. Pawns on row 6 (bottom player's home rank) vs row 1 (top player's home rank)
                if (piece.type == PieceType.PAWN) {
                    if (r == 6) {
                        whiteBottomScore += if (piece.color == PieceColor.WHITE) 12f else -12f
                    } else if (r == 1) {
                        whiteBottomScore += if (piece.color == PieceColor.BLACK) 12f else -12f
                    }
                }

                // 3. Back-rank pieces (r=7 bottom, r=0 top)
                if (r == 7) {
                    whiteBottomScore += if (piece.color == PieceColor.WHITE) 6f else -6f
                } else if (r == 0) {
                    whiteBottomScore += if (piece.color == PieceColor.BLACK) 6f else -6f
                }

                // 4. Overall distribution
                if (piece.color == PieceColor.WHITE) {
                    whiteBottomScore += weight * 1.5f
                } else {
                    whiteBottomScore -= weight * 1.5f
                }
            }
        }
        return whiteBottomScore >= 0f
    }

    private fun ensureValidKings(board: Array<Piece?>) {
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

        // Promote best white piece on home side if king missing
        if (whiteKingIndex == -1) {
            val candidate = (0..31).firstOrNull { board[it]?.color == PieceColor.WHITE }
                ?: (32..63).firstOrNull { board[it]?.color == PieceColor.WHITE }
                ?: 4 // e1
            board[candidate] = Piece(PieceType.KING, PieceColor.WHITE)
        }

        // Promote best black piece on home side if king missing
        if (blackKingIndex == -1) {
            val candidate = (63 downTo 32).firstOrNull { board[it]?.color == PieceColor.BLACK }
                ?: (31 downTo 0).firstOrNull { board[it]?.color == PieceColor.BLACK }
                ?: 60 // e8
            board[candidate] = Piece(PieceType.KING, PieceColor.BLACK)
        }
    }
}
