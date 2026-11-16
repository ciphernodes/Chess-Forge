package com.example.chessoverlay.model

enum class WorkspaceTab {
    EXTENSION,
    BROWSER,
    SETTINGS
}

enum class BrowserSitePreset(val label: String, val url: String) {
    PRACTICE("Practice", "file:///android_asset/practice_board.html"),
    LICHESS("Lichess", "https://lichess.org/analysis"),
    CHESS_COM("Chess.com", "https://www.chess.com/analysis")
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

data class BrowserExtensionConfig(
    val enabled: Boolean = true,
    val showArrows: Boolean = true,
    val showHud: Boolean = true,
    val showEvalBar: Boolean = true,
    val showAnnotations: Boolean = true,
    val showOpeningBook: Boolean = true,
    val autoAdaptTheme: Boolean = true,
    val evalBarOrientation: EvalBarOrientation = EvalBarOrientation.VERTICAL,
    val multiPv: Int = 2,
    val maxDepth: Int = 14,
    val skillLevel: Int = 20,
    val cpuProfile: CpuUsageProfile = CpuUsageProfile.BALANCED,
    val turnOverride: String = "auto",
    val practiceAutoPlay: Boolean = false,
    val practiceHumanDelayMs: Int = 650
) {
    fun toJsObjectLiteral(): String {
        val safeTurn = when (turnOverride) {
            "w", "b" -> turnOverride
            else -> "auto"
        }
        return "{" +
            "enabled:$enabled," +
            "showArrows:$showArrows," +
            "showHud:$showHud," +
            "showEvalBar:$showEvalBar," +
            "showAnnotations:$showAnnotations," +
            "showOpeningBook:$showOpeningBook," +
            "autoAdaptTheme:$autoAdaptTheme," +
            "evalBarOrientation:'${evalBarOrientation.key}'," +
            "multiPv:${multiPv.coerceIn(1, 3)}," +
            "maxDepth:${maxDepth.coerceIn(2, 20)}," +
            "skillLevel:${skillLevel.coerceIn(0, 20)}," +
            "cpuProfile:'${cpuProfile.key}'," +
            "turnOverride:'$safeTurn'," +
            "practiceAutoPlay:$practiceAutoPlay," +
            "practiceHumanDelayMs:${practiceHumanDelayMs.coerceIn(250, 2500)}" +
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

data class BrowserAnalysisSnapshot(
    val fen: String = "",
    val depth: Int = 0,
    val nodes: Long = 0L,
    val elapsedMs: Long = 0L,
    val engineBackend: String = "Stockfish 19 WASM",
    val status: EngineStatus = EngineStatus.IDLE,
    val lines: List<AnalysisLine> = emptyList(),
    val openingBook: OpeningBookState? = null,
    val boardTheme: BoardThemeInfo = BoardThemeInfo(),
    val lastMoveAnnotation: MoveAnnotationInfo? = null
)
