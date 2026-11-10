package com.example.ui.screens.practice

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.AnalysisResult
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessOpeningBook
import com.example.core.chess.ChessPosition
import com.example.core.chess.EngineLine
import com.example.core.chess.EnginePool
import com.example.core.chess.GamePhase
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.core.chess.MoveClassification
import com.example.core.chess.OpeningInfo
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.Square
import com.example.data.db.AnalysisEntity
import com.example.data.db.GameRecordEntity
import com.example.data.repository.ChessRepository
import com.example.data.repository.SettingsRepository
import com.example.ui.components.MoveDisplayItem
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlin.math.abs

data class PracticeUiState(
    val position: ChessPosition = ChessPosition.fromFen(ChessPosition.STARTING_FEN),
    val isWhiteAtBottom: Boolean = true,
    val selectedSquare: Square? = null,
    val legalMoves: List<Move> = emptyList(),
    val lastMove: Move? = null,
    val bestMove: Move? = null,
    val bestMoveColor: Long = 0xFF00E676,
    val isDashedArrow: Boolean = false,
    val threatMove: Move? = null,
    val analysisResult: AnalysisResult? = null,
    val moves: List<MoveDisplayItem> = emptyList(),
    val currentPlyIndex: Int = -1,
    val opening: OpeningInfo = ChessOpeningBook.identifyOpening(emptyList()),
    val gamePhase: GamePhase = GamePhase.OPENING,
    val materialBalance: String = "Even",
    val accuracy: Float? = null,
    val criticalMoments: List<CriticalMomentItem> = emptyList(),
    val isVariationActive: Boolean = false,
    val activeVariationTitle: String? = null,
    val statusMessage: String? = null,
    val isAnalyzing: Boolean = false
)

data class CriticalMomentItem(
    val plyIndex: Int,
    val moveNumber: Int,
    val playedSan: String,
    val bestSan: String,
    val swingPawns: Float,
    val positionFen: String
)

class PracticeViewModel(application: Application) : AndroidViewModel(application) {

    private val chessRepository = ChessRepository(application)
    private val settingsRepository = SettingsRepository(application)
    private val enginePool = EnginePool()

    private val _uiState = MutableStateFlow(PracticeUiState())
    val uiState: StateFlow<PracticeUiState> = _uiState.asStateFlow()

    private val positionHistory = mutableListOf<ChessPosition>()
    private val evalHistory = mutableListOf<Int>()
    private val executedMoves = mutableListOf<Move>()
    private var mainLinePositions = mutableListOf<ChessPosition>()

    init {
        loadStartingPosition()
    }

    private fun loadStartingPosition() {
        val start = ChessPosition.fromFen(ChessPosition.STARTING_FEN)
        positionHistory.clear()
        evalHistory.clear()
        executedMoves.clear()
        positionHistory.add(start)

        _uiState.value = PracticeUiState(
            position = start,
            moves = emptyList(),
            currentPlyIndex = -1,
            opening = ChessOpeningBook.identifyOpening(emptyList()),
            gamePhase = GamePhase.OPENING
        )
        analyzeCurrentPosition()
    }

    fun onSquareClicked(square: Square) {
        val state = _uiState.value
        val currentPos = state.position

        // 1. If square with active color piece is tapped -> select it and compute legal moves
        val piece = currentPos[square]
        if (piece != null && piece.color == currentPos.activeColor) {
            val legal = currentPos.generateLegalMoves().filter { it.from == square }
            _uiState.value = state.copy(
                selectedSquare = square,
                legalMoves = legal
            )
            return
        }

        // 2. If a square is already selected, check if this is a legal destination
        val selected = state.selectedSquare
        if (selected != null) {
            val matchingMove = state.legalMoves.firstOrNull { it.to == square }
            if (matchingMove != null) {
                makePlayerMove(matchingMove)
                return
            }
        }

        // 3. Clear selection
        _uiState.value = state.copy(selectedSquare = null, legalMoves = emptyList())
    }

    private fun makePlayerMove(move: Move) {
        val currentPos = _uiState.value.position
        val nextPos = currentPos.copy()
        val san = currentPos.toSan(move)
        nextPos.makeMove(move)

        val newPly = executedMoves.size
        executedMoves.add(move)
        positionHistory.add(nextPos)

        val isWhite = currentPos.activeColor == PieceColor.WHITE
        val moveNum = (newPly / 2) + 1

        val prevEval = evalHistory.lastOrNull() ?: 20

        val newDisplayItem = MoveDisplayItem(
            plyIndex = newPly,
            moveNumber = moveNum,
            san = san,
            isWhite = isWhite
        )
        val updatedMoves = _uiState.value.moves + newDisplayItem

        _uiState.value = _uiState.value.copy(
            position = nextPos,
            selectedSquare = null,
            legalMoves = emptyList(),
            lastMove = move,
            currentPlyIndex = newPly,
            moves = updatedMoves,
            opening = ChessOpeningBook.identifyOpening(updatedMoves.map { it.san })
        )

        analyzeCurrentPosition(prevEval = prevEval, playedMove = move)
    }

    fun navigateToPly(plyIndex: Int) {
        if (plyIndex < -1 || plyIndex >= positionHistory.size - 1) return
        val posIndex = plyIndex + 1
        val targetPos = positionHistory[posIndex]
        val lastM = if (plyIndex >= 0 && plyIndex < executedMoves.size) executedMoves[plyIndex] else null

        _uiState.value = _uiState.value.copy(
            position = targetPos,
            currentPlyIndex = plyIndex,
            lastMove = lastM,
            selectedSquare = null,
            legalMoves = emptyList(),
            isVariationActive = false
        )
        analyzeCurrentPosition()
    }

    fun navigatePrev() {
        val curr = _uiState.value.currentPlyIndex
        if (curr > -1) navigateToPly(curr - 1)
    }

    fun navigateNext() {
        val curr = _uiState.value.currentPlyIndex
        if (curr < executedMoves.size - 1) navigateToPly(curr + 1)
    }

    fun navigateFirst() {
        navigateToPly(-1)
    }

    fun navigateLast() {
        navigateToPly(executedMoves.size - 1)
    }

    fun flipBoard() {
        _uiState.value = _uiState.value.copy(isWhiteAtBottom = !_uiState.value.isWhiteAtBottom)
    }

    fun undoMove() {
        if (executedMoves.isNotEmpty()) {
            executedMoves.removeAt(executedMoves.size - 1)
            positionHistory.removeAt(positionHistory.size - 1)
            if (evalHistory.isNotEmpty()) evalHistory.removeAt(evalHistory.size - 1)

            val newMoves = _uiState.value.moves.dropLast(1)
            val newPly = executedMoves.size - 1
            val lastPos = positionHistory.last()
            val lastM = executedMoves.lastOrNull()

            _uiState.value = _uiState.value.copy(
                position = lastPos,
                currentPlyIndex = newPly,
                lastMove = lastM,
                moves = newMoves,
                selectedSquare = null,
                legalMoves = emptyList()
            )
            analyzeCurrentPosition()
        }
    }

    fun playEngineLineAsVariation(line: EngineLine) {
        val currentPos = _uiState.value.position
        val varPos = currentPos.copy()
        varPos.makeMove(line.move)

        _uiState.value = _uiState.value.copy(
            position = varPos,
            bestMove = if (line.continuationMoves.isNotEmpty()) line.move else null,
            isDashedArrow = true,
            isVariationActive = true,
            activeVariationTitle = "${line.san} (${line.displayScore})"
        )
    }

    fun returnToMainLine() {
        val curr = _uiState.value.currentPlyIndex
        val targetPos = if (curr >= 0 && curr < positionHistory.size - 1) positionHistory[curr + 1] else positionHistory.first()
        _uiState.value = _uiState.value.copy(
            position = targetPos,
            isVariationActive = false,
            isDashedArrow = false,
            activeVariationTitle = null
        )
        analyzeCurrentPosition()
    }

    private fun analyzeCurrentPosition(prevEval: Int? = null, playedMove: Move? = null) {
        val pos = _uiState.value.position
        val settings = settingsRepository.settings.value

        _uiState.value = _uiState.value.copy(isAnalyzing = true)

        enginePool.queueQuickAnalysis(
            position = pos,
            preset = settings.enginePreset,
            customDepth = settings.customDepth,
            customMovetimeMs = settings.customMovetimeMs,
            multiPv = settings.multiPv,
            previousEvalCp = prevEval,
            playedMove = playedMove
        ) { result ->
            evalHistory.add(result.evaluationCp)

            // Trigger haptic feedback according to Section 2.7
            if (settings.hapticFeedbackEnabled && result.classification != null) {
                triggerHaptic(result.classification)
            }

            // Update classification on the last move
            var updatedMoves = _uiState.value.moves
            val currIdx = _uiState.value.currentPlyIndex
            if (currIdx >= 0 && currIdx < updatedMoves.size && result.classification != null) {
                val updatedItem = updatedMoves[currIdx].copy(
                    classification = result.classification,
                    isCritical = (result.evalBefore != null && result.evalAfter != null &&
                            abs(result.evalBefore - result.evalAfter) >= 1.5f)
                )
                updatedMoves = updatedMoves.toMutableList().apply {
                    set(currIdx, updatedItem)
                }
            }

            // Calculate critical moments
            val criticalMomentsList = mutableListOf<CriticalMomentItem>()
            for (i in 1 until evalHistory.size) {
                val diff = abs(evalHistory[i] - evalHistory[i - 1]) / 100f
                if (diff >= 1.5f && i - 1 < updatedMoves.size) {
                    val m = updatedMoves[i - 1]
                    criticalMomentsList.add(
                        CriticalMomentItem(
                            plyIndex = m.plyIndex,
                            moveNumber = m.moveNumber,
                            playedSan = m.san,
                            bestSan = result.bestMoveSan,
                            swingPawns = diff,
                            positionFen = pos.toFen()
                        )
                    )
                }
            }

            // Accuracy calculation
            val evalDrops = mutableListOf<Float>()
            for (i in 1 until evalHistory.size) {
                val drop = (abs(evalHistory[i] - evalHistory[i - 1]) / 100f)
                evalDrops.add(drop)
            }
            val acc = ChessEngine().calculateGameAccuracy(evalDrops)

            _uiState.value = _uiState.value.copy(
                analysisResult = result,
                bestMove = result.bestMove,
                bestMoveColor = settings.arrowBaseColor.hex,
                threatMove = if (settings.showThreatArrow && result.topLines.size > 1) result.topLines[1].move else null,
                gamePhase = result.gamePhase,
                materialBalance = result.materialBalance,
                moves = updatedMoves,
                criticalMoments = criticalMomentsList,
                accuracy = if (updatedMoves.size >= 4) acc else null,
                isAnalyzing = false
            )

            // Auto-save to analysis history (Room DB)
            viewModelScope.launch {
                chessRepository.saveAnalysis(
                    AnalysisEntity(
                        fen = pos.toFen(),
                        bestMoveSan = result.bestMoveSan,
                        bestMoveUci = result.bestMove?.uci ?: "",
                        evaluationCp = result.evaluationCp,
                        mateIn = result.mateIn,
                        depth = result.depth,
                        sourceMode = "PRACTICE",
                        moveClassification = result.classification?.name,
                        openingName = _uiState.value.opening.name,
                        eco = _uiState.value.opening.eco
                    )
                )
            }
        }
    }

    private fun triggerHaptic(classification: MoveClassification) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val manager = getApplication<Application>().getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                manager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getApplication<Application>().getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (classification == MoveClassification.BLUNDER) {
                    vibrator.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE))
                } else if (classification == MoveClassification.BEST) {
                    vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
                }
            }
        } catch (_: Exception) {}
    }

    fun loadPgnText(pgn: String) {
        // Parse PGN moves into sequence
        val clean = pgn.replace("\\[.*?\\]".toRegex(), "").trim()
        val tokens = clean.split("\\s+".toRegex()).filter { it.isNotBlank() && !it.matches("\\d+\\.*".toRegex()) && it != "*" }

        val start = ChessPosition.fromFen(ChessPosition.STARTING_FEN)
        positionHistory.clear()
        executedMoves.clear()
        evalHistory.clear()
        positionHistory.add(start)

        var currentPos = start
        val displayMoves = mutableListOf<MoveDisplayItem>()

        for (token in tokens) {
            val legal = currentPos.generateLegalMoves()
            val cleanToken = token.replace("+", "").replace("#", "")
            val found = legal.firstOrNull {
                currentPos.toSan(it).replace("+", "").replace("#", "") == cleanToken || it.uci == cleanToken
            }
            if (found != null) {
                val nextPos = currentPos.copy()
                val san = currentPos.toSan(found)
                nextPos.makeMove(found)

                val ply = executedMoves.size
                executedMoves.add(found)
                positionHistory.add(nextPos)

                displayMoves.add(
                    MoveDisplayItem(
                        plyIndex = ply,
                        moveNumber = (ply / 2) + 1,
                        san = san,
                        isWhite = currentPos.activeColor == PieceColor.WHITE
                    )
                )
                currentPos = nextPos
            }
        }

        _uiState.value = _uiState.value.copy(
            position = currentPos,
            moves = displayMoves,
            currentPlyIndex = executedMoves.size - 1,
            lastMove = executedMoves.lastOrNull(),
            opening = ChessOpeningBook.identifyOpening(displayMoves.map { it.san })
        )
        analyzeCurrentPosition()
    }

    fun loadSampleGame() {
        val sampleNajdorf = "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 8. Qd2 Nbd7 9. O-O-O Be7 *"
        loadPgnText(sampleNajdorf)
    }

    fun copyFenToClipboard(): String {
        val fen = _uiState.value.position.toFen()
        val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        val clip = ClipData.newPlainText("Chess FEN", fen)
        clipboard.setPrimaryClip(clip)
        _uiState.value = _uiState.value.copy(statusMessage = "FEN copied to clipboard")
        return fen
    }

    fun exportPgn(): String {
        val reconstructor = GameReconstructor()
        reconstructor.reset()
        for (i in _uiState.value.moves.indices) {
            val item = _uiState.value.moves[i]
            reconstructor.gameState.sanHistory.add(item.san)
        }
        reconstructor.gameState.opening = _uiState.value.opening

        val pgn = reconstructor.gameState.exportPgn(accuracyWhite = _uiState.value.accuracy)
        val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Chess PGN", pgn))
        _uiState.value = _uiState.value.copy(statusMessage = "PGN exported to clipboard")

        // Save to Game records Room DB
        viewModelScope.launch {
            chessRepository.saveGame(
                GameRecordEntity(
                    title = _uiState.value.opening.name,
                    pgnText = pgn,
                    totalMoves = _uiState.value.moves.size,
                    accuracyWhite = _uiState.value.accuracy,
                    openingName = _uiState.value.opening.name
                )
            )
        }
        return pgn
    }

    fun generateShareableImage(): Bitmap {
        val size = 700
        val bmp = Bitmap.createBitmap(size, size + 160, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(AndroidColor.parseColor("#0F172A"))

        val paint = Paint().apply {
            color = AndroidColor.WHITE
            textSize = 28f
            isAntiAlias = true
            typeface = android.graphics.Typeface.DEFAULT_BOLD
        }
        canvas.drawText("Chess Forge Analysis", 40f, 60f, paint)

        val evalText = _uiState.value.analysisResult?.displayScore ?: "+0.00"
        paint.textSize = 24f
        paint.color = AndroidColor.parseColor("#0D9488")
        canvas.drawText("Eval: $evalText  |  Best: ${_uiState.value.analysisResult?.bestMoveSan ?: "-"}", 40f, 100f, paint)

        // Board preview background
        val sqSize = (size - 80) / 8f
        val boardTop = 130f
        val pos = _uiState.value.position

        for (r in 0..7) {
            for (f in 0..7) {
                val isLight = (f + r) % 2 != 0
                val sqPaint = Paint().apply {
                    color = if (isLight) AndroidColor.parseColor("#D8EBE7") else AndroidColor.parseColor("#2A5952")
                }
                val left = 40f + f * sqSize
                val top = boardTop + (7 - r) * sqSize
                canvas.drawRect(left, top, left + sqSize, top + sqSize, sqPaint)

                val piece = pos.get(f, r)
                if (piece != null) {
                    val piecePaint = Paint().apply {
                        textSize = sqSize * 0.75f
                        textAlign = Paint.Align.CENTER
                        color = if (piece.color == PieceColor.WHITE) AndroidColor.WHITE else AndroidColor.BLACK
                        isAntiAlias = true
                    }
                    canvas.drawText(piece.unicode, left + sqSize / 2f, top + sqSize * 0.78f, piecePaint)
                }
            }
        }

        // Watermark (Section 2.4)
        val waterPaint = Paint().apply {
            color = AndroidColor.parseColor("#94A3B8")
            textSize = 20f
            isAntiAlias = true
            textAlign = Paint.Align.RIGHT
        }
        canvas.drawText("Analyzed with Chess Forge", (size - 40).toFloat(), (size + 130).toFloat(), waterPaint)

        _uiState.value = _uiState.value.copy(statusMessage = "Analysis image generated")
        return bmp
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }
}
