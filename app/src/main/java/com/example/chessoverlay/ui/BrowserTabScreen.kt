package com.example.chessoverlay.ui

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CloseFullscreen
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.OpenInFull
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.example.chessoverlay.bridge.AccessibilityDispatcher
import com.example.chessoverlay.bridge.ChessForgeAndroidBridge
import com.example.chessoverlay.bridge.WebViewCompatHelper
import com.example.chessoverlay.model.AutonomousEloProfile
import com.example.chessoverlay.model.BrowserAnalysisSnapshot
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.BrowserSitePreset
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.model.FairPlayTelemetryModel
import com.example.chessoverlay.ui.components.EngineStatusIndicator
import com.example.chessoverlay.ui.components.EvaluationBar
import com.example.chessoverlay.ui.components.FairPlayStatusIndicator
import com.example.chessoverlay.ui.theme.CarbonSurface
import com.example.chessoverlay.ui.theme.CarbonSurfaceHigh
import com.example.chessoverlay.ui.theme.HairlineBorder
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import com.example.chessoverlay.ui.theme.TacticalRed
import com.example.chessoverlay.util.AssetManagerHelper
import kotlin.math.abs

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun BrowserWorkspaceTab(
    activeUrl: String,
    reloadNonce: Int,
    telemetryResetNonce: Int = 0,
    extensionConfig: BrowserExtensionConfig,
    engineStatus: EngineStatus,
    liveAnalysis: BrowserAnalysisSnapshot,
    onSelectPreset: (BrowserSitePreset) -> Unit,
    onNavigateUrl: (String) -> Unit,
    onToggleEnabled: (Boolean) -> Unit,
    onToggleOnlineAutoPlay: (Boolean) -> Unit = {},
    onSelectAutonomousEloProfile: (Int) -> Unit = {},
    onTogglePuzzleAutoSolve: (Boolean) -> Unit = {},
    onSelectDepth: (Int) -> Unit,
    onSelectCpuProfile: (CpuUsageProfile) -> Unit,
    onSelectEvalOrientation: (EvalBarOrientation) -> Unit,
    onPageStatusChange: (EngineStatus) -> Unit,
    onWebAnalysisJson: (String) -> Unit,
    onFairPlayTelemetry: (FairPlayTelemetryModel) -> Unit = {}
) {
    val context = LocalContext.current
    var urlInput by remember(activeUrl) { mutableStateOf(activeUrl) }
    var isLoadingPage by remember { mutableStateOf(false) }
    var quickMenuExpanded by remember { mutableStateOf(false) }
    var compactToolbar by remember { mutableStateOf(false) }
    var stripExpanded by remember { mutableStateOf(false) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    var webViewUnavailableReason by remember { mutableStateOf<String?>(null) }
    val accessibilityDispatcher = remember {
        AccessibilityDispatcher(enabled = extensionConfig.accessibilityDispatcherEnabled)
    }

    val engineJs = remember(context) {
        AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_ENGINE_JS)
    }
    val openingBookJs = remember(context) {
        AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_OPENING_BOOK_JS)
    }
    val syzygyTablebaseJs = remember(context) {
        AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_SYZYGY_TABLEBASE_JS)
    }
    val contentJs = remember(context) {
        AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_CONTENT_JS)
    }

    LaunchedEffect(extensionConfig) {
        accessibilityDispatcher.enabled = extensionConfig.accessibilityDispatcherEnabled
        val wv = webViewRef ?: return@LaunchedEffect
        val js = "window.__chessForgeUpdateConfig && window.__chessForgeUpdateConfig(${extensionConfig.toJsObjectLiteral()});"
        try {
            wv.evaluateJavascript(js, null)
        } catch (_: Throwable) {
        }
    }

    LaunchedEffect(telemetryResetNonce) {
        if (telemetryResetNonce <= 0) return@LaunchedEffect
        val wv = webViewRef ?: return@LaunchedEffect
        val js = "window.__ChessForgeHumanizer && window.__ChessForgeHumanizer.clearSessionTelemetry && window.__ChessForgeHumanizer.clearSessionTelemetry();"
        try {
            wv.evaluateJavascript(js, null)
        } catch (_: Throwable) {
        }
    }

    LaunchedEffect(activeUrl, reloadNonce) {
        val wv = webViewRef ?: return@LaunchedEffect
        try {
            if (wv.url != activeUrl) {
                wv.loadUrl(activeUrl)
            } else if (reloadNonce > 0) {
                wv.reload()
            }
        } catch (_: Throwable) {
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            try {
                webViewRef?.apply {
                    removeJavascriptInterface("ChessForgeAndroidBridge")
                    stopLoading()
                    destroy()
                }
            } catch (_: Throwable) {
            }
            webViewRef = null
        }
    }

    BoxWithConstraints(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.TopCenter
    ) {
        val isCompactPhone = maxWidth < 460.dp
        val outerHorizontalPad = if (isCompactPhone) 8.dp else 12.dp

        Column(
            modifier = Modifier
                .widthIn(max = 820.dp)
                .fillMaxSize()
                .padding(horizontal = outerHorizontalPad, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            // Top Controls Row: Compact & Responsive
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                IconButton(
                    onClick = { webViewRef?.let { if (it.canGoBack()) it.goBack() } },
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CarbonSurface)
                        .border(1.dp, HairlineBorder, RoundedCornerShape(12.dp))
                        .testTag("web_back_button")
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                if (!compactToolbar) {
                    OutlinedTextField(
                        value = urlInput,
                        onValueChange = { urlInput = it },
                        singleLine = true,
                        placeholder = { Text("https://lichess.org/analysis", maxLines = 1) },
                        textStyle = MaterialTheme.typography.labelMedium,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
                        keyboardActions = KeyboardActions(onGo = { onNavigateUrl(urlInput) }),
                        trailingIcon = {
                            IconButton(
                                onClick = { onNavigateUrl(urlInput) },
                                modifier = Modifier
                                    .size(48.dp)
                                    .testTag("web_go_button")
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Language,
                                    contentDescription = "Open URL",
                                    tint = TacticalEmerald
                                )
                            }
                        },
                        modifier = Modifier
                            .weight(1f)
                            .testTag("url_input_field")
                    )
                } else {
                    Surface(
                        modifier = Modifier
                            .weight(1f)
                            .height(48.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .clickable { compactToolbar = false },
                        shape = RoundedCornerShape(12.dp),
                        color = CarbonSurface,
                        border = BorderStroke(1.dp, HairlineBorder)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(horizontal = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text(
                                text = activeUrl.removePrefix("https://").removePrefix("file:///android_asset/"),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                text = "D${extensionConfig.maxDepth}",
                                style = MaterialTheme.typography.labelSmall,
                                color = TacticalEmerald
                            )
                        }
                    }
                }

                IconButton(
                    onClick = { webViewRef?.reload() ?: onNavigateUrl(urlInput) },
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CarbonSurface)
                        .border(1.dp, HairlineBorder, RoundedCornerShape(12.dp))
                        .testTag("web_reload_button")
                ) {
                    Icon(
                        imageVector = Icons.Default.Refresh,
                        contentDescription = "Reload page",
                        tint = MaterialTheme.colorScheme.onSurface
                    )
                }

                Box {
                    IconButton(
                        onClick = { quickMenuExpanded = true },
                        modifier = Modifier
                            .size(48.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(CarbonSurface)
                            .border(1.dp, HairlineBorder, RoundedCornerShape(12.dp))
                            .testTag("browser_quick_menu_button")
                    ) {
                        Icon(
                            imageVector = Icons.Default.Tune,
                            contentDescription = "Depth and CPU menu",
                            tint = TacticalEmerald
                        )
                    }

                    DropdownMenu(
                        expanded = quickMenuExpanded,
                        onDismissRequest = { quickMenuExpanded = false }
                    ) {
                        val gameAutoOn = extensionConfig.onlineAutoPlay || extensionConfig.autonomousMode
                        DropdownMenuItem(
                            text = {
                                Text(
                                    text = if (gameAutoOn) {
                                        "Normal Game Auto-Play: ON (${extensionConfig.autonomousEloProfile} Elo)"
                                    } else {
                                        "Normal Game Auto-Play: OFF"
                                    },
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (gameAutoOn) TacticalEmerald else MaterialTheme.colorScheme.onSurface
                                )
                            },
                            trailingIcon = if (gameAutoOn) {
                                { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                            } else null,
                            onClick = {
                                onToggleOnlineAutoPlay(!gameAutoOn)
                                quickMenuExpanded = false
                            }
                        )
                        AutonomousEloProfile.entries.forEach { prof ->
                            DropdownMenuItem(
                                text = { Text("Auto-Play Level: ${prof.elo} Elo (${prof.subtitle})") },
                                trailingIcon = if (extensionConfig.autonomousEloProfile == prof.elo) {
                                    { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                                } else null,
                                onClick = {
                                    onSelectAutonomousEloProfile(prof.elo)
                                    quickMenuExpanded = false
                                }
                            )
                        }
                        HorizontalDivider()
                        listOf(6, 10, 14, 18, 20).forEach { d ->
                            DropdownMenuItem(
                                text = { Text("Analysis Depth: D$d") },
                                trailingIcon = if (extensionConfig.maxDepth == d) {
                                    { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                                } else null,
                                onClick = {
                                    onSelectDepth(d)
                                    quickMenuExpanded = false
                                }
                            )
                        }
                        HorizontalDivider()
                        CpuUsageProfile.entries.forEach { profile ->
                            DropdownMenuItem(
                                text = { Text("CPU: ${profile.label} (${profile.detail})") },
                                trailingIcon = if (extensionConfig.cpuProfile == profile) {
                                    { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalEmerald) }
                                } else null,
                                onClick = {
                                    onSelectCpuProfile(profile)
                                    quickMenuExpanded = false
                                }
                            )
                        }
                        HorizontalDivider()
                        EvalBarOrientation.entries.forEach { orientation ->
                            DropdownMenuItem(
                                text = { Text("Eval Bar: ${orientation.label}") },
                                trailingIcon = if (extensionConfig.evalBarOrientation == orientation) {
                                    { Icon(Icons.Default.Check, contentDescription = null, tint = TacticalAmber) }
                                } else null,
                                onClick = {
                                    onSelectEvalOrientation(orientation)
                                    quickMenuExpanded = false
                                }
                            )
                        }
                    }
                }

                IconButton(
                    onClick = { compactToolbar = !compactToolbar },
                    modifier = Modifier
                        .size(48.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(CarbonSurface)
                        .border(1.dp, HairlineBorder, RoundedCornerShape(12.dp))
                        .testTag("browser_focus_toggle")
                ) {
                    Icon(
                        imageVector = if (compactToolbar) Icons.Default.CloseFullscreen else Icons.Default.OpenInFull,
                        contentDescription = if (compactToolbar) "Show browser bar" else "Maximize board space",
                        tint = TacticalAmber
                    )
                }
            }

            // Collapsible Site Presets & Status Strip for maximum mobile board viewport
            AnimatedVisibility(visible = !compactToolbar) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BrowserSitePreset.entries.forEach { preset ->
                        val selected = activeUrl == preset.url
                        FilterChip(
                            selected = selected,
                            onClick = {
                                urlInput = preset.url
                                onSelectPreset(preset)
                            },
                            label = { Text(preset.label, maxLines = 1) },
                            modifier = Modifier
                                .height(48.dp)
                                .testTag("preset_${preset.name.lowercase()}"),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = TacticalEmerald.copy(alpha = 0.22f),
                                selectedLabelColor = TacticalEmerald
                            )
                        )
                    }

                    FilterChip(
                        selected = extensionConfig.enabled,
                        onClick = { onToggleEnabled(!extensionConfig.enabled) },
                        leadingIcon = {
                            Icon(
                                imageVector = if (extensionConfig.enabled) Icons.Default.Visibility else Icons.Default.VisibilityOff,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        },
                        label = { Text(if (extensionConfig.enabled) "Overlay ON" else "Overlay OFF") },
                        modifier = Modifier
                            .height(48.dp)
                            .testTag("browser_toggle_overlay_chip"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = TacticalAmber.copy(alpha = 0.22f),
                            selectedLabelColor = TacticalAmber
                        )
                    )

                    val onlineOn = extensionConfig.onlineAutoPlay || extensionConfig.autonomousMode
                    FilterChip(
                        selected = onlineOn,
                        onClick = { onToggleOnlineAutoPlay(!onlineOn) },
                        label = {
                            Text(
                                text = if (onlineOn) "Game Auto ${extensionConfig.autonomousEloProfile}" else "Game Auto OFF",
                                maxLines = 1
                            )
                        },
                        modifier = Modifier
                            .height(48.dp)
                            .testTag("browser_toggle_online_autoplay_chip"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = TacticalEmerald.copy(alpha = 0.22f),
                            selectedLabelColor = TacticalEmerald
                        )
                    )

                    val puzzleAutoOn = extensionConfig.puzzleSolverEnabled && extensionConfig.puzzleAutoSolve
                    FilterChip(
                        selected = puzzleAutoOn,
                        onClick = { onTogglePuzzleAutoSolve(!puzzleAutoOn) },
                        label = {
                            Text(
                                text = if (puzzleAutoOn) "Puzzle AUTO" else "Puzzle OFF",
                                maxLines = 1
                            )
                        },
                        modifier = Modifier
                            .height(48.dp)
                            .testTag("browser_toggle_puzzle_solver_chip"),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = TacticalAmber.copy(alpha = 0.22f),
                            selectedLabelColor = TacticalAmber
                        )
                    )

                    EngineStatusIndicator(
                        status = engineStatus,
                        backendLabel = liveAnalysis.engineBackend
                    )

                    FairPlayStatusIndicator(
                        status = liveAnalysis.fairPlayStatus,
                        auditorEnabled = extensionConfig.fairPlayAuditorEnabled,
                        compact = true,
                        telemetry = liveAnalysis.fairPlayTelemetry,
                        showTelemetryMetrics = true
                    )

                    Surface(
                        shape = RoundedCornerShape(999.dp),
                        color = CarbonSurfaceHigh,
                        border = BorderStroke(1.dp, HairlineBorder),
                        modifier = Modifier.testTag("browser_runtime_mode_badge")
                    ) {
                        Text(
                            text = extensionConfig.androidRuntimeMode.label,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp)
                        )
                    }
                }
            }

            if (isLoadingPage) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(3.dp)
                        .clip(RoundedCornerShape(999.dp)),
                    color = TacticalEmerald,
                    trackColor = CarbonSurface
                )
            }

            val topLine = liveAnalysis.lines.firstOrNull()
            if (extensionConfig.showEvalBar && extensionConfig.evalBarOrientation == EvalBarOrientation.HORIZONTAL) {
                EvaluationBar(
                    topLine = topLine,
                    orientation = EvalBarOrientation.HORIZONTAL,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            // Main WebView + Optional Vertical Evaluation Bar
            Row(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                if (extensionConfig.showEvalBar && extensionConfig.evalBarOrientation == EvalBarOrientation.VERTICAL) {
                    EvaluationBar(
                        topLine = topLine,
                        orientation = EvalBarOrientation.VERTICAL,
                        modifier = Modifier.fillMaxHeight()
                    )
                }

                Box(
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(16.dp))
                        .background(CarbonSurface)
                        .border(1.dp, HairlineBorder, RoundedCornerShape(16.dp))
                ) {
                    if (webViewUnavailableReason != null) {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(20.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(
                                imageVector = Icons.Default.Language,
                                contentDescription = null,
                                tint = TacticalAmber,
                                modifier = Modifier.size(36.dp)
                            )
                            Spacer(modifier = Modifier.height(10.dp))
                            Text(
                                text = "Embedded Browser Preview Unavailable",
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurface
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(
                                text = "Install the exported .ZIP extension into Chrome, Edge, or Kiwi Browser from the Extension tab.",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    } else {
                        AndroidView(
                            modifier = Modifier
                                .fillMaxSize()
                                .testTag("browser_webview"),
                            factory = { ctx ->
                                try {
                                    WebView(ctx).apply {
                                        WebViewCompatHelper.configureCompatibleWebSettings(
                                            settings = settings,
                                            applyChromeAndroidUserAgent = true
                                        )
                                        addJavascriptInterface(
                                            ChessForgeAndroidBridge(
                                                onAnalysisUpdateJson = { json ->
                                                    post { onWebAnalysisJson(json) }
                                                },
                                                onFairPlayTelemetryParsed = { telemetry ->
                                                    post { onFairPlayTelemetry(telemetry) }
                                                },
                                                accessibilityDispatcher = accessibilityDispatcher,
                                                runtimeModeProvider = { extensionConfig.androidRuntimeMode },
                                                fallbackBaselineEloProvider = { extensionConfig.targetElo }
                                            ),
                                            "ChessForgeAndroidBridge"
                                        )
                                        webChromeClient = WebChromeClient()
                                        webViewClient = object : WebViewClient() {
                                            override fun onPageStarted(
                                                view: WebView?,
                                                url: String?,
                                                favicon: Bitmap?
                                            ) {
                                                isLoadingPage = true
                                                onPageStatusChange(EngineStatus.LOADING)
                                                if (!url.isNullOrBlank()) {
                                                    urlInput = url
                                                }
                                            }

                                            override fun onPageFinished(view: WebView?, url: String?) {
                                                isLoadingPage = false
                                                onPageStatusChange(EngineStatus.IDLE)
                                                if (view == null || engineJs.isEmpty() || contentJs.isEmpty()) return
                                                val bootstrap = buildString {
                                                    append(WebViewCompatHelper.buildChromeRuntimeStoragePolyfillJs())
                                                    append("\n")
                                                    append("window.__ChessForgeExtensionConfig = ")
                                                    append(extensionConfig.toJsObjectLiteral())
                                                    append(";\n")
                                                    append(engineJs)
                                                    append("\n")
                                                    if (openingBookJs.isNotEmpty()) {
                                                        append(openingBookJs)
                                                        append("\n")
                                                    }
                                                    if (syzygyTablebaseJs.isNotEmpty()) {
                                                        append(syzygyTablebaseJs)
                                                        append("\n")
                                                    }
                                                    append(contentJs)
                                                    append("\nwindow.__chessForgeUpdateConfig && window.__chessForgeUpdateConfig(")
                                                    append(extensionConfig.toJsObjectLiteral())
                                                    append(");")
                                                }
                                                view.evaluateJavascript(bootstrap, null)
                                            }
                                        }
                                        webViewRef = this
                                        loadUrl(activeUrl)
                                    }
                                } catch (t: Throwable) {
                                    webViewUnavailableReason = t.message ?: "WebView unavailable"
                                    onPageStatusChange(EngineStatus.ERROR)
                                    android.view.View(ctx)
                                }
                            }
                        )
                    }

                    // Live FairPlay Risk Level Overlay Status Indicator (SAFE / ELEVATED / LOCKOUT + S_i spikes, Z-score, ACPL)
                    FairPlayStatusIndicator(
                        status = liveAnalysis.fairPlayStatus,
                        auditorEnabled = extensionConfig.fairPlayAuditorEnabled,
                        compact = true,
                        telemetry = liveAnalysis.fairPlayTelemetry,
                        showTelemetryMetrics = true,
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(10.dp)
                            .testTag("browser_fairplay_overlay_indicator")
                    )
                }
            }

            LiveWebEvalStrip(
                analysis = liveAnalysis,
                expanded = stripExpanded,
                onToggleExpand = { stripExpanded = !stripExpanded }
            )
        }
    }
}

@Composable
private fun LiveWebEvalStrip(
    analysis: BrowserAnalysisSnapshot,
    expanded: Boolean,
    onToggleExpand: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag("live_web_eval_strip"),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = CarbonSurface),
        border = BorderStroke(1.dp, HairlineBorder)
    ) {
        val top = analysis.lines.firstOrNull()
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Psychology,
                        contentDescription = null,
                        tint = if (top != null) TacticalEmerald else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(20.dp)
                    )
                    if (top == null) {
                        Text(
                            text = "Waiting for chessboard on page…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    } else {
                        val bookPrefix = analysis.openingBook?.takeIf { it.opening.isNotBlank() }?.let { " • ${it.opening}" }.orEmpty()
                        Text(
                            text = "${top.san}${top.annotation} (${top.uci})$bookPrefix",
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    if (top != null) {
                        val mate = top.whiteMate ?: top.mate
                        val cp = top.whiteCentipawns ?: top.centipawns
                        val badgeText = when {
                            mate != null -> (if (mate > 0) "+M" else "-M") + abs(mate)
                            cp != null -> "%+.2f".format(cp / 100f)
                            else -> "${top.winPct.toInt()}%"
                        }
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = CarbonSurfaceHigh,
                            border = BorderStroke(1.dp, TacticalEmerald.copy(alpha = 0.55f))
                        ) {
                            Text(
                                text = "$badgeText • D${analysis.depth}",
                                style = MaterialTheme.typography.labelMedium,
                                color = TacticalEmerald,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }

                    IconButton(
                        onClick = onToggleExpand,
                        modifier = Modifier
                            .size(48.dp)
                            .testTag("live_strip_expand_button")
                    ) {
                        Icon(
                            imageVector = if (expanded) Icons.Default.ExpandMore else Icons.Default.ExpandLess,
                            contentDescription = if (expanded) "Collapse details" else "Show Multi-PV & Opening Book",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            AnimatedVisibility(visible = expanded) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    HorizontalDivider(color = HairlineBorder)

                    // Board theme + last played move annotation row
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Palette,
                                contentDescription = null,
                                tint = TacticalAmber,
                                modifier = Modifier.size(16.dp)
                            )
                            Text(
                                text = "Board Theme: ${analysis.boardTheme.name}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        analysis.lastMoveAnnotation?.let { ann ->
                            Surface(
                                shape = RoundedCornerShape(6.dp),
                                color = annotationBadgeColor(ann.symbol).copy(alpha = 0.2f),
                                border = BorderStroke(1.dp, annotationBadgeColor(ann.symbol))
                            ) {
                                Text(
                                    text = "Last: ${ann.square} ${ann.symbol} (${ann.label})",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = annotationBadgeColor(ann.symbol),
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }

                    // Candidate Multi-PV Lines
                    if (analysis.lines.isNotEmpty()) {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            analysis.lines.forEach { line ->
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(CarbonSurfaceHigh)
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        Text(
                                            text = "#${line.rank}  ${line.san} (${line.uci})",
                                            style = MaterialTheme.typography.labelMedium,
                                            color = MaterialTheme.colorScheme.onSurface
                                        )
                                        if (line.annotation.isNotBlank()) {
                                            val pillColor = annotationBadgeColor(line.annotation)
                                            Surface(
                                                shape = RoundedCornerShape(4.dp),
                                                color = pillColor.copy(alpha = 0.22f),
                                                border = BorderStroke(1.dp, pillColor.copy(alpha = 0.7f))
                                            ) {
                                                Text(
                                                    text = line.annotation,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    fontWeight = FontWeight.Bold,
                                                    color = pillColor,
                                                    modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp)
                                                )
                                            }
                                        }
                                    }
                                    val sMate = line.whiteMate ?: line.mate
                                    val sCp = line.whiteCentipawns ?: line.centipawns
                                    val score = when {
                                        sMate != null -> (if (sMate > 0) "+M" else "-M") + abs(sMate)
                                        sCp != null -> "%+.2f".format(sCp / 100f)
                                        else -> "${line.winPct.toInt()}%"
                                    }
                                    Text(
                                        text = "$score • D${line.depth}",
                                        style = MaterialTheme.typography.labelMedium,
                                        color = if (line.rank == 1) TacticalEmerald else TacticalAmber
                                    )
                                }
                            }
                        }
                    }

                    // Master Opening Book Section
                    val book = analysis.openingBook
                    if (book != null && (book.opening.isNotBlank() || book.moves.isNotEmpty())) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(CarbonSurfaceHigh)
                                .padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.MenuBook,
                                    contentDescription = null,
                                    tint = TacticalEmerald,
                                    modifier = Modifier.size(16.dp)
                                )
                                Text(
                                    text = "${if (book.eco.isNotBlank()) "[${book.eco}] " else ""}${book.opening.ifBlank { "Master Theory" }}",
                                    style = MaterialTheme.typography.labelLarge,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TacticalEmerald,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            book.moves.take(3).forEach { move ->
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = "${move.san} • ${move.games} games",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurface
                                    )
                                    Text(
                                        text = "W ${move.whitePct}% / D ${move.drawPct}% / B ${move.blackPct}%",
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }

                    // Syzygy 7-Piece Endgame Tablebase Section
                    val tablebase = analysis.tablebase
                    if (tablebase != null && tablebase.isTablebase) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp))
                                .background(CarbonSurfaceHigh)
                                .padding(10.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            val tbColor = when (tablebase.category) {
                                "win" -> TacticalEmerald
                                "loss" -> TacticalRed
                                else -> TacticalAmber
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Psychology,
                                        contentDescription = null,
                                        tint = tbColor,
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Text(
                                        text = "Syzygy 7-Piece • ${tablebase.outcome}",
                                        style = MaterialTheme.typography.labelLarge,
                                        fontWeight = FontWeight.SemiBold,
                                        color = tbColor
                                    )
                                }
                                Surface(
                                    shape = RoundedCornerShape(6.dp),
                                    color = tbColor.copy(alpha = 0.18f),
                                    border = BorderStroke(1.dp, tbColor)
                                ) {
                                    Text(
                                        text = tablebase.scoreBadge,
                                        style = MaterialTheme.typography.labelSmall,
                                        fontWeight = FontWeight.Bold,
                                        color = tbColor,
                                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                                    )
                                }
                            }
                            if (tablebase.moves.isNotEmpty()) {
                                tablebase.moves.take(3).forEach { move ->
                                    val moveColor = when (move.quality) {
                                        "win" -> TacticalEmerald
                                        "loss" -> TacticalRed
                                        else -> TacticalAmber
                                    }
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            Text(
                                                text = "${move.san} (${move.uci})",
                                                style = MaterialTheme.typography.labelMedium,
                                                color = MaterialTheme.colorScheme.onSurface
                                            )
                                            Surface(
                                                shape = RoundedCornerShape(4.dp),
                                                color = moveColor.copy(alpha = 0.2f)
                                            ) {
                                                Text(
                                                    text = move.annotation,
                                                    style = MaterialTheme.typography.labelSmall,
                                                    fontWeight = FontWeight.Bold,
                                                    color = moveColor,
                                                    modifier = Modifier.padding(horizontal = 4.dp)
                                                )
                                            }
                                        }
                                        val dtmText = when {
                                            move.checkmate -> "Checkmate"
                                            move.stalemate -> "Stalemate"
                                            move.dtm != null -> "DTM ${move.dtm}"
                                            move.dtz != null -> "DTZ ${move.dtz}"
                                            else -> move.quality.replaceFirstChar { it.uppercase() }
                                        }
                                        Text(
                                            text = dtmText,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun annotationBadgeColor(symbol: String): Color = when (symbol) {
    "!!" -> Color(0xFF1BACA6)      // Chess.com Brilliant Teal
    "!" -> Color(0xFF5C8BB0)       // Chess.com Great Blue
    "★" -> Color(0xFF81B64C)       // Chess.com Best Green
    "+", "!?" -> Color(0xFF96BC4B) // Chess.com Excellent Light Green
    "✓" -> Color(0xFF95B776)       // Chess.com Good Sage Green
    "Book" -> Color(0xFFA88865)    // Chess.com Book Tan
    "?!" -> Color(0xFFF7C631)      // Chess.com Inaccuracy Yellow
    "?" -> Color(0xFFE6912C)       // Chess.com Mistake Orange
    "✕" -> Color(0xFFFF7769)       // Chess.com Miss Coral
    "??" -> Color(0xFFCA3431)      // Chess.com Blunder Crimson
    else -> TacticalEmerald
}
