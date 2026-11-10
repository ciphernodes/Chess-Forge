package com.example.ui.screens.screenshot

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Collections
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Extension
import androidx.compose.material.icons.filled.PhotoLibrary
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.PieceType
import com.example.core.chess.Square
import com.example.data.repository.BoardScheme
import com.example.ui.components.ChessBoardView
import com.example.ui.components.EvalBar

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScreenshotScreen(
    viewModel: ScreenshotViewModel,
    boardScheme: BoardScheme = BoardScheme.FORGE_TEAL,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    var editingSquare by remember { mutableStateOf<Square?>(null) }

    // Single image picker (Zero-permission Android Photo Picker)
    val singlePicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) viewModel.loadFromUri(uri)
    }

    // Batch image picker
    val batchPicker = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia()
    ) { uris ->
        if (uris.isNotEmpty()) viewModel.processBatchUris(uris)
    }

    LaunchedEffect(state.statusMessage) {
        state.statusMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearStatusMessage()
        }
    }

    // Square Piece Correction Dialog (Section 12)
    if (editingSquare != null) {
        val sq = editingSquare!!
        val currentPiece = state.visionResult?.position?.get(sq)
        AlertDialog(
            onDismissRequest = { editingSquare = null },
            title = { Text("Correct Square ${sq.name}", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Select the piece occupying ${sq.name}:", fontSize = 13.sp)
                    // White pieces
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceAround
                    ) {
                        listOf(PieceType.PAWN, PieceType.KNIGHT, PieceType.BISHOP, PieceType.ROOK, PieceType.QUEEN, PieceType.KING).forEach { pt ->
                            val p = Piece(pt, PieceColor.WHITE)
                            Text(
                                text = p.unicode,
                                fontSize = 26.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (currentPiece == p) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                                    .clickable {
                                        viewModel.correctSquarePiece(sq, p)
                                        editingSquare = null
                                    }
                                    .padding(4.dp)
                            )
                        }
                    }
                    // Black pieces
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceAround
                    ) {
                        listOf(PieceType.PAWN, PieceType.KNIGHT, PieceType.BISHOP, PieceType.ROOK, PieceType.QUEEN, PieceType.KING).forEach { pt ->
                            val p = Piece(pt, PieceColor.BLACK)
                            Text(
                                text = p.unicode,
                                fontSize = 26.sp,
                                modifier = Modifier
                                    .clip(RoundedCornerShape(6.dp))
                                    .background(if (currentPiece == p) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
                                    .clickable {
                                        viewModel.correctSquarePiece(sq, p)
                                        editingSquare = null
                                    }
                                    .padding(4.dp)
                            )
                        }
                    }
                    // Empty square option
                    Button(
                        onClick = {
                            viewModel.correctSquarePiece(sq, null)
                            editingSquare = null
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Clear Square (Empty)", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { editingSquare = null }) {
                    Text("Done")
                }
            }
        )
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Screenshot Analyzer",
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                },
                actions = {
                    IconButton(
                        onClick = {
                            singlePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                        modifier = Modifier.testTag("pick_screenshot_button")
                    ) {
                        Icon(Icons.Default.PhotoLibrary, contentDescription = "Pick Screenshot")
                    }
                    IconButton(
                        onClick = {
                            batchPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                        modifier = Modifier.testTag("batch_screenshot_button")
                    ) {
                        Icon(Icons.Default.Collections, contentDescription = "Batch Screenshots")
                    }
                    IconButton(
                        onClick = { viewModel.loadSampleBoard() },
                        modifier = Modifier.testTag("sample_board_button")
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Load Sample")
                    }
                }
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
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Batch Processing Banner
            if (state.isBatchMode) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "Batch Processing: ${state.batchCurrent}/${state.batchTotal} screenshots...",
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = { if (state.batchTotal > 0) state.batchCurrent.toFloat() / state.batchTotal else 0f },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }

            // Vision Processing Spinner
            if (state.isProcessingVision) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(180.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Running Vision Pipeline (YOLO & Ensemble)...",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }

            // Error or Rejected Message (Section 3.4)
            if (state.errorMessage != null && !state.isProcessingVision) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = "Error", tint = Color(0xFFC62828))
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Position Unclear",
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFFC62828),
                                fontSize = 13.sp
                            )
                            Text(
                                text = state.errorMessage ?: "",
                                fontSize = 12.sp,
                                color = Color(0xFF37474F)
                            )
                        }
                        OutlinedButton(onClick = { viewModel.retryCrop() }) {
                            Text("Retry Crop", fontSize = 11.sp)
                        }
                    }
                }
            }

            // Vision Result Section
            val vision = state.visionResult
            if (vision != null && !state.isProcessingVision) {
                // Confidence & Detection Info Header
                Surface(
                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            // 8dp Confidence Dot (Section 4.5)
                            val dotColor = when {
                                vision.overallConfidence >= 0.90f -> Color(0xFF00E676)
                                vision.overallConfidence >= 0.75f -> Color(0xFFFFD600)
                                else -> Color(0xFFFF1744)
                            }
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(dotColor)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Confidence: ${(vision.overallConfidence * 100).toInt()}%",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                        }

                        Text(
                            text = vision.detectionMethodUsed,
                            fontSize = 11.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Confirmation Banner (0.75 - 0.89 confidence)
                if (vision.requiresConfirmation && !state.isConfirmed) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFFDE7)),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text(
                                text = "Confirm Board Position",
                                fontWeight = FontWeight.Bold,
                                fontSize = 14.sp,
                                color = Color(0xFFF57F17)
                            )
                            Text(
                                text = "Verify the detected position below before running deep engine analysis:",
                                fontSize = 12.sp,
                                color = Color(0xFF424242)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End
                            ) {
                                OutlinedButton(onClick = { viewModel.retryCrop() }) {
                                    Icon(Icons.Default.Close, contentDescription = "Retry", modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Retry")
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    onClick = { viewModel.confirmPosition() },
                                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0D9488))
                                ) {
                                    Icon(Icons.Default.Check, contentDescription = "Confirm", modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Confirm")
                                }
                            }
                        }
                    }
                }

                // Eval Bar
                if (state.analysisResult != null) {
                    EvalBar(
                        scoreCp = state.analysisResult!!.evaluationCp,
                        mateIn = state.analysisResult!!.mateIn
                    )
                }

                // Board View
                ChessBoardView(
                    position = vision.position,
                    scheme = boardScheme,
                    isWhiteAtBottom = vision.isWhiteAtBottom,
                    bestMove = state.analysisResult?.bestMove,
                    isDashedArrow = vision.requiresConfirmation,
                    onSquareClick = { clickedSquare ->
                        // Allow tapping any square to manually correct piece if needed
                        editingSquare = clickedSquare
                    }
                )

                // Engine Output Card
                val analysis = state.analysisResult
                if (analysis != null) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Best Move: ${analysis.bestMoveSan}",
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Text(
                                    text = analysis.displayScore,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 16.sp,
                                    color = if (analysis.evaluationCp >= 0) Color(0xFF0D9488) else Color(0xFFE11D48)
                                )
                            }
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = analysis.explanation,
                                fontSize = 13.sp,
                                color = MaterialTheme.colorScheme.onSurface
                            )

                            Spacer(modifier = Modifier.height(10.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Button(
                                    onClick = { viewModel.generatePuzzleFromPosition() },
                                    modifier = Modifier.weight(1f)
                                ) {
                                    Icon(Icons.Default.Extension, contentDescription = "Generate Puzzle", modifier = Modifier.size(16.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Generate Puzzle", fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            } else if (!state.isProcessingVision && state.errorMessage == null) {
                // Empty State Placeholder
                Card(
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 32.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            imageVector = Icons.Default.PhotoLibrary,
                            contentDescription = "Upload",
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(48.dp)
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Analyze Any Chess Screenshot",
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Pick a screenshot from gallery, share from another app, or process multiple images at once.",
                            fontSize = 13.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Button(
                            onClick = {
                                singlePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                            }
                        ) {
                            Text("Select Image")
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
