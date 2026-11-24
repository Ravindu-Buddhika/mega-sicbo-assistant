use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use global_hotkey::{
    hotkey::{Code, HotKey},
    GlobalHotKeyEvent, GlobalHotKeyManager, HotKeyState,
};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::sleep;
use xcap::Monitor;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Point {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CalibrationConfig {
    pub grid_top_left: Point,     // Roadmap Col 1, Row 1 center
    pub grid_bottom_right: Point, // Roadmap Col 19, Row 6 center
    pub btn_big: Point,           // BIG (11-17) white box
    pub btn_small: Point,         // SMALL (4-10) white box
    pub chip_50: Point,
    pub chip_250: Point,
    pub chip_500: Point,
    pub chip_2500: Point,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanStatus {
    pub vertical_streak: usize,
    pub vertical_type: String,
    pub horizontal_chop: usize,
    pub alert_triggered: bool,
    pub alert_reason: String,
    pub last_cell: String,
}

pub struct AppState {
    pub is_scanning: Arc<Mutex<bool>>,
    pub alert_active: Arc<Mutex<bool>>,
    pub selected_chip: Arc<Mutex<i32>>,
    pub config: Arc<Mutex<CalibrationConfig>>,
}

#[tauri::command]
fn get_mouse_position() -> Result<Point, String> {
    let enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    let (x, y) = enigo.location().map_err(|e| e.to_string())?;
    Ok(Point { x, y })
}

#[tauri::command]
fn save_calibration(state: State<'_, AppState>, config: CalibrationConfig) -> Result<(), String> {
    let mut cfg = state.config.lock().unwrap();
    *cfg = config;
    Ok(())
}

#[tauri::command]
fn set_selected_chip(state: State<'_, AppState>, chip: i32) {
    let mut c = state.selected_chip.lock().unwrap();
    *c = chip;
}

#[tauri::command]
fn dismiss_alert(state: State<'_, AppState>) {
    let mut active = state.alert_active.lock().unwrap();
    *active = false;
}

#[tauri::command]
fn browser_nav(app: AppHandle, action: String) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let js = match action.as_str() {
            "back" => "window.history.back();",
            "forward" => "window.history.forward();",
            "reload" => "window.location.reload();",
            "home" => "window.location.href = 'https://lk.1x-bet.mobi/en/casino-search?game=56264';",
            _ => return Err("Unknown action".into()),
        };
        main_win.eval(js).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Main window not found".into())
    }
}

#[tauri::command]
fn auto_fill_login(app: AppHandle, username: String, password: String) -> Result<String, String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let js_code = format!(
            r#"
            (function() {{
                const inputs = document.querySelectorAll('input');
                let userFilled = false;
                let passFilled = false;
                inputs.forEach(input => {{
                    if ((input.type === 'text' || input.type === 'email' || input.type === 'tel') && !userFilled && input.offsetParent !== null) {{
                        input.value = "{}";
                        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        userFilled = true;
                    }}
                    if (input.type === 'password' && !passFilled && input.offsetParent !== null) {{
                        input.value = "{}";
                        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        passFilled = true;
                    }}
                }});
            }})();
            "#,
            username.replace('"', "\\\""),
            password.replace('"', "\\\"")
        );
        main_win.eval(&js_code).map_err(|e| e.to_string())?;
        Ok("Credentials injected".into())
    } else {
        Err("Main game window not found".into())
    }
}

// Sample a 9x9 area around (cx, cy) to reliably detect Gold ('B'), White ('S'), and Red ('T')
fn classify_cell_area(img: &image::RgbaImage, cx: i32, cy: i32) -> char {
    let mut b_votes = 0;
    let mut s_votes = 0;
    let mut t_votes = 0;

    for dx in -4..=4 {
        for dy in -4..=4 {
            let px = cx + dx;
            let py = cy + dy;
            if px >= 0 && py >= 0 && (px as u32) < img.width() && (py as u32) < img.height() {
                let p = img.get_pixel(px as u32, py as u32);
                let (r, g, b) = (p[0] as i32, p[1] as i32, p[2] as i32);

                // White circle -> SMALL ('S'): R, G, B are all bright and close to each other
                if r > 180 && g > 180 && b > 180 && (r - b).abs() < 35 {
                    s_votes += 1;
                }
                // Gold/Yellow circle -> BIG ('B'): High R & G, significantly lower Blue
                else if r > 160 && g > 110 && (r - b) >= 40 && (g - b) >= 20 {
                    b_votes += 1;
                }
                // Red circle -> TRIPLE ('T'): High R, much lower G & B
                else if r > 155 && (r - g) >= 65 && (r - b) >= 65 {
                    t_votes += 1;
                }
            }
        }
    }

    if t_votes >= 5 {
        'T'
    } else if b_votes >= 5 && b_votes >= s_votes {
        'B'
    } else if s_votes >= 5 {
        'S'
    } else {
        'E'
    }
}

// Analyze 19x6 matrix from the rightmost column backwards
fn evaluate_patterns(grid: &[[char; 6]; 19]) -> (usize, String, usize, bool, String, String) {
    let mut max_vert = 0;
    let mut vert_type = String::from("-");
    let mut horiz_chop = 0;
    let mut last_cell = String::from("-");
    let mut alert = false;
    let mut reason = String::new();

    // Find the rightmost populated column (0..18)
    let mut last_col: Option<usize> = None;
    for c in (0..19).rev() {
        if grid[c][0] != 'E' {
            last_col = Some(c);
            break;
        }
    }

    if let Some(lc) = last_col {
        // 1. Last Drop: Lowest populated cell in the rightmost column
        for r in (0..6).rev() {
            if grid[lc][r] != 'E' {
                last_cell = grid[lc][r].to_string();
                break;
            }
        }

        // 2. Triple ('T') Check on the latest drop
        if last_cell == "T" {
            alert = true;
            reason = "TRIPLE (T) DETECTED!".into();
        }

        // 3. Vertical 4 Check: ONLY check the rightmost vertical column
        let top_char = grid[lc][0];
        if top_char == 'B' || top_char == 'S' {
            let mut count = 0;
            for r in 0..6 {
                if grid[lc][r] == top_char {
                    count += 1;
                } else {
                    break;
                }
            }
            max_vert = count;
            vert_type = top_char.to_string();
            if count >= 4 && !alert {
                alert = true;
                reason = format!(
                    "4x VERTICAL {} STREAK!",
                    if top_char == 'B' { "BIG" } else { "SMALL" }
                );
            }
        }

        // 4. Horizontal Chop 6: Scan backwards (Right -> Left) from rightmost column along Row 0
        // Stop immediately if any column went down to Row 1, is 'T', or repeats the same color!
        let mut chop_count = 0;
        let mut expected_char: Option<char> = None;

        for c in (0..=lc).rev() {
            let r0 = grid[c][0];
            let r1 = grid[c][1];

            if (r0 != 'B' && r0 != 'S') || r1 != 'E' {
                break;
            }

            if let Some(exp) = expected_char {
                if r0 == exp {
                    chop_count += 1;
                    expected_char = Some(if r0 == 'B' { 'S' } else { 'B' });
                } else {
                    break;
                }
            } else {
                chop_count = 1;
                expected_char = Some(if r0 == 'B' { 'S' } else { 'B' });
            }
        }
        horiz_chop = chop_count;

        if horiz_chop >= 6 && !alert {
            alert = true;
            reason = "6x STRICT HORIZONTAL CHOP!".into();
        }
    }

    (max_vert, vert_type, horiz_chop, alert, reason, last_cell)
}

// Executes exact Mega Sic Bo click order: BIG/SMALL first -> 150ms delay -> Chip
fn execute_bet_click(cfg: &CalibrationConfig, is_big: bool, chip_val: i32) {
    let target_box = if is_big { &cfg.btn_big } else { &cfg.btn_small };
    let target_chip = match chip_val {
        250 => &cfg.chip_250,
        500 => &cfg.chip_500,
        2500 => &cfg.chip_2500,
        _ => &cfg.chip_50,
    };

    if target_box.x == 0 || target_chip.x == 0 {
        return;
    }

    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        // 1. Click BIG or SMALL box first so chips become clickable
        let _ = enigo.move_mouse(target_box.x, target_box.y, Coordinate::Abs);
        std::thread::sleep(Duration::from_millis(40));
        let _ = enigo.button(Button::Left, Direction::Click);

        // 2. Wait 150ms for UI chips to activate, then click selected chip
        std::thread::sleep(Duration::from_millis(150));
        let _ = enigo.move_mouse(target_chip.x, target_chip.y, Coordinate::Abs);
        std::thread::sleep(Duration::from_millis(40));
        let _ = enigo.button(Button::Left, Direction::Click);
    }
}

#[tauri::command]
async fn toggle_scanning(
    app: AppHandle,
    state: State<'_, AppState>,
    start: bool,
) -> Result<bool, String> {
    {
        let mut scanning = state.is_scanning.lock().unwrap();
        *scanning = start;
    }

    if start {
        let is_scanning = state.is_scanning.clone();
        let alert_active = state.alert_active.clone();
        let config = state.config.clone();

        tokio::spawn(async move {
            let mut last_snapshot = [['E'; 6]; 19];

            while *is_scanning.lock().unwrap() {
                let cfg = config.lock().unwrap().clone();

                if cfg.grid_bottom_right.x > cfg.grid_top_left.x
                    && cfg.grid_bottom_right.y > cfg.grid_top_left.y
                {
                    if let Ok(monitors) = Monitor::all() {
                        if let Some(primary) = monitors.into_iter().next() {
                            if let Ok(img) = primary.capture_image() {
                                let mut grid = [['E'; 6]; 19];
                                let dx = (cfg.grid_bottom_right.x - cfg.grid_top_left.x) as f32 / 18.0;
                                let dy = (cfg.grid_bottom_right.y - cfg.grid_top_left.y) as f32 / 5.0;

                                for c in 0..19 {
                                    for r in 0..6 {
                                        let px = (cfg.grid_top_left.x as f32 + c as f32 * dx).round() as i32;
                                        let py = (cfg.grid_top_left.y as f32 + r as f32 * dy).round() as i32;
                                        grid[c][r] = classify_cell_area(&img, px, py);
                                    }
                                }

                                if grid != last_snapshot {
                                    last_snapshot = grid;
                                    let (v_streak, v_type, h_chop, alert, reason, last_cell) =
                                        evaluate_patterns(&grid);

                                    if alert {
                                        *alert_active.lock().unwrap() = true;
                                    }

                                    let status = ScanStatus {
                                        vertical_streak: v_streak,
                                        vertical_type: v_type,
                                        horizontal_chop: h_chop,
                                        alert_triggered: alert,
                                        alert_reason: reason,
                                        last_cell,
                                    };
                                    let _ = app.emit("scan-update", status);
                                }
                            }
                        }
                    }
                }
                sleep(Duration::from_millis(500)).await;
            }
        });
    }

    Ok(start)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let alert_active = Arc::new(Mutex::new(false));
    let selected_chip = Arc::new(Mutex::new(50));
    let config = Arc::new(Mutex::new(CalibrationConfig::default()));

    let alert_clone = alert_active.clone();
    let chip_clone = selected_chip.clone();
    let cfg_clone = config.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            is_scanning: Arc::new(Mutex::new(false)),
            alert_active,
            selected_chip,
            config,
        })
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // Register Global Hotkeys: NumpadAdd / Equal (+) = BIG, NumpadSubtract / Minus (-) = SMALL, Space = Mute
            std::thread::spawn(move || {
                let manager = GlobalHotKeyManager::new().expect("Failed to init hotkey manager");
                let hk_big_num = HotKey::new(None, Code::NumpadAdd);
                let hk_big_eq = HotKey::new(None, Code::Equal);
                let hk_small_num = HotKey::new(None, Code::NumpadSubtract);
                let hk_small_min = HotKey::new(None, Code::Minus);
                let hk_mute = HotKey::new(None, Code::Space);

                let _ = manager.register(hk_big_num);
                let _ = manager.register(hk_big_eq);
                let _ = manager.register(hk_small_num);
                let _ = manager.register(hk_small_min);
                let _ = manager.register(hk_mute);

                let receiver = GlobalHotKeyEvent::receiver();
                while let Ok(event) = receiver.recv() {
                    if event.state == HotKeyState::Pressed {
                        let is_alert = *alert_clone.lock().unwrap();

                        if event.id == hk_mute.id() {
                            *alert_clone.lock().unwrap() = false;
                            let _ = app_handle.emit("stop-ringing", ());
                        } else if is_alert
                            && (event.id == hk_big_num.id() || event.id == hk_big_eq.id())
                        {
                            *alert_clone.lock().unwrap() = false;
                            let _ = app_handle.emit("bet-placed", "BIG");
                            let cfg = cfg_clone.lock().unwrap().clone();
                            let chip = *chip_clone.lock().unwrap();
                            execute_bet_click(&cfg, true, chip);
                        } else if is_alert
                            && (event.id == hk_small_num.id() || event.id == hk_small_min.id())
                        {
                            *alert_clone.lock().unwrap() = false;
                            let _ = app_handle.emit("bet-placed", "SMALL");
                            let cfg = cfg_clone.lock().unwrap().clone();
                            let chip = *chip_clone.lock().unwrap();
                            execute_bet_click(&cfg, false, chip);
                        }
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auto_fill_login,
            browser_nav,
            get_mouse_position,
            save_calibration,
            set_selected_chip,
            dismiss_alert,
            toggle_scanning
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}