package com.example.chessoverlay.engine

import com.example.chessoverlay.model.AnalysisLine
import kotlin.math.exp

object UciParser {
    private val INFO_PV_REGEX = Regex(
        """^info\b.*\bmultipv\s+(\d+)\b.*\bscore\s+(cp|mate)\s+(-?\d+)\b.*\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?(?:\s+[a-h][1-8][a-h][1-8][qrbn]?)*)"""
    )
    private val INFO_SINGLE_PV_REGEX = Regex(
        """^info\b.*\bscore\s+(cp|mate)\s+(-?\d+)\b.*\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?(?:\s+[a-h][1-8][a-h][1-8][qrbn]?)*)"""
    )
    private val DEPTH_REGEX = Regex("""\bdepth\s+(\d+)\b""")
    private val SELDEPTH_REGEX = Regex("""\bseldepth\s+(\d+)\b""")
    private val NODES_REGEX = Regex("""\bnodes\s+(\d+)\b""")
    private val NPS_REGEX = Regex("""\bnps\s+(\d+)\b""")
    private val WDL_REGEX = Regex("""\bwdl\s+(\d+)\s+(\d+)\s+(\d+)\b""")
    private val BESTMOVE_REGEX = Regex("""^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?|\(none\)|0000)""")

    data class ParsedInfoLine(
        val rank: Int,
        val uci: String,
        val winPct: Float,
        val mate: Int?,
        val pvMoves: List<String>,
        val depth: Int = 0,
        val selDepth: Int = 0,
        val centipawns: Int? = null,
        val wdlWin: Int? = null,
        val wdlDraw: Int? = null,
        val wdlLoss: Int? = null,
        val nodes: Long = 0L,
        val nps: Long = 0L
    )

    fun cpToWinPct(cp: Int): Float {
        val raw = 50.0 + 50.0 * ((2.0 / (1.0 + exp(-0.00368208 * cp.toDouble()))) - 1.0)
        return raw.toFloat().coerceIn(0.1f, 99.9f)
    }

    fun mateToWinPct(mate: Int): Float {
        return when {
            mate > 0 -> 99.9f
            mate < 0 -> 0.1f
            else -> 50.0f
        }
    }

    fun wdlOrCpWinPct(isMate: Boolean, scoreValue: Int, wdlWin: Int, wdlDraw: Int, wdlLoss: Int): Float {
        if (isMate) return mateToWinPct(scoreValue)
        val total = wdlWin + wdlDraw + wdlLoss
        if (wdlWin >= 0 && total > 0) {
            return (((wdlWin + wdlDraw * 0.5f) / total.toFloat()) * 100f).coerceIn(0.1f, 99.9f)
        }
        return cpToWinPct(scoreValue)
    }

    fun parseInfoLine(line: String): ParsedInfoLine? {
        val trimmed = line.trim()
        if (!trimmed.startsWith("info ")) return null
        if (trimmed.contains("upperbound") || trimmed.contains("lowerbound")) return null

        val match = INFO_PV_REGEX.find(trimmed)
        val rank: Int
        val scoreType: String
        val scoreVal: Int
        val pvRaw: String

        if (match != null) {
            rank = match.groupValues[1].toIntOrNull() ?: 1
            scoreType = match.groupValues[2]
            scoreVal = match.groupValues[3].toIntOrNull() ?: 0
            pvRaw = match.groupValues[4]
        } else {
            val singleMatch = INFO_SINGLE_PV_REGEX.find(trimmed) ?: return null
            rank = 1
            scoreType = singleMatch.groupValues[1]
            scoreVal = singleMatch.groupValues[2].toIntOrNull() ?: 0
            pvRaw = singleMatch.groupValues[3]
        }

        val pvMoves = pvRaw.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val firstMove = pvMoves.firstOrNull() ?: return null
        val isMate = scoreType == "mate"
        val mate = if (isMate) scoreVal else null
        val cp = if (isMate) null else scoreVal

        val depth = DEPTH_REGEX.find(trimmed)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val selDepth = SELDEPTH_REGEX.find(trimmed)?.groupValues?.get(1)?.toIntOrNull() ?: 0
        val nodes = NODES_REGEX.find(trimmed)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        val nps = NPS_REGEX.find(trimmed)?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        val wdlMatch = WDL_REGEX.find(trimmed)
        val wdlW = wdlMatch?.groupValues?.get(1)?.toIntOrNull()
        val wdlD = wdlMatch?.groupValues?.get(2)?.toIntOrNull()
        val wdlL = wdlMatch?.groupValues?.get(3)?.toIntOrNull()

        val winPct = wdlOrCpWinPct(
            isMate = isMate,
            scoreValue = scoreVal,
            wdlWin = wdlW ?: -1,
            wdlDraw = wdlD ?: -1,
            wdlLoss = wdlL ?: -1
        )

        return ParsedInfoLine(
            rank = rank,
            uci = firstMove,
            winPct = winPct,
            mate = mate,
            pvMoves = pvMoves,
            depth = depth,
            selDepth = selDepth,
            centipawns = cp,
            wdlWin = wdlW,
            wdlDraw = wdlD,
            wdlLoss = wdlL,
            nodes = nodes,
            nps = nps
        )
    }

    fun parseBestMove(line: String): String? {
        val trimmed = line.trim()
        val match = BESTMOVE_REGEX.find(trimmed) ?: return null
        val move = match.groupValues[1]
        return if (move == "(none)" || move == "0000") null else move
    }

    fun collectTopLines(
        linesByRank: Map<Int, ParsedInfoLine>,
        bestMoveUci: String?,
        multiPv: Int,
        sanConverter: (String) -> String
    ): List<AnalysisLine> {
        val sorted = linesByRank.values
            .sortedBy { it.rank }
            .take(multiPv)
            .map { info ->
                AnalysisLine(
                    rank = info.rank,
                    uci = info.uci,
                    san = sanConverter(info.uci),
                    winPct = info.winPct,
                    mate = info.mate,
                    depth = info.depth,
                    selDepth = info.selDepth,
                    centipawns = info.centipawns,
                    wdlWin = info.wdlWin,
                    wdlDraw = info.wdlDraw,
                    wdlLoss = info.wdlLoss,
                    nodes = info.nodes,
                    nps = info.nps,
                    pv = info.pvMoves.joinToString(" ")
                )
            }
        if (sorted.isNotEmpty()) return sorted
        if (!bestMoveUci.isNullOrBlank()) {
            return listOf(
                AnalysisLine(
                    rank = 1,
                    uci = bestMoveUci,
                    san = sanConverter(bestMoveUci),
                    winPct = 50.0f,
                    mate = null
                )
            )
        }
        return emptyList()
    }
}
