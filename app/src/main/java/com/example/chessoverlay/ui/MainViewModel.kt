package com.example.chessoverlay.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.chessoverlay.bridge.FairPlayTelemetryParser
import com.example.chessoverlay.model.AnalysisLine
import com.example.chessoverlay.model.AndroidOverlayRuntimeMode
import com.example.chessoverlay.model.BoardThemeInfo
import com.example.chessoverlay.model.BrowserAnalysisSnapshot
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.BrowserSitePreset
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.model.FairPlayRiskLevel
import com.example.chessoverlay.model.FairPlayStatus
import com.example.chessoverlay.model.FairPlayTelemetryModel
import com.example.chessoverlay.model.MoveAnnotationInfo
import com.example.chessoverlay.model.OpeningBookMove
import com.example.chessoverlay.model.OpeningBookState
import com.example.chessoverlay.model.TablebaseMove
import com.example.chessoverlay.model.TablebaseState
import com.example.chessoverlay.model.WorkspaceTab
import com.example.chessoverlay.util.AppLogger
import com.example.chessoverlay.util.AssetManagerHelper
import com.example.chessoverlay.util.PreferencesRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainViewModel(application: Application) : AndroidViewModel(application) {

    private val preferences = PreferencesRepository(application)

    private val _selectedTab = MutableStateFlow(WorkspaceTab.EXTENSION)
    val selectedTab: StateFlow<WorkspaceTab> = _selectedTab.asStateFlow()

    private val _extensionConfig = MutableStateFlow(BrowserExtensionConfig())
    val extensionConfig: StateFlow<BrowserExtensionConfig> = _extensionConfig.asStateFlow()

    private val _activeUrl = MutableStateFlow(AssetManagerHelper.PRACTICE_BOARD_URL)
    val activeUrl: StateFlow<String> = _activeUrl.asStateFlow()

    private val _liveAnalysis = MutableStateFlow(BrowserAnalysisSnapshot())
    val liveAnalysis: StateFlow<BrowserAnalysisSnapshot> = _liveAnalysis.asStateFlow()

    private val _engineStatus = MutableStateFlow(EngineStatus.LOADING)
    val engineStatus: StateFlow<EngineStatus> = _engineStatus.asStateFlow()

    private val _exportStatus = MutableStateFlow<String?>(null)
    val exportStatus: StateFlow<String?> = _exportStatus.asStateFlow()

    private val _extensionAssetsReady = MutableStateFlow(false)
    val extensionAssetsReady: StateFlow<Boolean> = _extensionAssetsReady.asStateFlow()

    private val _reloadNonce = MutableStateFlow(0)
    val reloadNonce: StateFlow<Int> = _reloadNonce.asStateFlow()

    private val _telemetryResetNonce = MutableStateFlow(0)
    val telemetryResetNonce: StateFlow<Int> = _telemetryResetNonce.asStateFlow()

    private val _telemetryStatusMessage = MutableStateFlow<String?>(null)
    val telemetryStatusMessage: StateFlow<String?> = _telemetryStatusMessage.asStateFlow()

    init {
        viewModelScope.launch {
            preferences.extensionConfigFlow.collect { stored ->
                _extensionConfig.value = stored
            }
        }
        viewModelScope.launch(Dispatchers.IO) {
            val ready = verifyExtensionAssets()
            _extensionAssetsReady.value = ready
            _engineStatus.value = if (ready) EngineStatus.IDLE else EngineStatus.ERROR
        }
    }

    private fun verifyExtensionAssets(): Boolean {
        val ctx = getApplication<Application>()
        return try {
            val hasEngine = AssetManagerHelper.readAssetText(ctx, AssetManagerHelper.EXTENSION_ENGINE_JS).isNotEmpty()
            val hasBook = AssetManagerHelper.readAssetText(ctx, AssetManagerHelper.EXTENSION_OPENING_BOOK_JS).isNotEmpty()
            val hasTablebase = AssetManagerHelper.readAssetText(ctx, AssetManagerHelper.EXTENSION_SYZYGY_TABLEBASE_JS).isNotEmpty()
            val hasContent = AssetManagerHelper.readAssetText(ctx, AssetManagerHelper.EXTENSION_CONTENT_JS).isNotEmpty()
            val hasZip = ctx.assets.open(AssetManagerHelper.EXTENSION_ZIP_ASSET).use { it.available() > 0 }
            hasEngine && hasBook && hasTablebase && hasContent && hasZip
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Extension asset check failed: ${t.message}")
            false
        }
    }

    fun selectTab(tab: WorkspaceTab) {
        _selectedTab.value = tab
    }

    fun openInBrowser() {
        _selectedTab.value = WorkspaceTab.BROWSER
    }

    fun selectPreset(preset: BrowserSitePreset) {
        _activeUrl.value = preset.url
        _selectedTab.value = WorkspaceTab.BROWSER
        _engineStatus.value = EngineStatus.LOADING
        _reloadNonce.update { it + 1 }
    }

    fun navigateToUrl(rawInput: String) {
        val trimmed = rawInput.trim()
        val resolved = when {
            trimmed.isEmpty() -> AssetManagerHelper.PRACTICE_BOARD_URL
            trimmed.startsWith("http://", ignoreCase = true) ||
                trimmed.startsWith("https://", ignoreCase = true) ||
                trimmed.startsWith("file://", ignoreCase = true) -> trimmed
            else -> "https://$trimmed"
        }
        _activeUrl.value = resolved
        _engineStatus.value = EngineStatus.LOADING
        _reloadNonce.update { it + 1 }
    }

    fun setEngineStatus(status: EngineStatus) {
        _engineStatus.value = status
    }

    fun setExtensionEnabled(enabled: Boolean) = updateConfig { it.copy(enabled = enabled) }

    fun setShowArrows(showArrows: Boolean) = updateConfig { it.copy(showArrows = showArrows) }

    fun setShowHud(showHud: Boolean) = updateConfig { it.copy(showHud = showHud) }

    fun setShowEvalBar(showEvalBar: Boolean) = updateConfig { it.copy(showEvalBar = showEvalBar) }

    fun setShowAnnotations(showAnnotations: Boolean) = updateConfig { it.copy(showAnnotations = showAnnotations) }

    fun setShowOpeningBook(showOpeningBook: Boolean) = updateConfig { it.copy(showOpeningBook = showOpeningBook) }

    fun setShowTablebase(showTablebase: Boolean) = updateConfig { it.copy(showTablebase = showTablebase) }

    fun setAutoAdaptTheme(autoAdaptTheme: Boolean) = updateConfig { it.copy(autoAdaptTheme = autoAdaptTheme) }

    fun setEvalBarOrientation(orientation: EvalBarOrientation) =
        updateConfig { it.copy(evalBarOrientation = orientation) }

    fun setMultiPv(multiPv: Int) = updateConfig { it.copy(multiPv = multiPv.coerceIn(1, 4)) }

    fun setMaxDepth(depth: Int) = updateConfig { it.copy(maxDepth = depth.coerceIn(2, 20)) }

    fun setSkillLevel(skill: Int) = updateConfig { it.copy(skillLevel = skill.coerceIn(0, 20)) }

    fun setCpuProfile(profile: CpuUsageProfile) = updateConfig { it.copy(cpuProfile = profile) }

    fun setFairPlayAuditorEnabled(enabled: Boolean) {
        updateConfig { it.copy(fairPlayAuditorEnabled = enabled) }
        if (!enabled) {
            _liveAnalysis.update { snap ->
                snap.copy(
                    fairPlayStatus = snap.fairPlayStatus.copy(
                        riskLevel = FairPlayRiskLevel.SAFE,
                        lockedOut = false
                    )
                )
            }
        }
    }

    fun setHumanizerEnabled(enabled: Boolean) = updateConfig { it.copy(humanizerEnabled = enabled) }

    fun setTargetElo(elo: Int) = updateConfig { it.copy(targetElo = elo.coerceIn(400, 3000)) }

    fun setMaxHintsPerGame(hints: Int) = updateConfig { it.copy(maxHintsPerGame = hints.coerceIn(1, 5)) }

    fun clearSessionTelemetry() {
        viewModelScope.launch {
            preferences.clearSessionTelemetryStorage()
        }
        val baseline = _extensionConfig.value.targetElo
        val resetStatus = FairPlayStatus(
            riskLevel = FairPlayRiskLevel.SAFE,
            lockedOut = false,
            lockoutReason = null,
            baselineElo = baseline,
            observedIpr = baseline,
            zScore = 0f,
            currentGameMoves = 0,
            currentGameSiSpikes = 0,
            slidingWindowGames = 0,
            acpl = 0f,
            warnings = emptyList()
        )
        _liveAnalysis.update { current ->
            current.copy(
                fairPlayStatus = resetStatus,
                fairPlayTelemetry = resetStatus.toTelemetryModel()
            )
        }
        _telemetryResetNonce.update { it + 1 }
        _telemetryStatusMessage.value = "Session telemetry storage cleared (0/20 window games, SAFE)."
    }

    fun setPracticeAutoPlay(enabled: Boolean) = updateConfig { it.copy(practiceAutoPlay = enabled) }

    fun setAutonomousMode(enabled: Boolean) = updateConfig { it.copy(autonomousMode = enabled) }

    fun setAutonomousEloProfile(elo: Int) {
        val safeElo = if (elo in listOf(1200, 1600, 2000)) elo else 1600
        updateConfig { it.copy(autonomousEloProfile = safeElo) }
    }

    fun setAndroidRuntimeMode(mode: AndroidOverlayRuntimeMode) =
        updateConfig { it.copy(androidRuntimeMode = mode) }

    fun setAccessibilityDispatcherEnabled(enabled: Boolean) =
        updateConfig { it.copy(accessibilityDispatcherEnabled = enabled) }

    fun onFairPlayTelemetryJson(rawJson: String) {
        val parsed = FairPlayTelemetryParser.parse(rawJson, _extensionConfig.value.targetElo) ?: return
        onFairPlayTelemetry(parsed)
    }

    fun onFairPlayTelemetry(model: FairPlayTelemetryModel) {
        _liveAnalysis.update { current ->
            current.copy(
                fairPlayStatus = model.toFairPlayStatus(),
                fairPlayTelemetry = model
            )
        }
    }

    fun setPracticeHumanDelayMs(delayMs: Int) =
        updateConfig { it.copy(practiceHumanDelayMs = delayMs.coerceIn(250, 2500)) }

    fun setTurnOverride(turn: String) {
        val safe = when (turn) {
            "w", "b" -> turn
            else -> "auto"
        }
        updateConfig { it.copy(turnOverride = safe) }
    }

    private inline fun updateConfig(transform: (BrowserExtensionConfig) -> BrowserExtensionConfig) {
        val updated = transform(_extensionConfig.value)
        _extensionConfig.value = updated
        viewModelScope.launch {
            preferences.saveExtensionConfig(updated)
        }
    }

    fun onWebAnalysisJson(rawJson: String) {
        if (rawJson.isBlank()) return
        try {
            val root = JSONObject(rawJson)
            val fen = root.optString("fen", "")
            val depth = root.optInt("depth", 0)
            val nodes = root.optLong("nodes", 0L)
            val elapsedMs = root.optLong("elapsedMs", 0L)
            val backend = root.optString("engineBackend", "Stockfish 19 WASM")
            val rawStatus = root.optString("status", "IDLE")
            val parsedStatus = when (rawStatus.uppercase()) {
                "LOADING" -> EngineStatus.LOADING
                "CALCULATING" -> EngineStatus.CALCULATING
                "ERROR" -> EngineStatus.ERROR
                else -> EngineStatus.IDLE
            }
            val linesArr = root.optJSONArray("lines")
            val parsedLines = buildList {
                if (linesArr != null) {
                    for (i in 0 until linesArr.length()) {
                        val obj = linesArr.optJSONObject(i) ?: continue
                        val uci = obj.optString("uci", "")
                        if (uci.isBlank()) continue
                        val mate = if (obj.has("mate") && !obj.isNull("mate")) obj.optInt("mate") else null
                        val cp = if (obj.has("centipawns") && !obj.isNull("centipawns")) obj.optInt("centipawns") else null
                        val whiteMate = if (obj.has("whiteMate") && !obj.isNull("whiteMate")) obj.optInt("whiteMate") else mate
                        val whiteCp = if (obj.has("whiteCp") && !obj.isNull("whiteCp")) obj.optInt("whiteCp") else cp
                        val winPct = obj.optDouble("winPct", 50.0).toFloat()
                        val whiteWinPct = obj.optDouble("whiteWinPct", winPct.toDouble()).toFloat()
                        add(
                            AnalysisLine(
                                rank = obj.optInt("rank", i + 1),
                                uci = uci,
                                san = obj.optString("san", uci),
                                winPct = winPct,
                                mate = mate,
                                depth = obj.optInt("depth", depth),
                                centipawns = cp,
                                whiteCentipawns = whiteCp,
                                whiteMate = whiteMate,
                                whiteWinPct = whiteWinPct,
                                annotation = obj.optString("annotation", ""),
                                nodes = nodes
                            )
                        )
                    }
                }
            }

            val bookObj = root.optJSONObject("openingBook")
            val parsedBook = if (bookObj != null) {
                val bookMovesArr = bookObj.optJSONArray("moves")
                val bookMoves = buildList {
                    if (bookMovesArr != null) {
                        for (i in 0 until bookMovesArr.length()) {
                            val m = bookMovesArr.optJSONObject(i) ?: continue
                            add(
                                OpeningBookMove(
                                    uci = m.optString("uci", ""),
                                    san = m.optString("san", ""),
                                    games = m.optLong("games", 0L),
                                    whitePct = m.optInt("whitePct", 0),
                                    drawPct = m.optInt("drawPct", 0),
                                    blackPct = m.optInt("blackPct", 0)
                                )
                            )
                        }
                    }
                }
                OpeningBookState(
                    inBook = bookObj.optBoolean("inBook", false),
                    eco = bookObj.optString("eco", ""),
                    opening = bookObj.optString("opening", ""),
                    source = bookObj.optString("source", ""),
                    moves = bookMoves
                )
            } else null

            val tbObj = root.optJSONObject("tablebase")
            val parsedTb = if (tbObj != null && tbObj.optBoolean("isTablebase", false)) {
                val tbMovesArr = tbObj.optJSONArray("moves")
                val tbMoves = buildList {
                    if (tbMovesArr != null) {
                        for (i in 0 until tbMovesArr.length()) {
                            val m = tbMovesArr.optJSONObject(i) ?: continue
                            val dtmVal = if (m.has("dtm") && !m.isNull("dtm")) m.optInt("dtm") else null
                            val dtzVal = if (m.has("dtz") && !m.isNull("dtz")) m.optInt("dtz") else null
                            add(
                                TablebaseMove(
                                    uci = m.optString("uci", ""),
                                    san = m.optString("san", m.optString("uci", "")),
                                    quality = m.optString("quality", "draw"),
                                    annotation = m.optString("annotation", "="),
                                    dtm = dtmVal,
                                    dtz = dtzVal,
                                    checkmate = m.optBoolean("checkmate", false),
                                    stalemate = m.optBoolean("stalemate", false)
                                )
                            )
                        }
                    }
                }
                val rootDtm = if (tbObj.has("dtm") && !tbObj.isNull("dtm")) tbObj.optInt("dtm") else null
                val rootDtz = if (tbObj.has("dtz") && !tbObj.isNull("dtz")) tbObj.optInt("dtz") else null
                TablebaseState(
                    isTablebase = true,
                    pieceCount = tbObj.optInt("pieceCount", 7),
                    turn = tbObj.optString("turn", "w"),
                    category = tbObj.optString("category", "draw"),
                    outcome = tbObj.optString("outcome", "Tablebase Draw"),
                    scoreBadge = tbObj.optString("scoreBadge", "TB Draw"),
                    dtz = rootDtz,
                    dtm = rootDtm,
                    checkmate = tbObj.optBoolean("checkmate", false),
                    stalemate = tbObj.optBoolean("stalemate", false),
                    source = tbObj.optString("source", "Syzygy 7-Piece"),
                    moves = tbMoves
                )
            } else null

            val themeObj = root.optJSONObject("boardTheme")
            val parsedTheme = if (themeObj != null) {
                BoardThemeInfo(
                    name = themeObj.optString("name", "Auto"),
                    isDark = themeObj.optBoolean("isDark", true),
                    hue = themeObj.optString("hue", "neutral"),
                    accentHex = themeObj.optString("accentHex", "#10B981")
                )
            } else BoardThemeInfo()

            val annObj = root.optJSONObject("lastMoveAnnotation")
            val parsedAnn = if (annObj != null && !annObj.optString("symbol", "").isNullOrBlank()) {
                MoveAnnotationInfo(
                    square = annObj.optString("sq", ""),
                    symbol = annObj.optString("symbol", ""),
                    label = annObj.optString("label", ""),
                    cpLoss = annObj.optInt("cpLoss", 0)
                )
            } else null

            val fpObj = root.optJSONObject("fairPlay")
            val parsedFairPlay = if (fpObj != null) {
                val warnArr = fpObj.optJSONArray("warnings")
                val warnList = buildList {
                    if (warnArr != null) {
                        for (i in 0 until warnArr.length()) {
                            val w = warnArr.optJSONObject(i) ?: continue
                            val msg = w.optString("message", "")
                            if (msg.isNotBlank()) add(msg)
                        }
                    }
                }
                val baseline = fpObj.optInt("baselineElo", _extensionConfig.value.targetElo)
                FairPlayStatus(
                    riskLevel = FairPlayRiskLevel.fromKey(fpObj.optString("riskLevel", "SAFE")),
                    lockedOut = fpObj.optBoolean("lockedOut", false),
                    lockoutReason = fpObj.optString("lockoutReason", "").takeIf { it.isNotBlank() },
                    baselineElo = baseline,
                    observedIpr = fpObj.optInt("observedIpr", baseline),
                    zScore = fpObj.optDouble("zScore", 0.0).toFloat(),
                    currentGameMoves = fpObj.optInt("currentGameMoves", 0),
                    currentGameSiSpikes = fpObj.optInt("currentGameSiSpikes", 0),
                    slidingWindowGames = fpObj.optInt("slidingWindowGames", 0),
                    acpl = fpObj.optDouble("acpl", 0.0).toFloat(),
                    warnings = warnList
                )
            } else _liveAnalysis.value.fairPlayStatus

            val parsedTelemetry = if (fpObj != null) {
                parsedFairPlay.toTelemetryModel(
                    lastSiScore = fpObj.optDouble("lastSiScore", fpObj.optDouble("siScore", 0.0)).toFloat(),
                    updatedAtMs = fpObj.optLong("updatedAtMs", System.currentTimeMillis())
                )
            } else {
                _liveAnalysis.value.fairPlayTelemetry
            }

            _engineStatus.value = parsedStatus
            _liveAnalysis.value = BrowserAnalysisSnapshot(
                fen = fen,
                depth = depth,
                nodes = nodes,
                elapsedMs = elapsedMs,
                engineBackend = backend,
                status = parsedStatus,
                lines = parsedLines,
                openingBook = parsedBook,
                tablebase = parsedTb,
                boardTheme = parsedTheme,
                lastMoveAnnotation = parsedAnn,
                fairPlayStatus = parsedFairPlay,
                fairPlayTelemetry = parsedTelemetry
            )
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Failed parsing browser engine update: ${t.message}")
            _engineStatus.value = EngineStatus.ERROR
        }
    }

    fun setExportStatus(message: String?) {
        _exportStatus.value = message
    }

    companion object {
        private const val TAG = "MainViewModel"
    }
}
