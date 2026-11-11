package com.example.service

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationCompat
import com.example.MainActivity
import com.example.R
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.EnginePreset
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.core.chess.Square
import com.example.core.vision.ChessVisionPipeline
import com.example.data.repository.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

class LiveOverlayService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var windowManager: WindowManager? = null

    // Windows
    private var arrowWindowView: View? = null
    private var hudWindowView: View? = null
    private var calibrationWindowView: View? = null
    private var bubbleWindowView: View? = null
    private var isBubbleMode = false

    // Real-Time Screen Capture & Vision
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private val visionPipeline = ChessVisionPipeline()

    private val engine = ChessEngine()
    private val gameReconstructor = GameReconstructor()
    private var captureJob: Job? = null
    private lateinit var settingsRepository: SettingsRepository

    private var currentPosition: ChessPosition = ChessPosition.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5")
    private var currentBestMove: Move? = Move(Square(4, 1), Square(4, 3)) // default e2-e4
    private var currentBestMoveSan: String = "e4"
    private var currentEvalCp: Int = 35
    private var currentEvalDisplay: String = "+0.35"
    private var isBoardFlipped: Boolean = false
    private var scanStatusText: String = "Live Engine Active"

    // HUD View References
    private var hudEvalBadge: TextView? = null
    private var hudMoveText: TextView? = null
    private var hudStatusText: TextView? = null

    companion object {
        const val ACTION_START = "ACTION_START_OVERLAY"
        const val ACTION_START_WITH_PROJECTION = "ACTION_START_WITH_PROJECTION"
        const val ACTION_CAPTURE_NOW = "ACTION_CAPTURE_NOW"
        const val ACTION_CALIBRATE = "ACTION_CALIBRATE_BOARD"
        const val ACTION_STOP = "ACTION_STOP_OVERLAY"
        const val ACTION_SWITCH_PROFILE = "ACTION_SWITCH_PROFILE"

        const val EXTRA_RESULT_CODE = "EXTRA_RESULT_CODE"
        const val EXTRA_RESULT_DATA = "EXTRA_RESULT_DATA"

        const val CHANNEL_ID = "chess_forge_overlay_channel"
        const val NOTIFICATION_ID = 404

        var isRunning = false
            private set

        var isProjectionActive = false
            private set

        var mediaProjectionResultCode: Int? = null
        var mediaProjectionData: Intent? = null
        var lastScannedFen: String? = null
            private set
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsRepository = SettingsRepository(this)
        isBoardFlipped = settingsRepository.settings.value.isBoardFlipped
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createNotificationChannel()

        // Pre-analyze initial position so arrow is guaranteed immediately
        serviceScope.launch {
            try {
                val res = engine.analyze(currentPosition, settingsRepository.settings.value.enginePreset)
                if (res.bestMove != null) {
                    currentBestMove = res.bestMove
                    currentEvalCp = res.evaluationCp
                    currentEvalDisplay = res.displayScore
                    currentBestMoveSan = res.bestMoveSan
                    arrowWindowView?.invalidate()
                }
            } catch (_: Exception) {}
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_SWITCH_PROFILE -> {
                val current = settingsRepository.settings.value
                val newProfile = if (current.activeProfileName == "Blitz") "Study" else "Blitz"
                val newPreset = if (newProfile == "Blitz") EnginePreset.FAST else EnginePreset.DEEP
                settingsRepository.updateSettings(current.copy(activeProfileName = newProfile, enginePreset = newPreset))
                updateNotification()
            }
            ACTION_CALIBRATE -> {
                showForegroundNotification()
                isRunning = true
                if (checkOverlayPermission()) {
                    showCalibrationOverlay()
                }
            }
            ACTION_CAPTURE_NOW -> {
                serviceScope.launch {
                    triggerManualScan()
                }
            }
            ACTION_START_WITH_PROJECTION -> {
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, mediaProjectionResultCode ?: Activity.RESULT_CANCELED)
                val data = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java) ?: mediaProjectionData
                } else {
                    @Suppress("DEPRECATION")
                    (intent.getParcelableExtra(EXTRA_RESULT_DATA) as? Intent) ?: mediaProjectionData
                }

                if (code == Activity.RESULT_OK && data != null) {
                    initMediaProjection(code, data)
                }

                showForegroundNotification()
                isRunning = true
                if (checkOverlayPermission()) {
                    startActiveOverlay()
                }
                startCaptureLoop()
            }
            else -> {
                // If projection data already stored from earlier consent, reuse it
                if (mediaProjectionData != null && mediaProjectionResultCode == Activity.RESULT_OK) {
                    initMediaProjection(mediaProjectionResultCode!!, mediaProjectionData)
                }

                showForegroundNotification()
                isRunning = true
                if (checkOverlayPermission()) {
                    startActiveOverlay()
                }
                startCaptureLoop()
            }
        }
        return START_STICKY
    }

    private fun showForegroundNotification() {
        try {
            val notification = buildNotification()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                if (mediaProjection != null || isProjectionActive) {
                    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    } else {
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                    }
                    startForeground(NOTIFICATION_ID, notification, type)
                } else {
                    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                    } else {
                        0
                    }
                    if (type != 0) {
                        startForeground(NOTIFICATION_ID, notification, type)
                    } else {
                        startForeground(NOTIFICATION_ID, notification)
                    }
                }
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun checkOverlayPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Chess Forge Live Overlay",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Active screen analysis, board calibration, and best-move arrows"
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun buildNotification(): Notification {
        val stopIntent = Intent(this, LiveOverlayService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val scanIntent = Intent(this, LiveOverlayService::class.java).apply { action = ACTION_CAPTURE_NOW }
        val scanPendingIntent = PendingIntent.getService(
            this, 2, scanIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            putExtra("SHORTCUT_DESTINATION", "OVERLAY")
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val activeProfile = settingsRepository.settings.value.activeProfileName
        val status = if (isProjectionActive) "Real-Time Scanner Active" else "Ready (Tap Scan Board)"

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Chess Forge Live Overlay")
            .setContentText("$status • Profile: $activeProfile")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppPendingIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_camera, "Scan Board", scanPendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
    }

    private fun updateNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun getOverlayWindowType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        }
    }

    /**
     * Initializes MediaProjection and VirtualDisplay for live screen pixel capture
     */
    private fun initMediaProjection(code: Int, data: Intent?) {
        if (data == null || code != Activity.RESULT_OK) return
        mediaProjectionResultCode = code
        mediaProjectionData = data

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
                "ChessForgeScreenStream",
                w, h, dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader?.surface,
                null, null
            )
            isProjectionActive = true
            scanStatusText = "Scanner Active"
            updateHudStatus("Scanner Active • Live")
            showForegroundNotification()
        } catch (e: Exception) {
            e.printStackTrace()
            isProjectionActive = false
            scanStatusText = "Scanner Error: ${e.message}"
        }
    }

    /**
     * Captures a single frame from screen and runs vision pipeline + engine analysis
     */
    private suspend fun captureAndAnalyzeScreen(): Boolean = withContext(Dispatchers.Default) {
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

            val bitmap = Bitmap.createBitmap(
                width + rowPadding / pixelStride,
                height,
                Bitmap.Config.ARGB_8888
            )
            bitmap.copyPixelsFromBuffer(buffer)
            image.close()

            val screenW = width.toFloat()
            val screenH = height.toFloat()
            val boardRect = settingsRepository.getEffectiveBoardRect(screenW, screenH)

            val visionResult = visionPipeline.processImage(bitmap, boardRect)
            val pos = visionResult.position

            val pieceCount = pos.board.count { it != null }
            if (pieceCount >= 4) {
                val newFen = pos.toFen()
                if (newFen != lastScannedFen) {
                    lastScannedFen = newFen
                    currentPosition = pos
                    isBoardFlipped = !visionResult.isWhiteAtBottom

                    val res = engine.analyze(
                        position = currentPosition,
                        preset = settingsRepository.settings.value.enginePreset
                    )
                    if (res.bestMove != null) {
                        currentBestMove = res.bestMove
                        currentEvalCp = res.evaluationCp
                        currentEvalDisplay = res.displayScore
                        currentBestMoveSan = res.bestMoveSan

                        withContext(Dispatchers.Main) {
                            updateHudWithResult(res.bestMoveSan, res.displayScore, pieceCount)
                            arrowWindowView?.invalidate()
                        }
                        return@withContext true
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        } finally {
            try { image.close() } catch (_: Exception) {}
        }
        return@withContext false
    }

    private suspend fun triggerManualScan() {
        if (!isProjectionActive || imageReader == null) {
            // Prompt screen capture via MainActivity
            withContext(Dispatchers.Main) {
                Toast.makeText(this@LiveOverlayService, "Launching Screen Capture Permission...", Toast.LENGTH_SHORT).show()
                val intent = Intent(this@LiveOverlayService, MainActivity::class.java).apply {
                    action = "ACTION_REQUEST_SCREEN_CAPTURE"
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
                }
                startActivity(intent)
            }
            return
        }

        withContext(Dispatchers.Main) {
            updateHudStatus("Scanning Chess.com...")
        }

        val success = captureAndAnalyzeScreen()
        withContext(Dispatchers.Main) {
            if (success) {
                Toast.makeText(this@LiveOverlayService, "Scanned: $currentBestMoveSan ($currentEvalDisplay)", Toast.LENGTH_SHORT).show()
            } else {
                updateHudStatus("Align board box (tap 📐 Set Board)")
            }
        }
    }

    /**
     * CALIBRATION OVERLAY (Draggable frame to align over Chess.com / Lichess)
     */
    private fun showCalibrationOverlay() {
        dismissArrowWindow()
        dismissHudWindow()
        dismissBubbleWindow()
        if (calibrationWindowView != null) return

        val displayMetrics = resources.displayMetrics
        val screenW = displayMetrics.widthPixels.toFloat()
        val screenH = displayMetrics.heightPixels.toFloat()

        val initialRect = settingsRepository.getEffectiveBoardRect(screenW, screenH)
        val activeRect = RectF(initialRect)

        val root = FrameLayout(this)

        val calibrationView = object : View(this) {
            private val dimPaint = Paint().apply { color = Color.argb(160, 0, 0, 0) }
            private val clearPaint = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR) }
            private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#00E676")
                style = Paint.Style.STROKE
                strokeWidth = 6f
            }
            private val gridPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(140, 0, 230, 118)
                style = Paint.Style.STROKE
                strokeWidth = 2f
                pathEffect = DashPathEffect(floatArrayOf(10f, 10f), 0f)
            }
            private val handlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.parseColor("#00E676")
                style = Paint.Style.FILL
            }
            private val handleInnerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                style = Paint.Style.FILL
            }
            private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = 32f
                textAlign = Paint.Align.CENTER
            }

            private var touchMode = 0
            private var lastTouchX = 0f
            private var lastTouchY = 0f
            private val handleRadius = 45f

            init {
                setLayerType(LAYER_TYPE_SOFTWARE, null)
            }

            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)
                canvas.drawRect(activeRect, clearPaint)

                val sqW = activeRect.width() / 8f
                val sqH = activeRect.height() / 8f
                for (i in 1..7) {
                    val x = activeRect.left + i * sqW
                    canvas.drawLine(x, activeRect.top, x, activeRect.bottom, gridPaint)
                    val y = activeRect.top + i * sqH
                    canvas.drawLine(activeRect.left, y, activeRect.right, y, gridPaint)
                }

                canvas.drawRect(activeRect, borderPaint)

                drawHandle(canvas, activeRect.left, activeRect.top)
                drawHandle(canvas, activeRect.right, activeRect.top)
                drawHandle(canvas, activeRect.left, activeRect.bottom)
                drawHandle(canvas, activeRect.right, activeRect.bottom)

                canvas.drawText("✥ Drag box / Corners to resize", activeRect.centerX(), activeRect.centerY() + 10f, textPaint)
            }

            private fun drawHandle(canvas: Canvas, cx: Float, cy: Float) {
                canvas.drawCircle(cx, cy, handleRadius, handlePaint)
                canvas.drawCircle(cx, cy, handleRadius * 0.45f, handleInnerPaint)
            }

            override fun onTouchEvent(event: MotionEvent): Boolean {
                val x = event.x
                val y = event.y

                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        lastTouchX = x
                        lastTouchY = y

                        val touchCorner = isNear(x, y, activeRect.right, activeRect.bottom) ||
                                isNear(x, y, activeRect.right, activeRect.top) ||
                                isNear(x, y, activeRect.left, activeRect.bottom) ||
                                isNear(x, y, activeRect.left, activeRect.top)

                        if (touchCorner) {
                            touchMode = 2
                            return true
                        } else if (activeRect.contains(x, y)) {
                            touchMode = 1
                            return true
                        }
                        touchMode = 0
                        return false
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = x - lastTouchX
                        val dy = y - lastTouchY
                        lastTouchX = x
                        lastTouchY = y

                        if (touchMode == 1) {
                            activeRect.offset(dx, dy)
                            if (activeRect.left < 0) activeRect.offset(-activeRect.left, 0f)
                            if (activeRect.top < 0) activeRect.offset(0f, -activeRect.top)
                            if (activeRect.right > width) activeRect.offset(width - activeRect.right, 0f)
                            if (activeRect.bottom > height) activeRect.offset(0f, height - activeRect.bottom)
                            invalidate()
                            return true
                        } else if (touchMode == 2) {
                            val change = (dx + dy) / 2f
                            val newSize = (activeRect.width() + change * 2f).coerceIn(200f, width.toFloat() * 0.98f)
                            val cx = activeRect.centerX()
                            val cy = activeRect.centerY()
                            activeRect.set(cx - newSize / 2f, cy - newSize / 2f, cx + newSize / 2f, cy + newSize / 2f)
                            invalidate()
                            return true
                        }
                    }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        touchMode = 0
                    }
                }
                return super.onTouchEvent(event)
            }

            private fun isNear(tx: Float, ty: Float, hx: Float, hy: Float): Boolean {
                val dist = Math.hypot((tx - hx).toDouble(), (ty - hy).toDouble())
                return dist <= handleRadius * 1.6f
            }
        }
        root.addView(calibrationView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        // Top Header
        val headerLayout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.argb(235, 15, 23, 42))
            setPadding(32, 28, 32, 28)
        }
        val headerTitle = TextView(this).apply {
            text = "🎯 Set Chessboard Position"
            textSize = 17f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        headerLayout.addView(headerTitle)

        val headerDesc = TextView(this).apply {
            text = "Align this box over the chessboard in Chess.com or Lichess. Tap 'Lock Board' when aligned."
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
        }
        headerLayout.addView(headerDesc)
        root.addView(headerLayout, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.TOP })

        // Bottom Controls
        val bottomToolbar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.argb(240, 15, 23, 42))
            setPadding(24, 20, 24, 28)
        }

        val rowOptions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        val autoCenterBtn = Button(this).apply {
            text = "Center Box"
            textSize = 12f
            setOnClickListener {
                val size = (screenW * 0.94f).coerceAtMost(screenH * 0.55f)
                val l = (screenW - size) / 2f
                val t = (screenH - size) / 2f
                activeRect.set(l, t, l + size, t + size)
                calibrationView.invalidate()
            }
        }
        rowOptions.addView(autoCenterBtn)

        val flipBtn = Button(this).apply {
            text = if (isBoardFlipped) "Orientation: Black" else "Orientation: White"
            textSize = 12f
            setOnClickListener {
                isBoardFlipped = !isBoardFlipped
                text = if (isBoardFlipped) "Orientation: Black" else "Orientation: White"
                settingsRepository.updateSettings(settingsRepository.settings.value.copy(isBoardFlipped = isBoardFlipped))
            }
        }
        rowOptions.addView(flipBtn)
        bottomToolbar.addView(rowOptions)

        val rowActions = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, 16, 0, 0)
        }

        val cancelBtn = Button(this).apply {
            text = "Cancel"
            textSize = 13f
            setBackgroundColor(Color.argb(140, 239, 68, 68))
            setTextColor(Color.WHITE)
            setOnClickListener {
                dismissCalibrationOverlay()
                startActiveOverlay()
            }
        }
        rowActions.addView(cancelBtn)

        val lockBtn = Button(this).apply {
            text = "✓ Lock Board & Enable Touch"
            textSize = 14f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setBackgroundColor(Color.parseColor("#00E676"))
            setTextColor(Color.BLACK)
            setPadding(32, 12, 32, 12)
            setOnClickListener {
                settingsRepository.saveBoardRegion(activeRect)
                dismissCalibrationOverlay()
                startActiveOverlay()
            }
        }
        rowActions.addView(lockBtn)
        bottomToolbar.addView(rowActions)
        root.addView(bottomToolbar, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply { gravity = Gravity.BOTTOM })

        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        calibrationWindowView = root
        try {
            windowManager?.addView(calibrationWindowView, layoutParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun dismissCalibrationOverlay() {
        if (calibrationWindowView != null) {
            try { windowManager?.removeView(calibrationWindowView) } catch (_: Exception) {}
            calibrationWindowView = null
        }
    }

    /**
     * ACTIVE OVERLAY:
     * 1. Full-screen Arrow Layer with FLAG_NOT_TOUCHABLE -> 100% touch pass-through!
     * 2. Small floating HUD pill at top of screen with Eval, Best Move, Scan Board, Calibrate, and Stop.
     */
    private fun startActiveOverlay() {
        dismissCalibrationOverlay()
        showArrowPassThroughWindow()
        showFloatingHudPill()
    }

    private fun showArrowPassThroughWindow() {
        if (arrowWindowView != null) return

        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        val arrowCanvasView = object : View(this) {
            private val shaftPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
            }
            private val outlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
                color = Color.argb(200, 0, 0, 0)
            }
            private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
            }
            private val headOutlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                color = Color.BLACK
                strokeWidth = 6f
            }
            private val sourceCirclePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
            }
            private val targetRingPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE
                strokeWidth = 6f
            }
            private val tagBgPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.argb(230, 15, 23, 42)
                style = Paint.Style.FILL
            }
            private val tagTextPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.WHITE
                textSize = 28f
                textAlign = Paint.Align.CENTER
                typeface = android.graphics.Typeface.create(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD)
            }

            init {
                setWillNotDraw(false)
            }

            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                val move = currentBestMove ?: Move(Square(4, 1), Square(4, 3))

                val screenW = if (width > 0) width.toFloat() else resources.displayMetrics.widthPixels.toFloat()
                val screenH = if (height > 0) height.toFloat() else resources.displayMetrics.heightPixels.toFloat()
                val region = settingsRepository.getEffectiveBoardRect(screenW, screenH)

                val sqW = region.width() / 8f
                val sqH = region.height() / 8f

                val fromFile = if (isBoardFlipped) 7 - move.from.file else move.from.file
                val fromRank = if (isBoardFlipped) move.from.rank else 7 - move.from.rank
                val toFile = if (isBoardFlipped) 7 - move.to.file else move.to.file
                val toRank = if (isBoardFlipped) move.to.rank else 7 - move.to.rank

                val startX = region.left + (fromFile + 0.5f) * sqW
                val startY = region.top + (fromRank + 0.5f) * sqH
                val endX = region.left + (toFile + 0.5f) * sqW
                val endY = region.top + (toRank + 0.5f) * sqH

                val dx = endX - startX
                val dy = endY - startY
                val angle = atan2(dy, dx)
                val headSize = sqW * 0.42f
                val targetX = endX - (cos(angle) * headSize * 0.35f)
                val targetY = endY - (sin(angle) * headSize * 0.35f)

                val arrowColor = settingsRepository.settings.value.arrowBaseColor.hex.toInt()
                val opacity = (settingsRepository.settings.value.arrowOpacity * 255).toInt().coerceIn(60, 255)

                // 1. Source square luminous highlight
                sourceCirclePaint.color = arrowColor
                sourceCirclePaint.alpha = (opacity * 0.5f).toInt()
                canvas.drawCircle(startX, startY, sqW * 0.28f, sourceCirclePaint)

                // 2. Target square bullseye ring
                targetRingPaint.color = arrowColor
                targetRingPaint.alpha = opacity
                canvas.drawCircle(endX, endY, sqW * 0.32f, targetRingPaint)

                // 3. Arrow shaft
                shaftPaint.color = arrowColor
                shaftPaint.alpha = opacity
                val strokeW = sqW * 0.16f
                shaftPaint.strokeWidth = strokeW
                outlinePaint.strokeWidth = strokeW + 10f

                // Black outline
                canvas.drawLine(startX, startY, targetX, targetY, outlinePaint)
                // Vibrant shaft
                canvas.drawLine(startX, startY, targetX, targetY, shaftPaint)

                // 4. Arrowhead
                headPaint.color = arrowColor
                headPaint.alpha = opacity
                val headPath = Path().apply {
                    moveTo(endX, endY)
                    lineTo(
                        (endX - headSize * cos(angle - 0.45f)),
                        (endY - headSize * sin(angle - 0.45f))
                    )
                    lineTo(
                        (endX - headSize * cos(angle + 0.45f)),
                        (endY - headSize * sin(angle + 0.45f))
                    )
                    close()
                }
                canvas.drawPath(headPath, outlinePaint)
                canvas.drawPath(headPath, headPaint)
                canvas.drawPath(headPath, headOutlinePaint)

                // 5. Move & Eval floating tag
                val midX = (startX + endX) / 2f
                val midY = (startY + endY) / 2f - (sqH * 0.25f)
                val tagText = "${currentBestMoveSan.ifEmpty { "${move.from}→${move.to}" }} ($currentEvalDisplay)"
                val textW = tagTextPaint.measureText(tagText)
                val tagRect = RectF(midX - textW / 2f - 16f, midY - 24f, midX + textW / 2f + 16f, midY + 18f)
                canvas.drawRoundRect(tagRect, 14f, 14f, tagBgPaint)
                canvas.drawText(tagText, midX, midY + 8f, tagTextPaint)
            }
        }

        arrowWindowView = arrowCanvasView
        try {
            windowManager?.addView(arrowWindowView, layoutParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun dismissArrowWindow() {
        if (arrowWindowView != null) {
            try { windowManager?.removeView(arrowWindowView) } catch (_: Exception) {}
            arrowWindowView = null
        }
    }

    /**
     * Floating HUD pill:
     * Eval chip, Best move chip, [📸 Scan Board] button, [📐 Set Board] button, minimize, and stop.
     */
    private fun showFloatingHudPill() {
        if (hudWindowView != null) return

        val hudParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            y = 70
        }

        val hudLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.argb(238, 15, 23, 42))
            setPadding(16, 8, 16, 8)
        }

        // Eval chip
        hudEvalBadge = TextView(this).apply {
            text = currentEvalDisplay
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor("#00E676"))
            setBackgroundColor(Color.argb(160, 0, 0, 0))
            setPadding(12, 6, 12, 6)
        }
        hudLayout.addView(hudEvalBadge)

        // Best move text
        hudMoveText = TextView(this).apply {
            text = " $currentBestMoveSan "
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.WHITE)
            setPadding(8, 0, 8, 0)
        }
        hudLayout.addView(hudMoveText)

        // 📸 Scan Board Button (Captures and analyzes Chess.com screen immediately!)
        val scanBtn = TextView(this).apply {
            text = " 📸 Scan "
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.BLACK)
            setBackgroundColor(Color.parseColor("#00E676"))
            setPadding(12, 6, 12, 6)
            setOnClickListener {
                serviceScope.launch {
                    triggerManualScan()
                }
            }
        }
        hudLayout.addView(scanBtn)

        // 📐 Set Board Button
        val calibrateBtn = TextView(this).apply {
            text = " 📐 Board "
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor("#38BDF8"))
            setBackgroundColor(Color.argb(120, 3, 105, 161))
            setPadding(10, 6, 10, 6)
            setOnClickListener {
                showCalibrationOverlay()
            }
        }
        hudLayout.addView(calibrateBtn)

        // Minimize Button
        val minimizeBtn = TextView(this).apply {
            text = " — "
            textSize = 14f
            setTextColor(Color.WHITE)
            setPadding(8, 4, 8, 4)
            setOnClickListener {
                switchToBubbleMode()
            }
        }
        hudLayout.addView(minimizeBtn)

        // Stop Button
        val stopBtn = TextView(this).apply {
            text = " ✕ "
            textSize = 14f
            setTextColor(Color.parseColor("#EF4444"))
            setPadding(8, 4, 8, 4)
            setOnClickListener {
                stopSelf()
            }
        }
        hudLayout.addView(stopBtn)

        hudLayout.setOnTouchListener(object : View.OnTouchListener {
            private var initialY = 0
            private var initialTouchY = 0f

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialY = hudParams.y
                        initialTouchY = event.rawY
                        return false
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (Math.abs(dy) > 12) {
                            hudParams.y = (initialY + dy).coerceAtLeast(0)
                            windowManager?.updateViewLayout(hudLayout, hudParams)
                            return true
                        }
                    }
                }
                return false
            }
        })

        hudWindowView = hudLayout
        try {
            windowManager?.addView(hudWindowView, hudParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun updateHudWithResult(san: String, score: String, pieces: Int) {
        hudMoveText?.text = " $san "
        hudEvalBadge?.text = score
        val isAdvantage = !score.startsWith("-")
        hudEvalBadge?.setTextColor(if (isAdvantage) Color.parseColor("#00E676") else Color.parseColor("#FF5252"))
    }

    private fun updateHudStatus(status: String) {
        Handler(Looper.getMainLooper()).post {
            hudMoveText?.text = " $status "
        }
    }

    private fun dismissHudWindow() {
        if (hudWindowView != null) {
            try { windowManager?.removeView(hudWindowView) } catch (_: Exception) {}
            hudWindowView = null
        }
    }

    private fun switchToBubbleMode() {
        dismissArrowWindow()
        dismissHudWindow()
        showFloatingBubble()
        isBubbleMode = true
    }

    private fun showFloatingBubble() {
        if (bubbleWindowView != null) return

        val bubbleSize = (50 * resources.displayMetrics.density).toInt()

        val params = WindowManager.LayoutParams(
            bubbleSize,
            bubbleSize,
            getOverlayWindowType(),
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = 40
            y = 200
        }

        val bubble = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#0D9488"))
        }

        val icon = ImageView(this).apply {
            setImageResource(R.mipmap.ic_launcher)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
        }
        bubble.addView(icon)

        bubble.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        params.x = initialX + (event.rawX - initialTouchX).toInt()
                        params.y = initialY + (event.rawY - initialTouchY).toInt()
                        windowManager?.updateViewLayout(bubble, params)
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        val dx = Math.abs(event.rawX - initialTouchX)
                        val dy = Math.abs(event.rawY - initialTouchY)
                        if (dx < 12 && dy < 12) {
                            dismissBubbleWindow()
                            isBubbleMode = false
                            startActiveOverlay()
                        }
                        return true
                    }
                }
                return false
            }
        })

        bubbleWindowView = bubble
        try {
            windowManager?.addView(bubbleWindowView, params)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun dismissBubbleWindow() {
        if (bubbleWindowView != null) {
            try { windowManager?.removeView(bubbleWindowView) } catch (_: Exception) {}
            bubbleWindowView = null
        }
    }

    private fun startCaptureLoop() {
        captureJob?.cancel()
        captureJob = serviceScope.launch(Dispatchers.Default) {
            val fps = settingsRepository.settings.value.overlayFps.coerceIn(1, 15)
            val delayMs = 1000L / fps

            while (true) {
                if (isProjectionActive && imageReader != null) {
                    try {
                        captureAndAnalyzeScreen()
                    } catch (_: Exception) {}
                } else {
                    try {
                        val res = engine.analyze(
                            position = currentPosition,
                            preset = settingsRepository.settings.value.enginePreset
                        )
                        currentBestMove = res.bestMove
                        currentEvalCp = res.evaluationCp
                        currentEvalDisplay = res.displayScore
                        currentBestMoveSan = res.bestMoveSan
                        withContext(Dispatchers.Main) {
                            arrowWindowView?.invalidate()
                        }
                    } catch (_: Exception) {}
                }
                delay(delayMs)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        isProjectionActive = false
        captureJob?.cancel()
        serviceScope.cancel()

        virtualDisplay?.release()
        imageReader?.close()
        mediaProjection?.stop()

        dismissCalibrationOverlay()
        dismissArrowWindow()
        dismissHudWindow()
        dismissBubbleWindow()
    }
}
