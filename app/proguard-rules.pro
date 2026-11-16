# Keep chesslib
-keep class com.github.bhlangonijr.chesslib.** { *; }
-dontwarn com.github.bhlangonijr.chesslib.**

# Keep WebView JS Bridge
-keepclassmembers class com.example.chessoverlay.ui.ChessForgeWebBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Strip verbose debug logs in release builds
-assumenosideeffects class android.util.Log {
    public static int v(...);
    public static int d(...);
    public static int i(...);
}
