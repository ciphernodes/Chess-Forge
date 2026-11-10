package com.example.data.db

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "analysis_history")
data class AnalysisEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val fen: String,
    val bestMoveSan: String,
    val bestMoveUci: String,
    val evaluationCp: Int,
    val mateIn: Int? = null,
    val depth: Int,
    val sourceMode: String, // PRACTICE, SCREENSHOT, OVERLAY, PUZZLE
    val moveClassification: String? = null,
    val openingName: String? = null,
    val eco: String? = null,
    val sessionId: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "game_records")
data class GameRecordEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val pgnText: String,
    val totalMoves: Int,
    val accuracyWhite: Float? = null,
    val accuracyBlack: Float? = null,
    val isReconstructed: Boolean = false,
    val openingName: String? = null,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "puzzles")
data class PuzzleEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val fen: String,
    val sideToMove: String, // "White" or "Black"
    val objective: String, // e.g. "White to play and win material"
    val solutionSan: String, // e.g. "Nxf7, Kxf7, Bc4+"
    val rating: Int = 1200,
    val category: String = "TACTICS", // FORK, PIN, MATE, MATERIAL, DEFENSE
    val source: String = "ENGINE", // GAMES, SCREENSHOT, ENGINE
    val explanation: String = "",
    val isDaily: Boolean = false,
    val solved: Boolean = false,
    val attempts: Int = 0,
    val timestamp: Long = System.currentTimeMillis()
)

@Dao
interface AnalysisDao {
    @Query("SELECT * FROM analysis_history ORDER BY timestamp DESC")
    fun getAllAnalysis(): Flow<List<AnalysisEntity>>

    @Query("SELECT * FROM analysis_history WHERE sourceMode = :mode ORDER BY timestamp DESC")
    fun getAnalysisByMode(mode: String): Flow<List<AnalysisEntity>>

    @Query("SELECT * FROM analysis_history WHERE fen LIKE '%' || :query || '%' OR openingName LIKE '%' || :query || '%' OR bestMoveSan LIKE '%' || :query || '%' ORDER BY timestamp DESC")
    fun searchAnalysis(query: String): Flow<List<AnalysisEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAnalysis(entity: AnalysisEntity): Long

    @Query("DELETE FROM analysis_history WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM analysis_history WHERE sourceMode = :mode")
    suspend fun deleteByMode(mode: String)

    @Query("DELETE FROM analysis_history")
    suspend fun deleteAll()
}

@Dao
interface GameDao {
    @Query("SELECT * FROM game_records ORDER BY timestamp DESC")
    fun getAllGames(): Flow<List<GameRecordEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertGame(game: GameRecordEntity): Long

    @Query("DELETE FROM game_records WHERE id = :id")
    suspend fun deleteById(id: Long)

    @Query("DELETE FROM game_records")
    suspend fun deleteAll()
}

@Dao
interface PuzzleDao {
    @Query("SELECT * FROM puzzles ORDER BY id DESC")
    fun getAllPuzzles(): Flow<List<PuzzleEntity>>

    @Query("SELECT * FROM puzzles WHERE isDaily = 1 LIMIT 1")
    suspend fun getDailyPuzzle(): PuzzleEntity?

    @Query("SELECT * FROM puzzles WHERE solved = 1")
    fun getSolvedPuzzles(): Flow<List<PuzzleEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertPuzzle(puzzle: PuzzleEntity): Long

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(puzzles: List<PuzzleEntity>)

    @Query("UPDATE puzzles SET solved = :solved, attempts = attempts + 1 WHERE id = :id")
    suspend fun updatePuzzleSolved(id: Long, solved: Boolean)

    @Query("DELETE FROM puzzles")
    suspend fun deleteAll()
}

@Database(
    entities = [AnalysisEntity::class, GameRecordEntity::class, PuzzleEntity::class],
    version = 1,
    exportSchema = false
)
abstract class ChessForgeDatabase : RoomDatabase() {
    abstract fun analysisDao(): AnalysisDao
    abstract fun gameDao(): GameDao
    abstract fun puzzleDao(): PuzzleDao
}
