package com.example

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Parcelable
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.School
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import com.example.data.repository.SettingsRepository
import com.example.ui.screens.history.HistoryScreen
import com.example.ui.screens.history.HistoryViewModel
import com.example.ui.screens.onboarding.OnboardingScreen
import com.example.ui.screens.overlay.LiveOverlayScreen
import com.example.ui.screens.overlay.LiveOverlayViewModel
import com.example.ui.screens.practice.PracticeScreen
import com.example.ui.screens.practice.PracticeViewModel
import com.example.ui.screens.puzzles.PuzzleScreen
import com.example.ui.screens.puzzles.PuzzleViewModel
import com.example.ui.screens.screenshot.ScreenshotScreen
import com.example.ui.screens.screenshot.ScreenshotViewModel
import com.example.ui.screens.settings.SettingsScreen
import com.example.ui.screens.settings.SettingsViewModel
import com.example.ui.theme.ChessForgeTheme

enum class AppTab(val title: String, val icon: ImageVector, val tag: String) {
    PRACTICE("Practice", Icons.Default.School, "tab_practice"),
    SCREENSHOT("Screenshot", Icons.Default.PhotoLibrary, "tab_screenshot"),
    OVERLAY("Overlay", Icons.Default.Layers, "tab_overlay"),
    PUZZLES("Puzzles", Icons.Default.Extension, "tab_puzzles"),
    HISTORY("History", Icons.Default.History, "tab_history"),
    SETTINGS("Settings", Icons.Default.Settings, "tab_settings")
}

class MainActivity : ComponentActivity() {

    private val practiceViewModel: PracticeViewModel by viewModels()
    private val screenshotViewModel: ScreenshotViewModel by viewModels()
    private val liveOverlayViewModel: LiveOverlayViewModel by viewModels()
    private val puzzleViewModel: PuzzleViewModel by viewModels()
    private val historyViewModel: HistoryViewModel by viewModels()
    private val settingsViewModel: SettingsViewModel by viewModels()

    private lateinit var settingsRepository: SettingsRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        settingsRepository = SettingsRepository(this)

        var initialTab = AppTab.PRACTICE

        // Handle Shortcut or External Intent
        intent?.let { handleIncomingIntent(it) { tab -> initialTab = tab } }

        setContent {
            val settings by settingsRepository.settings.collectAsState()
            var currentTab by remember { mutableStateOf(initialTab) }
            var showOnboarding by remember { mutableStateOf(!settings.onboardingCompleted) }

            ChessForgeTheme(appTheme = settings.appTheme) {
                if (showOnboarding) {
                    OnboardingScreen(
                        onFinishOnboarding = {
                            val updated = settings.copy(onboardingCompleted = true, ethicsAccepted = true)
                            settingsRepository.updateSettings(updated)
                            showOnboarding = false
                        }
                    )
                } else {
                    Scaffold(
                        modifier = Modifier.fillMaxSize(),
                        bottomBar = {
                            NavigationBar(modifier = Modifier.testTag("bottom_nav_bar")) {
                                AppTab.values().forEach { tab ->
                                    NavigationBarItem(
                                        selected = currentTab == tab,
                                        onClick = { currentTab = tab },
                                        icon = { Icon(tab.icon, contentDescription = tab.title) },
                                        label = { Text(tab.title) },
                                        modifier = Modifier.testTag(tab.tag)
                                    )
                                }
                            }
                        }
                    ) { padding ->
                        when (currentTab) {
                            AppTab.PRACTICE -> PracticeScreen(
                                viewModel = practiceViewModel,
                                boardScheme = settings.boardScheme,
                                modifier = Modifier.padding(padding)
                            )
                            AppTab.SCREENSHOT -> ScreenshotScreen(
                                viewModel = screenshotViewModel,
                                boardScheme = settings.boardScheme,
                                modifier = Modifier.padding(padding)
                            )
                            AppTab.OVERLAY -> LiveOverlayScreen(
                                viewModel = liveOverlayViewModel,
                                onNavigateToPracticeWithReconstruction = {
                                    currentTab = AppTab.PRACTICE
                                },
                                modifier = Modifier.padding(padding)
                            )
                            AppTab.PUZZLES -> PuzzleScreen(
                                viewModel = puzzleViewModel,
                                boardScheme = settings.boardScheme,
                                modifier = Modifier.padding(padding)
                            )
                            AppTab.HISTORY -> HistoryScreen(
                                viewModel = historyViewModel,
                                onSelectFen = { fen ->
                                    practiceViewModel.loadPgnText(fen)
                                    currentTab = AppTab.PRACTICE
                                },
                                modifier = Modifier.padding(padding)
                            )
                            AppTab.SETTINGS -> SettingsScreen(
                                viewModel = settingsViewModel,
                                modifier = Modifier.padding(padding)
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingIntent(intent)
    }

    private fun handleIncomingIntent(intent: Intent, onTabSelected: ((AppTab) -> Unit)? = null) {
        // App Shortcut handling
        val shortcutDest = intent.getStringExtra("SHORTCUT_DESTINATION")
        if (shortcutDest != null) {
            when (shortcutDest) {
                "SCREENSHOT" -> onTabSelected?.invoke(AppTab.SCREENSHOT)
                "OVERLAY" -> onTabSelected?.invoke(AppTab.OVERLAY)
                "PUZZLES" -> onTabSelected?.invoke(AppTab.PUZZLES)
                "HISTORY" -> onTabSelected?.invoke(AppTab.HISTORY)
            }
            return
        }

        // Share Sheet Image Intent (Section 3.1)
        if (intent.action == Intent.ACTION_SEND && intent.type?.startsWith("image/") == true) {
            val imageUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra<Parcelable>(Intent.EXTRA_STREAM) as? Uri
            }
            if (imageUri != null) {
                screenshotViewModel.loadFromUri(imageUri)
                onTabSelected?.invoke(AppTab.SCREENSHOT)
            }
        }
    }
}
