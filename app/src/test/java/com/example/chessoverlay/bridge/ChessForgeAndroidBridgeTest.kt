package com.example.chessoverlay.bridge

import android.accessibilityservice.GestureDescription
import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import com.example.chessoverlay.model.AndroidOverlayRuntimeMode
import com.example.chessoverlay.model.BrowserExtensionConfig
import com.example.chessoverlay.model.FairPlayRiskLevel
import com.example.chessoverlay.model.FairPlayTelemetryModel
import com.example.chessoverlay.ui.MainViewModel
import com.example.chessoverlay.ui.components.FairPlayStatusIndicator
import com.example.chessoverlay.ui.theme.ChessForgeTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ChessForgeAndroidBridgeTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `default config selects native accessibility overlay mode and keeps AccessibilityDispatcher disabled`() {
        val cfg = BrowserExtensionConfig()
        assertEquals(AndroidOverlayRuntimeMode.NATIVE_ACCESSIBILITY_OVERLAY, cfg.androidRuntimeMode)
        assertFalse(cfg.accessibilityDispatcherEnabled)

        val dispatcher = AccessibilityDispatcher()
        assertFalse(dispatcher.enabled)
    }

    @Test
    fun `AccessibilityDispatcher blocks strokes when disabled and builds GestureDescription when opted in`() {
        val dispatchedGestures = mutableListOf<GestureDescription>()
        val dispatcher = AccessibilityDispatcher(
            enabled = false,
            executorProvider = {
                GestureStrokeExecutor { gesture ->
                    dispatchedGestures.add(gesture)
                    true
                }
            }
        )

        val pathJson = """
            {
              "mode": "drag",
              "durationMs": 180,
              "viewportScale": 2.0,
              "offsetX": 10.0,
              "offsetY": 20.0,
              "waypoints": [
                {"x": 120.0, "y": 320.0, "timestampOffsetMs": 0},
                {"x": 124.0, "y": 270.0, "timestampOffsetMs": 90},
                {"x": 128.0, "y": 220.0, "timestampOffsetMs": 180}
              ]
            }
        """.trimIndent()

        assertFalse(dispatcher.dispatchPathJson(pathJson))
        assertEquals(0, dispatchedGestures.size)

        dispatcher.enabled = true
        assertTrue(dispatcher.dispatchPathJson(pathJson))
        assertEquals(1, dispatchedGestures.size)
        assertEquals(1, dispatchedGestures[0].strokeCount)
    }

    @Test
    fun `ChessForgeAndroidBridge parses onFairPlayTelemetry into FairPlayTelemetryModel and updates MainViewModel`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val vm = MainViewModel(app)
        var captured: FairPlayTelemetryModel? = null

        val bridge = ChessForgeAndroidBridge(
            onAnalysisUpdateJson = vm::onWebAnalysisJson,
            onFairPlayTelemetryParsed = { model ->
                captured = model
                vm.onFairPlayTelemetry(model)
            }
        )

        val telemetryJson = """
            {
              "riskLevel": "ELEVATED",
              "lockedOut": false,
              "baselineElo": 1600,
              "observedIpr": 1890,
              "zScore": 2.15,
              "currentGameMoves": 22,
              "currentGameSiSpikes": 1,
              "lastSiScore": 0.91,
              "slidingWindowGames": 5,
              "acpl": 18.4,
              "warnings": [{"message": "IPR Z-score exceeded +1.8 sigma"}]
            }
        """.trimIndent()

        bridge.onFairPlayTelemetry(telemetryJson)

        assertNotNull(captured)
        assertEquals(FairPlayRiskLevel.ELEVATED, captured!!.riskLevel)
        assertEquals(1890, captured!!.observedIpr)
        assertEquals(2.15f, captured!!.zScore, 0.01f)
        assertEquals(1, captured!!.currentGameSiSpikes)
        assertEquals(18.4f, captured!!.acpl, 0.05f)
        assertEquals(5, captured!!.slidingWindowGames)

        val snap = vm.liveAnalysis.value
        assertEquals(FairPlayRiskLevel.ELEVATED, snap.fairPlayTelemetry.riskLevel)
        assertEquals(1, snap.fairPlayStatus.currentGameSiSpikes)
        assertEquals(18.4f, snap.fairPlayStatus.acpl, 0.05f)
    }

    @Test
    fun `WebViewCompatHelper provides Chrome for Android UA and chrome runtime storage polyfills`() {
        assertTrue(WebViewCompatHelper.CHROME_ANDROID_USER_AGENT.contains("Android"))
        assertTrue(WebViewCompatHelper.CHROME_ANDROID_USER_AGENT.contains("Chrome/"))
        val polyfill = WebViewCompatHelper.buildChromeRuntimeStoragePolyfillJs()
        assertTrue(polyfill.contains("root.runtime"))
        assertTrue(polyfill.contains("root.storage"))
        assertTrue(polyfill.contains("sendMessage"))
    }

    @Test
    fun `FairPlayStatusIndicator renders live S_i spikes, IPR Z-score, and ACPL metrics`() {
        val telemetry = FairPlayTelemetryModel(
            riskLevel = FairPlayRiskLevel.ELEVATED,
            observedIpr = 1910,
            zScore = 2.08f,
            currentGameSiSpikes = 2,
            acpl = 14.7f
        )

        composeRule.setContent {
            ChessForgeTheme {
                FairPlayStatusIndicator(
                    status = telemetry.toFairPlayStatus(),
                    auditorEnabled = true,
                    compact = true,
                    telemetry = telemetry,
                    showTelemetryMetrics = true
                )
            }
        }

        composeRule.onNodeWithTag("fairplay_status_indicator").assertIsDisplayed()
        composeRule.onNodeWithText("ELEVATED • Z 2.08σ • S_i 2 • ACPL 14.7").assertIsDisplayed()
    }
}
