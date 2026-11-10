#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod native;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};
fn main() {
    let app = tauri::Builder::default()
        .manage(native::Speech::default())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            native::read_voice_config,
            native::save_session,
            native::load_session,
            native::prepare_clips,
            native::start_speech,
            native::stop_speech,
            native::speech_pcm
        ])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示 Kaling Timer", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let pixels: Vec<u8> = (0..32 * 32)
                .flat_map(|i| {
                    if i % 32 > 8 && i % 32 < 24 {
                        [90, 190, 220, 255]
                    } else {
                        [20, 28, 44, 255]
                    }
                })
                .collect();
            TrayIconBuilder::new()
                .icon(tauri::image::Image::new_owned(pixels, 32, 32))
                .tooltip("Kaling Timer")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Kaling Timer");
    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            let _ = native::stop_speech(handle.state::<native::Speech>());
        }
    });
}
