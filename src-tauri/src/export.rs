//! Notes out of the app: files land in Downloads under a name that never overwrites (`save_export`),
//! the toast's Show and Open go through `reveal_export` / `open_export`, which only touch files in
//! Downloads. PDF on Windows is WebView2's PrintToPdf of the page's print view (app.js printNote
//! fills #printArea and sets html.printing first); macOS prints through the native dialog.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, WebviewWindow};

type CmdResult<T> = Result<T, String>;

const KINDS: [&str; 7] = ["md", "txt", "html", "docx", "pdf", "zip", "json"];

fn downloads(app: &AppHandle) -> CmdResult<PathBuf> {
    let p = app.path();
    p.download_dir()
        .or_else(|_| p.document_dir())
        .or_else(|_| p.home_dir())
        .map_err(|e| e.to_string())
}

/// A file name that's safe on every system, with one of the kinds above.
fn clean_name(name: &str) -> CmdResult<(String, String)> {
    let (stem, ext) = name.rsplit_once('.').ok_or("the file needs an extension")?;
    let ext = ext.to_ascii_lowercase();
    if !KINDS.contains(&ext.as_str()) {
        return Err(format!(".{ext} files aren't exported"));
    }
    // separators become spaces too, so a name is never a path
    let stem: String = stem
        .chars()
        .map(|c| {
            if c.is_control() || r#"<>:"/\|?*"#.contains(c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let stem = stem.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut stem: String = stem
        .trim_matches(|c| c == '.' || c == ' ')
        .chars()
        .take(80)
        .collect();
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3",
    ];
    if stem.is_empty() {
        stem = "Note".into();
    } else if reserved.contains(&stem.to_ascii_uppercase().as_str()) {
        stem.push_str(" note");
    }
    Ok((stem.trim_end().to_string(), ext))
}

/// `name.ext`, or `name (2).ext` and so on when that's taken.
fn unique(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..1000)
        .map(|n| dir.join(format!("{stem} ({n}).{ext}")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

#[tauri::command]
pub fn save_export(
    app: AppHandle,
    name: String,
    text: Option<String>,
    bytes: Option<Vec<u8>>,
) -> CmdResult<String> {
    let (stem, ext) = clean_name(&name)?;
    let dir = downloads(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique(&dir, &stem, &ext);
    let data = match (text, bytes) {
        (Some(t), _) => t.into_bytes(),
        (None, Some(b)) => b,
        _ => return Err("nothing to save".into()),
    };
    std::fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.display().to_string())
}

/// Only files in Downloads that exist, so a page can't point these at anything else.
fn exported(app: &AppHandle, path: &str) -> CmdResult<PathBuf> {
    let dir = downloads(app)?.canonicalize().map_err(|e| e.to_string())?;
    let p = Path::new(path)
        .canonicalize()
        .map_err(|_| "that file isn't there any more".to_string())?;
    if p.parent() != Some(dir.as_path()) || !p.is_file() {
        return Err("only exported files can be shown".into());
    }
    let ext = p
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !KINDS.contains(&ext.as_str()) {
        return Err("only exported files can be shown".into());
    }
    Ok(p)
}

#[tauri::command]
pub fn reveal_export(app: AppHandle, path: String) -> CmdResult<()> {
    let p = exported(&app, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_export(app: AppHandle, path: String) -> CmdResult<()> {
    use tauri_plugin_opener::OpenerExt;
    let p = exported(&app, &path)?;
    app.opener()
        .open_path(p.display().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// The page's print view as a PDF in Downloads (Windows: WebView2 PrintToPdf). Margins match core.css's @page.
#[tauri::command]
pub async fn save_pdf(app: AppHandle, window: WebviewWindow, name: String) -> CmdResult<String> {
    let (stem, ext) = clean_name(&name)?;
    if ext != "pdf" {
        return Err("not a PDF name".into());
    }
    let dir = downloads(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = unique(&dir, &stem, "pdf");
    print_to_pdf(&window, &path).await?;
    Ok(path.display().to_string())
}

#[cfg(windows)]
async fn print_to_pdf(window: &WebviewWindow, path: &Path) -> CmdResult<()> {
    use std::sync::mpsc;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment6, ICoreWebView2_7,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};

    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let file = path.display().to_string();
    window
        .with_webview(move |wv| {
            let go = || -> Result<(), String> {
                let fail = |e: windows::core::Error| e.message().to_string();
                unsafe {
                    let core = wv.controller().CoreWebView2().map_err(fail)?;
                    let core7: ICoreWebView2_7 = core.cast().map_err(|_| {
                        "this WebView2 can't make PDFs; update Microsoft Edge WebView2".to_string()
                    })?;
                    let env6: ICoreWebView2Environment6 = wv.environment().cast().map_err(fail)?;
                    let settings = env6.CreatePrintSettings().map_err(fail)?;
                    settings.SetShouldPrintBackgrounds(true).map_err(fail)?;
                    settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(fail)?;
                    // inches: 16 mm top, 15 mm sides, 18 mm bottom
                    settings.SetMarginTop(0.63).map_err(fail)?;
                    settings.SetMarginLeft(0.59).map_err(fail)?;
                    settings.SetMarginRight(0.59).map_err(fail)?;
                    settings.SetMarginBottom(0.71).map_err(fail)?;
                    let done = tx.clone();
                    let handler = PrintToPdfCompletedHandler::create(Box::new(
                        move |hr: windows::core::Result<()>, ok: bool| {
                            let _ = done.send(match hr {
                                Err(e) => Err(e.message().to_string()),
                                Ok(()) if !ok => Err("WebView2 couldn't write the PDF".into()),
                                Ok(()) => Ok(()),
                            });
                            Ok(())
                        },
                    ));
                    core7
                        .PrintToPdf(&HSTRING::from(file.as_str()), &settings, &handler)
                        .map_err(fail)?;
                }
                Ok(())
            };
            if let Err(e) = go() {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(60))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "the PDF took too long".to_string())?
}

#[cfg(not(windows))]
async fn print_to_pdf(_window: &WebviewWindow, _path: &Path) -> CmdResult<()> {
    Err("use Print and pick Save as PDF".into())
}

/// The native print dialog (macOS, where WKWebView's window.print() does nothing).
#[tauri::command]
pub fn print_page(window: WebviewWindow) -> CmdResult<()> {
    window.print().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_safe_and_never_overwrite() {
        assert_eq!(
            clean_name("PA3: notes / draft?.md").unwrap(),
            ("PA3 notes draft".into(), "md".into())
        );
        assert_eq!(clean_name("..\\..\\evil.docx").unwrap().0, "evil");
        assert_eq!(clean_name("nul.txt").unwrap().0, "nul note");
        assert_eq!(clean_name("...pdf").unwrap().0, "Note");
        assert!(clean_name("run.exe").is_err());
        assert!(clean_name("noext").is_err());
        let dir = std::env::temp_dir().join(format!("ca-export-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Note.md"), "x").unwrap();
        assert_eq!(unique(&dir, "Note", "md"), dir.join("Note (2).md"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
