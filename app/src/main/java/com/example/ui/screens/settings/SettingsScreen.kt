package com.example.ui.screens.settings

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Brush
import androidx.compose.material.icons.filled.BugReport
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.core.chess.EnginePreset
import com.example.data.repository.BoardScheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: SettingsViewModel,
    modifier: Modifier = Modifier
) {
    val settings by viewModel.settings.collectAsState()
    val isOverlayRunning by viewModel.isOverlayRunning.collectAsState()
    val showPermissionDialog by viewModel.showPermissionDialog.collectAsState()
    val statusMessage by viewModel.statusMessage.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current

    var showAboutDialog by remember { mutableStateOf(false) }
    var showLicensesDialog by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        viewModel.refreshOverlayStatus()
    }

    LaunchedEffect(statusMessage) {
        statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearStatusMessage()
        }
    }

    // Permission Dialog for Overlay (Display Over Other Apps)
    if (showPermissionDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissPermissionDialog() },
            icon = {
                Icon(
                    imageVector = Icons.Default.Security,
                    contentDescription = "Permission",
                    tint = Color(0xFF0D9488),
                    modifier = Modifier.size(36.dp)
                )
            },
            title = {
                Text(
                    text = "Overlay Permission Required",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "To project the best-move arrow over your chess apps (Chess.com, Lichess, etc.), Android requires the 'Display over other apps' permission.",
                        fontSize = 14.sp
                    )
                    Text(
                        text = "Touches pass freely through the arrow overlay so you can play normally.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.dismissPermissionDialog()
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            val intent = Intent(
                                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:${context.packageName}")
                            )
                            context.startActivity(intent)
                        }
                    }
                ) {
                    Text("Open Settings")
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissPermissionDialog() }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showAboutDialog) {
        AlertDialog(
            onDismissRequest = { showAboutDialog = false },
            title = { Text("About Chess Forge", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Chess Forge v2.0", fontWeight = FontWeight.Bold)
                    Text("Stockfish 19 with embedded NNUE local engine.")
                    Text("100% offline — no personal data or moves are uploaded to any server.")
                    Text("Built strictly for study, training, and puzzle solving.")
                }
            },
            confirmButton = {
                TextButton(onClick = { showAboutDialog = false }) { Text("OK") }
            }
        )
    }

    if (showLicensesDialog) {
        AlertDialog(
            onDismissRequest = { showLicensesDialog = false },
            title = { Text("Open Source Licenses", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("• Stockfish Chess Engine — GNU General Public License v3.0")
                    Text("• Jetpack Compose & Android Jetpack — Apache 2.0")
                    Text("• Kotlin Coroutines & Room — Apache 2.0")
                }
            },
            confirmButton = {
                TextButton(onClick = { showLicensesDialog = false }) { Text("Close") }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Settings", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
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
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            // USER-FRIENDLY LIVE OVERLAY SERVICE TOGGLE CARD
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (isOverlayRunning) Color(0xFFE8F5E9) else MaterialTheme.colorScheme.surface
                ),
                shape = RoundedCornerShape(14.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 3.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("live_overlay_settings_card")
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(if (isOverlayRunning) Color(0xFFC8E6C9) else MaterialTheme.colorScheme.primaryContainer),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Layers,
                                    contentDescription = "Live Overlay",
                                    tint = if (isOverlayRunning) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onPrimaryContainer,
                                    modifier = Modifier.size(22.dp)
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = "Live Overlay Service",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.onSurface
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .clip(CircleShape)
                                            .background(if (isOverlayRunning) Color(0xFF00E676) else Color(0xFF9E9E9E))
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = if (isOverlayRunning) "Running in background" else "Service stopped",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = if (isOverlayRunning) Color(0xFF2E7D32) else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }

                        // User-Friendly Switch with Proper Permission Checking
                        Switch(
                            checked = isOverlayRunning,
                            onCheckedChange = { enable ->
                                viewModel.toggleLiveOverlay(enable)
                            },
                            modifier = Modifier.testTag("overlay_service_switch")
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = "Draws best-move arrows over other apps with turn detection. Touches pass through freely with zero lag.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        lineHeight = 17.sp
                    )

                    Spacer(modifier = Modifier.height(14.dp))
                    Text(
                        text = "Frame Capture Frequency (Battery Saver)",
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(
                            Triple(2, "🔋 Saver", "2 FPS"),
                            Triple(5, "⚖️ Balanced", "5 FPS"),
                            Triple(10, "⚡ Fast", "10 FPS")
                        ).forEach { (fps, label, subtitle) ->
                            val isSelected = settings.overlayFps == fps
                            Surface(
                                color = if (isSelected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable { viewModel.updateOverlayFps(fps) }
                                    .testTag("fps_preset_${fps}")
                            ) {
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    modifier = Modifier.padding(vertical = 8.dp, horizontal = 4.dp)
                                ) {
                                    Text(
                                        text = label,
                                        fontSize = 12.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                        color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                    Text(
                                        text = subtitle,
                                        fontSize = 10.sp,
                                        color = if (isSelected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
                                    )
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Fine Tune: ${settings.overlayFps} FPS",
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = if (settings.overlayFps <= 2) "Low battery use" else if (settings.overlayFps <= 5) "Standard" else "High responsiveness",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (settings.overlayFps <= 2) Color(0xFF2E7D32) else if (settings.overlayFps <= 5) Color(0xFF0284C7) else Color(0xFFD97706)
                        )
                    }
                    Slider(
                        value = settings.overlayFps.toFloat(),
                        onValueChange = { viewModel.updateOverlayFps(it.toInt()) },
                        valueRange = 1f..15f,
                        steps = 13,
                        modifier = Modifier.testTag("fps_slider")
                    )

                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { viewModel.startCalibrationMode() },
                        modifier = Modifier.fillMaxWidth().testTag("calibrate_board_settings_button")
                    ) {
                        Icon(Icons.Default.CropFree, contentDescription = "Set Board", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Set Board Position (Calibrate)", fontSize = 12.sp)
                    }
                }
            }

            // 8.5 Profiles Selector
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Text(
                        text = "Active Profile",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("Study", "Blitz", "Custom").forEach { prof ->
                            FilterChip(
                                selected = settings.activeProfileName == prof,
                                onClick = { viewModel.selectProfile(prof) },
                                label = { Text(prof, fontWeight = FontWeight.SemiBold) }
                            )
                        }
                    }
                }
            }

            // 8.1 Engine Settings
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Speed, contentDescription = "Engine", tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Engine Settings (Stockfish NNUE)", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }

                    // Engine Presets
                    Text("Search Preset", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(EnginePreset.FAST, EnginePreset.BALANCED, EnginePreset.DEEP, EnginePreset.MAXIMUM).forEach { p ->
                            FilterChip(
                                selected = settings.enginePreset == p,
                                onClick = { viewModel.updatePreset(p) },
                                label = { Text(p.title, fontSize = 11.sp) }
                            )
                        }
                    }

                    // Custom Depth Slider
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Engine Depth", fontSize = 13.sp)
                            Text("${settings.customDepth}", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                        }
                        Slider(
                            value = settings.customDepth.toFloat(),
                            onValueChange = { viewModel.updateCustomDepth(it.toInt()) },
                            valueRange = 10f..25f,
                            steps = 14
                        )
                    }

                    // MultiPV Count (1 - 5)
                    Column {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("Top Engine Lines (MultiPV)", fontSize = 13.sp)
                            Text("${settings.multiPv} Lines", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
                        }
                        Slider(
                            value = settings.multiPv.toFloat(),
                            onValueChange = { viewModel.updateMultiPv(it.toInt()) },
                            valueRange = 1f..5f,
                            steps = 3
                        )
                    }
                }
            }

            // 8.2 Board Settings
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Palette, contentDescription = "Board", tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Board Appearance", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }

                    // Board Color Scheme
                    Text("Color Scheme", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(BoardScheme.FORGE_TEAL, BoardScheme.BLUE_BLACK, BoardScheme.GREEN_BLACK, BoardScheme.BROWN_CREAM, BoardScheme.TOURNAMENT).forEach { sc ->
                            FilterChip(
                                selected = settings.boardScheme == sc,
                                onClick = { viewModel.updateBoardScheme(sc) },
                                label = { Text(sc.displayName, fontSize = 10.sp) }
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Board Coordinates (a-h, 1-8)", fontSize = 13.sp)
                        Switch(
                            checked = settings.showCoordinates,
                            onCheckedChange = { viewModel.toggleCoordinates(it) }
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Last-Move Highlight", fontSize = 13.sp)
                        Switch(
                            checked = settings.showLastMoveHighlight,
                            onCheckedChange = { viewModel.toggleLastMove(it) }
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Legal-Move Indicator Dots", fontSize = 13.sp)
                        Switch(
                            checked = settings.showLegalMoveDots,
                            onCheckedChange = { viewModel.toggleLegalDots(it) }
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Show Opponent Threat Arrow", fontSize = 13.sp)
                        Switch(
                            checked = settings.showThreatArrow,
                            onCheckedChange = { viewModel.toggleThreatArrow(it) }
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Haptic Feedback (Buzz on blunder)", fontSize = 13.sp)
                        Switch(
                            checked = settings.hapticFeedbackEnabled,
                            onCheckedChange = { viewModel.toggleHaptics(it) }
                        )
                    }
                }
            }

            // 8.3 Appearance Settings
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.DarkMode, contentDescription = "Appearance", tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("App Appearance", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf("SYSTEM", "DARK", "LIGHT", "CONTRAST").forEach { theme ->
                            FilterChip(
                                selected = settings.appTheme == theme,
                                onClick = { viewModel.updateAppTheme(theme) },
                                label = { Text(theme, fontSize = 11.sp) }
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Reduced Motion", fontSize = 13.sp)
                        Switch(
                            checked = settings.reducedMotion,
                            onCheckedChange = { viewModel.toggleReducedMotion(it) }
                        )
                    }
                }
            }

            // 8.6 Data & Backup
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Text("Data & Backup", fontWeight = FontWeight.Bold, fontSize = 15.sp)

                    OutlinedButton(
                        onClick = { viewModel.exportBackupJson() },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.FileDownload, contentDescription = "Backup", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Export .forgebackup")
                    }

                    Button(
                        onClick = { viewModel.clearAllData() },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626)),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = "Clear", modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Delete All Local History & Data")
                    }
                }
            }

            // 8.7 About
            Card(
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text("About & Info", fontWeight = FontWeight.Bold, fontSize = 15.sp)

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showAboutDialog = true }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Info, contentDescription = "About", tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("About Chess Forge v2.0", fontSize = 14.sp)
                    }

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showLicensesDialog = true }
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Bookmark, contentDescription = "Licenses", tint = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Open Source Licenses", fontSize = 14.sp)
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}
