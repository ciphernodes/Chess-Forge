package com.example.core.chess

data class ReconstructedMove(
    val moveNumber: Int,
    val whiteMove: String?,
    val blackMove: String?,
    val whiteEval: String? = null,
    val blackEval: String? = null,
    val whiteClassification: MoveClassification? = null,
    val blackClassification: MoveClassification? = null,
    val isCriticalMoment: Boolean = false,
    val timestamp: Long = System.currentTimeMillis()
)

data class GameState(
    var currentPosition: ChessPosition = ChessPosition.fromFen(ChessPosition.STARTING_FEN),
    val moveHistory: MutableList<Move> = mutableListOf(),
    val sanHistory: MutableList<String> = mutableListOf(),
    val fenHistory: MutableList<String> = mutableListOf(ChessPosition.STARTING_FEN),
    var isWhiteAtBottom: Boolean = true,
    var opening: OpeningInfo = ChessOpeningBook.identifyOpening(emptyList()),
    var phase: GamePhase = GamePhase.OPENING,
    var isMidGameStart: Boolean = false,
    var initialFen: String = ChessPosition.STARTING_FEN,
    val capturedByWhite: MutableList<PieceType> = mutableListOf(),
    val capturedByBlack: MutableList<PieceType> = mutableListOf()
) {
    val totalMoves: Int get() = sanHistory.size

    fun exportPgn(
        whiteName: String = "Chess Forge Player",
        blackName: String = "Opponent",
        accuracyWhite: Float? = null,
        accuracyBlack: Float? = null
    ): String {
        val sb = StringBuilder()
        sb.append("[Event \"Chess Forge Analysis\"]\n")
        sb.append("[Site \"Chess Forge App\"]\n")
        sb.append("[Date \"${java.text.SimpleDateFormat("yyyy.MM.dd", java.util.Locale.US).format(java.util.Date())}\"]\n")
        sb.append("[White \"$whiteName\"]\n")
        sb.append("[Black \"$blackName\"]\n")
        sb.append("[Result \"*\"]\n")
        sb.append("[ECO \"${opening.eco}\"]\n")
        sb.append("[Opening \"${opening.name}\"]\n")
        if (accuracyWhite != null) {
            sb.append("[WhiteAccuracy \"%.1f%%\"]\n".format(accuracyWhite))
        }
        if (accuracyBlack != null) {
            sb.append("[BlackAccuracy \"%.1f%%\"]\n".format(accuracyBlack))
        }
        if (isMidGameStart) {
            sb.append("[FEN \"$initialFen\"]\n")
            sb.append("[SetUp \"1\"]\n")
            sb.append("[Comment \"Reconstruction started mid-game\"]\n")
        }
        sb.append("\n")

        for (i in sanHistory.indices step 2) {
            val moveNum = (i / 2) + 1
            sb.append("$moveNum. ${sanHistory[i]} ")
            if (i + 1 < sanHistory.size) {
                sb.append("${sanHistory[i + 1]} ")
            }
        }
        sb.append("*\n")
        return sb.toString()
    }
}

class GameReconstructor {
    var gameState: GameState = GameState()
        private set

    fun reset(startingFen: String = ChessPosition.STARTING_FEN, isMidGame: Boolean = false) {
        val pos = ChessPosition.fromFen(startingFen)
        gameState = GameState(
            currentPosition = pos,
            isMidGameStart = isMidGame,
            initialFen = startingFen,
            fenHistory = mutableListOf(startingFen)
        )
    }

    /**
     * Attempts to find a legal move that transitions from previousPosition to newPosition.
     */
    fun detectMoveFromPosition(newPosition: ChessPosition): Move? {
        val currentPos = gameState.currentPosition
        val legalMoves = currentPos.generateLegalMoves()

        for (move in legalMoves) {
            val candidate = currentPos.copy()
            candidate.makeMove(move)
            if (boardsMatch(candidate, newPosition)) {
                return move
            }
        }
        return null
    }

    fun applyDetectedMove(move: Move, newPosition: ChessPosition) {
        val currentPos = gameState.currentPosition
        val san = currentPos.toSan(move)
        val pieceTo = currentPos.get(move.to)
        if (pieceTo != null) {
            if (currentPos.activeColor == PieceColor.WHITE) {
                gameState.capturedByWhite.add(pieceTo.type)
            } else {
                gameState.capturedByBlack.add(pieceTo.type)
            }
        }

        gameState.moveHistory.add(move)
        gameState.sanHistory.add(san)
        gameState.currentPosition = newPosition
        gameState.fenHistory.add(newPosition.toFen())
        gameState.opening = ChessOpeningBook.identifyOpening(gameState.sanHistory)
    }

    private fun boardsMatch(posA: ChessPosition, posB: ChessPosition): Boolean {
        for (i in 0 until 64) {
            val a = posA.board[i]
            val b = posB.board[i]
            if (a?.type != b?.type || a?.color != b?.color) {
                return false
            }
        }
        return true
    }
}
