package com.example.chessoverlay.util

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

object AssetManagerHelper {
    const val EXTENSION_ZIP_ASSET = "chess-forge-browser-extension.zip"
    const val EXTENSION_ENGINE_JS = "extension/chess-engine.js"
    const val EXTENSION_OPENING_BOOK_JS = "extension/opening-book.js"
    const val EXTENSION_SYZYGY_TABLEBASE_JS = "extension/syzygy-tablebase.js"
    const val EXTENSION_CONTENT_JS = "extension/content.js"
    const val PRACTICE_BOARD_URL = "file:///android_asset/practice_board.html"

    fun readAssetText(context: Context, assetPath: String): String {
        return try {
            context.assets.open(assetPath).bufferedReader().use { it.readText() }
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Unable to read asset $assetPath: ${t.message}")
            ""
        }
    }

    fun copyExtensionZipToStream(context: Context, output: OutputStream): Boolean {
        return try {
            context.assets.open(EXTENSION_ZIP_ASSET).use { input ->
                input.copyTo(output)
                output.flush()
            }
            true
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Failed writing extension zip: ${t.message}")
            false
        }
    }

    fun exportExtensionZipToCache(context: Context): File? {
        val dir = File(context.cacheDir, "exports").apply { mkdirs() }
        val outFile = File(dir, EXTENSION_ZIP_ASSET)
        return try {
            context.assets.open(EXTENSION_ZIP_ASSET).use { input ->
                FileOutputStream(outFile).use { out ->
                    input.copyTo(out)
                    out.flush()
                }
            }
            outFile
        } catch (t: Throwable) {
            AppLogger.w(TAG, "Failed caching extension zip: ${t.message}")
            null
        }
    }

    private const val TAG = "AssetManagerHelper"
}
