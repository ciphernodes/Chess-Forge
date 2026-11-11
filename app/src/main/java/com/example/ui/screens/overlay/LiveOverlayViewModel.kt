package com.example.ui.screens.overlay

import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.RectF
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.AnalysisResult
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.core.chess.PieceColor
import com.example.core.chess.Square
import com.example.data.repository.ArrowColorChoice
import com.example.data.repository.SettingsRepository
import com.example.data.repository.UserSettings
import com.example.service.LiveOverlayService
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LiveOverlayUiState(
    val isServiceRunning: Boolean = false,
    val hasOverlayPermission: Boolean = false,
    val isSimulatingOverlay: Boolean = true, // Live in-app overlay sandbox mode
    val isBubbleMinimized: Boolean = false, // 50x50dp floating bubble
    val isAdjustingRegion: Boolean = false, // Drag-to-fit board region mode
    val boardRegion: RectF = RectF(0.08f, 0.08f, 0.92f, 0.92f), // Normalized coordinates 0..1
    val settings: UserSettings = UserSettings(),
    val position: ChessPosition = ChessPosition.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5"),
    val selectedSquare: Square? = null,
    val legalMoves: List<Move> = emptyList(),
    val analysisResult: AnalysisResult? = null,
    val bestMove: Move? = null,
    val moveTypeColor: Long = 0xFF00E676,
    val isSpecialMoveOnly: Boolean = false,
    val isCaptureMove: Boolean = false,
    val isCheckMove: Boolean = false,
    val turnLabel: String = "Your move (White)",
    val confidenceScore: Float = 0.94f,
    val reconstructedPgn: String = "",
    val reconstructedMovesCount: Int = 0,
    val showReconstructOffer: Boolean = false,
    val isScreenCaptureActive: Boolean = false,
    val statusMessage: String? = null
)

class LiveOverlayViewModel(application: Application) : AndroidViewModel(application) {

    private val settingsRepository = SettingsRepository(application)
    private val engine = ChessEngine()
    private val gameReconstructor = GameReconstructor()

    private val _uiState = MutableStateFlow(LiveOverlayUiState())
    val uiState: StateFlow<LiveOverlayUiState> = _uiState.asStateFlow()

    init {
        loadState()
        analyzePosition(_uiState.value.position)
    }

    fun loadState() {
        val context = getApplication<Application>()
        val hasOverlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        val currentSettings = settingsRepository.settings.value

        _uiState.value = _uiState.value.copy(
            isServiceRunning = LiveOverlayService.isRunning,
            hasOverlayPermission = hasOverlay,
            isScreenCaptureActive = com.example.service.ChessScreenCaptureService.isCapturing,
            settings = currentSettings
        )
    }

    fun onSquareClicked(square: Square) {
        val state = _uiState.value
        val pos = state.position

        // 1. Select piece
        val piece = pos[square]
        if (piece != null && piece.color == pos.activeColor) {
            val legal = pos.generateLegalMoves().filter { it.from == square }
            _uiState.value = state.copy(selectedSquare = square, legalMoves = legal)
            return
        }

        // 2. Play move if legal
        val selected = state.selectedSquare
        if (selected != null) {
            val matching = state.legalMoves.firstOrNull { it.to == square }
            if (matching != null) {
                applyMove(matching)
                return
            }
        }

        // 3. Clear selection
        _uiState.value = state.copy(selectedSquare = null, legalMoves = emptyList())
    }

    private fun applyMove(move: Move) {
        val currentPos = _uiState.value.position
        val nextPos = currentPos.copy()
        nextPos.makeMove(move)

        // Turn detection & game reconstruction
        gameReconstructor.applyDetectedMove(move, nextPos)

        val newTurn = if (nextPos.activeColor == PieceColor.WHITE) "Your move (White)" else "Opponent's move (Black)"

        _uiState.value = _uiState.value.copy(
            position = nextPos,
            selectedSquare = null,
            legalMoves = emptyList(),
            turnLabel = newTurn,
            reconstructedMovesCount = gameReconstructor.gameState.sanHistory.size
        )

        analyzePosition(nextPos)

        // If watching mode is off, simulate opponent reply after 700ms so user can play back and forth
        if (!_uiState.value.settings.isWatchingMode && nextPos.activeColor == PieceColor.BLACK) {
            viewModelScope.launch {
                delay(700)
                val oppMoves = nextPos.generateLegalMoves()
                val chosenOppMove = oppMoves.firstOrNull { it.isCapture } ?: oppMoves.firstOrNull()
                if (chosenOppMove != null) {
                    val afterOpp = nextPos.copy()
                    afterOpp.makeMove(chosenOppMove)
                    gameReconstructor.applyDetectedMove(chosenOppMove, afterOpp)

                    _uiState.value = _uiState.value.copy(
                        position = afterOpp,
                        turnLabel = "Your move (White)",
                        reconstructedMovesCount = gameReconstructor.gameState.sanHistory.size
                    )
                    analyzePosition(afterOpp)
                }
            }
        }
    }

    private fun analyzePosition(pos: ChessPosition) {
        viewModelScope.launch {
            val s = settingsRepository.settings.value
            val res = engine.analyze(
                position = pos,
                preset = s.enginePreset,
                customDepth = s.customDepth,
                customMovetimeMs = s.customMovetimeMs,
                multiPv = s.multiPv
            )

            // Determine move type color (Section 4.4)
            val best = res.bestMove
            val isOnlyMove = pos.generateLegalMoves().size == 1
            val isCapture = best != null && (best.isCapture || pos.get(best.to) != null)
            val isCheck = res.bestMoveSan.contains("+") || res.bestMoveSan.contains("#")

            val colorHex = when {
                isCheck -> s.arrowCheckColor
                isOnlyMove -> s.arrowOnlyMoveColor
                isCapture -> s.arrowCaptureColor
                else -> s.arrowBaseColor.hex
            }

            _uiState.value = _uiState.value.copy(
                analysisResult = res,
                bestMove = best,
                moveTypeColor = colorHex,
                isSpecialMoveOnly = isOnlyMove,
                isCaptureMove = isCapture,
                isCheckMove = isCheck,
                confidenceScore = 0.95f
            )
        }
    }

    fun startOverlayService() {
        val context = getApplication<Application>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            _uiState.value = _uiState.value.copy(
                statusMessage = "Grant 'Display over other apps' permission to start system overlay."
            )
            return
        }

        try {
            val intent = Intent(context, LiveOverlayService::class.java).apply {
                action = LiveOverlayService.ACTION_START
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            _uiState.value = _uiState.value.copy(
                isServiceRunning = true,
                statusMessage = "Live Overlay started! Touches pass directly through to your chess app."
            )
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(
                statusMessage = "Unable to start background service: ${e.localizedMessage}"
            )
        }
    }

    fun startCalibrationMode() {
        val context = getApplication<Application>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(context)) {
            _uiState.value = _uiState.value.copy(
                statusMessage = "Grant 'Display over other apps' permission to calibrate board position."
            )
            return
        }

        try {
            val intent = Intent(context, LiveOverlayService::class.java).apply {
                action = LiveOverlayService.ACTION_CALIBRATE
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            _uiState.value = _uiState.value.copy(
                isServiceRunning = true,
                statusMessage = "Board calibration active: switch to your chess app and align the box!"
            )
        } catch (e: Exception) {
            _uiState.value = _uiState.value.copy(
                statusMessage = "Unable to start calibration: ${e.localizedMessage}"
            )
        }
    }

    fun toggleAlwaysPromptCalibration(prompt: Boolean) {
        val s = _uiState.value.settings.copy(alwaysPromptCalibration = prompt)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleBoardFlipped(flipped: Boolean) {
        val s = _uiState.value.settings.copy(isBoardFlipped = flipped)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun updatePlayerColorMode(mode: String) {
        val s = _uiState.value.settings.copy(
            playerColorOverride = mode,
            isBoardFlipped = (mode == "BLACK")
        )
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
        val context = getApplication<Application>()
        com.example.service.ChessScreenCaptureService.requestScan(context)
    }

    fun toggleAutoDetectPlayerColor(auto: Boolean) {
        val s = _uiState.value.settings.copy(
            autoDetectPlayerColor = auto,
            playerColorOverride = if (auto) "AUTO" else _uiState.value.settings.playerColorOverride
        )
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun triggerManualScan() {
        val context = getApplication<Application>()
        com.example.service.ChessScreenCaptureService.requestScan(context)
        _uiState.value = _uiState.value.copy(
            statusMessage = "Scanning calibrated board in Chess.com..."
        )
    }

    fun stopOverlayService() {
        val context = getApplication<Application>()
        val intent = Intent(context, LiveOverlayService::class.java).apply {
            action = LiveOverlayService.ACTION_STOP
        }
        context.startService(intent)
        com.example.service.ChessScreenCaptureService.stop(context)

        val pgn = gameReconstructor.gameState.exportPgn()

        _uiState.value = _uiState.value.copy(
            isServiceRunning = false,
            isScreenCaptureActive = false,
            showReconstructOffer = true,
            reconstructedPgn = pgn,
            statusMessage = "Overlay stopped. Post-game analysis ready!"
        )
    }

    fun toggleMinimizeBubble() {
        _uiState.value = _uiState.value.copy(
            isBubbleMinimized = !_uiState.value.isBubbleMinimized
        )
    }

    fun toggleAdjustRegion() {
        _uiState.value = _uiState.value.copy(
            isAdjustingRegion = !_uiState.value.isAdjustingRegion
        )
    }

    fun updateRegion(left: Float, top: Float, right: Float, bottom: Float) {
        val newRegion = RectF(
            left.coerceIn(0f, 0.4f),
            top.coerceIn(0f, 0.4f),
            right.coerceIn(0.6f, 1f),
            bottom.coerceIn(0.6f, 1f)
        )
        settingsRepository.saveBoardRegion(newRegion)
        _uiState.value = _uiState.value.copy(boardRegion = newRegion)
    }

    fun updateFps(fps: Int) {
        val s = _uiState.value.settings.copy(overlayFps = fps)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun updateArrowColor(color: ArrowColorChoice) {
        val s = _uiState.value.settings.copy(arrowBaseColor = color)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
        analyzePosition(_uiState.value.position)
    }

    fun updateOpacity(opacity: Float) {
        val s = _uiState.value.settings.copy(arrowOpacity = opacity)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleWatchingMode(isWatching: Boolean) {
        val s = _uiState.value.settings.copy(isWatchingMode = isWatching)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(
            settings = s,
            turnLabel = if (isWatching) "Watching Mode (Whichever side is to move)" else "Playing Mode (White)"
        )
    }

    fun togglePulse(pulse: Boolean) {
        val s = _uiState.value.settings.copy(overlayPulseAnimation = pulse)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleEvalBadge(show: Boolean) {
        val s = _uiState.value.settings.copy(showOverlayEvalBadge = show)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleConfidenceDot(show: Boolean) {
        val s = _uiState.value.settings.copy(showOverlayConfidenceDot = show)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleTurnIndicator(show: Boolean) {
        val s = _uiState.value.settings.copy(showOverlayTurnIndicator = show)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun resetBoardRegion() {
        settingsRepository.clearBoardRegion()
        _uiState.value = _uiState.value.copy(
            boardRegion = RectF(0.08f, 0.08f, 0.92f, 0.92f),
            statusMessage = "Board region reset to default"
        )
    }

    fun dismissReconstructOffer() {
        _uiState.value = _uiState.value.copy(showReconstructOffer = false)
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }
}
