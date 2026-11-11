use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(windows)]
fn raise_without_focus(window: &WebviewWindow) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    // Reassert Z order even when Tao's cached ALWAYS_ON_TOP flag is unchanged.
    // Only our window is touched. Do not activate it, move it, resize it or show it.
    let flags = 0x0001 | 0x0002 | 0x0010 | 0x0200; // NOSIZE | NOMOVE | NOACTIVATE | NOOWNERZORDER
    let result = unsafe { SetWindowPos(hwnd.0, -1isize as *mut c_void, 0, 0, 0, 0, flags) };
    if result == 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

pub fn maintain_topmost(app: &AppHandle) {
    #[cfg(windows)]
    if let Some(window) = app.get_webview_window("overlay") {
        if window.is_visible().unwrap_or(false) {
            if let Err(error) = raise_without_focus(&window) {
                eprintln!("Overlay topmost refresh failed: {error}");
            }
        }
    }
}

pub fn start_topmost_maintenance(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(750));
        let handle = app.clone();
        if app
            .run_on_main_thread(move || maintain_topmost(&handle))
            .is_err()
        {
            break;
        }
    });
}

#[tauri::command]
pub async fn configure_overlay(
    app: AppHandle,
    window: WebviewWindow,
    visible: bool,
    locked: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("MAIN_WINDOW_ONLY".into());
    }
    let overlay = match app.get_webview_window("overlay") {
        Some(window) => window,
        None if !visible => return Ok(()),
        None => WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("index.html?overlay=1".into()))
            .title("Kaling Timer Overlay")
            .inner_size(340.0, 410.0)
            .min_inner_size(260.0, 180.0)
            .position(24.0, 80.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(true)
            .focused(false)
            .visible(false)
            .additional_browser_args("--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --autoplay-policy=no-user-gesture-required")
            .build()
            .map_err(|error| error.to_string())?,
    };
    overlay
        .set_ignore_cursor_events(locked)
        .map_err(|error| error.to_string())?;
    let result = if visible {
        overlay.show()
    } else {
        overlay.hide()
    }
    .map_err(|error| error.to_string());
    if result.is_ok() && visible {
        maintain_topmost(&app);
    }
    result
}
