package com.example.core.chess

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class EnginePool {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val engine = ChessEngine()

    private var quickJob: Job? = null
    private var deepJob: Job? = null

    private val _quickAnalysis = MutableStateFlow<AnalysisResult?>(null)
    val quickAnalysis: StateFlow<AnalysisResult?> = _quickAnalysis.asStateFlow()

    private val _isAnalyzing = MutableStateFlow(false)
    val isAnalyzing: StateFlow<Boolean> = _isAnalyzing.asStateFlow()

    fun queueQuickAnalysis(
        position: ChessPosition,
        preset: EnginePreset = EnginePreset.BALANCED,
        customDepth: Int = 15,
        customMovetimeMs: Long = 500L,
        multiPv: Int = 3,
        previousEvalCp: Int? = null,
        playedMove: Move? = null,
        onResult: ((AnalysisResult) -> Unit)? = null
    ) {
        // Cancel ongoing quick search immediately
        quickJob?.cancel()
        _isAnalyzing.value = true

        quickJob = scope.launch {
            try {
                val result = engine.analyze(
                    position = position,
                    preset = preset,
                    customDepth = customDepth,
                    customMovetimeMs = customMovetimeMs,
                    multiPv = multiPv,
                    previousEvalCp = previousEvalCp,
                    playedMove = playedMove
                )
                _quickAnalysis.value = result
                onResult?.invoke(result)
            } finally {
                _isAnalyzing.value = false
            }
        }
    }

    fun queueDeepAnalysis(
        positions: List<ChessPosition>,
        preset: EnginePreset = EnginePreset.DEEP,
        onProgress: (Int, Int) -> Unit,
        onComplete: (List<AnalysisResult>) -> Unit
    ) {
        deepJob?.cancel()
        deepJob = scope.launch {
            val results = mutableListOf<AnalysisResult>()
            var prevEval: Int? = null
            positions.forEachIndexed { index, pos ->
                val res = engine.analyze(
                    position = pos,
                    preset = preset,
                    multiPv = 1,
                    previousEvalCp = prevEval
                )
                prevEval = res.evaluationCp
                results.add(res)
                onProgress(index + 1, positions.size)
            }
            onComplete(results)
        }
    }

    fun pauseDeepAnalysis() {
        deepJob?.cancel()
    }

    fun cancelAll() {
        quickJob?.cancel()
        deepJob?.cancel()
        _isAnalyzing.value = false
    }
}
