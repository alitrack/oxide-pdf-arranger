use pdf_arranger_core::{
    delete_pages as delete_pages_impl, duplicate_pages as duplicate_pages_impl,
    insert_blank_page as insert_blank_page_impl, inspect_pdf as inspect_pdf_impl,
    merge_pdfs as merge_pdfs_impl, rotate_pdf as rotate_pdf_impl,
    split_pdf as split_pdf_impl, AppError, DeletePagesRequest,
    DuplicatePagesRequest, InsertBlankPageRequest, MergePdfRequest, PdfDocumentSummary,
    PdfOperationResult, RotatePdfRequest, SplitPdfRequest,
};
use std::sync::Once;
use tracing::info;

static LOGGING_INIT: Once = Once::new();

fn init_logging() {
    LOGGING_INIT.call_once(|| {
        let _ = tracing_subscriber::fmt()
            .with_max_level(tracing::Level::INFO)
            .with_target(false)
            .compact()
            .try_init();
    });
}

#[tauri::command]
fn inspect_pdf(path: String) -> Result<PdfDocumentSummary, AppError> {
    inspect_pdf_impl(&path)
}

#[tauri::command]
fn merge_pdfs(request: MergePdfRequest) -> Result<PdfOperationResult, AppError> {
    merge_pdfs_impl(&request)
}

#[tauri::command]
fn split_pdf(request: SplitPdfRequest) -> Result<PdfOperationResult, AppError> {
    split_pdf_impl(&request)
}

#[tauri::command]
fn rotate_pdf(request: RotatePdfRequest) -> Result<PdfOperationResult, AppError> {
    rotate_pdf_impl(&request)
}

#[tauri::command]
fn delete_pages(request: DeletePagesRequest) -> Result<PdfOperationResult, AppError> {
    delete_pages_impl(&request)
}

#[tauri::command]
fn duplicate_pages(request: DuplicatePagesRequest) -> Result<PdfOperationResult, AppError> {
    duplicate_pages_impl(&request)
}

#[tauri::command]
fn insert_blank_page(request: InsertBlankPageRequest) -> Result<PdfOperationResult, AppError> {
    insert_blank_page_impl(&request)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();
    info!("Starting oxide-pdf-arranger backend");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            inspect_pdf,
            merge_pdfs,
            split_pdf,
            rotate_pdf,
            delete_pages,
            duplicate_pages,
            insert_blank_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
