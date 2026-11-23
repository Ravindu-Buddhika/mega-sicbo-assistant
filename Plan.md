# Project Blueprint: Mega Sic Bo Pattern Tracker & Hotkey Assistant

## 1. Project Overview
A lightweight, standalone Windows 10 desktop application built with **Tauri (Rust + React/TypeScript)** optimized for low-spec hardware (2nd Gen Intel i3/i5, 8GB RAM, Windows 10). 
The app embeds the 1xBet Mega Sic Bo web interface, monitors the game's "Small/Big" roadmap grid via fast OS-level pixel color sampling, triggers a loud continuous audio ringtone when specific betting patterns occur, and allows the user to place bets via global keyboard hotkeys (`+` for BIG, `-` for SMALL) using OS-level mouse click simulation.

## 2. Target Hardware & Performance Constraints
- **OS:** Windows 10 (64-bit)
- **CPU:** 2nd Gen Intel Core i3/i5 (Strict low CPU overhead required; avoid heavy OCR or ML models).
- **RAM:** 8GB (Keep app footprint under 150MB excluding WebView2).
- **Optimization:** Use lightweight Rust crates (`xcap`, `rodio`, `enigo`, `global-hotkey`) for background processing. Sample specific `(X, Y)` pixel coordinates every 500ms rather than full-screen image processing.

## 3. Core Architecture (Dual-Window / Multi-WebView Tauri Setup)
1. **Main Game Window (`main`):**
   - Loads directly into `https://lk.1x-bet.mobi/en/casino-search?game=56264`.
   - Uses a persistent WebView2 `userDataFolder` so login sessions/cookies survive app restarts.
   - Fixed window resolution (e.g., `1280x720`) to ensure static screen coordinates for UI elements.
2. **Floating Control Overlay Window (`overlay`):**
   - Always-on-top, frameless, compact floating toolbar positioned on the side/top-right of the screen.
   - Controls:
     - `START / STOP` scanning toggle.
     - `Chip Selector`: `[50]`, `[250]`, `[500]`, `[2.5K]`.
     - `Live Status`: Displays current vertical streak, horizontal chop count, and queued bet status.
     - `STOP RING / MUTE` button.
     - `🔑 Auto-Fill Login` button (injects saved credentials if session expires).
     - `⚙ Calibrate` button (allows user to capture/save exact `(X, Y)` coordinates for grid & buttons).

## 4. Screen Regions & Visual Detection Specs (1xBet Pragmatic Play Mega Sic Bo)
- **Roadmap Grid (`Small/Big` tab, bottom-left):**
  - Dimensions: **12 Columns × 6 Rows** (`col: 0..11`, `row: 0..5`).
  - Cell Color Classification (RGB Thresholds):
    - **BIG (`B`):** Gold/Orange circle (High Red & Green, Low Blue).
    - **SMALL (`S`):** White/Light-Grey circle (High R, G, B).
    - **TRIPLE (`T`):** Red circle (High Red, Low Green & Blue).
    - **EMPTY (`E`):** Dark background (Low R, G, B).
- **Betting Phase Detection:**
  - During the active betting countdown (`4, 3, 2, 1...`), the chip row (`50, 250, 500...`) becomes visible/lit below the central white betting board.
  - Outside the betting phase, chips are hidden/disabled.

## 5. Pattern Detection Rules (Rust Engine)
Scan the 12×6 matrix every 500ms. Trigger an alert ONLY when a new result updates the board and matches one of the following:
1. **Vertical Streak (4-in-a-row):**
   - In any single column `c`, rows `0, 1, 2, 3` (or 4 consecutive vertical cells) are all `B` (`[B, B, B, B]`) OR all `S` (`[S, S, S, S]`).
   - Alert BEFORE the 5th drop.
2. **Strict Horizontal Chop (6-in-a-row, Row 0 ONLY):**
   - Across `Row 0` (the top row), results alternate strictly between `B` and `S` for 6 consecutive columns (e.g., `B -> S -> B -> S -> B -> S` or `S -> B -> S -> B -> S -> B`).
   - **CRITICAL RESET RULE:** If ANY column in this sequence drops down to `Row 1` (meaning two identical outcomes occurred consecutively and stacked vertically), the horizontal chop counter MUST immediately reset to `0`.
3. **Triple Detection (`T`):**
   - If the newly landed result anywhere on the grid is `T` (Red circle), trigger an alert immediately.

## 6. Alert & One-Key Auto-Betting Workflow
1. **Alert Trigger:**
   - Play a loud, continuous looping alarm/ringtone (`assets/ringtone.mp3`) via `rodio` until dismissed or a bet is placed.
   - Visually flash the Floating Overlay window with the detected pattern name.
   - Unlock the global betting hotkeys for 15 seconds (Safety Lock prevents accidental clicks during idle time).
2. **Global Hotkeys (`global-hotkey`):**
   - **`NumpadAdd` (`+`) or `RightArrow`:** Select **BIG**.
   - **`NumpadSubtract` (`-`) or `LeftArrow`:** Select **SMALL**.
   - **`Space`:** Mute ringtone / cancel queued bet.
3. **Exact Click Sequence (`enigo` OS Mouse Simulation):**
   - *Note:* In Mega Sic Bo, the user MUST click `BIG` or `SMALL` first before the chip buttons become clickable.
   - **Step 1:** Verify betting phase is active (if user presses `+` or `-` slightly early while dice are rolling, store as `QUEUED_BET` and execute immediately when betting phase opens).
   - **Step 2:** Move cursor and left-click saved `(X, Y)` of **BIG (`11-17`)** or **SMALL (`4-10`)** on the white betting board.
   - **Step 3:** Sleep `150ms`.
   - **Step 4:** Move cursor and left-click saved `(X, Y)` of the pre-selected **Chip (`50`, `250`, `500`, etc.)**.
   - **Step 5:** Stop ringtone, re-lock hotkeys, and reset status.

## 7. Session & Credential Management
- **Session Persistence:** Configure Tauri `WebviewWindow` with a dedicated `data_directory` in local AppData.
- **Credential Vault:** Store encrypted username/password locally (`config.json`). Clicking `Auto-Fill Login` evaluates JS in the main WebView to populate the 1xBet login inputs.

## 8. Rust Crate Dependencies (`src-tauri/Cargo.toml`)
- `tauri` (v2)
- `serde` & `serde_json` (Config & coordinate persistence)
- `xcap` (Fast Windows screen capture)
- `image` (Pixel RGB extraction)
- `rodio` (Continuous audio ringtone playback)
- `enigo` (OS-level mouse movement and clicking)
- `global-hotkey` (System-wide `+` / `-` / `Space` listener)
- `tokio` (Async background scanning loop)