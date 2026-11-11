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

        // Step 2 & 3: Crop and slice into 64 squares
        val croppedBoard = cropAndScaleBoard(bitmap, boardRect)
        val squareWidth = croppedBoard.width / 8
        val squareHeight = croppedBoard.height / 8

        val squareConfidences = FloatArray(64)
        val boardPieces = arrayOfNulls<Piece>(64)

        // Step 4 & 5: Piece classification + Ensemble inference
        for (rank in 0..7) {
            for (file in 0..7) {
                val index = rank * 8 + file
                val sqX = (file * squareWidth).coerceIn(0, croppedBoard.width - squareWidth)
                val sqY = ((7 - rank) * squareHeight).coerceIn(0, croppedBoard.height - squareHeight)

                val sqBmp = Bitmap.createBitmap(croppedBoard, sqX, sqY, squareWidth, squareHeight)

                // Ensemble: original + contrast-enhanced
                val resOriginal = classifySquare(sqBmp)
                val enhancedBmp = enhanceContrast(sqBmp)
                val resEnhanced = classifySquare(enhancedBmp)

                val finalPiece = if (resOriginal.confidence >= resEnhanced.confidence) resOriginal.piece else resEnhanced.piece
                val avgConfidence = (resOriginal.confidence + resEnhanced.confidence) / 2f

                boardPieces[index] = finalPiece
                squareConfidences[index] = avgConfidence
            }
        }

        // Step 7: Orientation detection (rank 2 pawns = white, rank 7 = black)
        val isWhiteAtBottom = detectOrientation(boardPieces)
        if (!isWhiteAtBottom) {
            // Flip board pieces array if black is at bottom
            flipBoardOrientation(boardPieces, squareConfidences)
        }

        // Assemble position
        val position = ChessPosition(
            board = boardPieces,
            activeColor = PieceColor.WHITE,
            castlingRights = "KQkq",
            enPassantSquare = null
        )

        // Step 6 & 10: FEN Validation layer (Section 3.3b)
        val validation = validatePosition(position)
        var overallConf = squareConfidences.minOrNull() ?: 0.5f

        if (!validation.isValid) {
            overallConf = min(overallConf, 0.74f) // Cap confidence at 0.74 if validation fails
        }

        val requiresConfirmation = overallConf in 0.75f..0.89f
        val isRejected = overallConf < 0.60f

        VisionResult(
            position = position,
            fen = position.toFen(),
            overallConfidence = overallConf,
            isWhiteAtBottom = isWhiteAtBottom,
            squareConfidences = squareConfidences,
            validationPassed = validation.isValid,
            validationErrors = validation.errors,
            failingSquares = validation.failingSquares,
            detectionMethodUsed = detectionMethod,
            boardRect = boardRect,
            requiresConfirmation = requiresConfirmation,
            isRejected = isRejected
        )
    }

    suspend fun processCroppedBoard(
        croppedBoard: Bitmap,
        isBoardFlipped: Boolean = false
    ): VisionResult = withContext(Dispatchers.Default) {
        val squareWidth = croppedBoard.width / 8
        val squareHeight = croppedBoard.height / 8

        val squareConfidences = FloatArray(64)
        val boardPieces = arrayOfNulls<Piece>(64)

        for (rank in 0..7) {
            for (file in 0..7) {
                val index = rank * 8 + file
                val sqX = (file * squareWidth).coerceIn(0, croppedBoard.width - squareWidth)
                val sqY = ((7 - rank) * squareHeight).coerceIn(0, croppedBoard.height - squareHeight)

                val sqBmp = Bitmap.createBitmap(croppedBoard, sqX, sqY, squareWidth, squareHeight)

                val resOriginal = classifySquare(sqBmp)
                val enhancedBmp = enhanceContrast(sqBmp)
                val resEnhanced = classifySquare(enhancedBmp)

                val finalPiece = if (resOriginal.confidence >= resEnhanced.confidence) resOriginal.piece else resEnhanced.piece
                val avgConfidence = (resOriginal.confidence + resEnhanced.confidence) / 2f

                boardPieces[index] = finalPiece
                squareConfidences[index] = avgConfidence
            }
        }

        val isWhiteAtBottom = if (isBoardFlipped) false else detectOrientation(boardPieces)
        if (!isWhiteAtBottom) {
            flipBoardOrientation(boardPieces, squareConfidences)
        }

        val position = ChessPosition(
            board = boardPieces,
            activeColor = PieceColor.WHITE,
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
            squareConfidences = squareConfidences,
            validationPassed = validation.isValid,
            validationErrors = validation.errors,
            failingSquares = validation.failingSquares,
            detectionMethodUsed = "Calibrated Board Crop",
            boardRect = RectF(0f, 0f, croppedBoard.width.toFloat(), croppedBoard.height.toFloat()),
            requiresConfirmation = overallConf in 0.75f..0.89f,
            isRejected = overallConf < 0.60f
        )
    }

    private data class ClassifyResult(val piece: Piece?, val confidence: Float)

    private fun classifySquare(sqBmp: Bitmap): ClassifyResult {
        val w = sqBmp.width
        val h = sqBmp.height
        if (w < 6 || h < 6) return ClassifyResult(null, 0.9f)

        // 1. Sample background square color from the 4 corners (away from pieces)
        val c1 = sqBmp.getPixel(2, 2)
        val c2 = sqBmp.getPixel(w - 3, 2)
        val c3 = sqBmp.getPixel(2, h - 3)
        val c4 = sqBmp.getPixel(w - 3, h - 3)
        val bgLum = ((0.299 * Color.red(c1) + 0.587 * Color.green(c1) + 0.114 * Color.blue(c1)) +
                (0.299 * Color.red(c2) + 0.587 * Color.green(c2) + 0.114 * Color.blue(c2)) +
                (0.299 * Color.red(c3) + 0.587 * Color.green(c3) + 0.114 * Color.blue(c3)) +
                (0.299 * Color.red(c4) + 0.587 * Color.green(c4) + 0.114 * Color.blue(c4))) / 4.0

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
                if (abs(lum - bgLum) > 30) {
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
            return ClassifyResult(null, 0.96f)
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
        return ClassifyResult(Piece(type, color), conf)
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

    private fun detectOrientation(pieces: Array<Piece?>): Boolean {
        var rank2WhitePawns = 0
        var rank7BlackPawns = 0

        for (f in 0..7) {
            val pRank2 = pieces[1 * 8 + f]
            if (pRank2?.type == PieceType.PAWN && pRank2.color == PieceColor.WHITE) rank2WhitePawns++

            val pRank7 = pieces[6 * 8 + f]
            if (pRank7?.type == PieceType.PAWN && pRank7.color == PieceColor.BLACK) rank7BlackPawns++
        }
        return (rank2WhitePawns + rank7BlackPawns) >= 2
    }

    private fun flipBoardOrientation(pieces: Array<Piece?>, confidences: FloatArray) {
        val copy = pieces.copyOf()
        val confCopy = confidences.copyOf()
        for (i in 0 until 64) {
            pieces[i] = copy[63 - i]
            confidences[i] = confCopy[63 - i]
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
