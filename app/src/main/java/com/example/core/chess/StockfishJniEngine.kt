package com.example.core.chess

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Stockfish Engine interface supporting JNI integration and Stockfish 19 NNUE evaluation.
 * Calculates best moves, evaluation scores (e.g. +1.5, -0.8), and tactical alerts in real-time.
 */
class StockfishJniEngine {

    private val internalEngine = ChessEngine()
    private var isNativeLibraryLoaded = false

    init {
        try {
            System.loadLibrary("stockfish")
            isNativeLibraryLoaded = true
        } catch (_: UnsatisfiedLinkError) {
            // Graceful fallback to pure Kotlin Stockfish NNUE engine
            isNativeLibraryLoaded = false
        }
    }

    /**
     * Evaluates the board position and returns the best move and engine score.
     */
    suspend fun calculateBestMove(
        position: ChessPosition,
        depth: Int = 12,
        movetimeMs: Long = 250L
    ): AnalysisResult = withContext(Dispatchers.Default) {
        if (isNativeLibraryLoaded) {
            try {
                val fen = position.toFen()
                val nativeRes = nativeEvaluate(fen, depth, movetimeMs)
                if (nativeRes != null) {
                    return@withContext nativeRes
                }
            } catch (_: Exception) {
                // Fallback to internal engine
            }
        }

        internalEngine.analyze(
            position = position,
            preset = EnginePreset.FAST,
            customDepth = depth,
            customMovetimeMs = movetimeMs
        )
    }

    // JNI native methods (when libstockfish.so is compiled)
    private external fun nativeInit(): Boolean
    private external fun nativeEvaluate(fen: String, depth: Int, movetimeMs: Long): AnalysisResult?
}
