package com.example.ui.screens.settings

import android.app.Application
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.EnginePreset
import com.example.data.repository.ArrowColorChoice
import com.example.data.repository.BoardScheme
import com.example.data.repository.ChessRepository
import com.example.data.repository.SettingsRepository
import com.example.data.repository.UserSettings
import com.example.service.LiveOverlayService
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class SettingsViewModel(application: Application) : AndroidViewModel(application) {

    private val settingsRepository = SettingsRepository(application)
    private val chessRepository = ChessRepository(application)

    private val _settings = MutableStateFlow(settingsRepository.settings.value)
    val settings: StateFlow<UserSettings> = _settings.asStateFlow()

    private val _isOverlayRunning = MutableStateFlow(LiveOverlayService.isRunning)
    val isOverlayRunning: StateFlow<Boolean> = _isOverlayRunning.asStateFlow()

    private val _showPermissionDialog = MutableStateFlow(false)
    val showPermissionDialog: StateFlow<Boolean> = _showPermissionDialog.asStateFlow()

    private val _statusMessage = MutableStateFlow<String?>(null)
    val statusMessage: StateFlow<String?> = _statusMessage.asStateFlow()

    init {
        viewModelScope.launch {
            settingsRepository.settings.collect {
                _settings.value = it
            }
        }
    }

    fun refreshOverlayStatus() {
        _isOverlayRunning.value = LiveOverlayService.isRunning
    }

    fun toggleLiveOverlay(enable: Boolean) {
        val context = getApplication<Application>()
        if (enable) {
            val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Settings.canDrawOverlays(context)
            } else {
                true
            }

            if (!hasPermission) {
                _showPermissionDialog.value = true
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
                _isOverlayRunning.value = true
                _statusMessage.value = "Live Overlay Service started"
            } catch (e: Exception) {
                _statusMessage.value = "Failed to start overlay: ${e.localizedMessage}"
            }
        } else {
            try {
                val intent = Intent(context, LiveOverlayService::class.java).apply {
                    action = LiveOverlayService.ACTION_STOP
                }
                context.startService(intent)
                _isOverlayRunning.value = false
                _statusMessage.value = "Live Overlay Service stopped"
            } catch (e: Exception) {
                _statusMessage.value = "Error stopping service: ${e.localizedMessage}"
            }
        }
    }

    fun startCalibrationMode() {
        val context = getApplication<Application>()
        val hasPermission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        if (!hasPermission) {
            _showPermissionDialog.value = true
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
            _isOverlayRunning.value = true
            _statusMessage.value = "Board calibration active: drag & resize the box over your chessboard!"
        } catch (e: Exception) {
            _statusMessage.value = "Failed to start calibration: ${e.localizedMessage}"
        }
    }

    fun dismissPermissionDialog() {
        _showPermissionDialog.value = false
    }

    fun updatePreset(preset: EnginePreset) {
        val updated = _settings.value.copy(enginePreset = preset)
        save(updated)
    }

    fun updateCustomDepth(depth: Int) {
        val updated = _settings.value.copy(customDepth = depth)
        save(updated)
    }

    fun updateCustomMovetime(ms: Long) {
        val updated = _settings.value.copy(customMovetimeMs = ms)
        save(updated)
    }

    fun updateMultiPv(count: Int) {
        val updated = _settings.value.copy(multiPv = count)
        save(updated)
    }

    fun updateThresholds(good: Float, inacc: Float, mistake: Float) {
        val updated = _settings.value.copy(
            thresholdGood = good,
            thresholdInaccuracy = inacc,
            thresholdMistake = mistake
        )
        save(updated)
    }

    fun updateBoardScheme(scheme: BoardScheme) {
        val updated = _settings.value.copy(boardScheme = scheme)
        save(updated)
    }

    fun toggleCoordinates(show: Boolean) {
        val updated = _settings.value.copy(showCoordinates = show)
        save(updated)
    }

    fun toggleLastMove(show: Boolean) {
        val updated = _settings.value.copy(showLastMoveHighlight = show)
        save(updated)
    }

    fun toggleLegalDots(show: Boolean) {
        val updated = _settings.value.copy(showLegalMoveDots = show)
        save(updated)
    }

    fun toggleThreatArrow(show: Boolean) {
        val updated = _settings.value.copy(showThreatArrow = show)
        save(updated)
    }

    fun toggleHaptics(enabled: Boolean) {
        val updated = _settings.value.copy(hapticFeedbackEnabled = enabled)
        save(updated)
    }

    fun updateAppTheme(theme: String) {
        val updated = _settings.value.copy(appTheme = theme)
        save(updated)
    }

    fun toggleReducedMotion(reduced: Boolean) {
        val updated = _settings.value.copy(reducedMotion = reduced)
        save(updated)
    }

    fun selectProfile(profileName: String) {
        val current = _settings.value
        val updated = when (profileName) {
            "Blitz" -> current.copy(
                activeProfileName = "Blitz",
                enginePreset = EnginePreset.FAST,
                showOverlayEvalBadge = false,
                showThreatArrow = false
            )
            "Study" -> current.copy(
                activeProfileName = "Study",
                enginePreset = EnginePreset.DEEP,
                showOverlayEvalBadge = true,
                showThreatArrow = true,
                multiPv = 3
            )
            else -> current.copy(activeProfileName = profileName)
        }
        save(updated)
        _statusMessage.value = "Switched to $profileName Profile"
    }

    fun exportBackupJson() {
        val json = settingsRepository.createBackupJson("[]", "[]", "[]")
        val clipboard = getApplication<Application>().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Chess Forge Backup", json))
        _statusMessage.value = ".forgebackup JSON copied to clipboard"
    }

    fun clearAllData() {
        viewModelScope.launch {
            chessRepository.clearHistory()
            settingsRepository.clearBoardRegion()
            _statusMessage.value = "All local data reset"
        }
    }

    fun updateFps(fps: Int) {
        val updated = _settings.value.copy(overlayFps = fps)
        save(updated)
    }

    private fun save(newSettings: UserSettings) {
        _settings.value = newSettings
        settingsRepository.updateSettings(newSettings)
    }

    fun clearStatusMessage() {
        _statusMessage.value = null
    }
}
