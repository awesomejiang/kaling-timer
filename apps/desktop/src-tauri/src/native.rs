use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
#[derive(Default)]
pub struct Speech(pub Mutex<Option<Child>>);
#[cfg(windows)]
fn powershell(mode: &str) -> Command {
    use base64::Engine;
    use std::os::windows::process::CommandExt;
    let bytes: Vec<u8> = include_str!("speech.ps1")
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    let mut command = Command::new("powershell.exe");
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ])
        .env("KALING_MODE", mode)
        .creation_flags(0x08000000);
    command
}
#[tauri::command]
pub fn read_voice_config(path: String) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 1_000_000 {
        return Err("Voice config exceeds 1 MB".into());
    }
    std::io::read_to_string(file).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn save_session(value: String) -> Result<(), String> {
    if value.len() > 4096 {
        return Err("Invalid session".into());
    }
    #[cfg(windows)]
    {
        keyring::Entry::new("Kaling Timer", "reconnect")
            .map_err(|e| e.to_string())?
            .set_password(&value)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = value;
        Err("Secure reconnect storage requires Windows".into())
    }
}
#[tauri::command]
pub fn load_session() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        match keyring::Entry::new("Kaling Timer", "reconnect")
            .map_err(|e| e.to_string())?
            .get_password()
        {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}
#[tauri::command]
pub fn clear_session() -> Result<(), String> {
    #[cfg(windows)]
    match keyring::Entry::new("Kaling Timer", "reconnect")
        .map_err(|error| error.to_string())?
        .delete_credential()
    {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
    #[cfg(not(windows))]
    Ok(())
}
#[tauri::command]
pub async fn prepare_clips(
    texts: HashMap<String, String>,
) -> Result<HashMap<String, String>, String> {
    if texts.len() > 100 || texts.values().any(|v| v.len() > 200) {
        return Err("Invalid audio request".into());
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut child = powershell("clips")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;
            child
                .stdin
                .take()
                .ok_or("Audio process stdin unavailable")?
                .write_all(
                    serde_json::to_string(&texts)
                        .map_err(|e| e.to_string())?
                        .as_bytes(),
                )
                .map_err(|e| e.to_string())?;
            let output = child.wait_with_output().map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
            serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = texts;
        Err("Offline speech clips require Windows".into())
    }
}
#[tauri::command]
pub fn stop_speech(state: tauri::State<'_, Speech>) -> Result<(), String> {
    if let Some(mut child) = state.0.lock().map_err(|e| e.to_string())?.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
#[tauri::command]
pub fn start_speech(
    app: tauri::AppHandle,
    state: tauri::State<'_, Speech>,
    phrases: Vec<String>,
    session_id: String,
) -> Result<(), String> {
    if phrases.is_empty() || phrases.len() > 100_000 || phrases.iter().any(|p| p.len() > 240) {
        return Err("Invalid speech grammar".into());
    }
    stop_speech(state.clone())?;
    #[cfg(windows)]
    {
        let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("speech-grammar.json");
        std::fs::write(
            &path,
            serde_json::to_vec(&phrases).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut child = powershell("recognize")
            .env("KALING_GRAMMAR", path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let stdout = child.stdout.take().ok_or("Speech stdout unavailable")?;
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&line) {
                    value["sessionId"] = serde_json::json!(session_id);
                    let _ = app.emit("speech:event", value);
                }
            }
            let _ = app.emit("speech:event", serde_json::json!({"kind":"error","message":"Offline recognizer stopped","sessionId":session_id}));
        });
        *state.0.lock().map_err(|e| e.to_string())? = Some(child);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, phrases, session_id);
        Err("Offline speech recognition requires Windows".into())
    }
}
#[tauri::command]
pub async fn speech_pcm(state: tauri::State<'_, Speech>, samples: Vec<i16>) -> Result<(), String> {
    if samples.len() > 3200 {
        return Err("Audio chunk too large".into());
    }
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let child = guard.as_mut().ok_or("Speech is not running")?;
    let input = child.stdin.as_mut().ok_or("Speech input is closed")?;
    let data: Vec<u8> = samples.iter().flat_map(|v| v.to_le_bytes()).collect();
    input.write_all(&data).map_err(|e| e.to_string())
}
