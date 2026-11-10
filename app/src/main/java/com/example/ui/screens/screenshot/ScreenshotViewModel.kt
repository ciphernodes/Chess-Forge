package com.example.ui.screens.screenshot

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.RectF
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.AnalysisResult
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.PieceType
import com.example.core.chess.Square
import com.example.core.vision.ChessVisionPipeline
import com.example.core.vision.VisionResult
import com.example.data.db.AnalysisEntity
import com.example.data.db.PuzzleEntity
import com.example.data.repository.ChessRepository
import com.example.data.repository.SettingsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class ScreenshotUiState(
    val currentBitmap: Bitmap? = null,
    val visionResult: VisionResult? = null,
    val analysisResult: AnalysisResult? = null,
    val isProcessingVision: Boolean = false,
    val isAnalyzingEngine: Boolean = false,
    val isConfirmed: Boolean = false,
    val errorMessage: String? = null,
    val statusMessage: String? = null,
    val isBatchMode: Boolean = false,
    val batchCurrent: Int = 0,
    val batchTotal: Int = 0,
    val batchLinkedGameCount: Int = 0,
    val puzzleGeneratedSuccess: Boolean = false
)

class ScreenshotViewModel(application: Application) : AndroidViewModel(application) {

    private val visionPipeline = ChessVisionPipeline()
    private val chessEngine = ChessEngine()
    private val chessRepository = ChessRepository(application)
    private val settingsRepository = SettingsRepository(application)

    private val _uiState = MutableStateFlow(ScreenshotUiState())
    val uiState: StateFlow<ScreenshotUiState> = _uiState.asStateFlow()

    fun loadFromUri(uri: Uri) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isProcessingVision = true, errorMessage = null)
            try {
                val bmp = withContext(Dispatchers.IO) {
                    val stream = getApplication<Application>().contentResolver.openInputStream(uri)
                    BitmapFactory.decodeStream(stream)
                }
                if (bmp != null) {
                    processBitmap(bmp)
                } else {
                    _uiState.value = _uiState.value.copy(
                        isProcessingVision = false,
                        errorMessage = "Could not decode image from storage."
                    )
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    isProcessingVision = false,
                    errorMessage = "Error loading image: ${e.localizedMessage}"
                )
            }
        }
    }

    fun loadSampleBoard() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isProcessingVision = true, errorMessage = null)
            // Create a clean sample board bitmap for instant testing
            val bmp = withContext(Dispatchers.Default) {
                val b = Bitmap.createBitmap(400, 400, Bitmap.Config.ARGB_8888)
                val canvas = android.graphics.Canvas(b)
                val paint = android.graphics.Paint()
                for (r in 0..7) {
                    for (f in 0..7) {
                        paint.color = if ((r + f) % 2 != 0) android.graphics.Color.WHITE else android.graphics.Color.DKGRAY
                        canvas.drawRect(f * 50f, r * 50f, (f + 1) * 50f, (r + 1) * 50f, paint)
                    }
                }
                b
            }
            processBitmap(bmp)
        }
    }

    private suspend fun processBitmap(bmp: Bitmap) {
        val savedRegion = settingsRepository.getSavedBoardRegion()
        val result = visionPipeline.processImage(bmp, savedRegion)

        _uiState.value = _uiState.value.copy(
            currentBitmap = bmp,
            visionResult = result,
            isProcessingVision = false,
            isConfirmed = result.overallConfidence >= 0.90f && !result.requiresConfirmation && !result.isRejected
        )

        // If high confidence, analyze immediately (Section 3.4)
        if (result.overallConfidence >= 0.90f && !result.isRejected) {
            runEngineAnalysis(result.position)
        } else if (result.isRejected) {
            _uiState.value = _uiState.value.copy(
                errorMessage = "Position unclear — try a clearer screenshot or adjust the crop."
            )
        }
    }

    fun confirmPosition() {
        val result = _uiState.value.visionResult ?: return
        _uiState.value = _uiState.value.copy(isConfirmed = true)
        runEngineAnalysis(result.position)
    }

    fun retryCrop() {
        val bmp = _uiState.value.currentBitmap ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isProcessingVision = true)
            // Try with default center square
            val rect = RectF(0f, 0f, bmp.width.toFloat(), bmp.height.toFloat())
            settingsRepository.saveBoardRegion(rect)
            processBitmap(bmp)
        }
    }

    fun correctSquarePiece(square: Square, piece: Piece?) {
        val currentVision = _uiState.value.visionResult ?: return
        val pos = currentVision.position.copy()
        pos[square] = piece

        val newVision = currentVision.copy(
            position = pos,
            fen = pos.toFen()
        )
        _uiState.value = _uiState.value.copy(visionResult = newVision)
        if (_uiState.value.isConfirmed) {
            runEngineAnalysis(pos)
        }
    }

    private fun runEngineAnalysis(pos: ChessPosition) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isAnalyzingEngine = true)
            val settings = settingsRepository.settings.value
            val result = chessEngine.analyze(
                position = pos,
                preset = settings.enginePreset,
                customDepth = settings.customDepth,
                customMovetimeMs = settings.customMovetimeMs,
                multiPv = settings.multiPv
            )

            _uiState.value = _uiState.value.copy(
                analysisResult = result,
                isAnalyzingEngine = false
            )

            // Save to Room DB history
            chessRepository.saveAnalysis(
                AnalysisEntity(
                    fen = pos.toFen(),
                    bestMoveSan = result.bestMoveSan,
                    bestMoveUci = result.bestMove?.uci ?: "",
                    evaluationCp = result.evaluationCp,
                    mateIn = result.mateIn,
                    depth = result.depth,
                    sourceMode = "SCREENSHOT"
                )
            )
        }
    }

    fun generatePuzzleFromPosition() {
        val result = _uiState.value.analysisResult ?: return
        val pos = _uiState.value.visionResult?.position ?: return

        viewModelScope.launch {
            val puzzle = PuzzleEntity(
                fen = pos.toFen(),
                sideToMove = if (pos.activeColor == PieceColor.WHITE) "White" else "Black",
                objective = "${if (pos.activeColor == PieceColor.WHITE) "White" else "Black"} to play: ${result.explanation}",
                solutionSan = result.bestMoveSan,
                rating = 1300,
                category = "TACTICS",
                source = "SCREENSHOT",
                explanation = result.explanation
            )
            chessRepository.savePuzzle(puzzle)
            _uiState.value = _uiState.value.copy(
                puzzleGeneratedSuccess = true,
                statusMessage = "Puzzle added to Puzzle Mode database!"
            )
        }
    }

    fun processBatchUris(uris: List<Uri>) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                isBatchMode = true,
                batchCurrent = 0,
                batchTotal = uris.size,
                isProcessingVision = true
            )

            val reconstructor = GameReconstructor()
            reconstructor.reset()
            var linkedMoves = 0

            for ((index, uri) in uris.withIndex()) {
                _uiState.value = _uiState.value.copy(batchCurrent = index + 1)
                try {
                    val bmp = withContext(Dispatchers.IO) {
                        val stream = getApplication<Application>().contentResolver.openInputStream(uri)
                        BitmapFactory.decodeStream(stream)
                    }
                    if (bmp != null) {
                        val vision = visionPipeline.processImage(bmp)
                        val detectedMove = reconstructor.detectMoveFromPosition(vision.position)
                        if (detectedMove != null) {
                            reconstructor.applyDetectedMove(detectedMove, vision.position)
                            linkedMoves++
                        }
                    }
                } catch (_: Exception) {}
            }

            _uiState.value = _uiState.value.copy(
                isProcessingVision = false,
                isBatchMode = false,
                batchLinkedGameCount = linkedMoves,
                statusMessage = "Processed ${uris.size} screenshots. Linked $linkedMoves moves into game sequence."
            )
        }
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null, puzzleGeneratedSuccess = false)
    }
}
