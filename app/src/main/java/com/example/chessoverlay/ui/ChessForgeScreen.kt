package com.example.chessoverlay.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.FolderZip
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.chessoverlay.R
import com.example.chessoverlay.model.BrowserAnalysisSnapshot
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.BrowserSitePreset
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.model.FairPlayTelemetryModel
import com.example.chessoverlay.model.WorkspaceTab
import com.example.chessoverlay.ui.components.EngineStatusIndicator
import com.example.chessoverlay.ui.components.EvaluationBar
import com.example.chessoverlay.ui.components.FairPlayStatusIndicator
import com.example.chessoverlay.ui.theme.CarbonSurface
import com.example.chessoverlay.ui.theme.CarbonSurfaceHigh
import com.example.chessoverlay.ui.theme.HairlineBorder
import com.example.chessoverlay.ui.theme.ObsidianBg
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import com.example.chessoverlay.ui.theme.TacticalRed

@Composable
fun ChessForgeScreen(
    selectedTab: WorkspaceTab,
    extensionConfig: BrowserExtensionConfig,
    engineStatus: EngineStatus,
    extensionAssetsReady: Boolean,
    exportStatus: String?,
    activeUrl: String,
    reloadNonce: Int,
    telemetryResetNonce: Int = 0,
    telemetryStatusMessage: String? = null,
    liveAnalysis: BrowserAnalysisSnapshot,
    onSelectTab: (WorkspaceTab) -> Unit,
    onExportZip: () -> Unit,
    onShareZip: () -> Unit,
    onOpenBrowser: () -> Unit,
    onToggleEnabled: (Boolean) -> Unit,
    onToggleArrows: (Boolean) -> Unit,
    onToggleAnnotations: (Boolean) -> Unit,
    onToggleOpeningBook: (Boolean) -> Unit,
    onToggleTablebase: (Boolean) -> Unit = {},
    onToggleAutoAdaptTheme: (Boolean) -> Unit,
    onToggleHud: (Boolean) -> Unit,
    onToggleEvalBar: (Boolean) -> Unit,
    onSelectEvalOrientation: (EvalBarOrientation) -> Unit,
    onSelectMultiPv: (Int) -> Unit,
    onSelectDepth: (Int) -> Unit,
    onSelectSkillLevel: (Int) -> Unit,
    onSelectCpuProfile: (CpuUsageProfile) -> Unit,
    onSelectTurn: (String) -> Unit,
    onToggleFairPlayAuditor: (Boolean) -> Unit = {},
    onToggleHumanizer: (Boolean) -> Unit = {},
    onSelectTargetElo: (Int) -> Unit = {},
    onClearSessionTelemetry: () -> Unit = {},
    onToggleAutonomousMode: (Boolean) -> Unit = {},
    onSelectAutonomousEloProfile: (Int) -> Unit = {},
    onTogglePracticeAutoPlay: (Boolean) -> Unit,
    onChangePracticeDelay: (Int) -> Unit,
    onSelectPreset: (BrowserSitePreset) -> Unit,
    onNavigateUrl: (String) -> Unit,
    onPageStatusChange: (EngineStatus) -> Unit,
    onWebAnalysisJson: (String) -> Unit,
    onFairPlayTelemetry: (FairPlayTelemetryModel) -> Unit = {}
) {
    if (selectedTab != WorkspaceTab.EXTENSION) {
        BackHandler { onSelectTab(WorkspaceTab.EXTENSION) }
    }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = ObsidianBg,
        contentWindowInsets = WindowInsets.safeDrawing,
        bottomBar = {
            NavigationBar(
                containerColor = CarbonSurface,
                contentColor = MaterialTheme.colorScheme.onSurface
            ) {
                NavigationBarItem(
                    selected = selectedTab == WorkspaceTab.EXTENSION,
                    onClick = { onSelectTab(WorkspaceTab.EXTENSION) },
                    icon = { Icon(Icons.Default.Extension, contentDescription = "Extension Tab") },
                    label = { Text("Extension") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF042F2E),
                        selectedTextColor = TacticalEmerald,
                        indicatorColor = TacticalEmerald,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                    ),
                    modifier = Modifier.testTag("nav_bottom_extension")
                )
                NavigationBarItem(
                    selected = selectedTab == WorkspaceTab.BROWSER,
                    onClick = { onSelectTab(WorkspaceTab.BROWSER) },
                    icon = { Icon(Icons.Default.Language, contentDescription = "Browser Tab") },
                    label = { Text("Browser") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF042F2E),
                        selectedTextColor = TacticalEmerald,
                        indicatorColor = TacticalEmerald,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                    ),
                    modifier = Modifier.testTag("nav_bottom_browser")
                )
                NavigationBarItem(
                    selected = selectedTab == WorkspaceTab.SETTINGS,
                    onClick = { onSelectTab(WorkspaceTab.SETTINGS) },
                    icon = { Icon(Icons.Default.Settings, contentDescription = "Settings Tab") },
                    label = { Text("Settings") },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF042F2E),
                        selectedTextColor = TacticalEmerald,
                        indicatorColor = TacticalEmerald,
                        unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                        unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant
                    ),
                    modifier = Modifier.testTag("nav_bottom_settings")
                )
            }
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            WorkspaceTabHeader(
                selectedTab = selectedTab,
                extensionConfig = extensionConfig,
                onSelectTab = onSelectTab,
                onSelectDepth = onSelectDepth,
                onSelectCpuProfile = onSelectCpuProfile
            )

            when (selectedTab) {
                WorkspaceTab.EXTENSION -> {
                    ExtensionHubContent(
                        extensionConfig = extensionConfig,
                        engineStatus = engineStatus,
                        assetsReady = extensionAssetsReady,
                        exportStatus = exportStatus,
                        liveAnalysis = liveAnalysis,
                        onExportZip = onExportZip,
                        onShareZip = onShareZip,
                        onOpenBrowser = onOpenBrowser,
                        onOpenSettings = { onSelectTab(WorkspaceTab.SETTINGS) }
                    )
                }

                WorkspaceTab.BROWSER -> {
                    BrowserWorkspaceTab(
                        activeUrl = activeUrl,
                        reloadNonce = reloadNonce,
                        telemetryResetNonce = telemetryResetNonce,
                        extensionConfig = extensionConfig,
                        engineStatus = engineStatus,
                        liveAnalysis = liveAnalysis,
                        onSelectPreset = onSelectPreset,
                        onNavigateUrl = onNavigateUrl,
                        onToggleEnabled = onToggleEnabled,
                        onSelectDepth = onSelectDepth,
                        onSelectCpuProfile = onSelectCpuProfile,
                        onSelectEvalOrientation = onSelectEvalOrientation,
                        onPageStatusChange = onPageStatusChange,
                        onWebAnalysisJson = onWebAnalysisJson,
                        onFairPlayTelemetry = onFairPlayTelemetry
                    )
                }

                WorkspaceTab.SETTINGS -> {
                    SettingsScreen(
                        config = extensionConfig,
                        engineStatus = engineStatus,
                        engineBackend = liveAnalysis.engineBackend,
                        fairPlayStatus = liveAnalysis.fairPlayStatus,
                        telemetryStatusMessage = telemetryStatusMessage,
                        onSelectCpuProfile = onSelectCpuProfile,
                        onSelectDepth = onSelectDepth,
                        onSelectSkillLevel = onSelectSkillLevel,
                        onSelectMultiPv = onSelectMultiPv,
                        onToggleEvalBar = onToggleEvalBar,
                        onSelectEvalOrientation = onSelectEvalOrientation,
                        onToggleArrows = onToggleArrows,
                        onToggleAnnotations = onToggleAnnotations,
                        onToggleOpeningBook = onToggleOpeningBook,
                        onToggleTablebase = onToggleTablebase,
                        onToggleAutoAdaptTheme = onToggleAutoAdaptTheme,
                        onToggleHud = onToggleHud,
                        onSelectTurn = onSelectTurn,
                        onToggleFairPlayAuditor = onToggleFairPlayAuditor,
                        onToggleHumanizer = onToggleHumanizer,
                        onSelectTargetElo = onSelectTargetElo,
                        onClearSessionTelemetry = onClearSessionTelemetry,
                        onToggleAutonomousMode = onToggleAutonomousMode,
                        onSelectAutonomousEloProfile = onSelectAutonomousEloProfile,
                        onTogglePracticeAutoPlay = onTogglePracticeAutoPlay,
                        onChangePracticeDelay = onChangePracticeDelay
                    )
                }
            }
        }
    }
}

@Composable
private fun WorkspaceTabHeader(
    selectedTab: WorkspaceTab,
    extensionConfig: BrowserExtensionConfig,
    onSelectTab: (WorkspaceTab) -> Unit,
    onSelectDepth: (Int) -> Unit,
    onSelectCpuProfile: (CpuUsageProfile) -> Unit
) {
    var menuExpanded by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Row(
            modifier = Modifier
                .widthIn(max = 680.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(14.dp))
                    .background(CarbonSurface)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                TabPillButton(
                    label = stringResource(R.string.tab_extension),
                    icon = Icons.Default.Extension,
                    selected = selectedTab == WorkspaceTab.EXTENSION,
                    testTag = "tab_extension_button",
                    modifier = Modifier.weight(1f),
                    onClick = { onSelectTab(WorkspaceTab.EXTENSION) }
                )
                TabPillButton(
                    label = stringResource(R.string.tab_browser),
                    icon = Icons.Default.Language,
                    selected = selectedTab == WorkspaceTab.BROWSER,
                    testTag = "tab_browser_button",
                    modifier = Modifier.weight(1f),
                    onClick = { onSelectTab(WorkspaceTab.BROWSER) }
                )
                TabPillButton(
                    label = stringResource(R.string.tab_settings),
                    icon = Icons.Default.Settings,
                    selected = selectedTab == WorkspaceTab.SETTINGS,
                    testTag = "tab_settings_button",
                    modifier = Modifier.weight(1f),
                    onClick = { onSelectTab(WorkspaceTab.SETTINGS) }
                )
            }

            Box {
                IconButton(
                    onClick = { menuExpanded = true },
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CarbonSurface)
                        .border(1.dp, HairlineBorder, RoundedCornerShape(12.dp))
                        .testTag("quick_settings_menu_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.MoreVert,
                        contentDescription = "Quick depth and CPU profile menu",
                        tint = TacticalEmerald
                    )
                }

                DropdownMenu(
                    expanded = menuExpanded,
                    onDismissRequest = { menuExpanded = false }
                ) {
                    DropdownMenuItem(
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Icon(Icons.Default.Settings, contentDescription = null, tint = TacticalEmerald, modifier = Modifier.size(18.dp))
                                Text("Full Settings (Engine, Syzygy, Theme)", fontWeight = FontWeight.SemiBold)
                            }
                        },
                        onClick = {
                            onSelectTab(WorkspaceTab.SETTINGS)
                            menuExpanded = false
                        }
                    )
                    HorizontalDivider()
                    listOf(6, 10, 14, 18, 20).forEach { d ->
                        DropdownMenuItem(
                            text = { Text("Depth $d") },
                            trailingIcon = if (extensionConfig.maxDepth == d) {
                                { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                            } else null,
                            onClick = {
                                onSelectDepth(d)
                                menuExpanded = false
                            }
                        )
                    }
                    HorizontalDivider()
                    CpuUsageProfile.entries.forEach { profile ->
                        DropdownMenuItem(
                            text = { Text("${profile.label} • ${profile.detail}") },
                            trailingIcon = if (extensionConfig.cpuProfile == profile) {
                                { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                            } else null,
                            onClick = {
                                onSelectCpuProfile(profile)
                                menuExpanded = false
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun TabPillButton(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    testTag: String,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val bg = if (selected) TacticalEmerald else Color.Transparent
    val fg = if (selected) Color(0xFF042F2E) else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = modifier
            .height(48.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(bg)
            .clickable(onClick = onClick)
            .testTag(testTag),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center
    ) {
        Icon(imageVector = icon, contentDescription = null, tint = fg, modifier = Modifier.size(16.dp))
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = fg,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}

@Composable
private fun ExtensionHubContent(
    extensionConfig: BrowserExtensionConfig,
    engineStatus: EngineStatus,
    assetsReady: Boolean,
    exportStatus: String?,
    liveAnalysis: BrowserAnalysisSnapshot,
    onExportZip: () -> Unit,
    onShareZip: () -> Unit,
    onOpenBrowser: () -> Unit,
    onOpenSettings: () -> Unit
) {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.TopCenter
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 600.dp)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 14.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            HeroBannerCard(
                engineStatus = engineStatus,
                assetsReady = assetsReady,
                backendLabel = liveAnalysis.engineBackend
            )

            FairPlayStatusIndicator(
                status = liveAnalysis.fairPlayStatus,
                auditorEnabled = extensionConfig.fairPlayAuditorEnabled,
                telemetry = liveAnalysis.fairPlayTelemetry,
                modifier = Modifier.fillMaxWidth()
            )

            // Live Horizontal Evaluation Bar + Active Config Summary
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = CarbonSurface),
                border = BorderStroke(1.dp, HairlineBorder)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Position Advantage Bar",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "D${extensionConfig.maxDepth} • Skill ${extensionConfig.skillLevel} • ${extensionConfig.cpuProfile.label}",
                            style = MaterialTheme.typography.labelSmall,
                            color = TacticalAmber
                        )
                    }
                    EvaluationBar(
                        topLine = liveAnalysis.lines.firstOrNull(),
                        orientation = EvalBarOrientation.HORIZONTAL,
                        modifier = Modifier.fillMaxWidth()
                    )
                    liveAnalysis.openingBook?.takeIf { it.opening.isNotBlank() }?.let { book ->
                        Text(
                            text = "Book: ${if (book.eco.isNotBlank()) "[${book.eco}] " else ""}${book.opening}",
                            style = MaterialTheme.typography.labelMedium,
                            color = TacticalEmerald
                        )
                    }
                    OutlinedButton(
                        onClick = onOpenSettings,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                            .testTag("open_settings_button"),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Settings, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Configure Stockfish 19 WASM & Overlays")
                    }
                }
            }

            // Syzygy 7-Piece Endgame Tablebase Overview Card
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = CarbonSurface),
                border = BorderStroke(1.dp, HairlineBorder)
            ) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Psychology,
                                contentDescription = null,
                                tint = TacticalEmerald,
                                modifier = Modifier.size(20.dp)
                            )
                            Text(
                                text = "Syzygy 7-Piece Tablebase",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                        }
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = TacticalEmerald.copy(alpha = 0.18f),
                            border = BorderStroke(1.dp, TacticalEmerald)
                        ) {
                            Text(
                                text = if (extensionConfig.showTablebase) "Active (<= 7 pcs)" else "Disabled",
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = if (extensionConfig.showTablebase) TacticalEmerald else TacticalAmber,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    val tb = liveAnalysis.tablebase
                    if (tb != null && tb.isTablebase) {
                        Text(
                            text = "Outcome: ${tb.outcome} (${tb.scoreBadge})",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.SemiBold,
                            color = when (tb.category) {
                                "win" -> TacticalEmerald
                                "loss" -> TacticalRed
                                else -> TacticalAmber
                            }
                        )
                    } else {
                        Text(
                            text = "Automatic lookup activates when 7 or fewer pieces remain on the board with mathematically exact Win/Draw/Loss & DTM analysis.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            ExportActionsCard(
                exportStatus = exportStatus,
                onExportZip = onExportZip,
                onShareZip = onShareZip,
                onOpenBrowser = onOpenBrowser
            )

            InstallGuideCard()

            BundledFilesCard()

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun HeroBannerCard(
    engineStatus: EngineStatus,
    assetsReady: Boolean,
    backendLabel: String
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = CarbonSurface),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(148.dp)
        ) {
            Image(
                painter = painterResource(id = R.drawable.img_chess_forge_hero),
                contentDescription = stringResource(R.string.cd_hero_banner),
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop
            )
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.28f),
                                ObsidianBg.copy(alpha = 0.94f)
                            )
                        )
                    )
            )
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(14.dp),
                verticalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    EngineStatusIndicator(
                        status = if (assetsReady) engineStatus else EngineStatus.ERROR,
                        backendLabel = backendLabel
                    )
                    HeaderChip(
                        label = if (assetsReady) "MV3 v2.1" else "Missing Assets",
                        accent = if (assetsReady) TacticalEmerald else TacticalAmber
                    )
                }

                Column {
                    Text(
                        text = stringResource(R.string.app_name),
                        style = MaterialTheme.typography.headlineMedium,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Text(
                        text = stringResource(R.string.hero_subtitle),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun HeaderChip(label: String, accent: Color) {
    Surface(
        shape = RoundedCornerShape(8.dp),
        color = CarbonSurfaceHigh.copy(alpha = 0.92f),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = accent,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
        )
    }
}

@Composable
private fun ExportActionsCard(
    exportStatus: String?,
    onExportZip: () -> Unit,
    onShareZip: () -> Unit,
    onOpenBrowser: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CarbonSurface),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Button(
                onClick = onExportZip,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(54.dp)
                    .testTag("export_zip_button"),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = TacticalEmerald,
                    contentColor = Color(0xFF042F2E)
                )
            ) {
                Icon(Icons.Default.Download, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = stringResource(R.string.btn_save_zip),
                    style = MaterialTheme.typography.labelLarge
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilledTonalButton(
                    onClick = onShareZip,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                        .testTag("share_zip_button"),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(stringResource(R.string.btn_share_zip), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }

                OutlinedButton(
                    onClick = onOpenBrowser,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp)
                        .testTag("open_browser_button"),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Icon(Icons.Default.Language, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(stringResource(R.string.btn_open_browser), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }

            if (exportStatus != null) {
                Text(
                    text = exportStatus,
                    style = MaterialTheme.typography.labelMedium,
                    color = TacticalAmber,
                    modifier = Modifier.testTag("export_status_text")
                )
            }
        }
    }
}

@Composable
private fun InstallGuideCard() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CarbonSurface),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text(
                text = "Install in Your Browser",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            GuideStep(
                step = "1. Mobile (Kiwi Browser / Edge Canary)",
                detail = "Tap Download .ZIP above, open Kiwi -> Extensions -> enable Developer mode -> tap +(from .zip) and select chess-forge-browser-extension.zip."
            )
            GuideStep(
                step = "2. Desktop (Chrome / Edge / Brave)",
                detail = "Download chess-forge-pc-extension from GitHub Actions, unzip it, open chrome://extensions -> Developer mode -> Load unpacked."
            )
            GuideStep(
                step = "3. In-App Mobile Browser Workspace",
                detail = "Tap Test in Browser for Lichess.org, Chess.com, or the offline Practice Board with Opening Book, Annotations (!!/?!), and adaptive SVG arrows."
            )
        }
    }
}

@Composable
private fun GuideStep(step: String, detail: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(CarbonSurfaceHigh)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        Text(
            text = step,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
            color = TacticalEmerald
        )
        Text(
            text = detail,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun BundledFilesCard() {
    val files = listOf(
        "manifest.json" to "MV3 config with wasm-unsafe-eval & Masters API",
        "vendor/stockfish-19-lite-single.wasm" to "Local Stockfish 19 WebAssembly engine (up to D20)",
        "src/opening-book.js" to "Master ECO & Lichess Masters database lookup",
        "src/offscreen.js" to "MV3 offscreen Web Worker for local WASM analysis",
        "src/content.js" to "Theme-aware SVG arrows, !!/?! annotations & HUD",
        "src/popup.html" to "Toolbar popup with Opening Book & CPU profiles"
    )
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = CarbonSurface),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(Icons.Default.FolderZip, contentDescription = null, tint = TacticalAmber)
                Text(
                    text = "Packaged Extension Modules",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            files.forEach { (name, role) ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = TacticalEmerald,
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = name,
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Text(
                        text = "— $role",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}
