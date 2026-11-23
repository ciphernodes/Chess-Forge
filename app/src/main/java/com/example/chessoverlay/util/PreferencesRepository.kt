package com.example.chessoverlay.util

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.emptyPreferences
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.example.chessoverlay.model.AutonomousEloProfile
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.model.PuzzleLevelMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map
import java.io.IOException

private val Context.chessForgeDataStore: DataStore<Preferences> by preferencesDataStore(name = "chess_forge_ext_prefs")

class PreferencesRepository(private val context: Context) {

    private val safeData: Flow<Preferences> = context.chessForgeDataStore.data
        .catch { e ->
            if (e is IOException) {
                AppLogger.w(TAG, "DataStore read error, recovering cleanly", e)
                emit(emptyPreferences())
            } else {
                throw e
            }
        }

    val extensionConfigFlow: Flow<BrowserExtensionConfig> = safeData.map { prefs ->
        BrowserExtensionConfig(
            enabled = prefs[KEY_ENABLED] ?: true,
            showArrows = prefs[KEY_ARROWS] ?: true,
            showHud = prefs[KEY_HUD] ?: true,
            showEvalBar = prefs[KEY_EVAL_BAR] ?: true,
            showAnnotations = prefs[KEY_ANNOTATIONS] ?: true,
            showOpeningBook = prefs[KEY_OPENING_BOOK] ?: true,
            showTablebase = prefs[KEY_TABLEBASE] ?: true,
            autoAdaptTheme = prefs[KEY_ADAPT_THEME] ?: true,
            evalBarOrientation = EvalBarOrientation.fromKey(prefs[KEY_EVAL_ORIENTATION]),
            multiPv = (prefs[KEY_MULTI_PV] ?: 2).coerceIn(1, 4),
            maxDepth = (prefs[KEY_DEPTH] ?: 14).coerceIn(2, 20),
            skillLevel = (prefs[KEY_SKILL] ?: 20).coerceIn(0, 20),
            cpuProfile = CpuUsageProfile.fromKey(prefs[KEY_CPU_PROFILE]),
            turnOverride = prefs[KEY_TURN_OVERRIDE] ?: "auto",
            fairPlayAuditorEnabled = prefs[KEY_FAIR_PLAY_ENABLED] ?: true,
            humanizerEnabled = prefs[KEY_HUMANIZER_ENABLED] ?: true,
            targetElo = (prefs[KEY_TARGET_ELO] ?: 1500).coerceIn(400, 3000),
            maxHintsPerGame = (prefs[KEY_MAX_HINTS] ?: 3).coerceIn(1, 5),
            practiceAutoPlay = prefs[KEY_PRACTICE_AUTO] ?: false,
            practiceHumanDelayMs = (prefs[KEY_PRACTICE_DELAY] ?: 650).coerceIn(250, 2500),
            autonomousMode = prefs[KEY_AUTONOMOUS_MODE] ?: false,
            onlineAutoPlay = prefs[KEY_ONLINE_AUTOPLAY] ?: false,
            autonomousEloProfile = (prefs[KEY_AUTONOMOUS_ELO_PROFILE] ?: 1600).let {
                if (it in AutonomousEloProfile.supportedElos) it else 1600
            },
            puzzleSolverEnabled = prefs[KEY_PUZZLE_SOLVER] ?: false,
            puzzleAutoSolve = prefs[KEY_PUZZLE_AUTOSOLVE] ?: false,
            puzzleAutoNext = prefs[KEY_PUZZLE_AUTONEXT] ?: false,
            puzzleLevelMode = PuzzleLevelMode.fromKey(prefs[KEY_PUZZLE_LEVEL_MODE]),
            puzzleSolveDelayMs = (prefs[KEY_PUZZLE_DELAY_MS] ?: 450).coerceIn(150, 1500)
        )
    }

    suspend fun saveExtensionConfig(config: BrowserExtensionConfig) {
        context.chessForgeDataStore.edit { prefs ->
            prefs[KEY_ENABLED] = config.enabled
            prefs[KEY_ARROWS] = config.showArrows
            prefs[KEY_HUD] = config.showHud
            prefs[KEY_EVAL_BAR] = config.showEvalBar
            prefs[KEY_ANNOTATIONS] = config.showAnnotations
            prefs[KEY_OPENING_BOOK] = config.showOpeningBook
            prefs[KEY_TABLEBASE] = config.showTablebase
            prefs[KEY_ADAPT_THEME] = config.autoAdaptTheme
            prefs[KEY_EVAL_ORIENTATION] = config.evalBarOrientation.key
            prefs[KEY_MULTI_PV] = config.multiPv.coerceIn(1, 4)
            prefs[KEY_DEPTH] = config.maxDepth.coerceIn(2, 20)
            prefs[KEY_SKILL] = config.skillLevel.coerceIn(0, 20)
            prefs[KEY_CPU_PROFILE] = config.cpuProfile.key
            prefs[KEY_TURN_OVERRIDE] = config.turnOverride
            prefs[KEY_FAIR_PLAY_ENABLED] = config.fairPlayAuditorEnabled
            prefs[KEY_HUMANIZER_ENABLED] = config.humanizerEnabled
            prefs[KEY_TARGET_ELO] = config.targetElo.coerceIn(400, 3000)
            prefs[KEY_MAX_HINTS] = config.maxHintsPerGame.coerceIn(1, 5)
            prefs[KEY_PRACTICE_AUTO] = config.practiceAutoPlay
            prefs[KEY_PRACTICE_DELAY] = config.practiceHumanDelayMs.coerceIn(250, 2500)
            prefs[KEY_AUTONOMOUS_MODE] = config.autonomousMode
            prefs[KEY_ONLINE_AUTOPLAY] = config.onlineAutoPlay
            prefs[KEY_AUTONOMOUS_ELO_PROFILE] = if (config.autonomousEloProfile in AutonomousEloProfile.supportedElos) {
                config.autonomousEloProfile
            } else {
                1600
            }
            prefs[KEY_PUZZLE_SOLVER] = config.puzzleSolverEnabled
            prefs[KEY_PUZZLE_AUTOSOLVE] = config.puzzleAutoSolve
            prefs[KEY_PUZZLE_AUTONEXT] = config.puzzleAutoNext
            prefs[KEY_PUZZLE_LEVEL_MODE] = config.puzzleLevelMode.key
            prefs[KEY_PUZZLE_DELAY_MS] = config.puzzleSolveDelayMs.coerceIn(150, 1500)
        }
    }

    suspend fun setAutonomousMode(enabled: Boolean) {
        context.chessForgeDataStore.edit { prefs ->
            prefs[KEY_AUTONOMOUS_MODE] = enabled
        }
    }

    suspend fun setAutonomousEloProfile(elo: Int) {
        context.chessForgeDataStore.edit { prefs ->
            prefs[KEY_AUTONOMOUS_ELO_PROFILE] = if (elo in AutonomousEloProfile.supportedElos) elo else 1600
        }
    }

    suspend fun clearSessionTelemetryStorage() {
        context.chessForgeDataStore.edit { prefs ->
            prefs.remove(KEY_TELEMETRY_WINDOW_JSON)
            prefs.remove(KEY_TELEMETRY_LAST_RESET_MS)
        }
    }

    companion object {
        private const val TAG = "PreferencesRepository"
        private val KEY_ENABLED = booleanPreferencesKey("ext_enabled")
        private val KEY_ARROWS = booleanPreferencesKey("ext_show_arrows")
        private val KEY_HUD = booleanPreferencesKey("ext_show_hud")
        private val KEY_EVAL_BAR = booleanPreferencesKey("ext_show_eval_bar")
        private val KEY_ANNOTATIONS = booleanPreferencesKey("ext_show_annotations")
        private val KEY_OPENING_BOOK = booleanPreferencesKey("ext_show_opening_book")
        private val KEY_TABLEBASE = booleanPreferencesKey("ext_show_tablebase")
        private val KEY_ADAPT_THEME = booleanPreferencesKey("ext_auto_adapt_theme")
        private val KEY_EVAL_ORIENTATION = stringPreferencesKey("ext_eval_orientation")
        private val KEY_MULTI_PV = intPreferencesKey("ext_multi_pv")
        private val KEY_DEPTH = intPreferencesKey("ext_max_depth")
        private val KEY_SKILL = intPreferencesKey("ext_skill_level")
        private val KEY_CPU_PROFILE = stringPreferencesKey("ext_cpu_profile")
        private val KEY_TURN_OVERRIDE = stringPreferencesKey("ext_turn_override")
        private val KEY_FAIR_PLAY_ENABLED = booleanPreferencesKey("ext_fair_play_enabled")
        private val KEY_HUMANIZER_ENABLED = booleanPreferencesKey("ext_humanizer_enabled")
        private val KEY_TARGET_ELO = intPreferencesKey("ext_target_elo")
        private val KEY_MAX_HINTS = intPreferencesKey("ext_max_hints")
        private val KEY_PRACTICE_AUTO = booleanPreferencesKey("ext_practice_auto")
        private val KEY_PRACTICE_DELAY = intPreferencesKey("ext_practice_delay")
        private val KEY_AUTONOMOUS_MODE = booleanPreferencesKey("ext_autonomous_mode")
        private val KEY_ONLINE_AUTOPLAY = booleanPreferencesKey("ext_online_autoplay")
        private val KEY_AUTONOMOUS_ELO_PROFILE = intPreferencesKey("ext_autonomous_elo_profile")
        private val KEY_PUZZLE_SOLVER = booleanPreferencesKey("ext_puzzle_solver")
        private val KEY_PUZZLE_AUTOSOLVE = booleanPreferencesKey("ext_puzzle_autosolve")
        private val KEY_PUZZLE_AUTONEXT = booleanPreferencesKey("ext_puzzle_autonext")
        private val KEY_PUZZLE_LEVEL_MODE = stringPreferencesKey("ext_puzzle_level_mode")
        private val KEY_PUZZLE_DELAY_MS = intPreferencesKey("ext_puzzle_delay_ms")
        private val KEY_TELEMETRY_WINDOW_JSON = stringPreferencesKey("ext_telemetry_window_json")
        private val KEY_TELEMETRY_LAST_RESET_MS = stringPreferencesKey("ext_telemetry_last_reset_ms")
    }
}
