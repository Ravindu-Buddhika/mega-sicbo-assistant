use tauri::{AppHandle, Manager};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![auto_fill_login, browser_nav])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}