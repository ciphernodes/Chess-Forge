package com.example.chessoverlay.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.HourglassTop
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.ui.theme.CarbonSurfaceHigh
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import com.example.chessoverlay.ui.theme.TacticalRed

private val CalculatingSky = Color(0xFF38BDF8)

@Composable
fun EngineStatusIndicator(
    status: EngineStatus,
    backendLabel: String = "Stockfish 19 WASM",
    modifier: Modifier = Modifier
) {
    val (accent, statusText, icon) = when (status) {
        EngineStatus.LOADING -> Triple(TacticalAmber, "Loading Engine", Icons.Default.HourglassTop)
        EngineStatus.CALCULATING -> Triple(CalculatingSky, "Calculating…", Icons.Default.Psychology)
        EngineStatus.IDLE -> Triple(TacticalEmerald, "Idle • Ready", Icons.Default.CheckCircle)
        EngineStatus.ERROR -> Triple(TacticalRed, "Engine Error", Icons.Default.ErrorOutline)
    }

    Surface(
        modifier = modifier.testTag("engine_status_indicator"),
        shape = RoundedCornerShape(999.dp),
        color = CarbonSurfaceHigh,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.55f))
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            if (status == EngineStatus.LOADING || status == EngineStatus.CALCULATING) {
                CircularProgressIndicator(
                    modifier = Modifier.size(14.dp),
                    strokeWidth = 2.dp,
                    color = accent
                )
            } else {
                Icon(
                    imageVector = icon,
                    contentDescription = statusText,
                    tint = accent,
                    modifier = Modifier.size(16.dp)
                )
            }

            Text(
                text = "$backendLabel • $statusText",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
