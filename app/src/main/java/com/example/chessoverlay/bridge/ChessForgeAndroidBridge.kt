package com.example.chessoverlay.bridge

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.graphics.Path
import android.view.accessibility.AccessibilityEvent
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import com.example.chessoverlay.model.AndroidOverlayRuntimeMode
import com.example.chessoverlay.model.FairPlayRiskLevel
import com.example.chessoverlay.model.FairPlayTelemetryModel
import com.example.chessoverlay.util.AppLogger
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.util.concurrent.atomic.AtomicReference

data class KinematicWaypoint(
    val x: Float,
    val y: Float,
    val timestampOffsetMs: Long = 0L
)

data class KinematicPathPayload(
    val mode: String = "drag",
    val durationMs: Long = 220L,
    val waypoints: List<KinematicWaypoint> = emptyList(),
    val viewportScale: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f
)

fun interface GestureStrokeExecutor {
    fun dispatch(gesture: GestureDescription): Boolean
}

object AccessibilityServiceRegistry {
    private val serviceRef = AtomicReference<WeakReference<AccessibilityService>?>(null)

    fun register(service: AccessibilityService) {
        serviceRef.set(WeakReference(service))
    }

    fun unregister(service: AccessibilityService) {
        val current = serviceRef.get()?.get()
        if (current == null || current === service) {
            serviceRef.set(null)
        }
    }

    fun getBoundService(): AccessibilityService? = serviceRef.get()?.get()
}

class ChessForgeAccessibilityService : AccessibilityService() {

    override fun onServiceConnected() {
        super.onServiceConnected()
        AccessibilityServiceRegistry.register(this)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Passive listener; gestures are only stroked on explicit user opt-in dispatch.
    }

    override fun onInterrupt() {
        // Required AccessibilityService lifecycle override.
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        AccessibilityServiceRegistry.unregister(this)
        return super.onUnbind(intent)
    }
}

/**
 * Strokes Bézier paths forwarded from TypeScript over `AccessibilityService.dispatchGesture`.
 * Defaults to `enabled = false` (explicit opt-in).
 */
class AccessibilityDispatcher(
    @Volatile var enabled: Boolean = false,
    private val executorProvider: () -> GestureStrokeExecutor? = {
        AccessibilityServiceRegistry.getBoundService()?.let { svc ->
            GestureStrokeExecutor { gesture ->
                svc.dispatchGesture(gesture, null, null)
            }
        }
    }
) {
    fun isServiceBound(): Boolean = executorProvider() != null

    fun parseKinematicPayload(rawJson: String): KinematicPathPayload? {
        if (rawJson.isBlank()) return null
        return try {
            val root = JSONObject(rawJson)
            val wpArr = root.optJSONArray("waypoints") ?: return null
            val waypoints = buildList {
                for (i in 0 until wpArr.length()) {
                    val obj = wpArr.optJSONObject(i) ?: continue
                    val x = obj.optDouble("x", Double.NaN).toFloat()
                    val y = obj.optDouble("y", Double.NaN).toFloat()
                    if (!x.isFinite() || !y.isFinite()) continue
                    add(
                        KinematicWaypoint(
                            x = x,
                            y = y,
                            timestampOffsetMs = obj.optLong("timestampOffsetMs", 0L).coerceAtLeast(0L)
                        )
                    )
                }
            }
            if (waypoints.isEmpty()) return null
            KinematicPathPayload(
                mode = root.optString("mode", "drag"),
                durationMs = root.optLong("durationMs", 220L).coerceIn(25L, 4000L),
                waypoints = waypoints,
                viewportScale = root.optDouble("viewportScale", 1.0).toFloat()
                    .let { if (it.isFinite() && it > 0f) it else 1f },
                offsetX = root.optDouble("offsetX", 0.0).toFloat()
                    .let { if (it.isFinite()) it else 0f },
                offsetY = root.optDouble("offsetY", 0.0).toFloat()
                    .let { if (it.isFinite()) it else 0f }
            )
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Failed parsing kinematic path JSON: ${t.message}")
            null
        }
    }

    fun buildGestureDescription(payload: KinematicPathPayload): GestureDescription? {
        if (payload.waypoints.isEmpty()) return null
        val scale = payload.viewportScale
        val path = Path()
        val first = payload.waypoints.first()
        val startX = (first.x * scale + payload.offsetX).coerceAtLeast(0f)
        val startY = (first.y * scale + payload.offsetY).coerceAtLeast(0f)
        path.moveTo(startX, startY)

        if (payload.mode == "click" || payload.waypoints.size == 1) {
            path.lineTo(startX + 0.5f, startY + 0.5f)
            val clickDuration = payload.durationMs.coerceIn(25L, 250L)
            val stroke = GestureDescription.StrokeDescription(path, 0L, clickDuration)
            return GestureDescription.Builder().addStroke(stroke).build()
        }

        for (i in 1 until payload.waypoints.size) {
            val wp = payload.waypoints[i]
            val sx = (wp.x * scale + payload.offsetX).coerceAtLeast(0f)
            val sy = (wp.y * scale + payload.offsetY).coerceAtLeast(0f)
            path.lineTo(sx, sy)
        }

        val lastOffset = payload.waypoints.last().timestampOffsetMs
        val rawDuration = if (lastOffset > 0L) lastOffset else payload.durationMs
        val maxStrokeMs = GestureDescription.getMaxGestureDuration().coerceAtLeast(1000L)
        val boundedDuration = rawDuration.coerceIn(40L, maxStrokeMs)

        val stroke = GestureDescription.StrokeDescription(path, 0L, boundedDuration)
        return GestureDescription.Builder().addStroke(stroke).build()
    }

    fun dispatchPathJson(rawJson: String): Boolean {
        if (!enabled) return false
        val payload = parseKinematicPayload(rawJson) ?: return false
        val gesture = buildGestureDescription(payload) ?: return false
        val executor = executorProvider() ?: return false
        return try {
            executor.dispatch(gesture)
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Accessibility GestureDescription dispatch failed: ${t.message}")
            false
        }
    }

    companion object {
        private const val TAG = "AccessibilityDispatcher"
    }
}

object FairPlayTelemetryParser {
    fun parse(rawJson: String, fallbackBaselineElo: Int = 1500): FairPlayTelemetryModel? {
        if (rawJson.isBlank()) return null
        return try {
            val root = JSONObject(rawJson)
            val fpObj = root.optJSONObject("fairPlay") ?: root
            val warnings = parseWarnings(fpObj.optJSONArray("warnings"))
            val baseline = fpObj.optInt("baselineElo", fallbackBaselineElo)
            val observedIpr = fpObj.optInt("observedIpr", baseline)
            val spikes = if (fpObj.has("currentGameSiSpikes")) {
                fpObj.optInt("currentGameSiSpikes", 0)
            } else {
                fpObj.optInt("siSpikes", 0)
            }
            val lastSi = if (fpObj.has("lastSiScore")) {
                fpObj.optDouble("lastSiScore", 0.0).toFloat()
            } else {
                fpObj.optDouble("siScore", 0.0).toFloat()
            }
            val lockoutReason = fpObj.optString("lockoutReason", "").takeIf { it.isNotBlank() }

            FairPlayTelemetryModel(
                riskLevel = FairPlayRiskLevel.fromKey(fpObj.optString("riskLevel", "SAFE")),
                lockedOut = fpObj.optBoolean("lockedOut", false),
                lockoutReason = lockoutReason,
                baselineElo = baseline,
                observedIpr = observedIpr,
                zScore = fpObj.optDouble("zScore", 0.0).toFloat(),
                currentGameMoves = fpObj.optInt("currentGameMoves", 0),
                currentGameSiSpikes = spikes,
                lastSiScore = lastSi,
                slidingWindowGames = fpObj.optInt("slidingWindowGames", 0),
                acpl = fpObj.optDouble("acpl", 0.0).toFloat(),
                warnings = warnings,
                updatedAtMs = fpObj.optLong("updatedAtMs", System.currentTimeMillis())
            )
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Failed parsing FairPlayTelemetryModel JSON: ${t.message}")
            null
        }
    }

    private fun parseWarnings(arr: JSONArray?): List<String> {
        if (arr == null) return emptyList()
        return buildList {
            for (i in 0 until arr.length()) {
                val item = arr.opt(i)
                when (item) {
                    is JSONObject -> {
                        val msg = item.optString("message", "")
                        if (msg.isNotBlank()) add(msg)
                    }
                    is String -> if (item.isNotBlank()) add(item)
                }
            }
        }
    }

    private const val TAG = "FairPlayTelemetryParser"
}

/**
 * WebView compatibility helpers (matching Chrome for Android User-Agent and
 * `chrome.runtime` / `chrome.storage` polyfills) used when WebView Compat mode runs.
 * Standard runtime defaults to `AndroidOverlayRuntimeMode.NATIVE_ACCESSIBILITY_OVERLAY`.
 */
object WebViewCompatHelper {
    const val CHROME_ANDROID_USER_AGENT: String =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"

    @SuppressLint("SetJavaScriptEnabled")
    fun configureCompatibleWebSettings(
        settings: WebSettings,
        applyChromeAndroidUserAgent: Boolean = true
    ) {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        if (applyChromeAndroidUserAgent) {
            settings.userAgentString = CHROME_ANDROID_USER_AGENT
        }
    }

    /**
     * Injects minimal MV3 `chrome.runtime` and `chrome.storage` (`local`/`sync`) polyfills
     * for embedded WebView sessions while keeping existing `chrome` globals intact.
     */
    fun buildChromeRuntimeStoragePolyfillJs(): String = """
        (function() {
          if (typeof window === "undefined") return;
          var root = (window.chrome = window.chrome || {});
          if (!root.runtime) {
            var listeners = [];
            root.runtime = {
              id: "chessforge-webview-compat",
              lastError: null,
              getURL: function(path) {
                var clean = String(path || "").replace(/^\/+/, "");
                return "file:///android_asset/extension/" + clean;
              },
              sendMessage: function(msg, cb) {
                if (typeof cb === "function") {
                  try { cb({ ok: true, webviewCompat: true, echo: msg }); } catch (_) {}
                }
                return Promise.resolve({ ok: true, webviewCompat: true, echo: msg });
              },
              onMessage: {
                addListener: function(fn) {
                  if (typeof fn === "function" && listeners.indexOf(fn) === -1) listeners.push(fn);
                },
                removeListener: function(fn) {
                  var idx = listeners.indexOf(fn);
                  if (idx !== -1) listeners.splice(idx, 1);
                },
                hasListener: function(fn) { return listeners.indexOf(fn) !== -1; }
              }
            };
          }
          if (!root.storage) {
            var createArea = function(prefix) {
              var mem = {};
              return {
                get: function(keys, cb) {
                  var out = {};
                  var list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : keys && typeof keys === "object" ? Object.keys(keys) : Object.keys(mem);
                  for (var i = 0; i < list.length; i++) {
                    var k = list[i];
                    var val = mem.hasOwnProperty(k) ? mem[k] : undefined;
                    if (val === undefined && typeof window.localStorage !== "undefined") {
                      try {
                        var raw = window.localStorage.getItem(prefix + k);
                        if (raw !== null) val = JSON.parse(raw);
                      } catch (_) {}
                    }
                    if (val !== undefined) out[k] = val;
                    else if (keys && typeof keys === "object" && !Array.isArray(keys) && keys.hasOwnProperty(k)) out[k] = keys[k];
                  }
                  if (typeof cb === "function") cb(out);
                  return Promise.resolve(out);
                },
                set: function(items, cb) {
                  if (items && typeof items === "object") {
                    var ks = Object.keys(items);
                    for (var i = 0; i < ks.length; i++) {
                      var k = ks[i];
                      mem[k] = items[k];
                      if (typeof window.localStorage !== "undefined") {
                        try { window.localStorage.setItem(prefix + k, JSON.stringify(items[k])); } catch (_) {}
                      }
                    }
                  }
                  if (typeof cb === "function") cb();
                  return Promise.resolve();
                },
                remove: function(keys, cb) {
                  var list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : [];
                  for (var i = 0; i < list.length; i++) {
                    delete mem[list[i]];
                    if (typeof window.localStorage !== "undefined") {
                      try { window.localStorage.removeItem(prefix + list[i]); } catch (_) {}
                    }
                  }
                  if (typeof cb === "function") cb();
                  return Promise.resolve();
                },
                clear: function(cb) {
                  mem = {};
                  if (typeof cb === "function") cb();
                  return Promise.resolve();
                }
              };
            };
            root.storage = {
              local: createArea("cf_wv_local_"),
              sync: createArea("cf_wv_sync_")
            };
          }
        })();
    """.trimIndent()
}

/**
 * Android companion JavascriptInterface bridge connecting WebView/TypeScript analysis,
 * FairPlay telemetry auditing, and opt-in `AccessibilityDispatcher` trajectory execution.
 */
class ChessForgeAndroidBridge(
    private val onAnalysisUpdateJson: (String) -> Unit,
    private val onFairPlayTelemetryParsed: (FairPlayTelemetryModel) -> Unit = {},
    val accessibilityDispatcher: AccessibilityDispatcher = AccessibilityDispatcher(enabled = false),
    private val runtimeModeProvider: () -> AndroidOverlayRuntimeMode = {
        AndroidOverlayRuntimeMode.NATIVE_ACCESSIBILITY_OVERLAY
    },
    private val fallbackBaselineEloProvider: () -> Int = { 1500 }
) {
    @JavascriptInterface
    fun onAnalysisUpdate(json: String) {
        onAnalysisUpdateJson(json)
        FairPlayTelemetryParser.parse(json, fallbackBaselineEloProvider())?.let { telemetry ->
            if (json.contains("\"fairPlay\"")) {
                onFairPlayTelemetryParsed(telemetry)
            }
        }
    }

    @JavascriptInterface
    fun onFairPlayTelemetry(json: String) {
        val model = FairPlayTelemetryParser.parse(json, fallbackBaselineEloProvider()) ?: return
        onFairPlayTelemetryParsed(model)
    }

    @JavascriptInterface
    fun dispatchKinematicPath(json: String): Boolean {
        return accessibilityDispatcher.dispatchPathJson(json)
    }

    @JavascriptInterface
    fun getRuntimeCapabilitiesJson(): String {
        val mode = runtimeModeProvider()
        return JSONObject()
            .put("runtimeMode", mode.key)
            .put("accessibilityEnabled", accessibilityDispatcher.enabled)
            .put("accessibilityServiceBound", accessibilityDispatcher.isServiceBound())
            .toString()
    }
}
