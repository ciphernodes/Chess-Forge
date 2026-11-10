package com.example.data.repository

import android.content.Context
import android.content.SharedPreferences
import android.graphics.RectF
import com.example.core.chess.EnginePreset
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

enum class BoardScheme(val displayName: String, val lightHex: Long, val darkHex: Long) {
    FORGE_TEAL("Forge Teal", 0xFFD8EBE7, 0xFF2A5952),
    BLUE_BLACK("Blue / Black", 0xFFD0E2FF, 0xFF2A4365),
    GREEN_BLACK("Green / Black", 0xFFE2EAD6, 0xFF4A6741),
    BROWN_CREAM("Brown / Cream", 0xFFF0D9B5, 0xFFB58863),
    TOURNAMENT("Tournament", 0xFFFFFFDD, 0xFF86A666)
}

enum class ArrowColorChoice(val displayName: String, val hex: Long) {
    FORGE_GREEN("Green", 0xFF00E676),
    NEON_BLUE("Blue", 0xFF448AFF),
    PURPLE("Purple", 0xFFB388FF),
    EMBER_ORANGE("Orange", 0xFFFF9100)
}

data class Profile(
    val name: String,
    val preset: EnginePreset,
    val depth: Int,
    val multiPv: Int,
    val showEvalBadge: Boolean,
    val showThreatArrow: Boolean,
    val arrowOpacity: Float
)

data class UserSettings(
    // Engine
    val enginePreset: EnginePreset = EnginePreset.BALANCED,
    val customDepth: Int = 18,
    val customMovetimeMs: Long = 1000L,
    val multiPv: Int = 3,
    val thresholdGood: Float = 0.3f,
    val thresholdInaccuracy: Float = 1.0f,
    val thresholdMistake: Float = 2.0f,

    // Board
    val boardScheme: BoardScheme = BoardScheme.FORGE_TEAL,
    val useSvgPieces: Boolean = false,
    val showCoordinates: Boolean = true,
    val showLastMoveHighlight: Boolean = true,
    val showLegalMoveDots: Boolean = true,
    val showThreatArrow: Boolean = false,
    val hapticFeedbackEnabled: Boolean = true,

    // Appearance
    val appTheme: String = "SYSTEM", // LIGHT, DARK, SYSTEM, CONTRAST
    val reducedMotion: Boolean = false,
    val oneHandedMode: Boolean = false,

    // Overlay
    val overlayFps: Int = 5,
    val arrowBaseColor: ArrowColorChoice = ArrowColorChoice.FORGE_GREEN,
    val arrowQuietColor: Long = 0xFF00E676,
    val arrowCaptureColor: Long = 0xFF448AFF,
    val arrowCheckColor: Long = 0xFFFF1744,
    val arrowOnlyMoveColor: Long = 0xFFFFD600,
    val arrowThickness: String = "MEDIUM", // THIN, MEDIUM, THICK
    val arrowOpacity: Float = 0.75f,
    val overlayPulseAnimation: Boolean = true,
    val showOverlayEvalBadge: Boolean = true,
    val showOverlayConfidenceDot: Boolean = true,
    val showOverlayCoordinateHint: Boolean = true,
    val showOverlayTurnIndicator: Boolean = true,
    val isWatchingMode: Boolean = false, // false = playing mode, true = watching mode

    // Active Profile
    val activeProfileName: String = "Study",

    // Puzzle Rating
    val puzzleRating: Int = 1200,
    val puzzlesSolved: Int = 0,
    val puzzlesAttempted: Int = 0,

    // Onboarding
    val onboardingCompleted: Boolean = false,
    val ethicsAccepted: Boolean = false
)

class SettingsRepository(private val context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("chess_forge_settings", Context.MODE_PRIVATE)

    private val _settings = MutableStateFlow(loadSettings())
    val settings: StateFlow<UserSettings> = _settings.asStateFlow()

    private fun loadSettings(): UserSettings {
        val presetName = prefs.getString("enginePreset", EnginePreset.BALANCED.name) ?: EnginePreset.BALANCED.name
        val preset = try { EnginePreset.valueOf(presetName) } catch (_: Exception) { EnginePreset.BALANCED }

        val schemeName = prefs.getString("boardScheme", BoardScheme.FORGE_TEAL.name) ?: BoardScheme.FORGE_TEAL.name
        val scheme = try { BoardScheme.valueOf(schemeName) } catch (_: Exception) { BoardScheme.FORGE_TEAL }

        val arrowColorName = prefs.getString("arrowBaseColor", ArrowColorChoice.FORGE_GREEN.name) ?: ArrowColorChoice.FORGE_GREEN.name
        val arrowColor = try { ArrowColorChoice.valueOf(arrowColorName) } catch (_: Exception) { ArrowColorChoice.FORGE_GREEN }

        return UserSettings(
            enginePreset = preset,
            customDepth = prefs.getInt("customDepth", 18),
            customMovetimeMs = prefs.getLong("customMovetimeMs", 1000L),
            multiPv = prefs.getInt("multiPv", 3),
            thresholdGood = prefs.getFloat("thresholdGood", 0.3f),
            thresholdInaccuracy = prefs.getFloat("thresholdInaccuracy", 1.0f),
            thresholdMistake = prefs.getFloat("thresholdMistake", 2.0f),
            boardScheme = scheme,
            useSvgPieces = prefs.getBoolean("useSvgPieces", false),
            showCoordinates = prefs.getBoolean("showCoordinates", true),
            showLastMoveHighlight = prefs.getBoolean("showLastMoveHighlight", true),
            showLegalMoveDots = prefs.getBoolean("showLegalMoveDots", true),
            showThreatArrow = prefs.getBoolean("showThreatArrow", false),
            hapticFeedbackEnabled = prefs.getBoolean("hapticFeedbackEnabled", true),
            appTheme = prefs.getString("appTheme", "SYSTEM") ?: "SYSTEM",
            reducedMotion = prefs.getBoolean("reducedMotion", false),
            oneHandedMode = prefs.getBoolean("oneHandedMode", false),
            overlayFps = prefs.getInt("overlayFps", 5),
            arrowBaseColor = arrowColor,
            arrowOpacity = prefs.getFloat("arrowOpacity", 0.75f),
            overlayPulseAnimation = prefs.getBoolean("overlayPulseAnimation", true),
            showOverlayEvalBadge = prefs.getBoolean("showOverlayEvalBadge", true),
            showOverlayConfidenceDot = prefs.getBoolean("showOverlayConfidenceDot", true),
            showOverlayCoordinateHint = prefs.getBoolean("showOverlayCoordinateHint", true),
            showOverlayTurnIndicator = prefs.getBoolean("showOverlayTurnIndicator", true),
            isWatchingMode = prefs.getBoolean("isWatchingMode", false),
            activeProfileName = prefs.getString("activeProfileName", "Study") ?: "Study",
            puzzleRating = prefs.getInt("puzzleRating", 1200),
            puzzlesSolved = prefs.getInt("puzzlesSolved", 0),
            puzzlesAttempted = prefs.getInt("puzzlesAttempted", 0),
            onboardingCompleted = prefs.getBoolean("onboardingCompleted", false),
            ethicsAccepted = prefs.getBoolean("ethicsAccepted", false)
        )
    }

    fun updateSettings(newSettings: UserSettings) {
        _settings.value = newSettings
        prefs.edit().apply {
            putString("enginePreset", newSettings.enginePreset.name)
            putInt("customDepth", newSettings.customDepth)
            putLong("customMovetimeMs", newSettings.customMovetimeMs)
            putInt("multiPv", newSettings.multiPv)
            putFloat("thresholdGood", newSettings.thresholdGood)
            putFloat("thresholdInaccuracy", newSettings.thresholdInaccuracy)
            putFloat("thresholdMistake", newSettings.thresholdMistake)
            putString("boardScheme", newSettings.boardScheme.name)
            putBoolean("useSvgPieces", newSettings.useSvgPieces)
            putBoolean("showCoordinates", newSettings.showCoordinates)
            putBoolean("showLastMoveHighlight", newSettings.showLastMoveHighlight)
            putBoolean("showLegalMoveDots", newSettings.showLegalMoveDots)
            putBoolean("showThreatArrow", newSettings.showThreatArrow)
            putBoolean("hapticFeedbackEnabled", newSettings.hapticFeedbackEnabled)
            putString("appTheme", newSettings.appTheme)
            putBoolean("reducedMotion", newSettings.reducedMotion)
            putBoolean("oneHandedMode", newSettings.oneHandedMode)
            putInt("overlayFps", newSettings.overlayFps)
            putString("arrowBaseColor", newSettings.arrowBaseColor.name)
            putFloat("arrowOpacity", newSettings.arrowOpacity)
            putBoolean("overlayPulseAnimation", newSettings.overlayPulseAnimation)
            putBoolean("showOverlayEvalBadge", newSettings.showOverlayEvalBadge)
            putBoolean("showOverlayConfidenceDot", newSettings.showOverlayConfidenceDot)
            putBoolean("showOverlayCoordinateHint", newSettings.showOverlayCoordinateHint)
            putBoolean("showOverlayTurnIndicator", newSettings.showOverlayTurnIndicator)
            putBoolean("isWatchingMode", newSettings.isWatchingMode)
            putString("activeProfileName", newSettings.activeProfileName)
            putInt("puzzleRating", newSettings.puzzleRating)
            putInt("puzzlesSolved", newSettings.puzzlesSolved)
            putInt("puzzlesAttempted", newSettings.puzzlesAttempted)
            putBoolean("onboardingCompleted", newSettings.onboardingCompleted)
            putBoolean("ethicsAccepted", newSettings.ethicsAccepted)
            apply()
        }
    }

    fun saveBoardRegion(rect: RectF) {
        prefs.edit().apply {
            putFloat("region_l", rect.left)
            putFloat("region_t", rect.top)
            putFloat("region_r", rect.right)
            putFloat("region_b", rect.bottom)
            apply()
        }
    }

    fun getSavedBoardRegion(): RectF? {
        if (!prefs.contains("region_l")) return null
        return RectF(
            prefs.getFloat("region_l", 0f),
            prefs.getFloat("region_t", 0f),
            prefs.getFloat("region_r", 0f),
            prefs.getFloat("region_b", 0f)
        )
    }

    fun clearBoardRegion() {
        prefs.edit().apply {
            remove("region_l")
            remove("region_t")
            remove("region_r")
            remove("region_b")
            apply()
        }
    }

    fun updatePuzzleScore(ratingDelta: Int, solved: Boolean) {
        val current = _settings.value
        val newRating = (current.puzzleRating + ratingDelta).coerceAtLeast(400)
        val solvedCount = if (solved) current.puzzlesSolved + 1 else current.puzzlesSolved
        val attemptedCount = current.puzzlesAttempted + 1
        updateSettings(current.copy(
            puzzleRating = newRating,
            puzzlesSolved = solvedCount,
            puzzlesAttempted = attemptedCount
        ))
    }

    fun createBackupJson(historyJson: String, gamesJson: String, puzzlesJson: String): String {
        val root = JSONObject()
        root.put("version", "2.0")
        root.put("timestamp", System.currentTimeMillis())
        val s = _settings.value
        val settingsObj = JSONObject().apply {
            put("preset", s.enginePreset.name)
            put("multiPv", s.multiPv)
            put("scheme", s.boardScheme.name)
            put("rating", s.puzzleRating)
        }
        root.put("settings", settingsObj)
        root.put("history", historyJson)
        root.put("games", gamesJson)
        root.put("puzzles", puzzlesJson)
        return root.toString(2)
    }
}
