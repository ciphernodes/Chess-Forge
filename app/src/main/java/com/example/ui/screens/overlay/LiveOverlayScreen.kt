package com.example.ui.screens.overlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Analytics
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.repository.ArrowColorChoice
import com.example.ui.components.ChessBoardView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LiveOverlayScreen(
    viewModel: LiveOverlayViewModel,
    onNavigateToPracticeWithReconstruction: () -> Unit = {},
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.loadState()
    }

    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearStatusMessage()
        }
    }

    // Post-game Analysis Offer Dialog (Section 4.11)
    if (state.showReconstructOffer) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissReconstructOffer() },
            title = { Text("Game Reconstruction Ready", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "The overlay session captured ${state.reconstructedMovesCount} moves with timestamps and turn detection.",
                        fontSize = 14.sp
                    )
                    Text(
                        text = "Would you like to analyze this game in Practice Mode with full move classifications, accuracy scores, and critical moments?",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.dismissReconstructOffer()
                        onNavigateToPracticeWithReconstruction()
                    }
                ) {
                    Icon(Icons.Default.Analytics, contentDescription = "Analyze", modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Analyze Reconstructed Game")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissReconstructOffer() }) {
                    Text("Dismiss")
                }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Live Overlay",
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        )
                        Text(
                            text = if (state.isServiceRunning) "System Window Active" else "Interactive Sandbox Active",
                            fontSize = 11.sp,
                            color = if (state.isServiceRunning) Color(0xFF00E676) else MaterialTheme.colorScheme.primary
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { viewModel.toggleAdjustRegion() },
                        modifier = Modifier.testTag("adjust_region_button")
                    ) {
                        Icon(Icons.Default.CropFree, contentDescription = "Adjust Board Region")
                    }
                }
            )
        },
        modifier = modifier.fillMaxSize()
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Main Overlay Control Card
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (state.isServiceRunning) Color(0xFFE8F5E9) else MaterialTheme.colorScheme.surface
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(CircleShape)
                                    .background(if (state.isServiceRunning) Color(0xFF00E676) else Color(0xFF0D9488))
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (state.isServiceRunning) "SYSTEM OVERLAY ACTIVE" else "LIVE OVERLAY SANDBOX",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                color = if (state.isServiceRunning) Color(0xFF1B5E20) else MaterialTheme.colorScheme.onSurface
                            )
                        }

                        if (!state.hasOverlayPermission) {
                            OutlinedButton(
                                onClick = {
                                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                                        val intent = Intent(
                                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                            Uri.parse("package:${context.packageName}")
                                        )
                                        context.startActivity(intent)
                                    }
                                }
                            ) {
                                Icon(Icons.Default.Security, contentDescription = "Permission", modifier = Modifier.size(13.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Grant Permission", fontSize = 11.sp)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Projects best-move arrows over any app with turn detection, battery throttling, and full game reconstruction.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(12.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (state.isServiceRunning) {
                            Button(
                                onClick = { viewModel.stopOverlayService() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                                modifier = Modifier
                                    .weight(1f)
                                    .testTag("stop_overlay_button")
                            ) {
                                Icon(Icons.Default.Stop, contentDescription = "Stop", modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Stop System Overlay")
                            }
                        } else {
                            Button(
                                onClick = { viewModel.startOverlayService() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488)),
                                modifier = Modifier
                                    .weight(1f)
                                    .testTag("start_overlay_button")
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = "Start", modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Start System Overlay")
                            }
                        }
                    }
                }
            }

            // Region Adjustment Banner
            AnimatedVisibility(visible = state.isAdjustingRegion) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE0F2FE)),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Adjust Board Region (Drag to Fit)",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                color = Color(0xFF0369A1)
                            )
                            IconButton(onClick = { viewModel.toggleAdjustRegion() }) {
                                Icon(Icons.Default.Close, contentDescription = "Close", modifier = Modifier.size(18.dp))
                            }
                        }
                        Text(
                            text = "Set region boundaries so the overlay maps accurately to your chess board size:",
                            fontSize = 12.sp,
                            color = Color(0xFF334155)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = { viewModel.resetBoardRegion() },
                                modifier = Modifier.weight(1f)
                            ) {
                                Icon(Icons.Default.Refresh, contentDescription = "Reset", modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Reset Region", fontSize = 11.sp)
                            }
                            Button(
                                onClick = { viewModel.toggleAdjustRegion() },
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("Save Region", fontSize = 11.sp)
                            }
                        }
                    }
                }
            }

            // LIVE OVERLAY SANDBOX & INTERACTIVE BOARD
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Interactive Overlay Sandbox",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )

                        // Move Type Indicator Badge (Section 4.4)
                        val moveBadgeText = when {
                            state.isCheckMove -> "Check (+)"
                            state.isCaptureMove -> "Capture (×)"
                            state.isSpecialMoveOnly -> "Only Legal Move"
                            else -> "Quiet Best Move"
                        }
                        Surface(
                            color = Color(state.moveTypeColor).copy(alpha = 0.15f),
                            shape = RoundedCornerShape(6.dp)
                        ) {
                            Text(
                                text = moveBadgeText,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color(state.moveTypeColor),
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Tap pieces on the board below to test live turn detection and arrow tracking:",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    // OVERLAY CANVAS CONTAINER
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                    ) {
                        // 1. The Interactive Board
                        ChessBoardView(
                            position = state.position,
                            scheme = state.settings.boardScheme,
                            isWhiteAtBottom = true,
                            selectedSquare = state.selectedSquare,
                            legalMoves = state.legalMoves,
                            bestMove = if (!state.isBubbleMinimized) state.bestMove else null,
                            bestMoveColor = Color(state.moveTypeColor),
                            pulseArrow = state.settings.overlayPulseAnimation,
                            onSquareClick = { viewModel.onSquareClicked(it) }
                        )

                        // 2. Overlay Board Region Highlight (if adjusting region)
                        if (state.isAdjustingRegion) {
                            Box(
                                modifier = Modifier
                                    .matchParentSize()
                                    .padding(12.dp)
                                    .border(2.dp, Color(0xFF00E676), RoundedCornerShape(4.dp))
                                    .background(Color(0x2200E676))
                            )
                        }

                        // 3. Floating 50x50dp Minimized Bubble (Section 4.5)
                        if (state.isBubbleMinimized) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopStart)
                                    .padding(12.dp)
                                    .size(50.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF0D9488))
                                    .border(2.dp, Color.White, CircleShape)
                                    .clickable { viewModel.toggleMinimizeBubble() }
                                    .testTag("floating_bubble"),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "♘",
                                    fontSize = 24.sp,
                                    color = Color.White
                                )
                            }
                        } else {
                            // 4. Minimize Button (30x30dp x, top-left)
                            Box(
                                modifier = Modifier
                                    .align(Alignment.TopStart)
                                    .padding(8.dp)
                                    .size(30.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xDD0F172A))
                                    .clickable { viewModel.toggleMinimizeBubble() }
                                    .testTag("minimize_overlay_button"),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "✕",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White
                                )
                            }

                            // 5. Top-Right: Eval Badge + 8dp Confidence Dot (Section 4.5)
                            if (state.settings.showOverlayEvalBadge) {
                                Row(
                                    modifier = Modifier
                                        .align(Alignment.TopEnd)
                                        .padding(8.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color(0xEE0F172A))
                                        .padding(horizontal = 8.dp, vertical = 4.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    if (state.settings.showOverlayConfidenceDot) {
                                        Box(
                                            modifier = Modifier
                                                .size(8.dp)
                                                .clip(CircleShape)
                                                .background(Color(0xFF00E676))
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                    }
                                    val evalText = state.analysisResult?.displayScore ?: "+0.35"
                                    Text(
                                        text = evalText,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = if ((state.analysisResult?.evaluationCp ?: 0) >= 0) Color(0xFF00E676) else Color(0xFFFF1744)
                                    )
                                }
                            }

                            // 6. Bottom-Center: Turn Indicator ("Your move" / "Opponent's move")
                            if (state.settings.showOverlayTurnIndicator) {
                                Box(
                                    modifier = Modifier
                                        .align(Alignment.BottomCenter)
                                        .padding(8.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(Color(0xDD000000))
                                        .padding(horizontal = 10.dp, vertical = 4.dp)
                                ) {
                                    Text(
                                        text = state.turnLabel,
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = Color.White
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Captured ${state.reconstructedMovesCount} moves in session",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (state.reconstructedMovesCount > 0) {
                            TextButton(onClick = { viewModel.stopOverlayService() }) {
                                Text("End & Analyze Game", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }

            // Customization Settings
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text(
                        text = "Overlay Appearance & Controls",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )

                    // Mode Toggle: Playing vs Watching
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Watching Mode", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Show moves for both sides instead of just player", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = state.settings.isWatchingMode,
                            onCheckedChange = { viewModel.toggleWatchingMode(it) }
                        )
                    }

                    // Arrow Base Color Picker
                    Text("Base Arrow Color", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ArrowColorChoice.values().forEach { choice ->
                            val isSelected = state.settings.arrowBaseColor == choice
                            Box(
                                modifier = Modifier
                                    .size(36.dp)
                                    .clip(CircleShape)
                                    .background(Color(choice.hex))
                                    .border(
                                        width = if (isSelected) 3.dp else 1.dp,
                                        color = if (isSelected) MaterialTheme.colorScheme.onSurface else Color.Transparent,
                                        shape = CircleShape
                                    )
                                    .clickable { viewModel.updateArrowColor(choice) }
                            )
                        }
                    }

                    // Capture Frame Rate Slider (1-15 FPS, default 5)
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Capture Frame Rate", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text("${state.settings.overlayFps} FPS", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                        }
                        Slider(
                            value = state.settings.overlayFps.toFloat(),
                            onValueChange = { viewModel.updateFps(it.toInt()) },
                            valueRange = 1f..15f,
                            steps = 13
                        )
                    }

                    // Arrow Opacity Slider (40% - 100%)
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Arrow Opacity", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Text("${(state.settings.arrowOpacity * 100).toInt()}%", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                        }
                        Slider(
                            value = state.settings.arrowOpacity,
                            onValueChange = { viewModel.updateOpacity(it) },
                            valueRange = 0.40f..1.00f
                        )
                    }

                    // Pulse Animation Toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Soft Pulse Animation", fontSize = 13.sp)
                        Switch(
                            checked = state.settings.overlayPulseAnimation,
                            onCheckedChange = { viewModel.togglePulse(it) }
                        )
                    }

                    // Eval Badge Toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Show Eval Badge Pill", fontSize = 13.sp)
                        Switch(
                            checked = state.settings.showOverlayEvalBadge,
                            onCheckedChange = { viewModel.toggleEvalBadge(it) }
                        )
                    }

                    // Turn Indicator Toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Show Turn Indicator", fontSize = 13.sp)
                        Switch(
                            checked = state.settings.showOverlayTurnIndicator,
                            onCheckedChange = { viewModel.toggleTurnIndicator(it) }
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
