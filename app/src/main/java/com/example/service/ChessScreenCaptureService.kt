package com.example.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.example.MainActivity
import com.example.R
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.EnginePreset
import com.example.core.chess.Move
import com.example.core.chess.PieceColor
import com.example.core.vision.ChessVisionPipeline
import com.example.data.repository.SettingsRepository
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class CaptureAnalysisResult(
    val position: ChessPosition,
    val bestMove: Move,
    val bestMoveSan: String,
    val evalCp: Int,
    val evalDisplay: String,
    val isWhiteAtBottom: Boolean,
    val playerColor: PieceColor,
    val isPlayerTurn: Boolean,
    val activeColor: PieceColor,
    val statusMessage: String,
    val timestamp: Long = System.currentTimeMillis()
)

class ChessScreenCaptureService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null

    private val visionPipeline = ChessVisionPipeline()
    private val engine = ChessEngine()
    private lateinit var settingsRepository: SettingsRepository

    private var loopJob: Job? = null
    private var engineJob: Job? = null
    private var lastAnalyzedFen: String? = null
    private var previousScannedPosition: ChessPosition? = null
    private var lastFrameSignature = IntArray(64)

    companion object {
        const val ACTION_START = "ACTION_START_CAPTURE"
        const val ACTION_CAPTURE_NOW = "ACTION_CAPTURE_NOW"
        const val ACTION_STOP = "ACTION_STOP_CAPTURE"

        const val EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA"

        const val CHANNEL_ID = "chess_forge_screen_capture_channel"
        const val NOTIFICATION_ID = 505

        var isCapturing = false
            private set

        val latestAnalysisResult = MutableStateFlow<CaptureAnalysisResult?>(null)
        private val _scanStatusMessage = MutableStateFlow<String?>("Ready")
        val scanStatusMessage = _scanStatusMessage.asStateFlow()

        fun requestScan(context: Context) {
            val intent = Intent(context, ChessScreenCaptureService::class.java).apply {
                action = ACTION_CAPTURE_NOW
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, ChessScreenCaptureService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsRepository = SettingsRepository(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_CAPTURE_NOW -> {
                serviceScope.launch {
                    performCalibratedRegionScan(forceScan = true)
                }
            }
            ACTION_START -> {
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, -1)
                val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(EXTRA_RESULT_DATA) as? Intent
                }

                if (code != -1 && data != null) {
                    startForegroundNotification()
                    initMediaProjection(code, data)
                    startAutoCaptureLoop()
                } else {
                    stopSelf()
                }
            }
        }
        return START_STICKY
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Chess Forge Screen Capture",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Captures the calibrated chessboard region in real-time"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun startForegroundNotification() {
        val stopIntent = Intent(this, ChessScreenCaptureService::class.java).apply { action = ACTION_STOP }
        val stopPending = PendingIntent.getService(this, 10, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val openApp = Intent(this, MainActivity::class.java).apply { putExtra("SHORTCUT_DESTINATION", "OVERLAY") }
        val openPending = PendingIntent.getActivity(this, 11, openApp, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Chess Forge Screen Scanner")
            .setContentText("Capturing calibrated board region live")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openPending)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPending)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun initMediaProjection(code: Int, data: Intent) {
        try {
            val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            virtualDisplay?.release()
            imageReader?.close()
            mediaProjection?.stop()

            mediaProjection = mpm.getMediaProjection(code, data)

            val metrics = resources.displayMetrics
            val w = metrics.widthPixels
            val h = metrics.heightPixels
            val dpi = metrics.densityDpi

            imageReader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
            virtualDisplay = mediaProjection?.createVirtualDisplay(
                "ChessForgeCalibratedStream",
                w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface,
                null, null
            )
            isCapturing = true
            _scanStatusMessage.value = "Scanner Active"
        } catch (e: Exception) {
            e.printStackTrace()
            isCapturing = false
            _scanStatusMessage.value = "Scanner Error: ${e.message}"
        }
    }

    /**
     * Grabs the current frame, crops specifically to the calibrated board region,
     * checks for position changes, detects player color automatically, and analyzes with Stockfish.
     */
    suspend fun performCalibratedRegionScan(forceScan: Boolean = false): Boolean = withContext(Dispatchers.Default) {
        val reader = imageReader ?: return@withContext false
        val image = reader.acquireLatestImage() ?: return@withContext false

        try {
            val planes = image.planes
            val buffer = planes[0].buffer
            val pixelStride = planes[0].pixelStride
            val rowStride = planes[0].rowStride
            val width = image.width
            val height = image.height
            val rowPadding = rowStride - pixelStride * width

            val fullBitmap = Bitmap.createBitmap(
                width + rowPadding / pixelStride,
                height,
                Bitmap.Config.ARGB_8888
            )
            fullBitmap.copyPixelsFromBuffer(buffer)
            image.close()

            // 1. Get calibrated region defined by user in calibration tool
            val boardRect = settingsRepository.getEffectiveBoardRect(width.toFloat(), height.toFloat())

            // 2. Crop strictly to the calibrated chessboard region
            val left = boardRect.left.toInt().coerceIn(0, fullBitmap.width - 2)
            val top = boardRect.top.toInt().coerceIn(0, fullBitmap.height - 2)
            val w = boardRect.width().toInt().coerceIn(2, fullBitmap.width - left)
            val h = boardRect.height().toInt().coerceIn(2, fullBitmap.height - top)

            val croppedBoard = Bitmap.createBitmap(fullBitmap, left, top, w, h)

            // 3. Fast board signature: If the board hasn't changed since last frame, skip re-evaluating!
            val currentSig = computeBoardSignature(croppedBoard)
            if (!forceScan && isBoardSignatureSimilar(currentSig, lastFrameSignature) && latestAnalysisResult.value != null) {
                return@withContext true
            }

            // 4. Process the cropped board with auto player color detection
            val currentSettings = settingsRepository.settings.value
            val visionResult = visionPipeline.processCroppedBoard(
                croppedBoard = croppedBoard,
                isBoardFlipped = currentSettings.isBoardFlipped,
                colorOverride = currentSettings.playerColorOverride,
                previousPosition = previousScannedPosition
            )
            val pos = visionResult.position

            val pieceCount = pos.board.count { it != null }
            if (pieceCount >= 4) {
                val newFen = pos.toFen()
                if (!forceScan && newFen == lastAnalyzedFen && latestAnalysisResult.value != null) {
                    lastFrameSignature = currentSig
                    return@withContext true
                }

                lastFrameSignature = currentSig
                lastAnalyzedFen = newFen
                previousScannedPosition = pos

                // Cancel any previous running engine search immediately so new move is computed with zero delay
                engineJob?.cancel()
                val job = serviceScope.launch {
                    val preset = currentSettings.enginePreset
                    val res = engine.analyze(
                        position = pos,
                        preset = EnginePreset.FAST, // Real-time fast evaluation (<250ms)
                        customDepth = 12,
                        customMovetimeMs = 250L
                    )
                    if (res.bestMove != null) {
                        val status = if (visionResult.isPlayerTurn) {
                            "Best: ${res.bestMoveSan} (${res.displayScore})"
                        } else {
                            "Opponent to move (${res.bestMoveSan})"
                        }

                        val analysis = CaptureAnalysisResult(
                            position = pos,
                            bestMove = res.bestMove,
                            bestMoveSan = res.bestMoveSan,
                            evalCp = res.evaluationCp,
                            evalDisplay = res.displayScore,
                            isWhiteAtBottom = visionResult.isWhiteAtBottom,
                            playerColor = visionResult.playerColor,
                            isPlayerTurn = visionResult.isPlayerTurn,
                            activeColor = pos.activeColor,
                            statusMessage = status
                        )
                        latestAnalysisResult.value = analysis
                        _scanStatusMessage.value = status
                    }
                }
                engineJob = job
                return@withContext true
            } else {
                _scanStatusMessage.value = "Align board region (tap 📐 Board)"
            }
        } catch (e: Exception) {
            e.printStackTrace()
            _scanStatusMessage.value = "Scan error: ${e.message}"
        } finally {
            try { image.close() } catch (_: Exception) {}
        }
        return@withContext false
    }

    private fun computeBoardSignature(bitmap: Bitmap): IntArray {
        val sig = IntArray(64)
        val sqW = bitmap.width / 8
        val sqH = bitmap.height / 8
        if (sqW < 2 || sqH < 2) return sig

        for (r in 0..7) {
            for (c in 0..7) {
                val cx = (c * sqW + sqW / 2).coerceIn(0, bitmap.width - 1)
                val cy = (r * sqH + sqH / 2).coerceIn(0, bitmap.height - 1)
                sig[r * 8 + c] = bitmap.getPixel(cx, cy)
            }
        }
        return sig
    }

    private fun isBoardSignatureSimilar(sigA: IntArray, sigB: IntArray): Boolean {
        var diffCount = 0
        for (i in 0 until 64) {
            val a = sigA[i]
            val b = sigB[i]
            val dr = abs(Color.red(a) - Color.red(b))
            val dg = abs(Color.green(a) - Color.green(b))
            val db = abs(Color.blue(a) - Color.blue(b))
            if (dr + dg + db > 40) {
                diffCount++
                if (diffCount > 1) return false
            }
        }
        return true
    }

    private fun startAutoCaptureLoop() {
        loopJob?.cancel()
        loopJob = serviceScope.launch {
            // Real-time continuous scanning loop: checks board frame at 4 FPS
            while (true) {
                if (isCapturing && imageReader != null) {
                    try {
                        performCalibratedRegionScan(forceScan = false)
                    } catch (_: Exception) {}
                }
                delay(250)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isCapturing = false
        loopJob?.cancel()
        engineJob?.cancel()
        serviceScope.cancel()

        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()
    }
}
