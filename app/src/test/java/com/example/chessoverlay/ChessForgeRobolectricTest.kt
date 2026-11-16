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

        // Navigate to Settings Screen & toggle CPU, Difficulty, Depth 20, Opening Book & Annotations
        composeRule.onNodeWithTag("tab_settings_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("settings_screen").assertIsDisplayed()
        composeRule.onNodeWithTag("cpu_profile_turbo").performScrollTo().performClick()
        composeRule.onNodeWithTag("skill_preset_12").performScrollTo().performClick()
        composeRule.onNodeWithTag("depth_preset_18").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_multipv_3").performScrollTo().performClick()
        composeRule.onNodeWithTag("settings_switch_opening_book").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_annotations").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("settings_switch_adapt_theme").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithTag("eval_orientation_horizontal").performScrollTo().performClick()
        composeRule.waitForIdle()

        // Navigate to Browser Workspace Tab & verify compact focus + expandable eval/book strip
        composeRule.onNodeWithTag("tab_browser_button").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("url_input_field").assertIsDisplayed()
        composeRule.onNodeWithTag("preset_lichess").assertIsDisplayed()
        composeRule.onNodeWithTag("browser_focus_toggle").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("evaluation_bar").assertIsDisplayed()
        composeRule.onNodeWithTag("live_web_eval_strip").assertIsDisplayed()
        composeRule.onNodeWithTag("live_strip_expand_button").performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun `bundled browser extension zip contains Stockfish 19 WASM, Opening Book, and MV3 scripts`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val engineJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_ENGINE_JS)
        val bookJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_OPENING_BOOK_JS)
        val contentJs = AssetManagerHelper.readAssetText(context, AssetManagerHelper.EXTENSION_CONTENT_JS)
        assertTrue(engineJs.contains("ChessForgeEngine"))
        assertTrue(engineJs.contains("uciToSan"))
        assertTrue(bookJs.contains("ChessForgeOpeningBook"))
        assertTrue(bookJs.contains("Ruy Lopez"))
        assertTrue(contentJs.contains("STOCKFISH_ANALYZE"))
        assertTrue(contentJs.contains("detectBoardTheme"))
        assertTrue(contentJs.contains("classifyCandidateAnnotations"))
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
            assertNotNull(zip.getEntry("src/content.js"))
            assertNotNull(zip.getEntry("src/popup.html"))
            assertNotNull(zip.getEntry("src/background.js"))
        }
    }

    @Test
    fun `view model manages Stockfish WASM parameters and parses opening book, annotations, and board theme`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val vm = MainViewModel(app)

        vm.setCpuProfile(CpuUsageProfile.TURBO)
        vm.setMaxDepth(20)
        vm.setSkillLevel(15)
        vm.setMultiPv(3)
        vm.setShowOpeningBook(true)
        vm.setShowAnnotations(true)
        vm.setAutoAdaptTheme(true)
        vm.setEvalBarOrientation(EvalBarOrientation.HORIZONTAL)
        val cfg = vm.extensionConfig.value
        assertEquals(CpuUsageProfile.TURBO, cfg.cpuProfile)
        assertEquals(20, cfg.maxDepth)
        assertEquals(15, cfg.skillLevel)
        assertEquals(3, cfg.multiPv)
        assertEquals(EvalBarOrientation.HORIZONTAL, cfg.evalBarOrientation)

        val jsLiteral = cfg.toJsObjectLiteral()
        assertTrue(jsLiteral.contains("cpuProfile:'turbo'"))
        assertTrue(jsLiteral.contains("maxDepth:20"))
        assertTrue(jsLiteral.contains("showAnnotations:true"))
        assertTrue(jsLiteral.contains("showOpeningBook:true"))
        assertTrue(jsLiteral.contains("autoAdaptTheme:true"))

        vm.selectPreset(BrowserSitePreset.LICHESS)
        assertEquals(WorkspaceTab.BROWSER, vm.selectedTab.value)
        assertEquals(EngineStatus.LOADING, vm.engineStatus.value)

        vm.onWebAnalysisJson(
            """{"fen":"r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3","depth":18,"nodes":240000,"elapsedMs":640,"engineBackend":"Stockfish 19 WASM","status":"IDLE","boardTheme":{"name":"Green • Dark UI","isDark":true,"hue":"green","accentHex":"#06B6D4"},"lastMoveAnnotation":{"sq":"b5","symbol":"!","label":"Best","cpLoss":0},"openingBook":{"inBook":true,"eco":"C60","opening":"Ruy Lopez","source":"Lichess Masters DB","moves":[{"uci":"a7a6","san":"a6","games":141200,"whitePct":37,"drawPct":40,"blackPct":23}]},"lines":[{"rank":1,"uci":"a7a6","san":"a6","annotation":"!!","centipawns":18,"whiteCp":-18,"mate":null,"whiteMate":null,"winPct":52.0,"whiteWinPct":48.0,"depth":18}]}"""
        )
        val snapshot = vm.liveAnalysis.value
        assertEquals(EngineStatus.IDLE, vm.engineStatus.value)
        assertEquals("Stockfish 19 WASM", snapshot.engineBackend)
        assertEquals(18, snapshot.depth)
        assertEquals("!!", snapshot.lines.first().annotation)
        assertEquals("Green • Dark UI", snapshot.boardTheme.name)
        assertEquals("C60", snapshot.openingBook?.eco)
        assertEquals("Ruy Lopez", snapshot.openingBook?.opening)
        assertEquals("a6", snapshot.openingBook?.moves?.first()?.san)
        assertEquals("b5", snapshot.lastMoveAnnotation?.square)
        assertEquals("!", snapshot.lastMoveAnnotation?.symbol)
    }
}
