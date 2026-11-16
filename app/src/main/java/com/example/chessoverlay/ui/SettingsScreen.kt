package com.example.chessoverlay.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.ui.components.EngineStatusIndicator
import com.example.chessoverlay.ui.theme.CarbonSurface
import com.example.chessoverlay.ui.theme.CarbonSurfaceHigh
import com.example.chessoverlay.ui.theme.HairlineBorder
import com.example.chessoverlay.ui.theme.TacticalAmber
import com.example.chessoverlay.ui.theme.TacticalEmerald
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(
    config: BrowserExtensionConfig,
    engineStatus: EngineStatus,
    engineBackend: String,
    onSelectCpuProfile: (CpuUsageProfile) -> Unit,
    onSelectDepth: (Int) -> Unit,
    onSelectSkillLevel: (Int) -> Unit,
    onSelectMultiPv: (Int) -> Unit,
    onToggleEvalBar: (Boolean) -> Unit,
    onSelectEvalOrientation: (EvalBarOrientation) -> Unit,
    onToggleArrows: (Boolean) -> Unit,
    onToggleAnnotations: (Boolean) -> Unit,
    onToggleOpeningBook: (Boolean) -> Unit,
    onToggleTablebase: (Boolean) -> Unit = {},
    onToggleAutoAdaptTheme: (Boolean) -> Unit,
    onToggleHud: (Boolean) -> Unit,
    onSelectTurn: (String) -> Unit,
    onTogglePracticeAutoPlay: (Boolean) -> Unit,
    onChangePracticeDelay: (Int) -> Unit
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
                .padding(horizontal = 14.dp, vertical = 8.dp)
                .testTag("settings_screen"),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Engine & Overlay",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(modifier = Modifier.width(8.dp))
                EngineStatusIndicator(
                    status = engineStatus,
                    backendLabel = engineBackend
                )
            }

            // CPU Usage Profile Card
            SettingsSectionCard(
                title = "CPU Usage Profile",
                icon = Icons.Default.Memory
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CpuUsageProfile.entries.forEach { profile ->
                        val active = config.cpuProfile == profile
                        Surface(
                            modifier = Modifier
                                .weight(1f)
                                .height(68.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .clickable { onSelectCpuProfile(profile) }
                                .testTag("cpu_profile_${profile.key}"),
                            shape = RoundedCornerShape(12.dp),
                            color = if (active) TacticalEmerald.copy(alpha = 0.2f) else CarbonSurfaceHigh,
                            border = BorderStroke(1.dp, if (active) TacticalEmerald else HairlineBorder)
                        ) {
                            Column(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(6.dp),
                                verticalArrangement = Arrangement.Center,
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(
                                    text = profile.label,
                                    style = MaterialTheme.typography.labelLarge,
                                    color = if (active) TacticalEmerald else MaterialTheme.colorScheme.onSurface,
                                    maxLines = 1
                                )
                                Text(
                                    text = profile.detail,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    }
                }
            }

            // Stockfish Strength & Depth Card
            SettingsSectionCard(
                title = "Stockfish 19 WASM Strength",
                icon = Icons.Default.Psychology
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Difficulty (Skill Level)",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "${config.skillLevel} / 20 (${skillTierLabel(config.skillLevel)})",
                            style = MaterialTheme.typography.labelMedium,
                            color = TacticalEmerald,
                            modifier = Modifier.testTag("skill_level_value")
                        )
                    }
                    Slider(
                        value = config.skillLevel.toFloat(),
                        onValueChange = { onSelectSkillLevel(it.roundToInt()) },
                        valueRange = 0f..20f,
                        steps = 19,
                        colors = SliderDefaults.colors(
                            thumbColor = TacticalEmerald,
                            activeTrackColor = TacticalEmerald
                        ),
                        modifier = Modifier.testTag("skill_level_slider")
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(5 to "Casual", 12 to "Club", 17 to "Master", 20 to "Max GM").forEach { (lvl, name) ->
                            FilterChip(
                                selected = config.skillLevel == lvl,
                                onClick = { onSelectSkillLevel(lvl) },
                                label = { Text(name, maxLines = 1) },
                                modifier = Modifier
                                    .height(48.dp)
                                    .testTag("skill_preset_$lvl"),
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = TacticalEmerald.copy(alpha = 0.2f),
                                    selectedLabelColor = TacticalEmerald
                                )
                            )
                        }
                    }
                }

                // Analysis Depth (2..20)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Analysis Depth",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = MaterialTheme.colorScheme.onSurface
                        )
                        Text(
                            text = "Depth ${config.maxDepth}",
                            style = MaterialTheme.typography.labelMedium,
                            color = TacticalAmber,
                            modifier = Modifier.testTag("analysis_depth_value")
                        )
                    }
                    Slider(
                        value = config.maxDepth.toFloat(),
                        onValueChange = { onSelectDepth(it.roundToInt()) },
                        valueRange = 2f..20f,
                        steps = 17,
                        colors = SliderDefaults.colors(
                            thumbColor = TacticalAmber,
                            activeTrackColor = TacticalAmber
                        ),
                        modifier = Modifier.testTag("analysis_depth_slider")
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(6, 10, 14, 18, 20).forEach { d ->
                            FilterChip(
                                selected = config.maxDepth == d,
                                onClick = { onSelectDepth(d) },
                                label = { Text("D$d", maxLines = 1) },
                                modifier = Modifier
                                    .height(48.dp)
                                    .testTag("depth_preset_$d"),
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = TacticalAmber.copy(alpha = 0.2f),
                                    selectedLabelColor = TacticalAmber
                                )
                            )
                        }
                    }
                }

                // MultiPV Line Count
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = "Candidate Lines (Multi-PV)",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.SemiBold,
                        color = MaterialTheme.colorScheme.onSurface
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        listOf(1, 2, 3).forEach { pv ->
                            val active = config.multiPv == pv
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(48.dp)
                                    .clip(RoundedCornerShape(10.dp))
                                    .clickable { onSelectMultiPv(pv) }
                                    .testTag("settings_multipv_$pv"),
                                shape = RoundedCornerShape(10.dp),
                                color = if (active) TacticalEmerald.copy(alpha = 0.22f) else CarbonSurfaceHigh,
                                border = BorderStroke(1.dp, if (active) TacticalEmerald else HairlineBorder)
                            ) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(
                                        text = "$pv ${if (pv == 1) "Line" else "Lines"}",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = if (active) TacticalEmerald else MaterialTheme.colorScheme.onSurface
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Master Opening Book & Annotations Card
            SettingsSectionCard(
                title = "Opening Book & Board Annotations",
                icon = Icons.Default.MenuBook
            ) {
                SettingsToggleItem(
                    title = "Master Opening Book Lookup",
                    subtitle = "Displays ECO opening names and top Master database moves",
                    checked = config.showOpeningBook,
                    testTag = "settings_switch_opening_book",
                    onCheckedChange = onToggleOpeningBook
                )

                SettingsToggleItem(
                    title = "Move Annotations (!!, !?, ?!, ??)",
                    subtitle = "Stamps Chess quality symbols directly on board squares",
                    checked = config.showAnnotations,
                    testTag = "settings_switch_annotations",
                    onCheckedChange = onToggleAnnotations
                )

                SettingsToggleItem(
                    title = "Adapt Colors to Board Theme",
                    subtitle = "Detects Lichess/Chess.com light, dark, green & custom boards",
                    checked = config.autoAdaptTheme,
                    testTag = "settings_switch_adapt_theme",
                    onCheckedChange = onToggleAutoAdaptTheme
                )
            }

            // Syzygy 7-Piece Endgame Tablebase Card
            SettingsSectionCard(
                title = "Syzygy 7-Piece Endgame Tablebase",
                icon = Icons.Default.Psychology
            ) {
                SettingsToggleItem(
                    title = "Enable Syzygy Tablebase",
                    subtitle = "Provides mathematically proven moves (WDL / DTZ / DTM) when 7 or fewer pieces remain",
                    checked = config.showTablebase,
                    testTag = "settings_switch_tablebase",
                    onCheckedChange = onToggleTablebase
                )
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = CarbonSurfaceHigh,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                ) {
                    Text(
                        text = "Instant 7-piece tablebase lookup via Lichess API with automatic offline heuristic fallback for fundamental mates (K+Q vs K, K+R vs K, K+B vs K, etc.).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(10.dp)
                    )
                }
            }

            // Visual Display & Evaluation Bar Card
            SettingsSectionCard(
                title = "Evaluation Bar & Overlay Visuals",
                icon = Icons.Default.Visibility
            ) {
                SettingsToggleItem(
                    title = "Show Evaluation Bar",
                    subtitle = "White/Black advantage bar synced to engine score",
                    checked = config.showEvalBar,
                    testTag = "settings_switch_evalbar",
                    onCheckedChange = onToggleEvalBar
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    EvalBarOrientation.entries.forEach { orientation ->
                        val active = config.evalBarOrientation == orientation
                        Surface(
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onSelectEvalOrientation(orientation) }
                                .testTag("eval_orientation_${orientation.key}"),
                            shape = RoundedCornerShape(10.dp),
                            color = if (active) TacticalEmerald.copy(alpha = 0.2f) else CarbonSurfaceHigh,
                            border = BorderStroke(1.dp, if (active) TacticalEmerald else HairlineBorder)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = "${orientation.label} Bar",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = if (active) TacticalEmerald else MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }

                SettingsToggleItem(
                    title = "Show SVG Move Arrows",
                    subtitle = "Draws primary & alternative move vectors directly on the board",
                    checked = config.showArrows,
                    testTag = "settings_switch_arrows",
                    onCheckedChange = onToggleArrows
                )

                SettingsToggleItem(
                    title = "Show Evaluation HUD",
                    subtitle = "Compact best-move score pill above the board",
                    checked = config.showHud,
                    testTag = "settings_switch_hud",
                    onCheckedChange = onToggleHud
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf("auto" to "Auto Turn", "w" to "White", "b" to "Black").forEach { (key, label) ->
                        val active = config.turnOverride == key
                        Surface(
                            modifier = Modifier
                                .weight(1f)
                                .height(48.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .clickable { onSelectTurn(key) }
                                .testTag("settings_turn_$key"),
                            shape = RoundedCornerShape(10.dp),
                            color = if (active) TacticalAmber.copy(alpha = 0.2f) else CarbonSurfaceHigh,
                            border = BorderStroke(1.dp, if (active) TacticalAmber else HairlineBorder)
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    text = label,
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (active) TacticalAmber else MaterialTheme.colorScheme.onSurface
                                )
                            }
                        }
                    }
                }
            }

            // Offline Practice Board Sparring Card
            SettingsSectionCard(
                title = "Offline Practice Board Sparring",
                icon = Icons.Default.Speed
            ) {
                SettingsToggleItem(
                    title = "Practice Board Auto-Play",
                    subtitle = "Plays paced sparring replies strictly on the offline Practice Board only",
                    checked = config.practiceAutoPlay,
                    testTag = "settings_switch_practice_auto",
                    onCheckedChange = onTogglePracticeAutoPlay
                )
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(
                            text = "Sparring Response Pacing",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Text(
                            text = "${config.practiceHumanDelayMs} ms",
                            style = MaterialTheme.typography.labelMedium,
                            color = TacticalEmerald
                        )
                    }
                    Slider(
                        value = config.practiceHumanDelayMs.toFloat(),
                        onValueChange = { onChangePracticeDelay((it / 50f).roundToInt() * 50) },
                        valueRange = 250f..2000f,
                        colors = SliderDefaults.colors(
                            thumbColor = TacticalEmerald,
                            activeTrackColor = TacticalEmerald
                        ),
                        modifier = Modifier.testTag("practice_delay_slider")
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun SettingsSectionCard(
    title: String,
    icon: ImageVector,
    content: @Composable () -> Unit
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
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(imageVector = icon, contentDescription = null, tint = TacticalEmerald, modifier = Modifier.size(20.dp))
                Text(
                    text = title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            }
            content()
        }
    }
}

@Composable
private fun SettingsToggleItem(
    title: String,
    subtitle: String,
    checked: Boolean,
    testTag: String,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(CarbonSurfaceHigh)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = Modifier.testTag(testTag)
        )
    }
}

private fun skillTierLabel(level: Int): String = when {
    level <= 5 -> "Casual"
    level <= 12 -> "Club"
    level <= 17 -> "Master"
    else -> "Full Strength"
}
