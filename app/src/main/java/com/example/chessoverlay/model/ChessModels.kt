package com.example.chessoverlay.model

enum class WorkspaceTab {
    EXTENSION,
    BROWSER,
    SETTINGS
}

enum class BrowserSitePreset(val label: String, val url: String) {
    PRACTICE("Practice", "file:///android_asset/practice_board.html"),
    LICHESS("Lichess", "https://lichess.org/analysis"),
    LICHESS_PUZZLES("Lichess Puzzles", "https://lichess.org/training"),
    CHESS_COM("Chess.com", "https://www.chess.com/analysis"),
    CHESS_COM_PUZZLES("Chess.com Puzzles", "https://www.chess.com/puzzles")
}

enum class EngineStatus(val label: String) {
    LOADING("Loading"),
    CALCULATING("Calculating"),
    IDLE("Idle"),
    ERROR("Error")
}

enum class CpuUsageProfile(
    val key: String,
    val label: String,
    val detail: String,
    val fallbackDepthCap: Int
) {
    ECO("eco", "Eco", "32 MB Hash • D10", 3),
    BALANCED("balanced", "Balanced", "64 MB Hash • D16", 4),
    TURBO("turbo", "Turbo", "128 MB Hash • D20", 6);

    companion object {
        fun fromKey(key: String?): CpuUsageProfile {
            return entries.firstOrNull { it.key.equals(key, ignoreCase = true) } ?: BALANCED
        }
    }
}

enum class EvalBarOrientation(val key: String, val label: String) {
    VERTICAL("vertical", "Vertical"),
    HORIZONTAL("horizontal", "Horizontal");

    companion object {
        fun fromKey(key: String?): EvalBarOrientation {
            return entries.firstOrNull { it.key.equals(key, ignoreCase = true) } ?: VERTICAL
        }
    }
}

enum class FairPlayRiskLevel(val key: String, val label: String) {
    SAFE("SAFE", "SAFE"),
    ELEVATED("ELEVATED", "ELEVATED"),
    LOCKOUT("LOCKOUT", "LOCKOUT");

    companion object {
        fun fromKey(key: String?): FairPlayRiskLevel {
            return entries.firstOrNull { it.key.equals(key, ignoreCase = true) } ?: SAFE
        }
    }
}

enum class AndroidOverlayRuntimeMode(val key: String, val label: String) {
    NATIVE_ACCESSIBILITY_OVERLAY("native_accessibility", "Native Chrome Overlay"),
    WEBVIEW_COMPAT("webview_compat", "WebView Compat");

    companion object {
        fun fromKey(key: String?): AndroidOverlayRuntimeMode {
            return entries.firstOrNull { it.key.equals(key, ignoreCase = true) }
                ?: NATIVE_ACCESSIBILITY_OVERLAY
        }
    }
}

data class FairPlayTelemetryModel(
    val riskLevel: FairPlayRiskLevel = FairPlayRiskLevel.SAFE,
    val lockedOut: Boolean = false,
    val lockoutReason: String? = null,
    val baselineElo: Int = 1500,
    val observedIpr: Int = 1500,
    val zScore: Float = 0f,
    val currentGameMoves: Int = 0,
    val currentGameSiSpikes: Int = 0,
    val lastSiScore: Float = 0f,
    val slidingWindowGames: Int = 0,
    val acpl: Float = 0f,
    val warnings: List<String> = emptyList(),
    val updatedAtMs: Long = 0L
) {
    fun toFairPlayStatus(): FairPlayStatus = FairPlayStatus(
        riskLevel = riskLevel,
        lockedOut = lockedOut,
        lockoutReason = lockoutReason,
        baselineElo = baselineElo,
        observedIpr = observedIpr,
        zScore = zScore,
        currentGameMoves = currentGameMoves,
        currentGameSiSpikes = currentGameSiSpikes,
        slidingWindowGames = slidingWindowGames,
        acpl = acpl,
        warnings = warnings
    )
}

data class FairPlayStatus(
    val riskLevel: FairPlayRiskLevel = FairPlayRiskLevel.SAFE,
    val lockedOut: Boolean = false,
    val lockoutReason: String? = null,
    val baselineElo: Int = 1500,
    val observedIpr: Int = 1500,
    val zScore: Float = 0f,
    val currentGameMoves: Int = 0,
    val currentGameSiSpikes: Int = 0,
    val slidingWindowGames: Int = 0,
    val acpl: Float = 0f,
    val warnings: List<String> = emptyList()
) {
    fun toTelemetryModel(lastSiScore: Float = 0f, updatedAtMs: Long = 0L): FairPlayTelemetryModel =
        FairPlayTelemetryModel(
            riskLevel = riskLevel,
            lockedOut = lockedOut,
            lockoutReason = lockoutReason,
            baselineElo = baselineElo,
            observedIpr = observedIpr,
            zScore = zScore,
            currentGameMoves = currentGameMoves,
            currentGameSiSpikes = currentGameSiSpikes,
            lastSiScore = lastSiScore,
            slidingWindowGames = slidingWindowGames,
            acpl = acpl,
            warnings = warnings,
            updatedAtMs = updatedAtMs
        )
}

enum class AutonomousEloProfile(
    val elo: Int,
    val label: String,
    val title: String,
    val subtitle: String,
    val blunderCapCp: Int,
    val baseTemp: Float,
    val depth: Int
) {
    ELO_800(800, "800", "800 Elo", "Beginner", 260, 1.45f, 8),
    ELO_1000(1000, "1000", "1000 Elo", "Casual", 210, 1.25f, 10),
    ELO_1200(1200, "1200", "1200 Elo", "Club Novice", 165, 1.08f, 14),
    ELO_1600(1600, "1600", "1600 Elo", "Intermediate", 105, 0.78f, 16),
    ELO_2000(2000, "2000", "2000 Elo", "Expert Candidate", 60, 0.50f, 18),
    ELO_2400(2400, "2400", "2400 Elo", "Master / IM", 25, 0.25f, 20),
    ELO_2800(2800, "2800", "2800 Elo", "Max GM Engine", 0, 0.0f, 20);

    companion object {
        val supportedElos: List<Int> = entries.map { it.elo }

        fun fromElo(elo: Int): AutonomousEloProfile {
            return entries.firstOrNull { it.elo == elo } ?: ELO_1600
        }
    }
}

enum class PuzzleLevelMode(
    val key: String,
    val label: String,
    val detail: String
) {
    ALL("all", "All Levels", "Adaptive D8–D20"),
    EASY("easy", "Easy", "400–1100 • D8"),
    MEDIUM("medium", "Club", "1100–1700 • D12"),
    HARD("hard", "Expert", "1700–2200 • D16"),
    MASTER("master", "GM", "2200+ • D20");

    companion object {
        fun fromKey(key: String?): PuzzleLevelMode {
            return entries.firstOrNull { it.key.equals(key, ignoreCase = true) } ?: ALL
        }
    }
}

data class BrowserExtensionConfig(
    val enabled: Boolean = true,
    val showArrows: Boolean = true,
    val showHud: Boolean = true,
    val showEvalBar: Boolean = true,
    val showAnnotations: Boolean = true,
    val showOpeningBook: Boolean = true,
    val showTablebase: Boolean = true,
    val autoAdaptTheme: Boolean = true,
    val evalBarOrientation: EvalBarOrientation = EvalBarOrientation.VERTICAL,
    val multiPv: Int = 2,
    val maxDepth: Int = 14,
    val skillLevel: Int = 20,
    val cpuProfile: CpuUsageProfile = CpuUsageProfile.BALANCED,
    val turnOverride: String = "auto",
    val fairPlayAuditorEnabled: Boolean = true,
    val humanizerEnabled: Boolean = true,
    val targetElo: Int = 1500,
    val maxHintsPerGame: Int = 3,
    val practiceAutoPlay: Boolean = false,
    val practiceHumanDelayMs: Int = 650,
    val autonomousMode: Boolean = false,
    val onlineAutoPlay: Boolean = false,
    val autonomousEloProfile: Int = 1600,
    val puzzleSolverEnabled: Boolean = false,
    val puzzleAutoSolve: Boolean = false,
    val puzzleAutoNext: Boolean = false,
    val puzzleLevelMode: PuzzleLevelMode = PuzzleLevelMode.ALL,
    val puzzleSolveDelayMs: Int = 450,
    val androidRuntimeMode: AndroidOverlayRuntimeMode = AndroidOverlayRuntimeMode.NATIVE_ACCESSIBILITY_OVERLAY,
    val accessibilityDispatcherEnabled: Boolean = false
) {
    fun toJsObjectLiteral(): String {
        val safeTurn = when (turnOverride) {
            "w", "b" -> turnOverride
            else -> "auto"
        }
        val safeEloProfile = if (autonomousEloProfile in AutonomousEloProfile.supportedElos) {
            autonomousEloProfile
        } else {
            1600
        }
        return "{" +
            "enabled:$enabled," +
            "showArrows:$showArrows," +
            "showHud:$showHud," +
            "showEvalBar:$showEvalBar," +
            "showAnnotations:$showAnnotations," +
            "showOpeningBook:$showOpeningBook," +
            "showTablebase:$showTablebase," +
            "autoAdaptTheme:$autoAdaptTheme," +
            "evalBarOrientation:'${evalBarOrientation.key}'," +
            "multiPv:${multiPv.coerceIn(1, 4)}," +
            "maxDepth:${maxDepth.coerceIn(2, 20)}," +
            "skillLevel:${skillLevel.coerceIn(0, 20)}," +
            "cpuProfile:'${cpuProfile.key}'," +
            "turnOverride:'$safeTurn'," +
            "fairPlayAuditorEnabled:$fairPlayAuditorEnabled," +
            "humanizerEnabled:$humanizerEnabled," +
            "targetElo:${targetElo.coerceIn(400, 3000)}," +
            "maxHintsPerGame:${maxHintsPerGame.coerceIn(1, 5)}," +
            "practiceAutoPlay:$practiceAutoPlay," +
            "practiceHumanDelayMs:${practiceHumanDelayMs.coerceIn(250, 2500)}," +
            "autonomousMode:$autonomousMode," +
            "onlineAutoPlay:$onlineAutoPlay," +
            "autonomousEloProfile:$safeEloProfile," +
            "puzzleSolverEnabled:$puzzleSolverEnabled," +
            "puzzleAutoSolve:$puzzleAutoSolve," +
            "puzzleAutoNext:$puzzleAutoNext," +
            "puzzleLevelMode:'${puzzleLevelMode.key}'," +
            "puzzleSolveDelayMs:${puzzleSolveDelayMs.coerceIn(150, 1500)}," +
            "androidRuntimeMode:'${androidRuntimeMode.key}'," +
            "accessibilityDispatcherEnabled:$accessibilityDispatcherEnabled" +
            "}"
    }
}

data class OpeningBookMove(
    val uci: String,
    val san: String,
    val games: Long,
    val whitePct: Int,
    val drawPct: Int,
    val blackPct: Int
)

data class OpeningBookState(
    val inBook: Boolean = false,
    val eco: String = "",
    val opening: String = "",
    val source: String = "",
    val moves: List<OpeningBookMove> = emptyList()
)

data class BoardThemeInfo(
    val name: String = "Auto",
    val isDark: Boolean = true,
    val hue: String = "neutral",
    val accentHex: String = "#10B981"
)

data class MoveAnnotationInfo(
    val square: String = "",
    val symbol: String = "",
    val label: String = "",
    val cpLoss: Int = 0
)

data class AnalysisLine(
    val rank: Int,
    val uci: String,
    val san: String,
    val winPct: Float,
    val mate: Int?,
    val depth: Int = 0,
    val selDepth: Int = 0,
    val centipawns: Int? = null,
    val whiteCentipawns: Int? = null,
    val whiteMate: Int? = null,
    val whiteWinPct: Float = winPct,
    val annotation: String = "",
    val wdlWin: Int? = null,
    val wdlDraw: Int? = null,
    val wdlLoss: Int? = null,
    val nodes: Long = 0L,
    val nps: Long = 0L,
    val pv: String = uci
)

data class TablebaseMove(
    val uci: String,
    val san: String,
    val quality: String = "draw",
    val annotation: String = "=",
    val dtm: Int? = null,
    val dtz: Int? = null,
    val checkmate: Boolean = false,
    val stalemate: Boolean = false
)

data class TablebaseState(
    val isTablebase: Boolean = false,
    val pieceCount: Int = 32,
    val turn: String = "w",
    val category: String = "draw",
    val outcome: String = "Tablebase Draw",
    val scoreBadge: String = "TB Draw",
    val dtz: Int? = null,
    val dtm: Int? = null,
    val checkmate: Boolean = false,
    val stalemate: Boolean = false,
    val source: String = "Syzygy 7-Piece",
    val moves: List<TablebaseMove> = emptyList()
)

data class BrowserAnalysisSnapshot(
    val fen: String = "",
    val depth: Int = 0,
    val nodes: Long = 0L,
    val elapsedMs: Long = 0L,
    val engineBackend: String = "Stockfish 19 WASM",
    val status: EngineStatus = EngineStatus.IDLE,
    val lines: List<AnalysisLine> = emptyList(),
    val openingBook: OpeningBookState? = null,
    val tablebase: TablebaseState? = null,
    val boardTheme: BoardThemeInfo = BoardThemeInfo(),
    val lastMoveAnnotation: MoveAnnotationInfo? = null,
    val fairPlayStatus: FairPlayStatus = FairPlayStatus(),
    val fairPlayTelemetry: FairPlayTelemetryModel = FairPlayTelemetryModel()
)
