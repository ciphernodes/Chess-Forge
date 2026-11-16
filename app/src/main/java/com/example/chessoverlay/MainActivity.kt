package com.example.chessoverlay

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.example.chessoverlay.ui.ChessForgeScreen
import com.example.chessoverlay.ui.MainViewModel
import com.example.chessoverlay.ui.theme.ChessForgeTheme
import com.example.chessoverlay.util.AssetManagerHelper

class MainActivity : ComponentActivity() {

    private val viewModel: MainViewModel by viewModels()

    private val saveZipLauncher =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
            if (uri == null) {
                viewModel.setExportStatus("Export cancelled.")
                return@registerForActivityResult
            }
            val success = try {
                contentResolver.openOutputStream(uri)?.use { out ->
                    AssetManagerHelper.copyExtensionZipToStream(this, out)
                } ?: false
            } catch (_: Throwable) {
                false
            }
            if (success) {
                viewModel.setExportStatus("Saved ${AssetManagerHelper.EXTENSION_ZIP_ASSET} — import it into Kiwi Browser or Chrome.")
            } else {
                viewModel.setExportStatus("Could not write extension ZIP to the selected location.")
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            ChessForgeTheme {
                val selectedTab by viewModel.selectedTab.collectAsStateWithLifecycle()
                val extensionConfig by viewModel.extensionConfig.collectAsStateWithLifecycle()
                val engineStatus by viewModel.engineStatus.collectAsStateWithLifecycle()
                val extensionAssetsReady by viewModel.extensionAssetsReady.collectAsStateWithLifecycle()
                val exportStatus by viewModel.exportStatus.collectAsStateWithLifecycle()
                val activeUrl by viewModel.activeUrl.collectAsStateWithLifecycle()
                val reloadNonce by viewModel.reloadNonce.collectAsStateWithLifecycle()
                val liveAnalysis by viewModel.liveAnalysis.collectAsStateWithLifecycle()

                ChessForgeScreen(
                    selectedTab = selectedTab,
                    extensionConfig = extensionConfig,
                    engineStatus = engineStatus,
                    extensionAssetsReady = extensionAssetsReady,
                    exportStatus = exportStatus,
                    activeUrl = activeUrl,
                    reloadNonce = reloadNonce,
                    liveAnalysis = liveAnalysis,
                    onSelectTab = viewModel::selectTab,
                    onExportZip = { saveZipLauncher.launch(AssetManagerHelper.EXTENSION_ZIP_ASSET) },
                    onShareZip = { shareExtensionZip() },
                    onOpenBrowser = viewModel::openInBrowser,
                    onToggleEnabled = viewModel::setExtensionEnabled,
                    onToggleArrows = viewModel::setShowArrows,
                    onToggleAnnotations = viewModel::setShowAnnotations,
                    onToggleOpeningBook = viewModel::setShowOpeningBook,
                    onToggleTablebase = viewModel::setShowTablebase,
                    onToggleAutoAdaptTheme = viewModel::setAutoAdaptTheme,
                    onToggleHud = viewModel::setShowHud,
                    onToggleEvalBar = viewModel::setShowEvalBar,
                    onSelectEvalOrientation = viewModel::setEvalBarOrientation,
                    onSelectMultiPv = viewModel::setMultiPv,
                    onSelectDepth = viewModel::setMaxDepth,
                    onSelectSkillLevel = viewModel::setSkillLevel,
                    onSelectCpuProfile = viewModel::setCpuProfile,
                    onSelectTurn = viewModel::setTurnOverride,
                    onTogglePracticeAutoPlay = viewModel::setPracticeAutoPlay,
                    onChangePracticeDelay = viewModel::setPracticeHumanDelayMs,
                    onSelectPreset = viewModel::selectPreset,
                    onNavigateUrl = viewModel::navigateToUrl,
                    onPageStatusChange = viewModel::setEngineStatus,
                    onWebAnalysisJson = viewModel::onWebAnalysisJson
                )
            }
        }
    }

    private fun shareExtensionZip() {
        val exportedFile = AssetManagerHelper.exportExtensionZipToCache(this)
        if (exportedFile == null) {
            viewModel.setExportStatus("Failed preparing extension ZIP for sharing.")
            return
        }
        try {
            val uri = FileProvider.getUriForFile(
                this,
                "$packageName.fileprovider",
                exportedFile
            )
            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, "Chess Forge Browser Extension (MV3 + Stockfish WASM)")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(shareIntent, "Share Chess Forge Extension (.zip)"))
            viewModel.setExportStatus("Ready to share ${AssetManagerHelper.EXTENSION_ZIP_ASSET}.")
        } catch (t: Throwable) {
            viewModel.setExportStatus("Share failed: ${t.message}")
        }
    }
}
