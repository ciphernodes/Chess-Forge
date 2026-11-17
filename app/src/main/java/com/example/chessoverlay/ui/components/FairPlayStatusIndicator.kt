package com.example.chessoverlay.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GppBad
import androidx.compose.material.icons.filled.VerifiedUser
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.chessoverlay.model.FairPlayRiskLevel
import com.example.chessoverlay.model.FairPlayStatus
import com.example.chessoverlay.ui.theme.CarbonSurfaceHigh
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import com.example.chessoverlay.ui.theme.TacticalRed

@Composable
fun FairPlayStatusIndicator(
    status: FairPlayStatus,
    auditorEnabled: Boolean = true,
    compact: Boolean = false,
    modifier: Modifier = Modifier
) {
    val risk = if (auditorEnabled) status.riskLevel else FairPlayRiskLevel.SAFE
    val targetAccent = when {
        !auditorEnabled -> MaterialTheme.colorScheme.onSurfaceVariant
        risk == FairPlayRiskLevel.SAFE -> TacticalEmerald
        risk == FairPlayRiskLevel.ELEVATED -> TacticalAmber
        else -> TacticalRed
    }
    val accent by animateColorAsState(
        targetValue = targetAccent,
        animationSpec = spring(),
        label = "fairPlayAccentColor"
    )

    val containerColor = when {
        !auditorEnabled -> CarbonSurfaceHigh.copy(alpha = 0.92f)
        risk == FairPlayRiskLevel.LOCKOUT -> TacticalRed.copy(alpha = 0.22f)
        risk == FairPlayRiskLevel.ELEVATED -> TacticalAmber.copy(alpha = 0.18f)
        else -> CarbonSurfaceHigh.copy(alpha = 0.94f)
    }

    val icon = when (risk) {
        FairPlayRiskLevel.SAFE -> Icons.Default.VerifiedUser
        FairPlayRiskLevel.ELEVATED -> Icons.Default.WarningAmber
        FairPlayRiskLevel.LOCKOUT -> Icons.Default.GppBad
    }

    val zFormatted = "%.2f".format(status.zScore)
    val labelText = when {
        !auditorEnabled -> "Auditor Paused"
        compact -> "${risk.label} • Z ${zFormatted}σ"
        else -> "FairPlay: ${risk.label} • ${status.observedIpr} IPR (Z=${zFormatted}σ)"
    }

    val accessibleDescription = if (auditorEnabled) {
        "FairPlay session safety status ${risk.label}, observed performance ${status.observedIpr}, Z score $zFormatted sigma"
    } else {
        "FairPlay Auditor paused"
    }

    Surface(
        modifier = modifier
            .semantics { contentDescription = accessibleDescription }
            .testTag("fairplay_status_indicator"),
        shape = RoundedCornerShape(999.dp),
        color = containerColor,
        border = BorderStroke(1.dp, accent.copy(alpha = 0.72f)),
        tonalElevation = if (risk == FairPlayRiskLevel.LOCKOUT) 4.dp else 1.dp
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = accessibleDescription,
                tint = accent,
                modifier = Modifier.size(16.dp)
            )
            Text(
                text = labelText,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                color = if (risk == FairPlayRiskLevel.LOCKOUT && auditorEnabled) accent else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
