package com.example.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.KeyboardReturn
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.core.chess.EngineLine
import com.example.core.chess.MoveClassification

data class MoveDisplayItem(
    val plyIndex: Int,
    val moveNumber: Int,
    val san: String,
    val isWhite: Boolean,
    val classification: MoveClassification? = null,
    val isCritical: Boolean = false
)

@Composable
fun MoveListView(
    moves: List<MoveDisplayItem>,
    currentPlyIndex: Int,
    onMoveClick: (Int) -> Unit,
    onClassificationClick: ((MoveDisplayItem) -> Unit)? = null,
    engineLines: List<EngineLine> = emptyList(),
    isVariationActive: Boolean = false,
    activeVariationTitle: String? = null,
    onLineClick: (EngineLine) -> Unit = {},
    onReturnToMainLine: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    LaunchedEffect(currentPlyIndex) {
        if (currentPlyIndex >= 0 && currentPlyIndex < moves.size) {
            listState.animateScrollToItem((currentPlyIndex / 2).coerceAtLeast(0))
        }
    }

    Column(modifier = modifier.fillMaxWidth()) {
        // Variation banner if variation is currently displayed
        if (isVariationActive) {
            Surface(
                color = MaterialTheme.colorScheme.secondaryContainer,
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Variation: ${activeVariationTitle ?: "Engine Line"}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                    OutlinedButton(
                        onClick = onReturnToMainLine,
                        modifier = Modifier.height(30.dp),
                        contentPadding = ButtonDefaults.TextButtonContentPadding
                    ) {
                        Icon(
                            imageVector = Icons.Default.KeyboardReturn,
                            contentDescription = "Return",
                            modifier = Modifier.size(14.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Main line", fontSize = 11.sp)
                    }
                }
            }
        }

        // Horizontal Move Ribbon
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            LazyRow(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Group by move number (pairs)
                val chunkedPairs = moves.chunked(2)
                itemsIndexed(chunkedPairs) { pairIdx, pair ->
                    val moveNum = pairIdx + 1
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 4.dp)
                    ) {
                        Text(
                            text = "$moveNum.",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                            modifier = Modifier.padding(end = 4.dp)
                        )

                        // White move
                        val white = pair.firstOrNull()
                        if (white != null) {
                            MovePill(
                                item = white,
                                isSelected = currentPlyIndex == white.plyIndex,
                                onClick = { onMoveClick(white.plyIndex) },
                                onClassificationClick = { onClassificationClick?.invoke(white) }
                            )
                        }

                        // Black move
                        val black = pair.getOrNull(1)
                        if (black != null) {
                            Spacer(modifier = Modifier.width(4.dp))
                            MovePill(
                                item = black,
                                isSelected = currentPlyIndex == black.plyIndex,
                                onClick = { onMoveClick(black.plyIndex) },
                                onClassificationClick = { onClassificationClick?.invoke(black) }
                            )
                        }
                    }
                }
            }
        }

        // Engine MultiPV Lines (Section 2.9 - Interactive Engine Lines)
        if (engineLines.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Engine Top Lines (MultiPV)",
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
            )

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                engineLines.forEach { line ->
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(8.dp),
                        tonalElevation = 2.dp,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onLineClick(line) }
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(
                                    modifier = Modifier
                                        .size(20.dp)
                                        .clip(CircleShape)
                                        .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.15f)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = "${line.rank}",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MaterialTheme.colorScheme.primary
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = line.san,
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                if (line.continuationMoves.isNotEmpty()) {
                                    Text(
                                        text = line.continuationMoves.joinToString(" "),
                                        fontSize = 12.sp,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1
                                    )
                                }
                            }
                            Text(
                                text = line.displayScore,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (line.scoreCp >= 0) Color(0xFF0D9488) else Color(0xFFE11D48)
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MovePill(
    item: MoveDisplayItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onClassificationClick: () -> Unit
) {
    val bg = if (isSelected) MaterialTheme.colorScheme.primary else Color.Transparent
    val textColor = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface

    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (item.isCritical) {
            Icon(
                imageVector = Icons.Default.Bolt,
                contentDescription = "Critical Moment",
                tint = Color(0xFFFFB300),
                modifier = Modifier.size(13.dp)
            )
        }
        Text(
            text = item.san,
            fontSize = 13.sp,
            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
            color = textColor
        )
        if (item.classification != null) {
            Spacer(modifier = Modifier.width(3.dp))
            Text(
                text = item.classification.symbol,
                fontSize = 11.sp,
                modifier = Modifier.clickable(onClick = onClassificationClick)
            )
        }
    }
}
