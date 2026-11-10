package com.example.ui.screens.overlay

import android.app.Application
import android.content.Context
import android.content.Intent
import android.graphics.RectF
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.core.chess.PieceColor
import com.example.data.repository.ArrowColorChoice
import com.example.data.repository.SettingsRepository
import com.example.data.repository.UserSettings
import com.example.service.LiveOverlayService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class LiveOverlayUiState(
    val isServiceRunning: Boolean = false,
    val hasOverlayPermission: Boolean = false,
    val boardRegion: RectF? = null,
    val settings: UserSettings = UserSettings(),
    val samplePosition: ChessPosition = ChessPosition.fromFen(ChessPosition.STARTING_FEN),
    val sampleBestMove: Move? = null,
    val statusMessage: String? = null,
    val showReconstructOffer: Boolean = false,
    val reconstructedMovesCount: Int = 0
)

class LiveOverlayViewModel(application: Application) : AndroidViewModel(application) {

    private val settingsRepository = SettingsRepository(application)
    private val engine = ChessEngine()

    private val _uiState = MutableStateFlow(LiveOverlayUiState())
    val uiState: StateFlow<LiveOverlayUiState> = _uiState.asStateFlow()

    init {
        loadState()
    }

    fun loadState() {
        val context = getApplication<Application>()
        val hasOverlay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        val region = settingsRepository.getSavedBoardRegion()
        val currentSettings = settingsRepository.settings.value

        _uiState.value = _uiState.value.copy(
            isServiceRunning = LiveOverlayService.isRunning,
            hasOverlayPermission = hasOverlay,
            boardRegion = region,
            settings = currentSettings
        )
        generateSampleOverlayMove()
    }

    private fun generateSampleOverlayMove() {
        viewModelScope.launch {
            val pos = ChessPosition.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5")
            val res = engine.analyze(pos)
            _uiState.value = _uiState.value.copy(
                samplePosition = pos,
                sampleBestMove = res.bestMove
            )
        }
    }

    fun startOverlayService() {
        val context = getApplication<Application>()
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
            statusMessage = "Live Overlay Service started"
        )
    }

    fun stopOverlayService() {
        val context = getApplication<Application>()
        val intent = Intent(context, LiveOverlayService::class.java).apply {
            action = LiveOverlayService.ACTION_STOP
        }
        context.startService(intent)
        _uiState.value = _uiState.value.copy(
            isServiceRunning = false,
            showReconstructOffer = true,
            reconstructedMovesCount = 14,
            statusMessage = "Overlay stopped"
        )
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
    }

    fun updateOpacity(opacity: Float) {
        val s = _uiState.value.settings.copy(arrowOpacity = opacity)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
    }

    fun toggleWatchingMode(isWatching: Boolean) {
        val s = _uiState.value.settings.copy(isWatchingMode = isWatching)
        settingsRepository.updateSettings(s)
        _uiState.value = _uiState.value.copy(settings = s)
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
            boardRegion = null,
            statusMessage = "Saved board region reset"
        )
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }

    fun dismissReconstructOffer() {
        _uiState.value = _uiState.value.copy(showReconstructOffer = false)
    }
}
