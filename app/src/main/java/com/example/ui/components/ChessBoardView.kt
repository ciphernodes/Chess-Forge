package com.example.ui.components

import android.graphics.Paint
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.example.core.chess.ChessPosition
import com.example.core.chess.Move
import com.example.core.chess.PieceColor
import com.example.core.chess.PieceType
import com.example.core.chess.Square
import com.example.data.repository.BoardScheme
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun ChessBoardView(
    position: ChessPosition,
    modifier: Modifier = Modifier,
    scheme: BoardScheme = BoardScheme.FORGE_TEAL,
    isWhiteAtBottom: Boolean = true,
    selectedSquare: Square? = null,
    legalMoves: List<Move> = emptyList(),
    lastMove: Move? = null,
    bestMove: Move? = null,
    threatMove: Move? = null,
    showCoordinates: Boolean = true,
    showLegalDots: Boolean = true,
    showLastMove: Boolean = true,
    bestMoveColor: Color = Color(0xFF00E676),
    isDashedArrow: Boolean = false,
    pulseArrow: Boolean = true,
    onSquareClick: (Square) -> Unit = {}
) {
    val infiniteTransition = rememberInfiniteTransition(label = "arrow_pulse")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.0f,
        animationSpec = infiniteRepeatable(
            animation = tween(1500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )

    val lightSquareColor = remember(scheme) { Color(scheme.lightHex) }
    val darkSquareColor = remember(scheme) { Color(scheme.darkHex) }

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .testTag("chess_board_canvas")
            .semantics {
                contentDescription = "Interactive Chessboard"
            }
    ) {
        Canvas(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(isWhiteAtBottom) {
                    detectTapGestures { offset ->
                        val squareSize = size.width / 8f
                        val file = (offset.x / squareSize).toInt().coerceIn(0, 7)
                        val rankFromTop = (offset.y / squareSize).toInt().coerceIn(0, 7)

                        val boardFile = if (isWhiteAtBottom) file else 7 - file
                        val boardRank = if (isWhiteAtBottom) 7 - rankFromTop else rankFromTop

                        onSquareClick(Square(boardFile, boardRank))
                    }
                }
        ) {
            val sqSize = size.width / 8f

            // 1. Draw 64 Board Squares
            for (screenR in 0..7) {
                for (screenF in 0..7) {
                    val boardF = if (isWhiteAtBottom) screenF else 7 - screenF
                    val boardR = if (isWhiteAtBottom) 7 - screenR else screenR

                    val isLight = (boardF + boardR) % 2 != 0
                    val baseColor = if (isLight) lightSquareColor else darkSquareColor

                    val sqLeft = screenF * sqSize
                    val sqTop = screenR * sqSize

                    drawRect(
                        color = baseColor,
                        topLeft = Offset(sqLeft, sqTop),
                        size = androidx.compose.ui.geometry.Size(sqSize, sqSize)
                    )

                    // Last move highlight
                    if (showLastMove && lastMove != null) {
                        if ((lastMove.from.file == boardF && lastMove.from.rank == boardR) ||
                            (lastMove.to.file == boardF && lastMove.to.rank == boardR)
                        ) {
                            drawRect(
                                color = Color(0x66FFEB3B),
                                topLeft = Offset(sqLeft, sqTop),
                                size = androidx.compose.ui.geometry.Size(sqSize, sqSize)
                            )
                        }
                    }

                    // Check highlight for checked king
                    val piece = position.get(boardF, boardR)
                    if (piece?.type == PieceType.KING && piece.color == position.activeColor && position.isKingInCheck()) {
                        drawRect(
                            color = Color(0x88FF1744),
                            topLeft = Offset(sqLeft, sqTop),
                            size = androidx.compose.ui.geometry.Size(sqSize, sqSize)
                        )
                    }

                    // Selected square highlight
                    if (selectedSquare != null && selectedSquare.file == boardF && selectedSquare.rank == boardR) {
                        drawRect(
                            color = Color(0x770D9488),
                            topLeft = Offset(sqLeft, sqTop),
                            size = androidx.compose.ui.geometry.Size(sqSize, sqSize)
                        )
                    }

                    // Legal move indicator dots
                    if (showLegalDots) {
                        val isLegalDest = legalMoves.any { it.to.file == boardF && it.to.rank == boardR }
                        if (isLegalDest) {
                            val center = Offset(sqLeft + sqSize / 2f, sqTop + sqSize / 2f)
                            if (piece == null) {
                                drawCircle(
                                    color = Color(0x55000000),
                                    radius = sqSize * 0.16f,
                                    center = center
                                )
                            } else {
                                drawCircle(
                                    color = Color(0x66F97316),
                                    radius = sqSize * 0.40f,
                                    center = center,
                                    style = Stroke(width = sqSize * 0.08f)
                                )
                            }
                        }
                    }

                    // Draw Coordinates (a-h, 1-8)
                    if (showCoordinates) {
                        val paint = Paint().apply {
                            color = if (isLight) scheme.darkHex.toInt() else scheme.lightHex.toInt()
                            textSize = sqSize * 0.22f
                            isAntiAlias = true
                            typeface = android.graphics.Typeface.DEFAULT_BOLD
                        }
                        if (screenR == 7) {
                            val fileChar = ('a' + boardF).toString()
                            drawContext.canvas.nativeCanvas.drawText(
                                fileChar,
                                sqLeft + sqSize * 0.08f,
                                sqTop + sqSize * 0.90f,
                                paint
                            )
                        }
                        if (screenF == 0) {
                            val rankChar = (boardR + 1).toString()
                            drawContext.canvas.nativeCanvas.drawText(
                                rankChar,
                                sqLeft + sqSize * 0.08f,
                                sqTop + sqSize * 0.28f,
                                paint
                            )
                        }
                    }

                    // Draw Chess Piece glyph
                    if (piece != null) {
                        val piecePaint = Paint().apply {
                            textSize = sqSize * 0.78f
                            textAlign = Paint.Align.CENTER
                            isAntiAlias = true
                            isSubpixelText = true
                            color = if (piece.color == PieceColor.WHITE) android.graphics.Color.WHITE else android.graphics.Color.BLACK
                            if (piece.color == PieceColor.WHITE) {
                                setShadowLayer(4f, 0f, 2f, android.graphics.Color.BLACK)
                            } else {
                                setShadowLayer(4f, 0f, 2f, android.graphics.Color.WHITE)
                            }
                        }
                        val baseline = sqTop + sqSize * 0.78f
                        drawContext.canvas.nativeCanvas.drawText(
                            piece.unicode,
                            sqLeft + sqSize / 2f,
                            baseline,
                            piecePaint
                        )
                    }
                }
            }

            // Draw Threat Arrow (opponent's threat if enabled)
            if (threatMove != null) {
                drawChessArrow(
                    move = threatMove,
                    isWhiteAtBottom = isWhiteAtBottom,
                    sqSize = sqSize,
                    color = Color(0xFFFF5252).copy(alpha = 0.65f),
                    isDashed = true
                )
            }

            // Draw Best Move Arrow
            if (bestMove != null) {
                val arrowAlpha = if (pulseArrow) pulseAlpha else 0.85f
                drawChessArrow(
                    move = bestMove,
                    isWhiteAtBottom = isWhiteAtBottom,
                    sqSize = sqSize,
                    color = bestMoveColor.copy(alpha = arrowAlpha),
                    isDashed = isDashedArrow
                )
            }
        }
    }
}

private fun DrawScope.drawChessArrow(
    move: Move,
    isWhiteAtBottom: Boolean,
    sqSize: Float,
    color: Color,
    isDashed: Boolean
) {
    val fromScreenF = if (isWhiteAtBottom) move.from.file else 7 - move.from.file
    val fromScreenR = if (isWhiteAtBottom) 7 - move.from.rank else move.from.rank

    val toScreenF = if (isWhiteAtBottom) move.to.file else 7 - move.to.file
    val toScreenR = if (isWhiteAtBottom) 7 - move.to.rank else move.to.rank

    val start = Offset(fromScreenF * sqSize + sqSize / 2f, fromScreenR * sqSize + sqSize / 2f)
    val end = Offset(toScreenF * sqSize + sqSize / 2f, toScreenR * sqSize + sqSize / 2f)

    val dx = end.x - start.x
    val dy = end.y - start.y
    val angle = atan2(dy, dx)

    val shaftWidth = sqSize * 0.12f
    val headSize = sqSize * 0.38f

    // Shorten end slightly so arrowhead centers on destination square
    val target = Offset(end.x - (cos(angle) * headSize * 0.4f), end.y - (sin(angle) * headSize * 0.4f))

    val pathEffect = if (isDashed) PathEffect.dashPathEffect(floatArrayOf(sqSize * 0.15f, sqSize * 0.10f)) else null

    // 1. Black outline shadow
    drawLine(
        color = Color(0x55000000),
        start = start,
        end = target,
        strokeWidth = shaftWidth + 6f,
        cap = StrokeCap.Round
    )

    // 2. Main shaft
    drawLine(
        color = color,
        start = start,
        end = target,
        strokeWidth = shaftWidth,
        cap = StrokeCap.Round,
        pathEffect = pathEffect
    )

    // 3. Arrowhead
    val headPath = Path().apply {
        val tip = end
        val left = Offset(
            tip.x - headSize * cos(angle - 0.45f),
            tip.y - headSize * sin(angle - 0.45f)
        )
        val right = Offset(
            tip.x - headSize * cos(angle + 0.45f),
            tip.y - headSize * sin(angle + 0.45f)
        )
        moveTo(tip.x, tip.y)
        lineTo(left.x, left.y)
        lineTo(right.x, right.y)
        close()
    }
    drawPath(path = headPath, color = color)
}
