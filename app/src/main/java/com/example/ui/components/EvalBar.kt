package com.example.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.abs

@Composable
fun EvalBar(
    scoreCp: Int,
    mateIn: Int? = null,
    modifier: Modifier = Modifier
) {
    // Normalization: 0 cp -> 50% white, +500 cp -> ~85% white, -500 cp -> ~15% white
    val rawRatio = if (mateIn != null) {
        if (mateIn > 0) 0.98f else 0.02f
    } else {
        val clampedCp = scoreCp.coerceIn(-1000, 1000)
        0.5f + (clampedCp / 2000f)
    }

    val animatedRatio by animateFloatAsState(
        targetValue = rawRatio.coerceIn(0.04f, 0.96f),
        animationSpec = tween(durationMillis = 350),
        label = "eval_ratio"
    )

    val scoreText = if (mateIn != null) {
        if (mateIn > 0) "+M$mateIn" else "-M${abs(mateIn)}"
    } else {
        val pawns = scoreCp / 100.0
        if (pawns >= 0) "+%.2f".format(pawns) else "%.2f".format(pawns)
    }

    val badgeColor = if (scoreCp >= 0) Color(0xFF0D9488) else Color(0xFFE11D48)

    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(28.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF1E293B))
            .testTag("eval_bar"),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // White portion (left)
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .weight(animatedRatio)
                .background(Color(0xFFF1F5F9))
                .padding(horizontal = 8.dp),
            contentAlignment = Alignment.CenterStart
        ) {
            if (animatedRatio > 0.35f) {
                Text(
                    text = scoreText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color(0xFF0F172A)
                )
            }
        }

        // Black portion (right)
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .weight(1f - animatedRatio)
                .background(Color(0xFF0F172A))
                .padding(horizontal = 8.dp),
            contentAlignment = Alignment.CenterEnd
        ) {
            if (animatedRatio <= 0.35f) {
                Text(
                    text = scoreText,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White
                )
            }
        }
    }
}
