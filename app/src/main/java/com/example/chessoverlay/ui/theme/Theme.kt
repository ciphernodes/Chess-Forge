package com.example.chessoverlay.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val ChessForgeDarkScheme = darkColorScheme(
    primary = TacticalEmerald,
    onPrimary = Color(0xFF042F2E),
    primaryContainer = TacticalEmeraldDark,
    onPrimaryContainer = Color(0xFFA7F3D0),
    secondary = TacticalAmber,
    onSecondary = Color(0xFF451A03),
    secondaryContainer = TacticalAmberDark,
    onSecondaryContainer = Color(0xFFFEF3C7),
    error = TacticalRed,
    onError = Color.White,
    background = ObsidianBg,
    onBackground = TextPrimary,
    surface = CarbonSurface,
    onSurface = TextPrimary,
    surfaceVariant = CarbonSurfaceHigh,
    onSurfaceVariant = TextSecondary,
    outline = HairlineBorder
)

@Composable
fun ChessForgeTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = ChessForgeDarkScheme,
        typography = ChessForgeTypography,
        content = content
    )
}
