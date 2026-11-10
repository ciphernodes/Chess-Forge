package com.example.ui.screens.overlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
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
            title = { Text("Game Reconstructed", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Overlay captured ${state.reconstructedMovesCount} moves during this session.",
                        fontSize = 14.sp
                    )
                    Text(
                        text = "Would you like to analyze this game in Practice Mode with move classifications, accuracy, and critical moments?",
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
                    Text("Analyze Game")
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
                    Text(
                        text = "Live Overlay",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
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
                .padding(horizontal = 14.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Main Overlay Control Card
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (state.isServiceRunning) Color(0xFFE6F4EA) else MaterialTheme.colorScheme.surface
                ),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
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
                                    .background(if (state.isServiceRunning) Color(0xFF00E676) else Color(0xFF9E9E9E))
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (state.isServiceRunning) "OVERLAY ACTIVE" else "OVERLAY STOPPED",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
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
                                Icon(Icons.Default.Security, contentDescription = "Grant Permission", modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Grant Permission", fontSize = 11.sp)
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Real-time best-move arrow projected onto any chess app with turn detection and background analysis.",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    Spacer(modifier = Modifier.height(16.dp))
                    if (state.isServiceRunning) {
                        Button(
                            onClick = { viewModel.stopOverlayService() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("stop_overlay_button")
                        ) {
                            Icon(Icons.Default.Stop, contentDescription = "Stop")
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Stop Live Overlay")
                        }
                    } else {
                        Button(
                            onClick = { viewModel.startOverlayService() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488)),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("start_overlay_button")
                        ) {
                            Icon(Icons.Default.PlayArrow, contentDescription = "Start")
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Start Live Overlay")
                        }
                    }
                }
            }

            // Competitive App Notice (Section 4.8)
            Surface(
                color = Color(0xFFFFF8E1),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Security, contentDescription = "Notice", tint = Color(0xFFF57F17), modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Notice: Live analysis in competitive games violates chess platforms' terms of service. For study and review purposes only.",
                        fontSize = 11.sp,
                        color = Color(0xFF5D4037)
                    )
                }
            }

            // Live Visual Preview Card (Section 4.4 & 4.5)
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Overlay Arrow Preview",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                        Text(
                            text = if (state.settings.isWatchingMode) "Watching Mode" else "Playing Mode",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.primary,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    // Sample Board Preview with Overlay Arrow and Badges
                    Box(modifier = Modifier.fillMaxWidth()) {
                        ChessBoardView(
                            position = state.samplePosition,
                            bestMove = state.sampleBestMove,
                            bestMoveColor = Color(state.settings.arrowBaseColor.hex),
                            pulseArrow = state.settings.overlayPulseAnimation
                        )

                        // Top right: Eval Badge + Confidence Dot (Section 4.5)
                        if (state.settings.showOverlayEvalBadge) {
                            Row(
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(8.dp)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(Color(0xDD0F172A))
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
                                Text(
                                    text = "+0.35",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color(0xFF00E676)
                                )
                            }
                        }

                        // Bottom center: Turn indicator (Section 4.5)
                        if (state.settings.showOverlayTurnIndicator) {
                            Box(
                                modifier = Modifier
                                    .align(Alignment.BottomCenter)
                                    .padding(8.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Color(0xDD000000))
                                    .padding(horizontal = 8.dp, vertical = 3.dp)
                            ) {
                                Text(
                                    text = if (state.settings.isWatchingMode) "White to move" else "Your move",
                                    fontSize = 11.sp,
                                    color = Color.White
                                )
                            }
                        }
                    }
                }
            }

            // Overlay Customization Settings (Section 8.4)
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
                        text = "Overlay Settings",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )

                    // Mode Toggle: Playing vs Watching
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Watching Mode", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("Show moves for both sides instead of just player", fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = state.settings.isWatchingMode,
                            onCheckedChange = { viewModel.toggleWatchingMode(it) }
                        )
                    }

                    // Arrow Color Picker
                    Text("Arrow Color", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
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

                    // FPS Slider (1-15, default 5)
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

                    // Arrow Opacity Slider (40-100%)
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

                    // Pulse Animation toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Pulse Animation", fontSize = 13.sp)
                        Switch(
                            checked = state.settings.overlayPulseAnimation,
                            onCheckedChange = { viewModel.togglePulse(it) }
                        )
                    }

                    // Eval badge toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Show Eval Badge", fontSize = 13.sp)
                        Switch(
                            checked = state.settings.showOverlayEvalBadge,
                            onCheckedChange = { viewModel.toggleEvalBadge(it) }
                        )
                    }

                    // Turn indicator toggle
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

                    // Reset Board Region Button
                    OutlinedButton(
                        onClick = { viewModel.resetBoardRegion() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Reset", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Reset Saved Board Region")
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
