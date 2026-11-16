package com.example.chessoverlay.ui.components

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.chessoverlay.model.AnalysisLine
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.ui.theme.CarbonSurface
import com.example.chessoverlay.ui.theme.HairlineBorder
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import kotlin.math.abs

private val EvalWhiteSurface = Color(0xFFF0F6FC)
private val EvalBlackSurface = Color(0xFF1A2029)

@Composable
fun EvaluationBar(
    topLine: AnalysisLine?,
    orientation: EvalBarOrientation,
    modifier: Modifier = Modifier
) {
    val targetRatio = ((topLine?.whiteWinPct ?: 50f) / 100f).coerceIn(0.03f, 0.97f)
    val animatedRatio by animateFloatAsState(
        targetValue = targetRatio,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "eval_bar_ratio"
    )

    val scoreText = formatEvalScore(topLine)
    val whiteWinning = animatedRatio >= 0.5f

    Surface(
        modifier = modifier.testTag("evaluation_bar"),
        shape = RoundedCornerShape(10.dp),
        color = CarbonSurface,
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        if (orientation == EvalBarOrientation.VERTICAL) {
            Box(
                modifier = Modifier
                    .width(28.dp)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(10.dp))
                    .background(EvalBlackSurface)
            ) {
                // White fill rises from bottom
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .fillMaxHeight(animatedRatio)
                        .background(EvalWhiteSurface)
                )

                Text(
                    text = scoreText,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = if (whiteWinning) Color(0xFF0D1117) else EvalWhiteSurface,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .align(if (whiteWinning) Alignment.BottomCenter else Alignment.TopCenter)
                        .padding(vertical = 6.dp, horizontal = 2.dp)
                )
            }
        } else {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(28.dp)
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = "W",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = EvalWhiteSurface
                )

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .height(14.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(EvalBlackSurface)
                ) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.CenterStart)
                            .fillMaxHeight()
                            .fillMaxWidth(animatedRatio)
                            .background(EvalWhiteSurface)
                    )
                }

                Text(
                    text = "B",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )

                Text(
                    text = scoreText,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = if (whiteWinning) TacticalEmerald else TacticalAmber,
                    modifier = Modifier.testTag("evaluation_bar_score")
                )
            }
        }
    }
}

private fun formatEvalScore(topLine: AnalysisLine?): String {
    if (topLine == null) return "0.0"
    val mate = topLine.whiteMate ?: topLine.mate
    if (mate != null) {
        return (if (mate > 0) "+M" else "-M") + abs(mate)
    }
    val cp = topLine.whiteCentipawns ?: topLine.centipawns ?: return "0.0"
    val pawns = cp / 100f
    return if (pawns >= 0f) "+%.1f".format(pawns) else "%.1f".format(pawns)
}
