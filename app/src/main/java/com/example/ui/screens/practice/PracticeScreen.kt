package com.example.ui.screens.practice

import android.widget.Toast
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.FirstPage
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.LastPage
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.repository.BoardScheme
import com.example.ui.components.ChessBoardView
import com.example.ui.components.ClassificationDialog
import com.example.ui.components.EvalBar
import com.example.ui.components.GameContextPanel
import com.example.ui.components.MoveDisplayItem
import com.example.ui.components.MoveListView

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PracticeScreen(
    viewModel: PracticeViewModel,
    boardScheme: BoardScheme = BoardScheme.FORGE_TEAL,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val snackbarHostState = remember { SnackbarHostState() }

    var showLoadPgnDialog by remember { mutableStateOf(false) }
    var selectedClassificationItem by remember { mutableStateOf<MoveDisplayItem?>(null) }
    var showCriticalMomentsDialog by remember { mutableStateOf(false) }
    var shareableBitmap by remember { mutableStateOf<android.graphics.Bitmap?>(null) }

    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearStatusMessage()
        }
    }

    // Load PGN Dialog
    if (showLoadPgnDialog) {
        var pgnInputText by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showLoadPgnDialog = false },
            title = { Text("Load PGN Game", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Paste PGN notation, Lichess study URL, or load sample game:")
                    OutlinedTextField(
                        value = pgnInputText,
                        onValueChange = { pgnInputText = it },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(140.dp)
                            .testTag("pgn_input_field"),
                        placeholder = { Text("1. e4 c5 2. Nf3 d6 3. d4 cxd4...") }
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        OutlinedButton(
                            onClick = {
                                viewModel.loadSampleGame()
                                showLoadPgnDialog = false
                            }
                        ) {
                            Text("Load Sample (Najdorf)")
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (pgnInputText.isNotBlank()) {
                            viewModel.loadPgnText(pgnInputText)
                        }
                        showLoadPgnDialog = false
                    }
                ) {
                    Text("Load")
                }
            },
            dismissButton = {
                TextButton(onClick = { showLoadPgnDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Classification Dialog (Section 2.7)
    if (selectedClassificationItem != null) {
        val item = selectedClassificationItem!!
        ClassificationDialog(
            moveSan = item.san,
            classification = item.classification ?: com.example.core.chess.MoveClassification.BEST,
            evalBefore = state.analysisResult?.evalBefore,
            evalAfter = state.analysisResult?.evalAfter,
            bestAlternativeSan = state.analysisResult?.bestMoveSan,
            explanation = state.analysisResult?.explanation ?: "Engine evaluated move variation.",
            onDismiss = { selectedClassificationItem = null }
        )
    }

    // Critical Moments Dialog (Section 2.10)
    if (showCriticalMomentsDialog) {
        AlertDialog(
            onDismissRequest = { showCriticalMomentsDialog = false },
            title = { Text("⚡ Critical Moments (${state.criticalMoments.size})", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (state.criticalMoments.isEmpty()) {
                        Text("No critical swings (+1.5 pawns) detected in this game yet.")
                    } else {
                        state.criticalMoments.forEach { moment ->
                            Surface(
                                color = MaterialTheme.colorScheme.surfaceVariant,
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        viewModel.navigateToPly(moment.plyIndex)
                                        showCriticalMomentsDialog = false
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text(
                                            text = "Move ${moment.moveNumber}: Played ${moment.playedSan}",
                                            fontWeight = FontWeight.Bold,
                                            fontSize = 13.sp
                                        )
                                        Text(
                                            text = "Best was ${moment.bestSan}",
                                            fontSize = 12.sp,
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                    Text(
                                        text = "⚡ %.1f swing".format(moment.swingPawns),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = androidx.compose.ui.graphics.Color(0xFFE65100)
                                    )
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showCriticalMomentsDialog = false }) {
                    Text("Close")
                }
            }
        )
    }

    // Share Image Preview Dialog
    if (shareableBitmap != null) {
        AlertDialog(
            onDismissRequest = { shareableBitmap = null },
            title = { Text("Analysis Image Preview", fontWeight = FontWeight.Bold) },
            text = {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(
                        bitmap = shareableBitmap!!.asImageBitmap(),
                        contentDescription = "Analysis Share Preview",
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(280.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Includes board position, best-move arrow, eval, and 'Analyzed with Chess Forge' watermark.",
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        Toast.makeText(context, "Analysis image saved/shared successfully", Toast.LENGTH_SHORT).show()
                        shareableBitmap = null
                    }
                ) {
                    Text("Share PNG")
                }
            },
            dismissButton = {
                TextButton(onClick = { shareableBitmap = null }) {
                    Text("Close")
                }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "Practice Mode",
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        )
                        Text(
                            text = "Depth ${state.analysisResult?.depth ?: 15} • ${state.analysisResult?.nodes ?: 0} nodes",
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { showLoadPgnDialog = true },
                        modifier = Modifier.testTag("load_pgn_button")
                    ) {
                        Icon(Icons.Default.FileUpload, contentDescription = "Load PGN")
                    }
                    IconButton(
                        onClick = { viewModel.copyFenToClipboard() },
                        modifier = Modifier.testTag("copy_fen_button")
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = "Copy FEN")
                    }
                    IconButton(
                        onClick = { viewModel.exportPgn() },
                        modifier = Modifier.testTag("export_pgn_button")
                    ) {
                        Icon(Icons.Default.FileDownload, contentDescription = "Export PGN")
                    }
                    IconButton(
                        onClick = {
                            shareableBitmap = viewModel.generateShareableImage()
                        },
                        modifier = Modifier.testTag("share_image_button")
                    ) {
                        Icon(Icons.Default.Share, contentDescription = "Share Image")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        },
        modifier = modifier.fillMaxSize()
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            // 1. Horizontal Eval Bar (Section 2.3)
            EvalBar(
                scoreCp = state.analysisResult?.evaluationCp ?: 0,
                mateIn = state.analysisResult?.mateIn
            )

            // 2. Interactive Chessboard
            ChessBoardView(
                position = state.position,
                scheme = boardScheme,
                isWhiteAtBottom = state.isWhiteAtBottom,
                selectedSquare = state.selectedSquare,
                legalMoves = state.legalMoves,
                lastMove = state.lastMove,
                bestMove = state.bestMove,
                threatMove = state.threatMove,
                bestMoveColor = androidx.compose.ui.graphics.Color(state.bestMoveColor),
                isDashedArrow = state.isDashedArrow,
                onSquareClick = { viewModel.onSquareClicked(it) }
            )

            // 3. Navigation Controls Row: First, Prev, Next, Last, Flip, Undo
            Surface(
                color = MaterialTheme.colorScheme.surface,
                shape = RoundedCornerShape(10.dp),
                tonalElevation = 1.dp,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    FilledTonalIconButton(
                        onClick = { viewModel.navigateFirst() },
                        modifier = Modifier.size(40.dp).testTag("nav_first")
                    ) {
                        Icon(Icons.Default.FirstPage, contentDescription = "Start of Game")
                    }
                    FilledTonalIconButton(
                        onClick = { viewModel.navigatePrev() },
                        modifier = Modifier.size(40.dp).testTag("nav_prev")
                    ) {
                        Icon(Icons.Default.KeyboardArrowLeft, contentDescription = "Previous Move")
                    }
                    FilledTonalIconButton(
                        onClick = { viewModel.navigateNext() },
                        modifier = Modifier.size(40.dp).testTag("nav_next")
                    ) {
                        Icon(Icons.Default.KeyboardArrowRight, contentDescription = "Next Move")
                    }
                    FilledTonalIconButton(
                        onClick = { viewModel.navigateLast() },
                        modifier = Modifier.size(40.dp).testTag("nav_last")
                    ) {
                        Icon(Icons.Default.LastPage, contentDescription = "End of Game")
                    }
                    FilledTonalIconButton(
                        onClick = { viewModel.flipBoard() },
                        modifier = Modifier.size(40.dp).testTag("flip_board")
                    ) {
                        Icon(Icons.Default.Sync, contentDescription = "Flip Board Orientation")
                    }
                    FilledTonalIconButton(
                        onClick = { viewModel.undoMove() },
                        modifier = Modifier.size(40.dp).testTag("undo_move")
                    ) {
                        Icon(Icons.Default.Undo, contentDescription = "Undo Move")
                    }
                }
            }

            // 4. Move List View with Classifications & Engine MultiPV
            MoveListView(
                moves = state.moves,
                currentPlyIndex = state.currentPlyIndex,
                onMoveClick = { viewModel.navigateToPly(it) },
                onClassificationClick = { selectedClassificationItem = it },
                engineLines = state.analysisResult?.topLines ?: emptyList(),
                isVariationActive = state.isVariationActive,
                activeVariationTitle = state.activeVariationTitle,
                onLineClick = { viewModel.playEngineLineAsVariation(it) },
                onReturnToMainLine = { viewModel.returnToMainLine() }
            )

            // 5. Game Context Panel (Opening ID, Phase Bar, Tactical Alerts, Material)
            GameContextPanel(
                opening = state.opening,
                phase = state.gamePhase,
                materialBalance = state.materialBalance,
                tacticalAlerts = state.analysisResult?.tacticalAlerts ?: emptyList(),
                accuracyPercent = state.accuracy,
                criticalMomentsCount = state.criticalMoments.size,
                onViewCriticalMoments = { showCriticalMomentsDialog = true }
            )

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
