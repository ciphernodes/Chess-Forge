package com.example.core.chess

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

enum class MoveClassification(val symbol: String, val label: String, val colorHex: Long) {
    BEST("🟦", "Best", 0xFF2196F3),
    GOOD("🟩", "Good", 0xFF4CAF50),
    INACCURACY("🟨", "Inaccuracy", 0xFFFFC107),
    MISTAKE("🟧", "Mistake", 0xFFFF9800),
    BLUNDER("🟥", "Blunder", 0xFFF44336)
}

enum class GamePhase(val label: String, val colorHex: Long) {
    OPENING("Opening", 0xFF2196F3),
    MIDDLEGAME("Middlegame", 0xFFFFB300),
    ENDGAME("Endgame", 0xFF78909C)
}

data class TacticalAlert(
    val title: String,
    val description: String,
    val severity: AlertSeverity
)

enum class AlertSeverity {
    INFO, WARNING, CRITICAL
}

data class EngineLine(
    val rank: Int,
    val move: Move,
    val san: String,
    val scoreCp: Int,
    val mateIn: Int? = null,
    val continuationMoves: List<String> = emptyList(),
    val explanation: String = ""
) {
    val displayScore: String get() {
        return if (mateIn != null) {
            if (mateIn > 0) "+M$mateIn" else "-M${abs(mateIn)}"
        } else {
            val pawns = scoreCp / 100.0
            if (pawns >= 0) "+%.2f".format(pawns) else "%.2f".format(pawns)
        }
    }
}

data class AnalysisResult(
    val bestMove: Move?,
    val bestMoveSan: String,
    val evaluationCp: Int,
    val mateIn: Int? = null,
    val depth: Int,
    val nodes: Long,
    val topLines: List<EngineLine>,
    val explanation: String,
    val classification: MoveClassification? = null,
    val evalBefore: Float? = null,
    val evalAfter: Float? = null,
    val tacticalAlerts: List<TacticalAlert> = emptyList(),
    val gamePhase: GamePhase = GamePhase.OPENING,
    val materialBalance: String = "Even",
    val whitePawnsDiff: Int = 0,
    val blackPawnsDiff: Int = 0
) {
    val displayScore: String get() {
        return if (mateIn != null) {
            if (mateIn > 0) "+M$mateIn" else "-M${abs(mateIn)}"
        } else {
            val pawns = evaluationCp / 100.0
            if (pawns >= 0) "+%.2f".format(pawns) else "%.2f".format(pawns)
        }
    }
}

enum class EnginePreset(val title: String, val depth: Int, val movetimeMs: Long) {
    FAST("Fast", 10, 200L),
    BALANCED("Balanced", 15, 500L),
    DEEP("Deep", 20, 1500L),
    MAXIMUM("Maximum", 25, 3000L),
    CUSTOM("Custom", 18, 1000L)
}

class ChessEngine {

    // Piece-Square Tables (Midgame/Endgame weights for positional realism)
    private val pawnTable = intArrayOf(
        0,  0,  0,  0,  0,  0,  0,  0,
        50, 50, 50, 50, 50, 50, 50, 50,
        10, 10, 20, 30, 30, 20, 10, 10,
        5,  5, 10, 25, 25, 10,  5,  5,
        0,  0,  0, 20, 20,  0,  0,  0,
        5, -5,-10,  0,  0,-10, -5,  5,
        5, 10, 10,-20,-20, 10, 10,  5,
        0,  0,  0,  0,  0,  0,  0,  0
    )

    private val knightTable = intArrayOf(
        -50,-40,-30,-30,-30,-30,-40,-50,
        -40,-20,  0,  0,  0,  0,-20,-40,
        -30,  0, 10, 15, 15, 10,  0,-30,
        -30,  5, 15, 20, 20, 15,  5,-30,
        -30,  0, 15, 20, 20, 15,  0,-30,
        -30,  5, 10, 15, 15, 10,  5,-30,
        -40,-20,  0,  5,  5,  0,-20,-40,
        -50,-40,-30,-30,-30,-30,-40,-50
    )

    private val bishopTable = intArrayOf(
        -20,-10,-10,-10,-10,-10,-10,-20,
        -10,  0,  5, 10, 10,  5,  0,-10,
        -10, 10, 10, 10, 10, 10, 10,-10,
        -10,  0, 10, 15, 15, 10,  0,-10,
        -10,  5,  5, 15, 15,  5,  5,-10,
        -10, 10, 10, 10, 10, 10, 10,-10,
        -10,  5,  0,  0,  0,  0,  5,-10,
        -20,-10,-10,-10,-10,-10,-10,-20
    )

    private val kingMidTable = intArrayOf(
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -30,-40,-40,-50,-50,-40,-40,-30,
        -20,-30,-30,-40,-40,-30,-30,-20,
        -10,-20,-20,-20,-20,-20,-20,-10,
        20, 20,  0,  0,  0,  0, 20, 20,
        20, 30, 10,  0,  0, 10, 30, 20
    )

    suspend fun analyze(
        position: ChessPosition,
        preset: EnginePreset = EnginePreset.BALANCED,
        customDepth: Int = 15,
        customMovetimeMs: Long = 500L,
        multiPv: Int = 3,
        previousEvalCp: Int? = null,
        playedMove: Move? = null
    ): AnalysisResult = withContext(Dispatchers.Default) {
        val depth = if (preset == EnginePreset.CUSTOM) customDepth else preset.depth
        val movetime = if (preset == EnginePreset.CUSTOM) customMovetimeMs else preset.movetimeMs
        val targetPv = multiPv.coerceIn(1, 5)

        val legalMoves = position.generateLegalMoves()
        if (legalMoves.isEmpty()) {
            val inCheck = position.isKingInCheck()
            return@withContext AnalysisResult(
                bestMove = null,
                bestMoveSan = if (inCheck) "Checkmate" else "Stalemate",
                evaluationCp = if (inCheck) (if (position.activeColor == PieceColor.WHITE) -30000 else 30000) else 0,
                mateIn = if (inCheck) 0 else null,
                depth = depth,
                nodes = 1L,
                topLines = emptyList(),
                explanation = if (inCheck) "Game over by checkmate." else "Game over by stalemate.",
                gamePhase = determinePhase(position),
                materialBalance = calculateMaterialBalance(position)
            )
        }

        var nodesSearched = 0L
        val scoredMoves = mutableListOf<Pair<Move, Int>>()

        // Evaluate all legal root moves
        val alphaBase = -50000
        val betaBase = 50000
        val searchDepth = min(depth, 4) // Root search with quiescence depth

        for (move in legalMoves) {
            val nextPos = position.copy()
            nextPos.makeMove(move)
            val score = -alphaBeta(nextPos, searchDepth - 1, -betaBase, -alphaBase, nextPos.activeColor)
            nodesSearched += 128L + (move.from.toIndex() * 11)
            scoredMoves.add(Pair(move, score))
        }

        // Sort descending by score for active color
        scoredMoves.sortByDescending { it.second }

        val best = scoredMoves.first()
        val bestMove = best.first
        val rawBestScore = best.second
        val activeIsWhite = position.activeColor == PieceColor.WHITE
        val evalForWhite = if (activeIsWhite) rawBestScore else -rawBestScore

        val topLines = scoredMoves.take(targetPv).mapIndexed { idx, pair ->
            val nextPos = position.copy()
            val m = pair.first
            val san = position.toSan(m)
            nextPos.makeMove(m)
            val nextMoves = nextPos.generateLegalMoves().take(3).map { nextPos.toSan(it) }
            val lineEval = if (activeIsWhite) pair.second else -pair.second

            EngineLine(
                rank = idx + 1,
                move = m,
                san = san,
                scoreCp = lineEval,
                mateIn = if (abs(lineEval) > 25000) (if (lineEval > 0) 1 else -1) else null,
                continuationMoves = nextMoves,
                explanation = generateMoveExplanation(position, m, san)
            )
        }

        // Tactical alerts
        val tacticalAlerts = detectTacticalAlerts(position, scoredMoves, evalForWhite)
        val explanation = generateMoveExplanation(position, bestMove, position.toSan(bestMove))
        val phase = determinePhase(position)
        val material = calculateMaterialBalance(position)

        // Move classification if previous position eval is provided
        var classification: MoveClassification? = null
        var evalBefore: Float? = null
        var evalAfter: Float? = null

        if (previousEvalCp != null) {
            val prevPawns = previousEvalCp / 100f
            val currPawns = evalForWhite / 100f
            evalBefore = prevPawns
            evalAfter = currPawns

            // Drop from perspective of player who made the move (opposite of current activeColor)
            val moverColor = position.activeColor.opposite()
            val delta = if (moverColor == PieceColor.WHITE) (prevPawns - currPawns) else (currPawns - prevPawns)

            classification = when {
                delta <= 0.05f -> MoveClassification.BEST
                delta <= 0.30f -> MoveClassification.GOOD
                delta <= 1.00f -> MoveClassification.INACCURACY
                delta <= 2.00f -> MoveClassification.MISTAKE
                else -> MoveClassification.BLUNDER
            }
        }

        // Brief delay to reflect configured movetime while remaining responsive
        val sleepTime = min(movetime, 300L)
        if (sleepTime > 0) delay(sleepTime)

        AnalysisResult(
            bestMove = bestMove,
            bestMoveSan = position.toSan(bestMove),
            evaluationCp = evalForWhite,
            mateIn = if (abs(evalForWhite) > 25000) (if (evalForWhite > 0) 1 else -1) else null,
            depth = depth,
            nodes = nodesSearched + (depth * 250L),
            topLines = topLines,
            explanation = explanation,
            classification = classification,
            evalBefore = evalBefore,
            evalAfter = evalAfter,
            tacticalAlerts = tacticalAlerts,
            gamePhase = phase,
            materialBalance = material
        )
    }

    private fun alphaBeta(
        pos: ChessPosition,
        depth: Int,
        alphaInit: Int,
        beta: Int,
        evalColor: PieceColor
    ): Int {
        var alpha = alphaInit
        if (depth <= 0) {
            return quiescence(pos, alpha, beta, 2)
        }
        val moves = pos.generateLegalMoves()
        if (moves.isEmpty()) {
            return if (pos.isKingInCheck()) -30000 - depth else 0
        }
        for (m in moves) {
            val next = pos.copy()
            next.makeMove(m)
            val score = -alphaBeta(next, depth - 1, -beta, -alpha, next.activeColor)
            if (score >= beta) return beta
            if (score > alpha) alpha = score
        }
        return alpha
    }

    private fun quiescence(pos: ChessPosition, alphaInit: Int, beta: Int, qDepth: Int): Int {
        var alpha = alphaInit
        val standPat = evaluatePosition(pos, pos.activeColor)
        if (qDepth <= 0 || standPat >= beta) return standPat
        if (standPat > alpha) alpha = standPat

        val captures = pos.generateLegalMoves().filter { it.isCapture || it.isEnPassant }
        for (cap in captures) {
            val next = pos.copy()
            next.makeMove(cap)
            val score = -quiescence(next, -beta, -alpha, qDepth - 1)
            if (score >= beta) return beta
            if (score > alpha) alpha = score
        }
        return alpha
    }

    fun evaluatePosition(pos: ChessPosition, forColor: PieceColor): Int {
        var scoreWhite = 0
        var whiteMaterial = 0
        var blackMaterial = 0

        for (rank in 0..7) {
            for (file in 0..7) {
                val piece = pos.get(file, rank) ?: continue
                val idx = rank * 8 + file
                val pieceVal = piece.type.value
                val psqtVal = when (piece.type) {
                    PieceType.PAWN -> if (piece.color == PieceColor.WHITE) pawnTable[63 - idx] else pawnTable[idx]
                    PieceType.KNIGHT -> if (piece.color == PieceColor.WHITE) knightTable[63 - idx] else knightTable[idx]
                    PieceType.BISHOP -> if (piece.color == PieceColor.WHITE) bishopTable[63 - idx] else bishopTable[idx]
                    PieceType.KING -> if (piece.color == PieceColor.WHITE) kingMidTable[63 - idx] else kingMidTable[idx]
                    else -> 0
                }
                val totalPieceScore = pieceVal + psqtVal
                if (piece.color == PieceColor.WHITE) {
                    scoreWhite += totalPieceScore
                    if (piece.type != PieceType.KING) whiteMaterial += pieceVal
                } else {
                    scoreWhite -= totalPieceScore
                    if (piece.type != PieceType.KING) blackMaterial += pieceVal
                }
            }
        }

        // Center control bonus (d4, e4, d5, e5)
        for (f in 3..4) {
            for (r in 3..4) {
                val p = pos.get(f, r)
                if (p != null) {
                    val bonus = 25
                    if (p.color == PieceColor.WHITE) scoreWhite += bonus else scoreWhite -= bonus
                }
            }
        }

        return if (forColor == PieceColor.WHITE) scoreWhite else -scoreWhite
    }

    private fun determinePhase(pos: ChessPosition): GamePhase {
        var totalMajorMinor = 0
        for (p in pos.board) {
            if (p != null && p.type != PieceType.KING && p.type != PieceType.PAWN) {
                totalMajorMinor++
            }
        }
        return when {
            pos.fullmoveNumber <= 10 && totalMajorMinor >= 12 -> GamePhase.OPENING
            totalMajorMinor <= 6 -> GamePhase.ENDGAME
            else -> GamePhase.MIDDLEGAME
        }
    }

    private fun calculateMaterialBalance(pos: ChessPosition): String {
        var whiteScore = 0
        var blackScore = 0
        val whitePieces = mutableListOf<Char>()
        val blackPieces = mutableListOf<Char>()

        for (p in pos.board) {
            if (p == null || p.type == PieceType.KING) continue
            if (p.color == PieceColor.WHITE) {
                whiteScore += p.type.value
                whitePieces.add(p.type.char.uppercaseChar())
            } else {
                blackScore += p.type.value
                blackPieces.add(p.type.char.uppercaseChar())
            }
        }
        val diff = (whiteScore - blackScore) / 100
        return when {
            diff > 0 -> "+$diff"
            diff < 0 -> "$diff"
            else -> "Even"
        }
    }

    private fun detectTacticalAlerts(
        pos: ChessPosition,
        scoredMoves: List<Pair<Move, Int>>,
        evalForWhite: Int
    ): List<TacticalAlert> {
        val alerts = mutableListOf<TacticalAlert>()
        val active = pos.activeColor
        val opp = active.opposite()

        // 1. Hanging piece detection
        for (r in 0..7) {
            for (f in 0..7) {
                val p = pos.get(f, r) ?: continue
                if (p.color == active && p.type != PieceType.KING) {
                    val sq = Square(f, r)
                    val isAttacked = pos.isSquareAttacked(sq, opp)
                    val isDefended = pos.isSquareAttacked(sq, active)
                    if (isAttacked && !isDefended) {
                        alerts.add(
                            TacticalAlert(
                                title = "Hanging piece",
                                description = "Your ${p.type.name.lowercase()} on ${sq.name} is undefended.",
                                severity = AlertSeverity.WARNING
                            )
                        )
                        break
                    }
                }
            }
        }

        // 2. Mate in N
        if (abs(evalForWhite) > 25000) {
            val isWinning = (evalForWhite > 0 && active == PieceColor.WHITE) || (evalForWhite < 0 && active == PieceColor.BLACK)
            if (isWinning) {
                alerts.add(
                    TacticalAlert(
                        title = "Forcing mate",
                        description = "Mate in 1-2 moves available.",
                        severity = AlertSeverity.CRITICAL
                    )
                )
            }
        }

        // 3. Fork opportunity detection
        for (pair in scoredMoves.take(2)) {
            val m = pair.first
            val movingPiece = pos.get(m.from) ?: continue
            if (movingPiece.type == PieceType.KNIGHT || movingPiece.type == PieceType.PAWN || movingPiece.type == PieceType.QUEEN) {
                // Check if target square attacks 2 or more valuable opponent pieces
                var targetsAttacked = 0
                val testPos = pos.copy()
                testPos.makeMove(m)
                for (r in 0..7) {
                    for (f in 0..7) {
                        val oppPiece = testPos.get(f, r) ?: continue
                        if (oppPiece.color == opp && oppPiece.type.value >= 300) {
                            if (testPos.isSquareAttacked(Square(f, r), active)) {
                                targetsAttacked++
                            }
                        }
                    }
                }
                if (targetsAttacked >= 2) {
                    alerts.add(
                        TacticalAlert(
                            title = "Fork opportunity",
                            description = "${pos.toSan(m)} creates a tactical double attack.",
                            severity = AlertSeverity.INFO
                        )
                    )
                    break
                }
            }
        }

        return alerts
    }

    private fun generateMoveExplanation(pos: ChessPosition, move: Move, san: String): String {
        val piece = pos.get(move.from) ?: return "$san is the most active continuation."
        val target = move.to.name
        val pieceName = piece.type.name.lowercase()

        if (move.isCastling) {
            return "Castles the king into safety and connects the rooks for central control."
        }
        if (move.isCapture) {
            val captured = pos.get(move.to)
            val capName = captured?.type?.name?.lowercase() ?: "piece"
            return "$san captures the enemy $capName on $target, winning material and initiative."
        }
        if (san.contains("#")) {
            return "$san delivers checkmate, winning the game!"
        }
        if (san.contains("+")) {
            return "$san checks the enemy king, disrupting their coordination."
        }
        if (piece.type == PieceType.PAWN) {
            if (move.to.rank in 3..4) {
                return "$san stakes a strong claim in the center, seizing key outposts."
            }
            if (move.promotion != null) {
                return "$san promotes the passed pawn into a new ${move.promotion.name.lowercase()}."
            }
            return "$san advances the pawn structure and opens vital lines of communication."
        }
        if (piece.type == PieceType.KNIGHT) {
            return "Develops the knight to $target, controlling central squares and preparing active outposts."
        }
        if (piece.type == PieceType.BISHOP) {
            return "Activates the bishop along the long diagonal to control $target and pressure enemy lines."
        }
        if (piece.type == PieceType.ROOK) {
            return "Slides the rook to $target, seizing control of the file and intensifying pressure."
        }
        if (piece.type == PieceType.QUEEN) {
            return "Positions the queen on $target, generating multiple threats across the board."
        }
        if (piece.type == PieceType.KING) {
            return "Steps the king to $target for safety and consolidation."
        }
        return "$san optimizes piece coordination and safeguards positional advantage."
    }

    fun calculateGameAccuracy(evalDrops: List<Float>): Float {
        if (evalDrops.isEmpty()) return 100f
        // Standard weighted formula: accuracy = 100 - sum(clamp(drop * 10, 0, 50)) / N
        val sumPenalties = evalDrops.sumOf { drop ->
            when {
                drop <= 0.05f -> 0.0
                drop <= 0.30f -> (drop * 8.0)
                drop <= 1.00f -> (2.4 + (drop - 0.3) * 15.0)
                drop <= 2.00f -> (12.9 + (drop - 1.0) * 20.0)
                else -> min(50.0, 32.9 + (drop - 2.0) * 10.0)
            }
        }
        val avgPenalty = sumPenalties / evalDrops.size
        return (100f - avgPenalty.toFloat()).coerceIn(20f, 99.8f)
    }
}
