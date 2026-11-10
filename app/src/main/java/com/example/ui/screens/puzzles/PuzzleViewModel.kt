package com.example.ui.screens.puzzles

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.core.chess.ChessPosition
import com.example.core.chess.Move
import com.example.core.chess.Piece
import com.example.core.chess.PieceColor
import com.example.core.chess.Square
import com.example.data.db.PuzzleEntity
import com.example.data.repository.ChessRepository
import com.example.data.repository.SettingsRepository
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class PuzzleUiState(
    val currentPuzzle: PuzzleEntity? = null,
    val position: ChessPosition = ChessPosition.fromFen(ChessPosition.STARTING_FEN),
    val selectedSquare: Square? = null,
    val legalMoves: List<Move> = emptyList(),
    val hintSquare: Square? = null,
    val failCount: Int = 0,
    val isSolved: Boolean = false,
    val isFailedMove: Boolean = false,
    val solutionStep: Int = 0,
    val userRating: Int = 1200,
    val solvedCount: Int = 0,
    val attemptedCount: Int = 0,
    val ratingChange: Int = 0,
    val statusMessage: String? = null
)

class PuzzleViewModel(application: Application) : AndroidViewModel(application) {

    private val chessRepository = ChessRepository(application)
    private val settingsRepository = SettingsRepository(application)

    private val _uiState = MutableStateFlow(PuzzleUiState())
    val uiState: StateFlow<PuzzleUiState> = _uiState.asStateFlow()

    private val allPuzzles = mutableListOf<PuzzleEntity>()
    private var currentIndex = 0

    init {
        loadPuzzles()
    }

    private fun loadPuzzles() {
        viewModelScope.launch {
            chessRepository.getAllPuzzles().collect { list ->
                if (list.isNotEmpty()) {
                    allPuzzles.clear()
                    allPuzzles.addAll(list)
                    if (_uiState.value.currentPuzzle == null) {
                        displayPuzzle(allPuzzles[currentIndex % allPuzzles.size])
                    }
                }
            }
        }
    }

    private fun displayPuzzle(puzzle: PuzzleEntity) {
        val pos = ChessPosition.fromFen(puzzle.fen)
        val s = settingsRepository.settings.value
        _uiState.value = PuzzleUiState(
            currentPuzzle = puzzle,
            position = pos,
            userRating = s.puzzleRating,
            solvedCount = s.puzzlesSolved,
            attemptedCount = s.puzzlesAttempted,
            failCount = 0,
            isSolved = false,
            solutionStep = 0,
            hintSquare = null
        )
    }

    fun onSquareClicked(square: Square) {
        val state = _uiState.value
        if (state.isSolved) return
        val pos = state.position

        // 1. Select active piece
        val piece = pos[square]
        if (piece != null && piece.color == pos.activeColor) {
            val legal = pos.generateLegalMoves().filter { it.from == square }
            _uiState.value = state.copy(
                selectedSquare = square,
                legalMoves = legal
            )
            return
        }

        // 2. Make move if selected
        val selected = state.selectedSquare
        if (selected != null) {
            val matching = state.legalMoves.firstOrNull { it.to == square }
            if (matching != null) {
                checkPlayerPuzzleMove(matching)
                return
            }
        }

        // 3. Deselect
        _uiState.value = state.copy(selectedSquare = null, legalMoves = emptyList())
    }

    private fun checkPlayerPuzzleMove(move: Move) {
        val puzzle = _uiState.value.currentPuzzle ?: return
        val currentPos = _uiState.value.position
        val moveSan = currentPos.toSan(move)

        // Parse solution steps: e.g. "Bxf7+, Kxf7, Nxe5+"
        val solutionSteps = puzzle.solutionSan.split(",").map { it.trim() }
        val targetSan = solutionSteps.getOrNull(_uiState.value.solutionStep) ?: ""

        val isCorrect = moveSan.replace("+", "").replace("#", "") == targetSan.replace("+", "").replace("#", "")

        if (isCorrect) {
            // Apply correct move
            val nextPos = currentPos.copy()
            nextPos.makeMove(move)

            val nextStep = _uiState.value.solutionStep + 1
            if (nextStep >= solutionSteps.size) {
                // Completed successfully!
                handlePuzzleCompleted(puzzle)
                _uiState.value = _uiState.value.copy(
                    position = nextPos,
                    selectedSquare = null,
                    legalMoves = emptyList(),
                    isSolved = true,
                    solutionStep = nextStep
                )
            } else {
                // Auto-play opponent response if next step exists
                val oppSan = solutionSteps[nextStep]
                _uiState.value = _uiState.value.copy(
                    position = nextPos,
                    selectedSquare = null,
                    legalMoves = emptyList(),
                    solutionStep = nextStep
                )

                viewModelScope.launch {
                    delay(400)
                    val oppMoves = nextPos.generateLegalMoves()
                    val oppMove = oppMoves.firstOrNull {
                        nextPos.toSan(it).replace("+", "").replace("#", "") == oppSan.replace("+", "").replace("#", "")
                    }
                    if (oppMove != null) {
                        val posAfterOpp = nextPos.copy()
                        posAfterOpp.makeMove(oppMove)
                        _uiState.value = _uiState.value.copy(
                            position = posAfterOpp,
                            solutionStep = nextStep + 1
                        )
                        if (nextStep + 1 >= solutionSteps.size) {
                            handlePuzzleCompleted(puzzle)
                            _uiState.value = _uiState.value.copy(isSolved = true)
                        }
                    }
                }
            }
        } else {
            // Incorrect move: trigger shake & fail count
            val newFailCount = _uiState.value.failCount + 1
            var hintSq: Square? = null
            if (newFailCount >= 3) {
                // Hint after 3 failed attempts: highlight first piece to move (Section 5.2)
                hintSq = move.from // Highlight correct origin piece
            }

            _uiState.value = _uiState.value.copy(
                isFailedMove = true,
                failCount = newFailCount,
                hintSquare = hintSq,
                selectedSquare = null,
                legalMoves = emptyList()
            )

            viewModelScope.launch {
                delay(600)
                _uiState.value = _uiState.value.copy(isFailedMove = false)
            }
        }
    }

    private fun handlePuzzleCompleted(puzzle: PuzzleEntity) {
        val eloDelta = if (_uiState.value.failCount == 0) 16 else 8
        settingsRepository.updatePuzzleScore(eloDelta, solved = true)
        viewModelScope.launch {
            chessRepository.updatePuzzleResult(puzzle.id, true)
        }
        val s = settingsRepository.settings.value
        _uiState.value = _uiState.value.copy(
            userRating = s.puzzleRating,
            solvedCount = s.puzzlesSolved,
            attemptedCount = s.puzzlesAttempted,
            ratingChange = eloDelta,
            statusMessage = "Puzzle solved! Rating +$eloDelta"
        )
    }

    fun nextPuzzle() {
        if (allPuzzles.isNotEmpty()) {
            currentIndex++
            displayPuzzle(allPuzzles[currentIndex % allPuzzles.size])
        }
    }

    fun loadDailyPuzzle() {
        viewModelScope.launch {
            val daily = chessRepository.getDailyPuzzle()
            if (daily != null) {
                displayPuzzle(daily)
            }
        }
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }
}
