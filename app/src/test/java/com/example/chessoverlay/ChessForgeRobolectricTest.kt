package com.example.chessoverlay

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import com.example.chessoverlay.model.BrowserSitePreset
import com.example.chessoverlay.model.CpuUsageProfile
import com.example.chessoverlay.model.EngineStatus
import com.example.chessoverlay.model.EvalBarOrientation
import com.example.chessoverlay.model.WorkspaceTab
import com.example.chessoverlay.ui.MainViewModel
import com.example.chessoverlay.util.AssetManagerHelper
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.zip.ZipFile

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ChessForgeRobolectricTest {

    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun `extension hub, settings screen, eval bar, status indicator, and responsive browser tab render cleanly`() {
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("engine_status_indicator").assertIsDisplayed()
        composeRule.onNodeWithTag("evaluation_bar").assertIsDisplayed()
        composeRule.onNodeWithTag("quick_settings_menu_button").assertIsDisplayed()
        composeRule.onNodeWithTag("export_zip_button").performScrollTo().assertIsDisplayed()

        // Navigate to Settings Screen & toggle CPU, Difficulty, Depth 20, FairPlayAuditor, HumanizerController, Clear Telemetry, Opening Book & Annotations
        composeRule.onNodeWithTag("tab_settings_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_fairplay_auditor").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_humanizer").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_clear_telemetry_button").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings_telemetry_cleared_text").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("cpu_profile_turbo").performScrollTo().performClick()
        composeRule.onNodeWithTag("skill_preset_12").performScrollTo().performClick()
        composeRule.onNodeWithTag("depth_preset_18").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_multipv_3").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_switch_opening_book").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_annotations").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_adapt_theme").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_tablebase").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_autonomous_mode").performScrollTo().assertIsDisplayed().performClick()
        composeRule.onNodeWithTag("settings_autonomous_elo_1200").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_autonomous_elo_2000").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_autonomous_elo_1600").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_autonomous_profile_info").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("eval_orientation_horizontal").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Navigate via bottom NavigationBar to Browser Workspace Tab & verify compact focus + FairPlay overlay indicator + expandable eval/book/tb strip
        composeRule.onNodeWithTag("nav_bottom_browser").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("url_input_field").assertIsDisplayed()
        composeRule.onNodeWithTag("preset_lichess").assertIsDisplayed()
        composeRule.onNodeWithTag("browser_fairplay_overlay_indicator").assertIsDisplayed()
        composeRule.onNodeWithTag("browser_focus_toggle").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("evaluation_bar").assertIsDisplayed()
        composeRule.onNodeWithTag("live_web_eval_strip").assertIsDisplayed()
        composeRule.onNodeWithTag("live_strip_expand_button").performClick()
        composeRule.waitForIdle()

        // Verify bottom Settings navigation item returns directly to Settings
        composeRule.onNodeWithTag("nav_bottom_settings").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings_screen").assertIsDisplayed()
    }

    @Test
    fun `bundled browser extension zip contains Stockfish 19 WASM, Opening Book, Syzygy Tablebase, and Chesscom annotations`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val engineJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_ENGINE_JS)
        val bookJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_OPENING_BOOK_JS)
        val tablebaseJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_SYZYGY_TABLEBASE_JS)
        val contentJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_CONTENT_JS)
        assertTrue(engineJs.contains("ChessForgeEngine"))
        assertTrue(engineJs.contains("uciToSan"))
        assertTrue(bookJs.contains("ChessForgeOpeningBook"))
        assertTrue(bookJs.contains("Ruy Lopez"))
        assertTrue(tablebaseJs.contains("ChessForgeTablebase"))
        assertTrue(tablebaseJs.contains("tablebase.lichess.ovh"))
        assertTrue(contentJs.contains("STOCKFISH_ANALYZE"))
        assertTrue(contentJs.contains("detectBoardTheme"))
        assertTrue(contentJs.contains("classifyCandidateAnnotations"))
        assertTrue(contentJs.contains("#1BACA6")) // Chess.com Brilliant Teal
        assertTrue(contentJs.contains("#81B64C")) // Chess.com Best Star Green
        assertTrue(contentJs.contains("readLichessBoard"))
        assertTrue(contentJs.contains("readChessComBoard"))

        val zipFile = AssetManagerHelper.exportExtensionZipToCache(context)
        assertNotNull(zipFile)
        assertTrue(zipFile!!.exists() && zipFile.length() > 100_000L)

        ZipFile(zipFile).use { zip ->
            assertNotNull(zip.getEntry("manifest.json"))
            assertNotNull(zip.getEntry("vendor/stockfish-19-lite-single.wasm"))
            assertNotNull(zip.getEntry("vendor/stockfish-19-lite-single.js"))
            assertNotNull(zip.getEntry("src/offscreen.html"))
            assertNotNull(zip.getEntry("src/offscreen.js"))
            assertNotNull(zip.getEntry("src/chess-engine.js"))
            assertNotNull(zip.getEntry("src/opening-book.js"))
            assertNotNull(zip.getEntry("src/syzygy-tablebase.js"))
            assertNotNull(zip.getEntry("src/content.js"))
            assertNotNull(zip.getEntry("src/popup.html"))
            assertNotNull(zip.getEntry("src/background.js"))
        }
    }

    @Test
    fun `view model manages FairPlayAuditor, HumanizerController, telemetry reset, and SAFE-ELEVATED-LOCKOUT risk states`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val vm = MainViewModel(app)

        vm.setCpuProfile(CpuUsageProfile.TURBO)
        vm.setMaxDepth(20)
        vm.setSkillLevel(15)
        vm.setMultiPv(4)
        vm.setFairPlayAuditorEnabled(true)
        vm.setHumanizerEnabled(true)
        vm.setTargetElo(1800)
        vm.setShowOpeningBook(true)
        vm.setShowTablebase(true)
        vm.setShowAnnotations(true)
        vm.setAutoAdaptTheme(true)
        vm.setAutonomousMode(true)
        vm.setAutonomousEloProfile(2000)
        vm.setEvalBarOrientation(EvalBarOrientation.HORIZONTAL)
        val cfg = vm.extensionConfig.value
        assertEquals(CpuUsageProfile.TURBO, cfg.cpuProfile)
        assertEquals(20, cfg.maxDepth)
        assertEquals(15, cfg.skillLevel)
        assertEquals(4, cfg.multiPv)
        assertEquals(true, cfg.fairPlayAuditorEnabled)
        assertEquals(true, cfg.humanizerEnabled)
        assertEquals(1800, cfg.targetElo)
        assertEquals(true, cfg.showTablebase)
        assertEquals(true, cfg.autonomousMode)
        assertEquals(2000, cfg.autonomousEloProfile)
        assertEquals(EvalBarOrientation.HORIZONTAL, cfg.evalBarOrientation)

        val jsLiteral = cfg.toJsObjectLiteral()
        assertTrue(jsLiteral.contains("cpuProfile:'turbo'"))
        assertTrue(jsLiteral.contains("maxDepth:20"))
        assertTrue(jsLiteral.contains("fairPlayAuditorEnabled:true"))
        assertTrue(jsLiteral.contains("humanizerEnabled:true"))
        assertTrue(jsLiteral.contains("targetElo:1800"))
        assertTrue(jsLiteral.contains("showAnnotations:true"))
        assertTrue(jsLiteral.contains("showOpeningBook:true"))
        assertTrue(jsLiteral.contains("showTablebase:true"))
        assertTrue(jsLiteral.contains("autoAdaptTheme:true"))
        assertTrue(jsLiteral.contains("autonomousMode:true"))
        assertTrue(jsLiteral.contains("autonomousEloProfile:2000"))

        vm.selectPreset(BrowserSitePreset.LICHESS)
        assertEquals(WorkspaceTab.BROWSER, vm.selectedTab.value)
        assertEquals(EngineStatus.LOADING, vm.engineStatus.value)

        vm.onWebAnalysisJson(
            """{"fen":"8/8/8/8/8/3k4/3Q4/3K4 w - - 0 1","depth":18,"nodes":240000,"elapsedMs":640,"engineBackend":"Stockfish 19 WASM","status":"IDLE","fairPlay":{"riskLevel":"LOCKOUT","lockedOut":true,"lockoutReason":"Lockout: 2 S_i spikes","baselineElo":1800,"observedIpr":2420,"zScore":2.74,"currentGameMoves":14,"currentGameSiSpikes":2,"slidingWindowGames":5,"acpl":9.4,"warnings":[{"message":"2 rapid critical S_i spikes"}]},"boardTheme":{"name":"Green • Dark UI","isDark":true,"hue":"green","accentHex":"#06B6D4"},"lastMoveAnnotation":{"sq":"d2","symbol":"★","label":"Best","cpLoss":0},"openingBook":{"inBook":true,"eco":"C60","opening":"Ruy Lopez","source":"Lichess Masters DB","moves":[{"uci":"a7a6","san":"a6","games":141200,"whitePct":37,"drawPct":40,"blackPct":23}]},"tablebase":{"isTablebase":true,"pieceCount":3,"turn":"w","category":"win","outcome":"Tablebase Win","scoreBadge":"+M10","dtz":1,"dtm":10,"checkmate":false,"stalemate":false,"source":"Lichess Syzygy 7-Piece","moves":[{"uci":"d2f4","san":"Qf4","quality":"win","annotation":"!","dtm":9,"dtz":1,"checkmate":false,"stalemate":false}]},"lines":[{"rank":1,"uci":"d2f4","san":"Qf4","annotation":"!!","centipawns":9900,"whiteCp":9900,"mate":5,"whiteMate":5,"winPct":99.9,"whiteWinPct":99.9,"depth":18}]}"""
        )
        val snapshot = vm.liveAnalysis.value
        assertEquals(EngineStatus.IDLE, vm.engineStatus.value)
        assertEquals("Stockfish 19 WASM", snapshot.engineBackend)
        assertEquals(18, snapshot.depth)
        assertEquals("LOCKOUT", snapshot.fairPlayStatus.riskLevel.label)
        assertEquals(true, snapshot.fairPlayStatus.lockedOut)
        assertEquals(2420, snapshot.fairPlayStatus.observedIpr)
        assertEquals(2, snapshot.fairPlayStatus.currentGameSiSpikes)

        val prevReset = vm.telemetryResetNonce.value
        vm.clearSessionTelemetry()
        assertEquals(prevReset + 1, vm.telemetryResetNonce.value)
        assertEquals("SAFE", vm.liveAnalysis.value.fairPlayStatus.riskLevel.label)
        assertEquals(false, vm.liveAnalysis.value.fairPlayStatus.lockedOut)
        assertNotNull(vm.telemetryStatusMessage.value)
    }
}
