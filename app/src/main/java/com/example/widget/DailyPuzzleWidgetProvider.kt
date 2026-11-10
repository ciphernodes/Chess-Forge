package com.example.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.example.MainActivity
import com.example.R

class DailyPuzzleWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (appWidgetId in appWidgetIds) {
            val intent = Intent(context, MainActivity::class.java).apply {
                putExtra("SHORTCUT_DESTINATION", "PUZZLES")
            }
            val pendingIntent = PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val views = RemoteViews(context.packageName, R.layout.widget_daily_puzzle).apply {
                setOnClickPendingIntent(R.id.widget_container, pendingIntent)
                setTextViewText(R.id.widget_title, "Chess Forge Daily")
                setTextViewText(R.id.widget_subtitle, "Tap to solve today's tactical puzzle")
                setTextViewText(R.id.widget_rating, "Rating: 1200")
            }

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
