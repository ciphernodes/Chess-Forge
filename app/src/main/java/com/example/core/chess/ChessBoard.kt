package com.example.core.chess

import kotlin.math.abs

enum class PieceColor {
    WHITE, BLACK;
    fun opposite() = if (this == WHITE) BLACK else WHITE
}

enum class PieceType(val char: Char, val value: Int) {
    PAWN('p', 100),
    KNIGHT('n', 320),
    BISHOP('b', 330),
    ROOK('r', 500),
    QUEEN('q', 900),
    KING('k', 20000);

    companion object {
        fun fromChar(c: Char): PieceType? = when (c.lowercaseChar()) {
            'p' -> PAWN
            'n' -> KNIGHT
            'b' -> BISHOP
            'r' -> ROOK
            'q' -> QUEEN
            'k' -> KING
            else -> null
        }
    }
}

data class Piece(val type: PieceType, val color: PieceColor) {
    fun toChar(): Char = if (color == PieceColor.WHITE) type.char.uppercaseChar() else type.char
    val unicode: String get() = when (color) {
        PieceColor.WHITE -> when (type) {
            PieceType.PAWN -> "♙"
            PieceType.KNIGHT -> "♘"
            PieceType.BISHOP -> "♗"
            PieceType.ROOK -> "♖"
            PieceType.QUEEN -> "♕"
            PieceType.KING -> "♔"
        }
        PieceColor.BLACK -> when (type) {
            PieceType.PAWN -> "♟"
            PieceType.KNIGHT -> "♞"
            PieceType.BISHOP -> "♝"
            PieceType.ROOK -> "♜"
            PieceType.QUEEN -> "♛"
            PieceType.KING -> "♚"
        }
    }
}

data class Square(val file: Int, val rank: Int) { // file: 0..7 (a..h), rank: 0..7 (1..8)
    init {
        require(file in 0..7 && rank in 0..7) { "Invalid square $file, $rank" }
    }
    val name: String get() = "${('a' + file)}${rank + 1}"

    companion object {
        fun fromName(name: String): Square? {
            if (name.length < 2) return null
            val file = name[0].lowercaseChar() - 'a'
            val rank = name[1] - '1'
            return if (file in 0..7 && rank in 0..7) Square(file, rank) else null
        }
        fun fromIndex(index: Int): Square = Square(index % 8, index / 8)
    }
    fun toIndex(): Int = rank * 8 + file
}

data class Move(
    val from: Square,
    val to: Square,
    val promotion: PieceType? = null,
    val isCapture: Boolean = false,
    val isCastling: Boolean = false,
    val isEnPassant: Boolean = false
) {
    val uci: String get() = "${from.name}${to.name}${promotion?.char?.lowercaseChar() ?: ""}"
}

class ChessPosition(
    val board: Array<Piece?> = arrayOfNulls(64),
    var activeColor: PieceColor = PieceColor.WHITE,
    var castlingRights: String = "KQkq",
    var enPassantSquare: Square? = null,
    var halfmoveClock: Int = 0,
    var fullmoveNumber: Int = 1
) {
    fun copy(): ChessPosition {
        val newBoard = board.copyOf()
        return ChessPosition(
            board = newBoard,
            activeColor = activeColor,
            castlingRights = castlingRights,
            enPassantSquare = enPassantSquare,
            halfmoveClock = halfmoveClock,
            fullmoveNumber = fullmoveNumber
        )
    }

    operator fun get(square: Square): Piece? = board[square.toIndex()]
    operator fun get(file: Int, rank: Int): Piece? = board[rank * 8 + file]
    operator fun set(square: Square, piece: Piece?) {
        board[square.toIndex()] = piece
    }

    fun toFen(): String {
        val sb = StringBuilder()
        for (rank in 7 downTo 0) {
            var empty = 0
            for (file in 0..7) {
                val piece = get(file, rank)
                if (piece == null) {
                    empty++
                } else {
                    if (empty > 0) {
                        sb.append(empty)
                        empty = 0
                    }
                    sb.append(piece.toChar())
                }
            }
            if (empty > 0) sb.append(empty)
            if (rank > 0) sb.append('/')
        }
        sb.append(' ')
        sb.append(if (activeColor == PieceColor.WHITE) 'w' else 'b')
        sb.append(' ')
        sb.append(if (castlingRights.isEmpty()) "-" else castlingRights)
        sb.append(' ')
        sb.append(enPassantSquare?.name ?: "-")
        sb.append(' ')
        sb.append(halfmoveClock)
        sb.append(' ')
        sb.append(fullmoveNumber)
        return sb.toString()
    }

    fun generateLegalMoves(): List<Move> {
        val pseudoMoves = generatePseudoLegalMoves()
        val legalMoves = mutableListOf<Move>()
        for (move in pseudoMoves) {
            val nextPos = copy()
            nextPos.makeMove(move)
            if (!nextPos.isSquareAttacked(nextPos.findKing(activeColor), activeColor.opposite())) {
                legalMoves.add(move)
            }
        }
        return legalMoves
    }

    fun findKing(color: PieceColor): Square {
        for (r in 0..7) {
            for (f in 0..7) {
                val p = get(f, r)
                if (p?.type == PieceType.KING && p.color == color) {
                    return Square(f, r)
                }
            }
        }
        return Square(4, if (color == PieceColor.WHITE) 0 else 7)
    }

    fun isKingInCheck(color: PieceColor = activeColor): Boolean {
        return isSquareAttacked(findKing(color), color.opposite())
    }

    fun isSquareAttacked(square: Square, byColor: PieceColor): Boolean {
        // Pawn attacks
        val pawnDir = if (byColor == PieceColor.WHITE) -1 else 1
        for (df in listOf(-1, 1)) {
            val pf = square.file + df
            val pr = square.rank + pawnDir
            if (pf in 0..7 && pr in 0..7) {
                val p = get(pf, pr)
                if (p?.type == PieceType.PAWN && p.color == byColor) return true
            }
        }
        // Knight attacks
        val knightOffsets = listOf(
            Pair(1, 2), Pair(2, 1), Pair(-1, 2), Pair(-2, 1),
            Pair(1, -2), Pair(2, -1), Pair(-1, -2), Pair(-2, -1)
        )
        for ((df, dr) in knightOffsets) {
            val f = square.file + df
            val r = square.rank + dr
            if (f in 0..7 && r in 0..7) {
                val p = get(f, r)
                if (p?.type == PieceType.KNIGHT && p.color == byColor) return true
            }
        }
        // Sliders (Bishop/Queen & Rook/Queen)
        val diagDirs = listOf(Pair(1, 1), Pair(1, -1), Pair(-1, 1), Pair(-1, -1))
        for ((df, dr) in diagDirs) {
            var f = square.file + df
            var r = square.rank + dr
            while (f in 0..7 && r in 0..7) {
                val p = get(f, r)
                if (p != null) {
                    if (p.color == byColor && (p.type == PieceType.BISHOP || p.type == PieceType.QUEEN)) return true
                    break
                }
                f += df
                r += dr
            }
        }
        val straightDirs = listOf(Pair(1, 0), Pair(-1, 0), Pair(0, 1), Pair(0, -1))
        for ((df, dr) in straightDirs) {
            var f = square.file + df
            var r = square.rank + dr
            while (f in 0..7 && r in 0..7) {
                val p = get(f, r)
                if (p != null) {
                    if (p.color == byColor && (p.type == PieceType.ROOK || p.type == PieceType.QUEEN)) return true
                    break
                }
                f += df
                r += dr
            }
        }
        // King attacks
        for (df in -1..1) {
            for (dr in -1..1) {
                if (df == 0 && dr == 0) continue
                val f = square.file + df
                val r = square.rank + dr
                if (f in 0..7 && r in 0..7) {
                    val p = get(f, r)
                    if (p?.type == PieceType.KING && p.color == byColor) return true
                }
            }
        }
        return false
    }

    private fun generatePseudoLegalMoves(): List<Move> {
        val moves = mutableListOf<Move>()
        for (rank in 0..7) {
            for (file in 0..7) {
                val piece = get(file, rank) ?: continue
                if (piece.color != activeColor) continue
                val sq = Square(file, rank)
                when (piece.type) {
                    PieceType.PAWN -> generatePawnMoves(sq, piece.color, moves)
                    PieceType.KNIGHT -> generateKnightMoves(sq, piece.color, moves)
                    PieceType.BISHOP -> generateSliderMoves(sq, piece.color, listOf(Pair(1,1), Pair(1,-1), Pair(-1,1), Pair(-1,-1)), moves)
                    PieceType.ROOK -> generateSliderMoves(sq, piece.color, listOf(Pair(1,0), Pair(-1,0), Pair(0,1), Pair(0,-1)), moves)
                    PieceType.QUEEN -> {
                        generateSliderMoves(sq, piece.color, listOf(Pair(1,1), Pair(1,-1), Pair(-1,1), Pair(-1,-1)), moves)
                        generateSliderMoves(sq, piece.color, listOf(Pair(1,0), Pair(-1,0), Pair(0,1), Pair(0,-1)), moves)
                    }
                    PieceType.KING -> generateKingMoves(sq, piece.color, moves)
                }
            }
        }
        return moves
    }

    private fun generatePawnMoves(sq: Square, color: PieceColor, moves: MutableList<Move>) {
        val forward = if (color == PieceColor.WHITE) 1 else -1
        val startRank = if (color == PieceColor.WHITE) 1 else 6
        val promRank = if (color == PieceColor.WHITE) 7 else 0

        // Single step
        val nextRank = sq.rank + forward
        if (nextRank in 0..7 && get(sq.file, nextRank) == null) {
            val target = Square(sq.file, nextRank)
            if (nextRank == promRank) {
                listOf(PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT).forEach {
                    moves.add(Move(sq, target, promotion = it))
                }
            } else {
                moves.add(Move(sq, target))
                // Double step
                val doubleRank = sq.rank + 2 * forward
                if (sq.rank == startRank && get(sq.file, doubleRank) == null) {
                    moves.add(Move(sq, Square(sq.file, doubleRank)))
                }
            }
        }
        // Captures
        for (df in listOf(-1, 1)) {
            val targetFile = sq.file + df
            if (targetFile in 0..7 && nextRank in 0..7) {
                val target = Square(targetFile, nextRank)
                val targetPiece = get(target)
                if (targetPiece != null && targetPiece.color != color) {
                    if (nextRank == promRank) {
                        listOf(PieceType.QUEEN, PieceType.ROOK, PieceType.BISHOP, PieceType.KNIGHT).forEach {
                            moves.add(Move(sq, target, promotion = it, isCapture = true))
                        }
                    } else {
                        moves.add(Move(sq, target, isCapture = true))
                    }
                } else if (enPassantSquare == target) {
                    moves.add(Move(sq, target, isCapture = true, isEnPassant = true))
                }
            }
        }
    }

    private fun generateKnightMoves(sq: Square, color: PieceColor, moves: MutableList<Move>) {
        val offsets = listOf(
            Pair(1, 2), Pair(2, 1), Pair(-1, 2), Pair(-2, 1),
            Pair(1, -2), Pair(2, -1), Pair(-1, -2), Pair(-2, -1)
        )
        for ((df, dr) in offsets) {
            val f = sq.file + df
            val r = sq.rank + dr
            if (f in 0..7 && r in 0..7) {
                val target = Square(f, r)
                val targetPiece = get(target)
                if (targetPiece == null) {
                    moves.add(Move(sq, target))
                } else if (targetPiece.color != color) {
                    moves.add(Move(sq, target, isCapture = true))
                }
            }
        }
    }

    private fun generateSliderMoves(sq: Square, color: PieceColor, dirs: List<Pair<Int, Int>>, moves: MutableList<Move>) {
        for ((df, dr) in dirs) {
            var f = sq.file + df
            var r = sq.rank + dr
            while (f in 0..7 && r in 0..7) {
                val target = Square(f, r)
                val targetPiece = get(target)
                if (targetPiece == null) {
                    moves.add(Move(sq, target))
                } else {
                    if (targetPiece.color != color) {
                        moves.add(Move(sq, target, isCapture = true))
                    }
                    break
                }
                f += df
                r += dr
            }
        }
    }

    private fun generateKingMoves(sq: Square, color: PieceColor, moves: MutableList<Move>) {
        for (df in -1..1) {
            for (dr in -1..1) {
                if (df == 0 && dr == 0) continue
                val f = sq.file + df
                val r = sq.rank + dr
                if (f in 0..7 && r in 0..7) {
                    val target = Square(f, r)
                    val targetPiece = get(target)
                    if (targetPiece == null) {
                        moves.add(Move(sq, target))
                    } else if (targetPiece.color != color) {
                        moves.add(Move(sq, target, isCapture = true))
                    }
                }
            }
        }
        // Castling
        val rank = if (color == PieceColor.WHITE) 0 else 7
        if (sq.file == 4 && sq.rank == rank && !isSquareAttacked(sq, color.opposite())) {
            val kingside = if (color == PieceColor.WHITE) 'K' else 'k'
            val queenside = if (color == PieceColor.WHITE) 'Q' else 'q'

            if (castlingRights.contains(kingside)) {
                if (get(5, rank) == null && get(6, rank) == null &&
                    !isSquareAttacked(Square(5, rank), color.opposite()) &&
                    !isSquareAttacked(Square(6, rank), color.opposite()) &&
                    get(7, rank)?.type == PieceType.ROOK
                ) {
                    moves.add(Move(sq, Square(6, rank), isCastling = true))
                }
            }
            if (castlingRights.contains(queenside)) {
                if (get(3, rank) == null && get(2, rank) == null && get(1, rank) == null &&
                    !isSquareAttacked(Square(3, rank), color.opposite()) &&
                    !isSquareAttacked(Square(2, rank), color.opposite()) &&
                    get(0, rank)?.type == PieceType.ROOK
                ) {
                    moves.add(Move(sq, Square(2, rank), isCastling = true))
                }
            }
        }
    }

    fun makeMove(move: Move) {
        val piece = get(move.from) ?: return
        val isPawn = piece.type == PieceType.PAWN
        val isCap = move.isCapture || get(move.to) != null

        // En passant capture removal
        if (isPawn && move.isEnPassant) {
            val capRank = if (activeColor == PieceColor.WHITE) move.to.rank - 1 else move.to.rank + 1
            set(Square(move.to.file, capRank), null)
        }

        // Move piece
        set(move.from, null)
        val finalPiece = if (move.promotion != null) Piece(move.promotion, activeColor) else piece
        set(move.to, finalPiece)

        // Castling rook move
        if (piece.type == PieceType.KING && move.isCastling) {
            val rank = move.from.rank
            if (move.to.file == 6) { // Kingside
                set(Square(7, rank), null)
                set(Square(5, rank), Piece(PieceType.ROOK, activeColor))
            } else if (move.to.file == 2) { // Queenside
                set(Square(0, rank), null)
                set(Square(3, rank), Piece(PieceType.ROOK, activeColor))
            }
        }

        // Castling rights update
        if (piece.type == PieceType.KING) {
            val remove = if (activeColor == PieceColor.WHITE) "KQ" else "kq"
            castlingRights = castlingRights.filter { !remove.contains(it) }
        } else if (piece.type == PieceType.ROOK) {
            if (move.from == Square(0, 0)) castlingRights = castlingRights.replace("Q", "")
            if (move.from == Square(7, 0)) castlingRights = castlingRights.replace("K", "")
            if (move.from == Square(0, 7)) castlingRights = castlingRights.replace("q", "")
            if (move.from == Square(7, 7)) castlingRights = castlingRights.replace("k", "")
        }
        if (move.to == Square(0, 0)) castlingRights = castlingRights.replace("Q", "")
        if (move.to == Square(7, 0)) castlingRights = castlingRights.replace("K", "")
        if (move.to == Square(0, 7)) castlingRights = castlingRights.replace("q", "")
        if (move.to == Square(7, 7)) castlingRights = castlingRights.replace("k", "")

        // En passant square update
        enPassantSquare = if (isPawn && abs(move.to.rank - move.from.rank) == 2) {
            Square(move.from.file, (move.from.rank + move.to.rank) / 2)
        } else {
            null
        }

        if (isPawn || isCap) halfmoveClock = 0 else halfmoveClock++
        if (activeColor == PieceColor.BLACK) fullmoveNumber++
        activeColor = activeColor.opposite()
    }

    fun toSan(move: Move): String {
        val piece = get(move.from) ?: return move.uci
        if (move.isCastling) {
            return if (move.to.file > move.from.file) "O-O" else "O-O-O"
        }
        val sb = StringBuilder()
        if (piece.type != PieceType.PAWN) {
            sb.append(piece.type.char.uppercaseChar())
            // Disambiguation
            val others = generateLegalMoves().filter {
                it.to == move.to && it.from != move.from && get(it.from)?.type == piece.type
            }
            if (others.isNotEmpty()) {
                val sameFile = others.any { it.from.file == move.from.file }
                val sameRank = others.any { it.from.rank == move.from.rank }
                if (!sameFile) {
                    sb.append(('a' + move.from.file))
                } else if (!sameRank) {
                    sb.append(move.from.rank + 1)
                } else {
                    sb.append(('a' + move.from.file))
                    sb.append(move.from.rank + 1)
                }
            }
        } else if (move.isCapture || move.from.file != move.to.file) {
            sb.append(('a' + move.from.file))
        }

        if (move.isCapture || move.isEnPassant || get(move.to) != null) {
            sb.append('x')
        }
        sb.append(move.to.name)
        if (move.promotion != null) {
            sb.append('=').append(move.promotion.char.uppercaseChar())
        }

        // Check or mate check
        val next = copy()
        next.makeMove(move)
        val inCheck = next.isKingInCheck()
        val hasMoves = next.generateLegalMoves().isNotEmpty()
        if (inCheck && !hasMoves) {
            sb.append('#')
        } else if (inCheck) {
            sb.append('+')
        }
        return sb.toString()
    }

    companion object {
        const val STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"

        fun fromFen(fen: String): ChessPosition {
            val parts = fen.trim().split("\\s+".toRegex())
            val position = ChessPosition()
            val ranks = parts[0].split("/")
            for (r in 0..7) {
                val rankStr = ranks[7 - r]
                var file = 0
                for (c in rankStr) {
                    if (c.isDigit()) {
                        file += c.digitToInt()
                    } else {
                        val color = if (c.isUpperCase()) PieceColor.WHITE else PieceColor.BLACK
                        val type = PieceType.fromChar(c) ?: continue
                        position.board[r * 8 + file] = Piece(type, color)
                        file++
                    }
                }
            }
            if (parts.size > 1) {
                position.activeColor = if (parts[1].lowercase() == "b") PieceColor.BLACK else PieceColor.WHITE
            }
            if (parts.size > 2) {
                position.castlingRights = if (parts[2] == "-") "" else parts[2]
            }
            if (parts.size > 3 && parts[3] != "-") {
                position.enPassantSquare = Square.fromName(parts[3])
            }
            if (parts.size > 4) {
                position.halfmoveClock = parts[4].toIntOrNull() ?: 0
            }
            if (parts.size > 5) {
                position.fullmoveNumber = parts[5].toIntOrNull() ?: 1
            }
            return position
        }
    }
}
