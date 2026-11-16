package com.example.chessoverlay.chess

import com.github.bhlangonijr.chesslib.Board
import com.github.bhlangonijr.chesslib.Piece
import com.github.bhlangonijr.chesslib.Side
import com.github.bhlangonijr.chesslib.Square
import com.github.bhlangonijr.chesslib.move.Move
import com.github.bhlangonijr.chesslib.move.MoveList

class ChessStateMachine(
    initialFen: String? = null,
    private var boardFlipped: Boolean = false
) {
    private var board = Board().apply {
        if (!initialFen.isNullOrBlank()) {
            loadFromFen(initialFen)
        }
    }

    private var lastAnalyzedFen: String = ""
    private var candidatePlacement: String? = null
    private var consecutiveObservations: Int = 0

    @Synchronized
    fun setBoardFlipped(flipped: Boolean) {
        if (boardFlipped != flipped) {
            boardFlipped = flipped
            candidatePlacement = null
            consecutiveObservations = 0
            lastAnalyzedFen = ""
        }
    }

    @Synchronized
    fun isBoardFlipped(): Boolean = boardFlipped

    @Synchronized
    fun currentFen(): String = board.getFen()

    @Synchronized
    fun reset(initialFen: String? = null) {
        board = Board().apply {
            if (!initialFen.isNullOrBlank()) {
                loadFromFen(initialFen)
            }
        }
        lastAnalyzedFen = ""
        candidatePlacement = null
        consecutiveObservations = 0
    }

    @Synchronized
    fun observeGrid(grid: Array<Array<Char>>): String? {
        if (grid.size != 8 || grid.any { it.size != 8 }) {
            return null
        }

        val observedPlacement = gridToPlacement(grid, boardFlipped)
        if (!hasSingleKingPerSide(observedPlacement)) {
            candidatePlacement = null
            consecutiveObservations = 0
            return null
        }

        if (observedPlacement == candidatePlacement) {
            consecutiveObservations++
        } else {
            candidatePlacement = observedPlacement
            consecutiveObservations = 1
        }

        if (consecutiveObservations < REQUIRED_STABLE_FRAMES) {
            return null
        }

        val currentPlacement = board.getFen().substringBefore(' ')
        if (observedPlacement == currentPlacement) {
            val fen = board.getFen()
            return if (fen != lastAnalyzedFen) {
                lastAnalyzedFen = fen
                fen
            } else {
                null
            }
        }

        // 1. Try legal-move diffing from current board state (preserves castling, EP, promotion, clocks)
        val matchedMove = findLegalMoveForPlacement(board, observedPlacement)
        if (matchedMove != null) {
            board.doMove(matchedMove)
            val updatedFen = board.getFen()
            if (updatedFen != lastAnalyzedFen) {
                lastAnalyzedFen = updatedFen
                return updatedFen
            }
            return null
        }

        // 2. Fallback: reconstruct FEN from observed placement, infer turn & castling rights, validate via chesslib
        val reconstructed = reconstructAndValidateFen(observedPlacement, preferSide = board.sideToMove)
            ?: return null

        board.loadFromFen(reconstructed)
        val updatedFen = board.getFen()
        return if (updatedFen != lastAnalyzedFen) {
            lastAnalyzedFen = updatedFen
            updatedFen
        } else {
            null
        }
    }

    fun uciToSan(fen: String, uci: String): String {
        val cleanUci = uci.trim().lowercase()
        if (cleanUci.length < 4) return uci
        return try {
            val scratch = Board().apply { loadFromFen(fen) }
            val legalMoves = scratch.legalMoves()
            val matched = legalMoves.firstOrNull { move ->
                move.toString().equals(cleanUci, ignoreCase = true)
            } ?: return uci

            val moveList = MoveList(fen)
            moveList.add(matched)
            moveList.toSanArray().firstOrNull()?.takeIf { it.isNotBlank() } ?: uci
        } catch (_: Throwable) {
            uci
        }
    }

    companion object {
        const val REQUIRED_STABLE_FRAMES = 2

        fun gridToPlacement(grid: Array<Array<Char>>, isFlipped: Boolean): String {
            val sb = StringBuilder(72)
            for (r in 0 until 8) {
                val srcRow = if (isFlipped) 7 - r else r
                var emptyRun = 0
                for (c in 0 until 8) {
                    val srcCol = if (isFlipped) 7 - c else c
                    val ch = grid[srcRow][srcCol]
                    if (ch == '.' || ch == ' ') {
                        emptyRun++
                    } else {
                        if (emptyRun > 0) {
                            sb.append(emptyRun)
                            emptyRun = 0
                        }
                        sb.append(ch)
                    }
                }
                if (emptyRun > 0) {
                    sb.append(emptyRun)
                }
                if (r < 7) sb.append('/')
            }
            return sb.toString()
        }

        fun findLegalMoveForPlacement(board: Board, targetPlacement: String): Move? {
            val legalMoves = board.legalMoves()
            for (move in legalMoves) {
                if (board.doMove(move)) {
                    val candidate = board.getFen().substringBefore(' ')
                    board.undoMove()
                    if (candidate == targetPlacement) {
                        return move
                    }
                }
            }
            return null
        }

        fun hasSingleKingPerSide(placement: String): Boolean {
            var whiteKings = 0
            var blackKings = 0
            val ranks = placement.split('/')
            if (ranks.size != 8) return false
            for ((rankIdx, rank) in ranks.withIndex()) {
                var files = 0
                for (ch in rank) {
                    when (ch) {
                        in '1'..'8' -> files += (ch - '0')
                        'K' -> {
                            whiteKings++
                            files++
                        }
                        'k' -> {
                            blackKings++
                            files++
                        }
                        'P', 'p' -> {
                            if (rankIdx == 0 || rankIdx == 7) return false
                            files++
                        }
                        'N', 'B', 'R', 'Q', 'n', 'b', 'r', 'q' -> files++
                        else -> return false
                    }
                }
                if (files != 8) return false
            }
            return whiteKings == 1 && blackKings == 1
        }

        fun inferCastlingRights(placement: String): String {
            val scratch = Board()
            return try {
                scratch.loadFromFen("$placement w - - 0 1")
                val rights = StringBuilder()
                if (scratch.getPiece(Square.E1) == Piece.WHITE_KING) {
                    if (scratch.getPiece(Square.H1) == Piece.WHITE_ROOK) rights.append('K')
                    if (scratch.getPiece(Square.A1) == Piece.WHITE_ROOK) rights.append('Q')
                }
                if (scratch.getPiece(Square.E8) == Piece.BLACK_KING) {
                    if (scratch.getPiece(Square.H8) == Piece.BLACK_ROOK) rights.append('k')
                    if (scratch.getPiece(Square.A8) == Piece.BLACK_ROOK) rights.append('q')
                }
                if (rights.isEmpty()) "-" else rights.toString()
            } catch (_: Throwable) {
                "-"
            }
        }

        fun reconstructAndValidateFen(placement: String, preferSide: Side = Side.WHITE): String? {
            if (!hasSingleKingPerSide(placement)) return null
            val castling = inferCastlingRights(placement)

            val candidateSides = if (preferSide == Side.WHITE) {
                listOf(Side.BLACK, Side.WHITE)
            } else {
                listOf(Side.WHITE, Side.BLACK)
            }

            // Check which side-to-move yields a legally reachable check status:
            // The side NOT to move must NOT have its king in check.
            for (sideToMove in candidateSides) {
                val sideToken = if (sideToMove == Side.WHITE) "w" else "b"
                val oppToken = if (sideToMove == Side.WHITE) "b" else "w"
                val fen = "$placement $sideToken $castling - 0 1"
                val oppPerspectiveFen = "$placement $oppToken $castling - 0 1"

                try {
                    val checkBoard = Board().apply { loadFromFen(oppPerspectiveFen) }
                    val opponentKingAttacked = checkBoard.isKingAttacked
                    if (opponentKingAttacked) {
                        // Opponent cannot be in check if it's our turn to move
                        continue
                    }
                    val activeBoard = Board().apply { loadFromFen(fen) }
                    if (activeBoard.legalMoves().isNotEmpty()) {
                        return activeBoard.getFen()
                    }
                } catch (_: Throwable) {
                    continue
                }
            }
            return null
        }
    }
}
