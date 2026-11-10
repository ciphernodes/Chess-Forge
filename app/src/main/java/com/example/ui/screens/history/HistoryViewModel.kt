package com.example.ui.screens.history

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.example.data.db.AnalysisEntity
import com.example.data.repository.ChessRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HistoryUiState(
    val items: List<AnalysisEntity> = emptyList(),
    val filteredItems: List<AnalysisEntity> = emptyList(),
    val searchQuery: String = "",
    val selectedFilterMode: String = "ALL", // ALL, PRACTICE, SCREENSHOT, OVERLAY, PUZZLE
    val isLoading: Boolean = false,
    val statusMessage: String? = null
)

class HistoryViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = ChessRepository(application)

    private val _uiState = MutableStateFlow(HistoryUiState())
    val uiState: StateFlow<HistoryUiState> = _uiState.asStateFlow()

    init {
        loadHistory()
    }

    fun loadHistory() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true)
            repository.getAllAnalysis().collect { list ->
                _uiState.value = _uiState.value.copy(
                    items = list,
                    filteredItems = filterList(list, _uiState.value.searchQuery, _uiState.value.selectedFilterMode),
                    isLoading = false
                )
            }
        }
    }

    fun updateSearchQuery(query: String) {
        _uiState.value = _uiState.value.copy(
            searchQuery = query,
            filteredItems = filterList(_uiState.value.items, query, _uiState.value.selectedFilterMode)
        )
    }

    fun selectFilterMode(mode: String) {
        _uiState.value = _uiState.value.copy(
            selectedFilterMode = mode,
            filteredItems = filterList(_uiState.value.items, _uiState.value.searchQuery, mode)
        )
    }

    private fun filterList(list: List<AnalysisEntity>, query: String, mode: String): List<AnalysisEntity> {
        return list.filter { item ->
            val matchesMode = if (mode == "ALL") true else item.sourceMode.equals(mode, ignoreCase = true)
            val matchesQuery = if (query.isBlank()) true else {
                item.fen.contains(query, ignoreCase = true) ||
                        (item.openingName?.contains(query, ignoreCase = true) == true) ||
                        item.bestMoveSan.contains(query, ignoreCase = true) ||
                        item.sourceMode.contains(query, ignoreCase = true)
            }
            matchesMode && matchesQuery
        }
    }

    fun deleteItem(id: Long) {
        viewModelScope.launch {
            repository.deleteAnalysis(id)
            _uiState.value = _uiState.value.copy(statusMessage = "Analysis deleted")
        }
    }

    fun clearAll() {
        viewModelScope.launch {
            repository.clearHistory()
            _uiState.value = _uiState.value.copy(statusMessage = "All history cleared")
        }
    }

    fun clearStatusMessage() {
        _uiState.value = _uiState.value.copy(statusMessage = null)
    }
}
