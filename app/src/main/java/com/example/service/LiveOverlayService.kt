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
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
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

    private var fullOverlayView: View? = null
    private var bubbleView: View? = null
    private var isBubbleMode = false

    private val engine = ChessEngine()
    private val gameReconstructor = GameReconstructor()
    private var captureJob: Job? = null
    private lateinit var settingsRepository: SettingsRepository

    private var currentPosition: ChessPosition = ChessPosition.fromFen("r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 5")
    private var currentBestMove: Move? = null
    private var currentEvalCp: Int = 35

    companion object {
        const val ACTION_START = "ACTION_START_OVERLAY"
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
            else -> {
                try {
                    startForeground(NOTIFICATION_ID, buildNotification())
                } catch (e: Exception) {
                    e.printStackTrace()
                }
                isRunning = true
                if (checkOverlayPermission()) {
                    showOverlayWindow()
                }
                startCaptureLoop()
            }
        }
        return START_STICKY
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
                description = "Active screen analysis and best-move overlay"
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

        val switchIntent = Intent(this, LiveOverlayService::class.java).apply { action = ACTION_SWITCH_PROFILE }
        val switchPendingIntent = PendingIntent.getService(
            this, 2, switchIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
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
            .setContentText("Profile: $activeProfile • Drawing best-move arrows live")
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openAppPendingIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .addAction(android.R.drawable.ic_menu_rotate, "Switch Profile", switchPendingIntent)
            .build()
    }

    private fun updateNotification() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun showOverlayWindow() {
        if (fullOverlayView != null) return

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        }

        val layoutParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            layoutType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                    WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                    WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        val root = FrameLayout(this)

        // Custom Canvas for Best-Move Arrow
        val arrowCanvasView = object : View(this) {
            private val shaftPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
            }
            private val outlinePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                strokeCap = Paint.Cap.ROUND
                color = Color.argb(120, 0, 0, 0)
            }
            private val headPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.FILL
            }

            override fun onDraw(canvas: Canvas) {
                super.onDraw(canvas)
                val move = currentBestMove ?: return
                val region = settingsRepository.getSavedBoardRegion() ?: run {
                    val size = (width * 0.85f).coerceAtMost(height * 0.5f)
                    val l = (width - size) / 2f
                    val t = (height - size) / 2f
                    RectF(l, t, l + size, t + size)
                }

                val sqW = region.width() / 8f
                val sqH = region.height() / 8f

                val startX = region.left + (move.from.file + 0.5f) * sqW
                val startY = region.top + (7 - move.from.rank + 0.5f) * sqH
                val endX = region.left + (move.to.file + 0.5f) * sqW
                val endY = region.top + (7 - move.to.rank + 0.5f) * sqH

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

                // Draw black outline
                canvas.drawLine(startX, startY, targetX, targetY, outlinePaint)
                // Draw shaft
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
        root.addView(arrowCanvasView, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

        // Overlay Secondary HUD Bar (Eval Pill + Turn Indicator + Minimize Button)
        val hudLayout = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.argb(220, 15, 23, 42))
            setPadding(24, 16, 24, 16)
        }

        // Minimize Button (Section 4.5: 30x30dp x)
        val minimizeBtn = TextView(this).apply {
            text = "✕"
            textSize = 18f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            setPadding(12, 4, 12, 4)
            setOnClickListener {
                switchToBubbleMode()
            }
        }
        hudLayout.addView(minimizeBtn)

        val turnText = TextView(this).apply {
            text = "  Chess Forge Live • Your move  "
            textSize = 13f
            setTextColor(Color.WHITE)
        }
        hudLayout.addView(turnText)

        val evalBadge = TextView(this).apply {
            text = "+0.35"
            textSize = 13f
            setTextColor(Color.parseColor("#00E676"))
            setBackgroundColor(Color.argb(160, 0, 0, 0))
            setPadding(16, 6, 16, 6)
        }
        hudLayout.addView(evalBadge)

        val hudParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            topMargin = 80
        }
        root.addView(hudLayout, hudParams)

        fullOverlayView = root

        try {
            windowManager?.addView(fullOverlayView, layoutParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun switchToBubbleMode() {
        if (fullOverlayView != null) {
            try { windowManager?.removeView(fullOverlayView) } catch (_: Exception) {}
            fullOverlayView = null
        }
        showFloatingBubble()
        isBubbleMode = true
    }

    private fun showFloatingBubble() {
        if (bubbleView != null) return

        val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        }

        val bubbleSize = (50 * resources.displayMetrics.density).toInt()

        val params = WindowManager.LayoutParams(
            bubbleSize,
            bubbleSize,
            layoutType,
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

        // Draggable touch handling for the floating bubble
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
                        if (dx < 10 && dy < 10) {
                            // Tap to restore full overlay
                            restoreFullOverlay()
                        }
                        return true
                    }
                }
                return false
            }
        })

        bubbleView = bubble
        try {
            windowManager?.addView(bubbleView, params)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun restoreFullOverlay() {
        if (bubbleView != null) {
            try { windowManager?.removeView(bubbleView) } catch (_: Exception) {}
            bubbleView = null
        }
        isBubbleMode = false
        showOverlayWindow()
    }

    private fun startCaptureLoop() {
        captureJob?.cancel()
        captureJob = serviceScope.launch {
            val fps = settingsRepository.settings.value.overlayFps.coerceIn(1, 15)
            val delayMs = 1000L / fps

            while (true) {
                // Periodically update engine suggestion
                try {
                    val res = engine.analyze(
                        position = currentPosition,
                        preset = settingsRepository.settings.value.enginePreset
                    )
                    currentBestMove = res.bestMove
                    currentEvalCp = res.evaluationCp
                    fullOverlayView?.invalidate()
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

        if (fullOverlayView != null) {
            try { windowManager?.removeView(fullOverlayView) } catch (_: Exception) {}
            fullOverlayView = null
        }
        if (bubbleView != null) {
            try { windowManager?.removeView(bubbleView) } catch (_: Exception) {}
            bubbleView = null
        }
    }
}
