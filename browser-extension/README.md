# Chess Forge — Browser Extension (Manifest V3)

Self-contained tactical overlay extension for **Lichess.org** and **Chess.com**. Reads pieces directly from the browser DOM, computes top Multi-PV moves locally in JavaScript, and renders click-through SVG arrows and an evaluation bar right above the board.

## Install on Desktop (Chrome / Edge / Brave)
1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `browser-extension/` folder (or drag-and-drop `chess-forge-browser-extension.zip`).

## Install on Android Browsers (Kiwi Browser / Edge Canary)
1. Export `chess-forge-browser-extension.zip` from the Chess Forge app (or GitHub Actions artifacts).
2. Open **Extensions** in Kiwi Browser or Edge Canary.
3. Enable **Developer mode**, tap **+ (from .zip/.crx/.user.js)**, and select `chess-forge-browser-extension.zip`.
4. Open `lichess.org` or `chess.com` — the floating `CF: ON` toggle and SVG move arrows appear automatically.
