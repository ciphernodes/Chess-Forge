package com.example.data.repository

import android.content.Context
import androidx.room.Room
import com.example.data.db.AnalysisDao
import com.example.data.db.AnalysisEntity
import com.example.data.db.ChessForgeDatabase
import com.example.data.db.GameDao
import com.example.data.db.GameRecordEntity
import com.example.data.db.PuzzleDao
import com.example.data.db.PuzzleEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

class ChessRepository(context: Context) {
    private val db = Room.databaseBuilder(
        context.applicationContext,
        ChessForgeDatabase::class.java,
        "chess_forge.db"
    ).build()

    val analysisDao: AnalysisDao = db.analysisDao()
    val gameDao: GameDao = db.gameDao()
    val puzzleDao: PuzzleDao = db.puzzleDao()

    init {
        CoroutineScope(Dispatchers.IO).launch {
            seedInitialPuzzles()
        }
    }

    private suspend fun seedInitialPuzzles() {
        val count = puzzleDao.getDailyPuzzle()
        if (count == null) {
            val initialPuzzles = listOf(
                PuzzleEntity(
                    fen = "r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 5",
                    sideToMove = "White",
                    objective = "White to play and gain decisive material advantage",
                    solutionSan = "Bxf7+, Kxf7, Nxe5+",
                    rating = 1100,
                    category = "TACTICS",
                    source = "ENGINE",
                    explanation = "Bxf7+ deflects the black king and exposes Black's center.",
                    isDaily = true
                ),
                PuzzleEntity(
                    fen = "r1b2rk1/pp3ppp/2n1p3/q7/3Pn3/P1PB1N2/5PPP/R1BQK2R w KQ - 0 12",
                    sideToMove = "White",
                    objective = "White to play and win a piece",
                    solutionSan = "Bxe4, Qxc3+, Bd2",
                    rating = 1250,
                    category = "MATERIAL",
                    source = "ENGINE",
                    explanation = "Bxe4 eliminates Black's active knight on e4 safely.",
                    isDaily = false
                ),
                PuzzleEntity(
                    fen = "r2q1rk1/pp1b1ppp/2n1pn2/2pp4/2PP4/2NBPN2/PP3PPP/R2QK2R w KQ - 0 9",
                    sideToMove = "White",
                    objective = "White to play and disrupt Black's center",
                    solutionSan = "dxc5, dxc4, Bxc4",
                    rating = 1350,
                    category = "POSITIONAL",
                    source = "GAMES",
                    explanation = "dxc5 unlocks active diagonals for the white bishops.",
                    isDaily = false
                ),
                PuzzleEntity(
                    fen = "6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1",
                    sideToMove = "White",
                    objective = "White to play and deliver checkmate",
                    solutionSan = "Re8#",
                    rating = 800,
                    category = "MATE",
                    source = "ENGINE",
                    explanation = "Re8# delivers a back-rank checkmate as Black's king is boxed in.",
                    isDaily = false
                ),
                PuzzleEntity(
                    fen = "r1bqk2r/pppp1ppp/2n2n2/4p3/1bB1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5",
                    sideToMove = "White",
                    objective = "White to play and break the pin on c3",
                    solutionSan = "Nd5, Nxd5, exd5",
                    rating = 1400,
                    category = "FORK",
                    source = "GAMES",
                    explanation = "Nd5 challenges Black's bishop and attacks the f6 knight.",
                    isDaily = false
                )
            )
            puzzleDao.insertAll(initialPuzzles)
        }
    }

    fun getAllAnalysis(): Flow<List<AnalysisEntity>> = analysisDao.getAllAnalysis()
    fun searchAnalysis(query: String): Flow<List<AnalysisEntity>> = analysisDao.searchAnalysis(query)
    fun getAnalysisByMode(mode: String): Flow<List<AnalysisEntity>> = analysisDao.getAnalysisByMode(mode)
    suspend fun saveAnalysis(entity: AnalysisEntity) = analysisDao.insertAnalysis(entity)
    suspend fun deleteAnalysis(id: Long) = analysisDao.deleteById(id)
    suspend fun clearHistory() = analysisDao.deleteAll()

    fun getAllGames(): Flow<List<GameRecordEntity>> = gameDao.getAllGames()
    suspend fun saveGame(game: GameRecordEntity) = gameDao.insertGame(game)
    suspend fun deleteGame(id: Long) = gameDao.deleteById(id)

    fun getAllPuzzles(): Flow<List<PuzzleEntity>> = puzzleDao.getAllPuzzles()
    suspend fun getDailyPuzzle(): PuzzleEntity? = puzzleDao.getDailyPuzzle()
    suspend fun updatePuzzleResult(id: Long, solved: Boolean) = puzzleDao.updatePuzzleSolved(id, solved)
    suspend fun savePuzzle(puzzle: PuzzleEntity) = puzzleDao.insertPuzzle(puzzle)
}
