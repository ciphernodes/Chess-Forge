package com.example.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import com.example.MainActivity
import com.example.R
import com.example.core.chess.ChessEngine
import com.example.core.chess.ChessPosition
import com.example.core.chess.EnginePreset
import com.example.core.chess.GameReconstructor
import com.example.core.chess.Move
import com.example.data.repository.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
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

    private val engine = ChessEngine()
    private val gameReconstructor = GameReconstructor()
    private var captureJob: Job? = null
    private lateinit var settingsRepository: SettingsRepository

    private var currentPosition: ChessPosition = ChessPosition.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5")
    private var currentBestMove: Move? = null
    private var currentEvalCp: Int = 35
    private var currentEvalDisplay: String = "+0.35"
    private var isBoardFlipped: Boolean = false

    companion object {
        const val ACTION_START = "ACTION_START_OVERLAY"
        const val ACTION_CALIBRATE = "ACTION_CALIBRATE_BOARD"
        const val ACTION_STOP = "ACTION_STOP_OVERLAY"
        const val ACTION_SWITCH_PROFILE = "ACTION_SWITCH_PROFILE"
        const val CHANNEL_ID = "chess_forge_overlay_channel"
        const val NOTIFICATION_ID = 404
        var isRunning = false
            private set
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        settingsRepository = SettingsRepository(this)
        isBoardFlipped = settingsRepository.settings.value.isBoardFlipped
        windowManager = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        createNotificationChannel()
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
            else -> {
                showForegroundNotification()
                isRunning = true
                if (checkOverlayPermission()) {
                    val s = settingsRepository.settings.value
                    if (s.alwaysPromptCalibration || !settingsRepository.hasSavedBoardRegion()) {
                        showCalibrationOverlay()
                    } else {
                        startActiveOverlay()
                    }
                }
                startCaptureLoop()
            }
        }
        return START_STICKY
    }

    private fun showForegroundNotification() {
        try {
            startForeground(NOTIFICATION_ID, buildNotification())
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

        val calibrateIntent = Intent(this, LiveOverlayService::class.java).apply { action = ACTION_CALIBRATE }
        val calibratePendingIntent = PendingIntent.getService(
            this, 2, calibrateIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            putExtra("SHORTCUT_DESTINATION", "OVERLAY")
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val activeProfile = settingsRepository.settings.value.activeProfileName

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Chess Forge Live Overlay Active")
            .setContentText("Profile: $activeProfile • Touches pass through to chess app")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppPendingIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_crop, "Set Board", calibratePendingIntent)
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
     * CALIBRATION OVERLAY (Prompt to set where the chessboard is located)
     * This window accepts touches so the user can drag & resize the box over the chess app!
     */
    private fun showCalibrationOverlay() {
        // Dismiss active windows while calibrating
        dismissArrowWindow()
        dismissHudWindow()
        dismissBubbleWindow()
        if (calibrationWindowView != null) return

        val displayMetrics = resources.displayMetrics
        val screenW = displayMetrics.widthPixels.toFloat()
        val screenH = displayMetrics.heightPixels.toFloat()

        // Initial board rectangle
        val initialRect = settingsRepository.getEffectiveBoardRect(screenW, screenH)
        val activeRect = RectF(initialRect)

        val root = FrameLayout(this)

        // Custom View that renders dimming, transparent cutout, 8x8 grid and handles gestures
        val calibrationView = object : View(this) {
            private val dimPaint = Paint().apply {
                color = Color.argb(160, 0, 0, 0)
            }
            private val clearPaint = Paint().apply {
                xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
            }
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

            private var touchMode = 0 // 0: None, 1: Drag, 2: Resize Corner
            private var lastTouchX = 0f
            private var lastTouchY = 0f
            private val handleRadius = 45f

            init {
                setLayerType(LAYER_TYPE_SOFTWARE, null)
            }

            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)

                // 1. Dim background
                canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), dimPaint)

                // 2. Clear transparent hole for the chessboard underneath
                canvas.drawRect(activeRect, clearPaint)

                // 3. Draw 8x8 Grid inside the hole so user can match squares
                val sqW = activeRect.width() / 8f
                val sqH = activeRect.height() / 8f
                for (i in 1..7) {
                    val x = activeRect.left + i * sqW
                    canvas.drawLine(x, activeRect.top, x, activeRect.bottom, gridPaint)
                    val y = activeRect.top + i * sqH
                    canvas.drawLine(activeRect.left, y, activeRect.right, y, gridPaint)
                }

                // 4. Outer Border
                canvas.drawRect(activeRect, borderPaint)

                // 5. Four Corner Handles for Resizing
                drawHandle(canvas, activeRect.left, activeRect.top)
                drawHandle(canvas, activeRect.right, activeRect.top)
                drawHandle(canvas, activeRect.left, activeRect.bottom)
                drawHandle(canvas, activeRect.right, activeRect.bottom)

                // 6. Center hint text
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

                        // Check if touched corner handle (Resize)
                        val touchCorner = isNear(x, y, activeRect.right, activeRect.bottom) ||
                                isNear(x, y, activeRect.right, activeRect.top) ||
                                isNear(x, y, activeRect.left, activeRect.bottom) ||
                                isNear(x, y, activeRect.left, activeRect.top)

                        if (touchCorner) {
                            touchMode = 2 // Resize
                            return true
                        } else if (activeRect.contains(x, y)) {
                            touchMode = 1 // Drag
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

                        if (touchMode == 1) { // Drag
                            activeRect.offset(dx, dy)
                            // Constrain within screen
                            if (activeRect.left < 0) activeRect.offset(-activeRect.left, 0f)
                            if (activeRect.top < 0) activeRect.offset(0f, -activeRect.top)
                            if (activeRect.right > width) activeRect.offset(width - activeRect.right, 0f)
                            if (activeRect.bottom > height) activeRect.offset(0f, height - activeRect.bottom)
                            invalidate()
                            return true
                        } else if (touchMode == 2) { // Resize square
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

        // Top Instruction Header
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
            text = "Drag & resize the green box to fit your chessboard in Chess.com or Lichess. Tap 'Lock Board' when aligned."
            textSize = 12f
            setTextColor(Color.parseColor("#94A3B8"))
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 0)
        }
        headerLayout.addView(headerDesc)

        val headerParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP
        }
        root.addView(headerLayout, headerParams)

        // Bottom Controls (Auto-Center, Flip Orientation, Lock Board, Cancel)
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
                // Save region in absolute screen pixels
                settingsRepository.saveBoardRegion(activeRect)
                dismissCalibrationOverlay()
                startActiveOverlay()
            }
        }
        rowActions.addView(lockBtn)
        bottomToolbar.addView(rowActions)

        val bottomParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.BOTTOM
        }
        root.addView(bottomToolbar, bottomParams)

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
     * 1. Full-screen Arrow Layer with WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
     *    -> ZERO touch interference! All touches pass 100% through to Chess.com or Lichess!
     * 2. Small floating HUD pill at top of screen with Eval, Best Move, Calibrate, and Stop.
     */
    private fun startActiveOverlay() {
        dismissCalibrationOverlay()
        showArrowPassThroughWindow()
        showFloatingHudPill()
    }

    private fun showArrowPassThroughWindow() {
        if (arrowWindowView != null) return

        // CRITICAL: FLAG_NOT_TOUCHABLE allows ALL screen touches to pass straight through
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

        // Custom Canvas for Best-Move Arrow
        val arrowCanvasView = object : View(this) {
            private val shaftPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
            }
            private val outlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
                color = Color.argb(140, 0, 0, 0)
            }
            private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
            }

            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                val move = currentBestMove ?: return
                val region = settingsRepository.getEffectiveBoardRect(width.toFloat(), height.toFloat())

                val sqW = region.width() / 8f
                val sqH = region.height() / 8f

                // Coordinate mapping based on board orientation
                val startX: Float
                val startY: Float
                val endX: Float
                val endY: Float

                if (isBoardFlipped) {
                    // Black at bottom
                    startX = region.left + (7 - move.from.file + 0.5f) * sqW
                    startY = region.top + (move.from.rank + 0.5f) * sqH
                    endX = region.left + (7 - move.to.file + 0.5f) * sqW
                    endY = region.top + (move.to.rank + 0.5f) * sqH
                } else {
                    // White at bottom
                    startX = region.left + (move.from.file + 0.5f) * sqW
                    startY = region.top + (7 - move.from.rank + 0.5f) * sqH
                    endX = region.left + (move.to.file + 0.5f) * sqW
                    endY = region.top + (7 - move.to.rank + 0.5f) * sqH
                }

                val dx = endX - startX
                val dy = endY - startY
                val angle = atan2(dy, dx)
                val headSize = sqW * 0.38f
                val targetX = endX - (cos(angle) * headSize * 0.4f)
                val targetY = endY - (sin(angle) * headSize * 0.4f)

                val arrowColor = settingsRepository.settings.value.arrowBaseColor.hex.toInt()
                val opacity = (settingsRepository.settings.value.arrowOpacity * 255).toInt().coerceIn(40, 255)

                shaftPaint.color = arrowColor
                shaftPaint.alpha = opacity
                shaftPaint.strokeWidth = sqW * 0.12f

                outlinePaint.strokeWidth = sqW * 0.12f + 8f

                // Black outline
                canvas.drawLine(startX, startY, targetX, targetY, outlinePaint)
                // Main shaft
                canvas.drawLine(startX, startY, targetX, targetY, shaftPaint)

                // Arrowhead
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
                canvas.drawPath(headPath, headPaint)
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
     * Small Floating HUD Pill at the top of the screen:
     * Contains Eval score, Best Move chip, Calibrate button, Minimize and Close.
     * Takes up minimal space and is user draggable!
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
            setBackgroundColor(Color.argb(235, 15, 23, 42))
            setPadding(18, 10, 18, 10)
        }

        // Eval chip
        val evalBadge = TextView(this).apply {
            text = currentEvalDisplay
            textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor("#00E676"))
            setBackgroundColor(Color.argb(160, 0, 0, 0))
            setPadding(14, 6, 14, 6)
        }
        hudLayout.addView(evalBadge)

        // Best move text
        val moveText = TextView(this).apply {
            val moveSan = currentBestMove?.let { "${it.from}→${it.to}" } ?: "Best Move"
            text = " $moveSan "
            textSize = 12f
            setTextColor(Color.WHITE)
            setPadding(8, 0, 8, 0)
        }
        hudLayout.addView(moveText)

        // Calibrate Board button (Quickly set position again anytime)
        val calibrateBtn = TextView(this).apply {
            text = " 📐 Set Board "
            textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(Color.parseColor("#38BDF8"))
            setBackgroundColor(Color.argb(100, 3, 105, 161))
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
            setPadding(10, 4, 10, 4)
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
            setPadding(10, 4, 10, 4)
            setOnClickListener {
                stopSelf()
            }
        }
        hudLayout.addView(stopBtn)

        // Draggable touch handling for the HUD pill
        hudLayout.setOnTouchListener(object : View.OnTouchListener {
            private var initialY = 0
            private var initialTouchY = 0f

            override fun onTouch(v: View, event: MotionEvent): Boolean {
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialY = hudParams.y
                        initialTouchY = event.rawY
                        return false // Let child clicks work unless moved
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
                            // Restore full overlay
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
        captureJob = serviceScope.launch {
            val fps = settingsRepository.settings.value.overlayFps.coerceIn(1, 15)
            val delayMs = 1000L / fps

            while (true) {
                try {
                    val res = engine.analyze(
                        position = currentPosition,
                        preset = settingsRepository.settings.value.enginePreset
                    )
                    currentBestMove = res.bestMove
                    currentEvalCp = res.evaluationCp
                    currentEvalDisplay = res.displayScore
                    arrowWindowView?.invalidate()
                } catch (_: Exception) {}
                delay(delayMs)
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isRunning = false
        captureJob?.cancel()
        serviceScope.cancel()

        dismissCalibrationOverlay()
        dismissArrowWindow()
        dismissHudWindow()
        dismissBubbleWindow()
    }
}
