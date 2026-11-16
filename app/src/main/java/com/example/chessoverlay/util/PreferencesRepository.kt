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
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EvalBarOrientation
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
            multiPv = (prefs[KEY_MULTI_PV] ?: 2).coerceIn(1, 3),
            maxDepth = (prefs[KEY_DEPTH] ?: 14).coerceIn(2, 20),
            skillLevel = (prefs[KEY_SKILL] ?: 20).coerceIn(0, 20),
            cpuProfile = CpuUsageProfile.fromKey(prefs[KEY_CPU_PROFILE]),
            turnOverride = prefs[KEY_TURN_OVERRIDE] ?: "auto",
            practiceAutoPlay = prefs[KEY_PRACTICE_AUTO] ?: false,
            practiceHumanDelayMs = (prefs[KEY_PRACTICE_DELAY] ?: 650).coerceIn(250, 2500)
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
            prefs[KEY_MULTI_PV] = config.multiPv.coerceIn(1, 3)
            prefs[KEY_DEPTH] = config.maxDepth.coerceIn(2, 20)
            prefs[KEY_SKILL] = config.skillLevel.coerceIn(0, 20)
            prefs[KEY_CPU_PROFILE] = config.cpuProfile.key
            prefs[KEY_TURN_OVERRIDE] = config.turnOverride
            prefs[KEY_PRACTICE_AUTO] = config.practiceAutoPlay
            prefs[KEY_PRACTICE_DELAY] = config.practiceHumanDelayMs.coerceIn(250, 2500)
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
        private val KEY_PRACTICE_AUTO = booleanPreferencesKey("ext_practice_auto")
        private val KEY_PRACTICE_DELAY = intPreferencesKey("ext_practice_delay")
    }
}
