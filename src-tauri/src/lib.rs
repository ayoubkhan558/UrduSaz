//! Harfsaz — Tauri application entry. Wires the Nastaliq shaper and the Claude AI
//! bridge as invokable commands the React frontend can call.

mod account;
mod ai;
mod inpage;
mod printing;
mod settings;
mod shaping;

use ai::{AiRequest, AiResponse};
use shaping::{RenderLayout, ShapedRun};

/// Shape a run of (Urdu) text into positioned glyphs.
///
/// `font_bytes` is the raw font file sent from the frontend as a byte array.
#[tauri::command]
fn shape_text(text: String, font_bytes: Vec<u8>, font_size: f32) -> Result<ShapedRun, String> {
    shaping::shape_text(&text, &font_bytes, font_size)
}

/// Lay out text into a frame and return positioned vector glyphs (SVG paths) —
/// the print-grade render path.
#[tauri::command]
fn layout_text(
    text: String,
    font_bytes: Vec<u8>,
    font_size: f32,
    frame_width: f32,
    align: Option<String>,
) -> Result<RenderLayout, String> {
    // "justify" triggers kashida elongation; other values just set line origin.
    let align = align.unwrap_or_else(|| "right".to_string());
    shaping::layout_text(&text, &font_bytes, font_size, frame_width, &align)
}

/// Run an AI task (write / proofread / translate / layout) via Claude.
#[tauri::command]
async fn ai_task(req: AiRequest) -> Result<AiResponse, String> {
    ai::run_task(req).await
}

/// Multi-turn chat with conversation context (the AI panel's chat thread).
#[tauri::command]
async fn ai_chat(
    messages: Vec<ai::ChatMessage>,
    system: String,
) -> Result<ai::AiResponse, String> {
    ai::chat(messages, system).await
}

/// Add diacritics/harakat (تشكيل) to RTL text for the given base language.
#[tauri::command]
async fn ai_add_diacritics(
    text: String,
    lang: String,
    model: Option<String>,
) -> Result<ai::AiResponse, String> {
    ai::add_diacritics(text, lang, model).await
}

/// Transform a selected snippet (rephrase/grammar/caption/define/expand/custom…)
/// for the selection AI menu.
#[tauri::command]
async fn ai_transform(
    text: String,
    action: String,
    instruction: Option<String>,
    lang: Option<String>,
    model: Option<String>,
) -> Result<ai::AiResponse, String> {
    ai::transform(text, action, instruction, lang, model).await
}

/// Proofread Urdu text and return span-level corrections for inline,
/// non-destructive highlighting (accept/reject per suggestion).
#[tauri::command]
async fn ai_proofread_inline(
    text: String,
    model: Option<String>,
) -> Result<ai::ProofreadResult, String> {
    ai::proofread_inline(text, model).await
}

/// OCR an attached image/PDF (handwritten or printed) into editable text.
///
/// `data` is the file as base64 (a data URL is accepted too), `media_type` its
/// MIME type. `mode` is "plain" or "layout"; `diacritics` adds aerab.
#[tauri::command]
async fn ai_ocr(
    data: String,
    media_type: String,
    lang: String,
    mode: String,
    diacritics: bool,
    instruction: Option<String>,
    model: Option<String>,
) -> Result<ai::OcrResult, String> {
    ai::ocr(data, media_type, lang, mode, diacritics, instruction, model).await
}

/// Import an InPage (.inp) document: returns its paragraphs as Unicode text.
///
/// The file is read here rather than via the fs plugin so the OLE container
/// never has to cross the IPC bridge as a JSON byte array.
#[tauri::command]
fn import_inpage(path: String) -> Result<inpage::InpageDoc, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read file: {e}"))?;
    inpage::extract_text(&bytes)
}

/// List installed system printers (CUPS via lpstat).
#[tauri::command]
fn list_printers() -> Result<Vec<printing::PrinterInfo>, String> {
    printing::list_printers()
}

/// Print a file to a chosen printer via the OS print system (lp).
#[tauri::command]
fn print_file(
    file_path: String,
    printer: Option<String>,
    copies: u32,
    range: Option<String>,
    grayscale: bool,
) -> Result<String, String> {
    printing::print_file(file_path, printer, copies, range, grayscale)
}

/// Lightweight health check the UI can call on startup to confirm the active
/// AI provider is configured, without leaking any key.
#[tauri::command]
fn ai_key_present() -> bool {
    ai::is_configured()
}

/// Which AI provider is active (Claude / DeepSeek / Mistral / OpenAI / Claude CLI).
#[tauri::command]
fn ai_provider() -> String {
    ai::provider_name()
}

/// Read current AI settings (provider + model + whether a key is saved — never
/// returns the raw key).
#[tauri::command]
fn get_ai_settings() -> settings::AiSettingsView {
    settings::view()
}

/// Save AI settings (provider, api key, model) to local config. Takes effect
/// immediately (no restart). If `api_key` is blank the previously-saved key is
/// preserved, so the UI never has to read a key back to re-save the other
/// fields. Use `clear_ai_key` to actually remove a stored key.
#[tauri::command]
fn set_ai_settings(
    provider: String, api_key: String, model: String, endpoint: String, system_prompt: String,
) -> Result<(), String> {
    let provider = provider.trim().to_lowercase();
    if !matches!(provider.as_str(), "" | "anthropic" | "openai" | "gemini" | "custom" | "deepseek" | "mistral" | "claude-cli") {
        return Err("Unknown AI provider.".into());
    }
    let endpoint = endpoint.trim();
    if provider == "custom" {
        let url = reqwest::Url::parse(endpoint).map_err(|_| "Enter a valid chat completions URL.")?;
        if url.scheme() != "https" || url.host().is_none() || !url.username().is_empty() ||
            url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
            return Err("Use an HTTPS chat completions URL without credentials, query or fragment.".into());
        }
        if model.trim().is_empty() {
            return Err("Enter the model ID for your custom endpoint.".into());
        }
    }
    let current = settings::load();
    let endpoint = if provider == "custom" { endpoint } else { "" };
    let key = if provider.is_empty() || provider == "claude-cli" {
        String::new()
    } else if api_key.trim().is_empty() && provider == current.provider && endpoint == current.endpoint {
        current.api_key
    } else {
        api_key.trim().to_string()
    };
    if !provider.is_empty() && provider != "claude-cli" && key.is_empty() {
        return Err("Enter an API key for this provider.".into());
    }
    settings::save(&settings::AiSettings {
        provider, api_key: key, model: model.trim().to_string(),
        endpoint: endpoint.to_string(), system_prompt: system_prompt.trim().to_string(),
    })
}

/// Forget the stored API key and return to hosted AI.
#[tauri::command]
fn clear_ai_key() -> Result<(), String> {
    let mut current = settings::load();
    current.api_key.clear();
    current.provider.clear();
    settings::save(&current)
}

#[tauri::command]
fn local_ai_enabled() -> bool {
    let current = settings::load();
    !current.provider.is_empty() && ai::is_configured()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            account::desktop_account,
            account::desktop_ai,
            shape_text,
            layout_text,
            ai_task,
            ai_chat,
            ai_proofread_inline,
            ai_add_diacritics,
            ai_transform,
            ai_ocr,
            import_inpage,
            list_printers,
            print_file,
            ai_key_present,
            ai_provider,
            get_ai_settings,
            set_ai_settings,
            local_ai_enabled,
            clear_ai_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Harfsaz");
}
