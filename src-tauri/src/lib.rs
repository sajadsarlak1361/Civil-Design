use base64::Engine;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

struct WatchState(Mutex<Option<RecommendedWatcher>>);

static LAUNCH: Mutex<Option<String>> = Mutex::new(None);

fn drawing_arg(args: impl IntoIterator<Item = String>) -> Option<String> {
    let current = std::env::current_exe().ok();
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let path = Path::new(&arg);
        if !path.is_file() {
            continue;
        }
        if current.as_ref().is_some_and(|exe| exe == path) {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|item| item.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext == "exe" || ext == "msi" || ext == "dll" {
            continue;
        }
        return Some(arg);
    }
    None
}

fn remember_launch() {
    let Some(path) = drawing_arg(std::env::args().skip(1)) else {
        return;
    };
    if let Ok(mut slot) = LAUNCH.lock() {
        *slot = Some(path);
    }
}

#[tauri::command]
fn take_launch_path() -> Option<String> {
    LAUNCH.lock().ok().and_then(|mut slot| slot.take())
}

fn standard() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

#[tauri::command]
fn read_bytes(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|err| err.to_string())?;
    Ok(standard().encode(bytes))
}

#[tauri::command]
fn write_bytes(path: String, data: String) -> Result<(), String> {
    let bytes = standard().decode(data).map_err(|err| err.to_string())?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    std::fs::write(path, bytes).map_err(|err| err.to_string())
}

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn watch_xref(app: AppHandle, state: tauri::State<WatchState>, path: String) -> Result<(), String> {
    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
        if let Ok(event) = result {
            if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_)) {
                let changed = event
                    .paths
                    .first()
                    .map(|item| item.to_string_lossy().to_string())
                    .unwrap_or_default();
                let _ = handle.emit("fieldline-xref-changed", changed);
            }
        }
    })
    .map_err(|err| err.to_string())?;
    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|err| err.to_string())?;
    *state.0.lock().map_err(|err| err.to_string())? = Some(watcher);
    Ok(())
}

#[derive(Serialize)]
struct OdaProbe {
    found: bool,
    path: String,
    message: String,
}

fn converter_name() -> &'static str {
    if cfg!(windows) {
        "ODAFileConverter.exe"
    } else {
        "ODAFileConverter"
    }
}

fn allowed_converter(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_ascii_lowercase().contains("odafileconverter"))
        .unwrap_or(false)
}

fn push_converter(dir: &Path, out: &mut Vec<PathBuf>) {
    out.push(dir.join(converter_name()));
    let nested = dir.join("ODAFileConverter").join(converter_name());
    out.push(nested);
    if let Ok(read) = std::fs::read_dir(dir) {
        for entry in read.flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.push(path.join(converter_name()));
            }
        }
    }
}

fn oda_candidates(custom: &str) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !custom.trim().is_empty() {
        out.push(PathBuf::from(custom.trim()));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        push_converter(&PathBuf::from(program_files).join("ODA"), &mut out);
    }
    if let Ok(program_files) = std::env::var("ProgramFiles(x86)") {
        push_converter(&PathBuf::from(program_files).join("ODA"), &mut out);
    }
    push_converter(Path::new(r"C:\Program Files\ODA"), &mut out);
    push_converter(Path::new(r"C:\Program Files (x86)\ODA"), &mut out);
    out.push(PathBuf::from("/usr/bin/ODAFileConverter"));
    out.push(PathBuf::from("/usr/local/bin/ODAFileConverter"));
    out.push(PathBuf::from("/opt/ODAFileConverter/ODAFileConverter"));
    if let Ok(home) = std::env::var("HOME") {
        let root = PathBuf::from(home);
        out.push(root.join(".local/bin/ODAFileConverter"));
        out.push(root.join("ODAFileConverter/ODAFileConverter"));
        if let Ok(read) = std::fs::read_dir(&root) {
            for entry in read.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    let name = path.file_name().and_then(|item| item.to_str()).unwrap_or("");
                    if name.to_ascii_lowercase().contains("oda") {
                        out.push(path.join("ODAFileConverter"));
                    }
                }
            }
        }
    }
    out
}

fn missing_message() -> String {
    "ODA File Converter was not found. Install it, then set its path in DWG Settings. Windows looks in Program Files\\ODA\\ODAFileConverter and in versioned folders next to it. Linux looks at /usr/bin/ODAFileConverter, /usr/local/bin/ODAFileConverter, /opt/ODAFileConverter/ODAFileConverter, and ODAFileConverter under your home directory.".to_string()
}

#[tauri::command]
fn oda_probe(custom: String) -> OdaProbe {
    for candidate in oda_candidates(&custom) {
        if candidate.is_file() && allowed_converter(&candidate) {
            return OdaProbe {
                found: true,
                path: candidate.to_string_lossy().to_string(),
                message: String::new(),
            };
        }
    }
    OdaProbe {
        found: false,
        path: String::new(),
        message: missing_message(),
    }
}

fn safe_name(name: &str, fallback: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|item| item.to_str())
        .unwrap_or(fallback);
    let cleaned: String = base
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() || ch == '.' || ch == '-' || ch == '_' { ch } else { '_' })
        .collect();
    if cleaned.is_empty() { fallback.to_string() } else { cleaned }
}

#[tauri::command]
fn oda_convert(exe: String, name: String, data: String, version: String, output_type: String) -> Result<String, String> {
    let versions = ["ACAD2000", "ACAD2004", "ACAD2007", "ACAD2010", "ACAD2013", "ACAD2018"];
    let kinds = ["DWG", "DXF"];
    if !versions.contains(&version.as_str()) {
        return Err("Choose a DWG version from 2000 through 2018.".to_string());
    }
    let kind = output_type.to_ascii_uppercase();
    if !kinds.contains(&kind.as_str()) {
        return Err("ODA output must be DWG or DXF.".to_string());
    }
    let exe_path = PathBuf::from(&exe);
    if !exe_path.is_file() || !allowed_converter(&exe_path) {
        return Err(missing_message());
    }
    let bytes = standard().decode(data).map_err(|err| err.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|item| item.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("fieldline-oda-{stamp}"));
    let input = root.join("in");
    let output = root.join("out");
    std::fs::create_dir_all(&input).map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&output).map_err(|err| err.to_string())?;
    let file_name = safe_name(&name, if kind == "DXF" { "drawing.dwg" } else { "drawing.dxf" });
    let input_path = input.join(&file_name);
    std::fs::write(&input_path, &bytes).map_err(|err| err.to_string())?;
    let filter = if file_name.to_ascii_lowercase().ends_with(".dxf") { "*.DXF" } else { "*.DWG" };
    let ran = Command::new(&exe_path)
        .arg(input.to_string_lossy().as_ref())
        .arg(output.to_string_lossy().as_ref())
        .arg(&version)
        .arg(&kind)
        .arg("0")
        .arg("1")
        .arg(filter)
        .output()
        .map_err(|err| err.to_string());
    let result = match ran {
        Ok(value) => value,
        Err(err) => {
            let _ = std::fs::remove_dir_all(&root);
            return Err(err);
        }
    };
    let produced = std::fs::read_dir(&output).ok().and_then(|read| {
        read.flatten().find_map(|entry| {
            let path = entry.path();
            let ext = path.extension().and_then(|item| item.to_str()).unwrap_or("").to_ascii_lowercase();
            if path.is_file() && ext == kind.to_ascii_lowercase() {
                std::fs::read(&path).ok()
            } else {
                None
            }
        })
    });
    let _ = std::fs::remove_dir_all(&root);
    let Some(file) = produced else {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let stdout = String::from_utf8_lossy(&result.stdout);
        let detail = if !stderr.trim().is_empty() { stderr } else { stdout };
        return Err(format!("ODA File Converter did not write a {kind} file. {detail}").trim().to_string());
    };
    Ok(standard().encode(file))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    remember_launch();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = drawing_arg(argv) {
                let _ = app.emit("fieldline-open-path", path);
            }
        }))
        .manage(WatchState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_bytes, write_bytes, open_path, watch_xref, oda_probe, oda_convert, take_launch_path])
        .run(tauri::generate_context!())
        .expect("error while running Civil Design");
}
