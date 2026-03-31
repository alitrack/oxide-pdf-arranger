use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{imageops, ImageBuffer, Rgba};
use lopdf::content::{Content, Operation};
use lopdf::{dictionary, xobject, Document, Object, ObjectId, Stream};
use pdf_core::{InputSource, PdfDocument, PdfError};
use pdf_crop::{crop_page_box, CropError, CropMargins, PageBox};
use pdf_merge::MergeEngine;
use pdf_page_range::{PageNum, PageRange, Qualifier, Rotation};
use pdf_rotate::RotateEngine;
use pdf_split::extract_pages;
use serde::ser::Serializer;
use serde::{Deserialize, Serialize};
use std::io::Cursor;
use std::path::Path;
use thiserror::Error;
use tracing::info;

pub type AppResult<T> = Result<T, AppError>;

const DEFAULT_MEDIA_BOX: [f32; 4] = [0.0, 0.0, 612.0, 792.0];
const MAX_INHERITANCE_DEPTH: usize = 64;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    InvalidRequest(String),

    #[error("PDF operation failed: {0}")]
    Pdf(#[from] PdfError),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidRequest(_) => "invalid_request",
            Self::Pdf(_) => "pdf_error",
            Self::Io(_) => "io_error",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct ErrorPayload<'a> {
            code: &'a str,
            message: String,
        }

        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfPageInfo {
    pub page_number: u32,
    pub media_box: [f32; 4],
    pub crop_box: Option<[f32; 4]>,
    pub rotation: i32,
    pub thumbnail_data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfDocumentSummary {
    pub path: String,
    pub page_count: u32,
    pub pages: Vec<PdfPageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergePdfRequest {
    pub input_paths: Vec<String>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SplitPdfRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RotatePdfRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub rotation_degrees: i32,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CropPdfRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub margins: CropMargins,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeletePagesRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DuplicatePagesRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InsertBlankPageRequest {
    pub input_path: String,
    pub after_page_number: u32,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReorderPagesRequest {
    pub input_path: String,
    pub page_numbers: Vec<u32>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MovePagesBetweenDocumentsRequest {
    pub source_path: String,
    pub target_path: String,
    pub page_numbers: Vec<u32>,
    pub target_position: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CopyDocumentRequest {
    pub input_path: String,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ImageImportPosition {
    Append,
    Prepend,
    AfterSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportImagesRequest {
    pub target_path: String,
    pub image_paths: Vec<String>,
    pub position: ImageImportPosition,
    pub after_page_number: Option<u32>,
    pub output_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PdfOperationResult {
    pub output_path: String,
    pub page_count: u32,
}

pub fn inspect_pdf(path: &str) -> AppResult<PdfDocumentSummary> {
    validate_path(path, "path")?;

    info!(path, "Inspecting PDF document");
    let doc = PdfDocument::load(path)?;
    let pages_map = doc.inner.get_pages();
    let mut pages = Vec::with_capacity(pages_map.len());

    for (page_number, page_id) in &pages_map {
        let media_box =
            find_page_box(&doc.inner, *page_id, b"MediaBox").unwrap_or(DEFAULT_MEDIA_BOX);
        pages.push(PdfPageInfo {
            page_number: *page_number,
            media_box,
            crop_box: find_page_box(&doc.inner, *page_id, b"CropBox"),
            rotation: find_inherited_object(&doc.inner, *page_id, b"Rotate")
                .and_then(|value| object_to_i32(&value))
                .unwrap_or(0),
            thumbnail_data_url: generate_page_thumbnail(
                &doc.inner,
                *page_id,
                *page_number as usize,
                media_box,
            ),
        });
    }

    Ok(PdfDocumentSummary {
        path: path.to_string(),
        page_count: pages.len() as u32,
        pages,
    })
}

pub fn merge_pdfs(request: &MergePdfRequest) -> AppResult<PdfOperationResult> {
    if request.input_paths.is_empty() {
        return Err(AppError::InvalidRequest(
            "input_paths must contain at least one PDF".to_string(),
        ));
    }
    validate_path(&request.output_path, "output_path")?;
    ensure_output_parent(&request.output_path)?;

    let sources: Vec<_> = request
        .input_paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            validate_path(path, "input_paths[]")?;
            let handle = handle_for_index(index);
            Ok((
                InputSource::new(path).with_handle(handle.clone()),
                vec![full_document_range(&handle)],
            ))
        })
        .collect::<AppResult<_>>()?;

    info!(
        output_path = request.output_path,
        input_count = request.input_paths.len(),
        "Merging PDFs"
    );
    let mut merged = MergeEngine::merge(&sources)?;
    let page_count = merged.page_count() as u32;
    merged.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count,
    })
}

pub fn split_pdf(request: &SplitPdfRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    validate_page_numbers_exist(input_doc.page_count(), &request.page_numbers)?;

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        page_numbers = ?request.page_numbers,
        "Extracting PDF pages"
    );
    extract_pages(
        Path::new(&request.input_path),
        &request.page_numbers,
        Path::new(&request.output_path),
    )?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: request.page_numbers.len() as u32,
    })
}

pub fn rotate_pdf(request: &RotatePdfRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    validate_rotation(request.rotation_degrees)?;
    ensure_output_parent(&request.output_path)?;

    let mut doc = PdfDocument::load(&request.input_path)?;
    let page_count = doc.page_count();
    validate_page_numbers_exist(page_count, &request.page_numbers)?;

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        page_numbers = ?request.page_numbers,
        rotation = request.rotation_degrees,
        "Rotating PDF pages"
    );
    RotateEngine::rotate_pages(&mut doc, &request.page_numbers, request.rotation_degrees)?;
    doc.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: page_count as u32,
    })
}

pub fn crop_pdf(request: &CropPdfRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_output_parent(&request.output_path)?;

    let mut doc = PdfDocument::load(&request.input_path)?;
    let page_count = doc.page_count();
    validate_page_numbers_exist(page_count, &request.page_numbers)?;

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        page_numbers = ?request.page_numbers,
        margins = ?request.margins,
        "Cropping PDF pages"
    );

    for &page_number in &request.page_numbers {
        let page_id = doc
            .get_page_id(page_number)
            .ok_or_else(|| {
                AppError::InvalidRequest(format!(
                    "page {page_number} is out of range for a document with {page_count} pages"
                ))
            })?;
        let media_box = find_page_box(&doc.inner, page_id, b"MediaBox").unwrap_or(DEFAULT_MEDIA_BOX);
        let current_box = find_page_box(&doc.inner, page_id, b"CropBox").unwrap_or(media_box);
        let next_crop_box = crop_page_box(
            page_box_from_array(current_box),
            request.margins,
        )
        .map_err(map_crop_error)?;
        let crop_box_object = page_box_to_object(next_crop_box);
        let page = doc
            .inner
            .objects
            .get_mut(&page_id)
            .ok_or_else(|| AppError::InvalidRequest(format!("page {page_number} is unavailable")))?;
        let Object::Dictionary(page_dict) = page else {
            return Err(AppError::InvalidRequest(format!(
                "page {page_number} is unavailable"
            )));
        };
        page_dict.set("CropBox", crop_box_object);
    }

    doc.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: page_count as u32,
    })
}

pub fn delete_pages(request: &DeletePagesRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    let page_count = input_doc.page_count();
    validate_page_numbers_exist(page_count, &request.page_numbers)?;

    let deleted_pages: std::collections::HashSet<_> = request.page_numbers.iter().copied().collect();
    let remaining_pages: Vec<u32> = (1..=page_count as u32)
        .filter(|page_number| !deleted_pages.contains(page_number))
        .collect();

    if remaining_pages.is_empty() {
        return Err(AppError::InvalidRequest(
            "cannot delete every page from the document".to_string(),
        ));
    }

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        deleted_pages = ?request.page_numbers,
        remaining_pages = ?remaining_pages,
        "Deleting PDF pages"
    );
    extract_pages(
        Path::new(&request.input_path),
        &remaining_pages,
        Path::new(&request.output_path),
    )?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: remaining_pages.len() as u32,
    })
}

pub fn duplicate_pages(request: &DuplicatePagesRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    let page_count = input_doc.page_count();
    validate_page_numbers_exist(page_count, &request.page_numbers)?;

    let duplicated_pages: std::collections::HashSet<_> =
        request.page_numbers.iter().copied().collect();
    let mut sources = Vec::new();
    let mut occurrence_index = 0usize;

    for page_number in 1..=page_count as u32 {
        occurrence_index += 1;
        let handle = handle_for_index(occurrence_index);
        sources.push((
            InputSource::new(&request.input_path).with_handle(handle.clone()),
            vec![single_page_range(&handle, page_number)],
        ));

        if duplicated_pages.contains(&page_number) {
            occurrence_index += 1;
            let duplicate_handle = handle_for_index(occurrence_index);
            sources.push((
                InputSource::new(&request.input_path).with_handle(duplicate_handle.clone()),
                vec![single_page_range(&duplicate_handle, page_number)],
            ));
        }
    }

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        duplicated_pages = ?request.page_numbers,
        "Duplicating PDF pages"
    );
    let mut merged = MergeEngine::merge(&sources)?;
    let output_page_count = merged.page_count() as u32;
    merged.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: output_page_count,
    })
}

pub fn insert_blank_page(request: &InsertBlankPageRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    let page_count = input_doc.page_count();
    validate_page_numbers_exist(page_count, &[request.after_page_number])?;

    let blank_page_box = input_doc
        .get_page_id(request.after_page_number)
        .and_then(|page_id| find_page_box(&input_doc.inner, page_id, b"MediaBox"))
        .unwrap_or(DEFAULT_MEDIA_BOX);

    let blank_page_file = tempfile::NamedTempFile::new()?;
    write_blank_page_pdf(blank_page_file.path(), blank_page_box)?;

    let mut sources = Vec::new();
    let mut occurrence_index = 0usize;

    for page_number in 1..=page_count as u32 {
        occurrence_index += 1;
        let handle = handle_for_index(occurrence_index);
        sources.push((
            InputSource::new(&request.input_path).with_handle(handle.clone()),
            vec![single_page_range(&handle, page_number)],
        ));

        if page_number == request.after_page_number {
            occurrence_index += 1;
            let blank_handle = handle_for_index(occurrence_index);
            sources.push((
                InputSource::new(blank_page_file.path()).with_handle(blank_handle.clone()),
                vec![single_page_range(&blank_handle, 1)],
            ));
        }
    }

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        after_page_number = request.after_page_number,
        "Inserting blank PDF page"
    );
    let mut merged = MergeEngine::merge(&sources)?;
    let output_page_count = merged.page_count() as u32;
    merged.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: output_page_count,
    })
}

pub fn reorder_pages(request: &ReorderPagesRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    let page_count = input_doc.page_count();
    validate_reorder_page_numbers(page_count, &request.page_numbers)?;

    let sources: Vec<_> = request
        .page_numbers
        .iter()
        .enumerate()
        .map(|(index, page_number)| {
            let handle = handle_for_index(index);
            (
                InputSource::new(&request.input_path).with_handle(handle.clone()),
                vec![single_page_range(&handle, *page_number)],
            )
        })
        .collect();

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        page_numbers = ?request.page_numbers,
        "Reordering PDF pages"
    );
    let mut merged = MergeEngine::merge(&sources)?;
    let output_page_count = merged.page_count() as u32;
    merged.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: output_page_count,
    })
}

pub fn move_pages_between_documents(
    request: &MovePagesBetweenDocumentsRequest,
) -> AppResult<PdfOperationResult> {
    validate_path(&request.source_path, "source_path")?;
    validate_path(&request.target_path, "target_path")?;
    validate_page_numbers_not_empty(&request.page_numbers)?;
    ensure_distinct_paths(&request.source_path, &request.target_path)?;
    ensure_output_parent(&request.source_path)?;
    ensure_output_parent(&request.target_path)?;

    let source_doc = PdfDocument::load(&request.source_path)?;
    let target_doc = PdfDocument::load(&request.target_path)?;
    let source_page_count = source_doc.page_count();
    let target_page_count = target_doc.page_count();
    validate_page_numbers_exist(source_page_count, &request.page_numbers)?;
    validate_target_position(target_page_count, request.target_position)?;

    let moved_pages: std::collections::HashSet<_> = request.page_numbers.iter().copied().collect();
    let remaining_source_pages: Vec<u32> = (1..=source_page_count as u32)
        .filter(|page_number| !moved_pages.contains(page_number))
        .collect();

    if remaining_source_pages.is_empty() {
        return Err(AppError::InvalidRequest(
            "cannot move every page out of the source document".to_string(),
        ));
    }

    let source_snapshot = tempfile::NamedTempFile::new()?;
    let target_snapshot = tempfile::NamedTempFile::new()?;
    std::fs::copy(&request.source_path, source_snapshot.path())?;
    std::fs::copy(&request.target_path, target_snapshot.path())?;

    let source_sources: Vec<_> = remaining_source_pages
        .iter()
        .enumerate()
        .map(|(index, page_number)| {
            let handle = handle_for_index(index);
            (
                InputSource::new(source_snapshot.path()).with_handle(handle.clone()),
                vec![single_page_range(&handle, *page_number)],
            )
        })
        .collect();

    let mut target_sources = Vec::new();
    let mut occurrence_index = 0usize;

    for target_index in 0..=target_page_count {
        if target_index == request.target_position {
            for page_number in &request.page_numbers {
                occurrence_index += 1;
                let handle = handle_for_index(occurrence_index);
                target_sources.push((
                    InputSource::new(source_snapshot.path()).with_handle(handle.clone()),
                    vec![single_page_range(&handle, *page_number)],
                ));
            }
        }

        if target_index < target_page_count {
            occurrence_index += 1;
            let handle = handle_for_index(occurrence_index);
            target_sources.push((
                InputSource::new(target_snapshot.path()).with_handle(handle.clone()),
                vec![single_page_range(&handle, (target_index + 1) as u32)],
            ));
        }
    }

    info!(
        source_path = request.source_path,
        target_path = request.target_path,
        page_numbers = ?request.page_numbers,
        target_position = request.target_position,
        "Moving pages between PDF documents"
    );

    let mut rewritten_source = MergeEngine::merge(&source_sources)?;
    rewritten_source.save(&request.source_path)?;

    let mut rewritten_target = MergeEngine::merge(&target_sources)?;
    let target_output_page_count = rewritten_target.page_count() as u32;
    rewritten_target.save(&request.target_path)?;

    Ok(PdfOperationResult {
        output_path: request.target_path.clone(),
        page_count: target_output_page_count,
    })
}

pub fn copy_document(request: &CopyDocumentRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.input_path, "input_path")?;
    validate_path(&request.output_path, "output_path")?;
    ensure_distinct_paths(&request.input_path, &request.output_path)?;
    ensure_output_parent(&request.output_path)?;

    let input_doc = PdfDocument::load(&request.input_path)?;
    let page_count = input_doc.page_count() as u32;

    info!(
        input_path = request.input_path,
        output_path = request.output_path,
        "Copying PDF document"
    );
    std::fs::copy(&request.input_path, &request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count,
    })
}

pub fn import_images(request: &ImportImagesRequest) -> AppResult<PdfOperationResult> {
    validate_path(&request.target_path, "target_path")?;
    validate_path(&request.output_path, "output_path")?;
    validate_image_paths_not_empty(&request.image_paths)?;
    ensure_output_parent(&request.output_path)?;

    let target_doc = PdfDocument::load(&request.target_path)?;
    let target_page_count = target_doc.page_count();
    let insertion_index = resolve_image_insertion_index(
        target_page_count,
        &request.position,
        request.after_page_number,
    )?;

    let target_snapshot = tempfile::NamedTempFile::new()?;
    std::fs::copy(&request.target_path, target_snapshot.path())?;

    let image_pdfs: Vec<_> = request
        .image_paths
        .iter()
        .map(|image_path| {
            validate_path(image_path, "image_paths[]")?;
            let temp_pdf = tempfile::NamedTempFile::new()?;
            write_image_page_pdf(temp_pdf.path(), Path::new(image_path))?;
            Ok(temp_pdf)
        })
        .collect::<AppResult<_>>()?;

    let mut sources = Vec::new();
    let mut occurrence_index = 0usize;

    for target_index in 0..=target_page_count {
        if target_index == insertion_index {
            for image_pdf in &image_pdfs {
                occurrence_index += 1;
                let handle = handle_for_index(occurrence_index);
                sources.push((
                    InputSource::new(image_pdf.path()).with_handle(handle.clone()),
                    vec![single_page_range(&handle, 1)],
                ));
            }
        }

        if target_index < target_page_count {
            occurrence_index += 1;
            let handle = handle_for_index(occurrence_index);
            sources.push((
                InputSource::new(target_snapshot.path()).with_handle(handle.clone()),
                vec![single_page_range(&handle, (target_index + 1) as u32)],
            ));
        }
    }

    info!(
        target_path = request.target_path,
        output_path = request.output_path,
        image_count = request.image_paths.len(),
        position = ?request.position,
        after_page_number = request.after_page_number,
        "Importing images into PDF document"
    );

    let mut merged = MergeEngine::merge(&sources)?;
    let output_page_count = merged.page_count() as u32;
    merged.save(&request.output_path)?;

    Ok(PdfOperationResult {
        output_path: request.output_path.clone(),
        page_count: output_page_count,
    })
}

fn validate_path(value: &str, field_name: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidRequest(format!(
            "{field_name} cannot be empty"
        )));
    }
    Ok(())
}

fn validate_page_numbers_not_empty(page_numbers: &[u32]) -> AppResult<()> {
    if page_numbers.is_empty() {
        return Err(AppError::InvalidRequest(
            "page_numbers must contain at least one page".to_string(),
        ));
    }
    Ok(())
}

fn validate_image_paths_not_empty(image_paths: &[String]) -> AppResult<()> {
    if image_paths.is_empty() {
        return Err(AppError::InvalidRequest(
            "image_paths must contain at least one image".to_string(),
        ));
    }
    Ok(())
}

fn validate_page_numbers_exist(page_count: usize, page_numbers: &[u32]) -> AppResult<()> {
    for &page_number in page_numbers {
        if page_number == 0 || page_number as usize > page_count {
            return Err(AppError::InvalidRequest(format!(
                "page {page_number} is out of range for a document with {page_count} pages"
            )));
        }
    }

    Ok(())
}

fn validate_reorder_page_numbers(page_count: usize, page_numbers: &[u32]) -> AppResult<()> {
    if page_numbers.len() != page_count {
        return Err(AppError::InvalidRequest(format!(
            "page_numbers must include exactly {page_count} pages"
        )));
    }

    validate_page_numbers_exist(page_count, page_numbers)?;

    let unique_pages: std::collections::HashSet<_> = page_numbers.iter().copied().collect();
    if unique_pages.len() != page_numbers.len() {
        return Err(AppError::InvalidRequest(
            "page_numbers must not contain duplicates".to_string(),
        ));
    }

    Ok(())
}

fn validate_target_position(page_count: usize, target_position: usize) -> AppResult<()> {
    if target_position > page_count {
        return Err(AppError::InvalidRequest(format!(
            "target_position must be between 0 and {page_count}"
        )));
    }

    Ok(())
}

fn validate_rotation(rotation_degrees: i32) -> AppResult<()> {
    if rotation_degrees.rem_euclid(90) != 0 {
        return Err(AppError::InvalidRequest(
            "rotation_degrees must be a multiple of 90".to_string(),
        ));
    }

    Ok(())
}

fn ensure_output_parent(output_path: &str) -> AppResult<()> {
    let path = Path::new(output_path);
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        std::fs::create_dir_all(parent)?;
    }
    Ok(())
}

fn ensure_distinct_paths(input_path: &str, output_path: &str) -> AppResult<()> {
    let input = Path::new(input_path);
    let output = Path::new(output_path);

    if input == output {
        return Err(AppError::InvalidRequest(
            "output_path must be different from input_path".to_string(),
        ));
    }

    Ok(())
}

fn resolve_image_insertion_index(
    page_count: usize,
    position: &ImageImportPosition,
    after_page_number: Option<u32>,
) -> AppResult<usize> {
    match position {
        ImageImportPosition::Append => Ok(page_count),
        ImageImportPosition::Prepend => Ok(0),
        ImageImportPosition::AfterSelection => {
            let page_number = after_page_number.ok_or_else(|| {
                AppError::InvalidRequest(
                    "after_page_number is required when position is after-selection"
                        .to_string(),
                )
            })?;
            validate_page_numbers_exist(page_count, &[page_number])?;
            Ok(page_number as usize)
        }
    }
}

fn handle_for_index(index: usize) -> String {
    let mut value = index + 1;
    let mut handle = String::new();

    while value > 0 {
        let remainder = (value - 1) % 26;
        handle.push((b'A' + remainder as u8) as char);
        value = (value - 1) / 26;
    }

    handle.chars().rev().collect()
}

fn full_document_range(handle: &str) -> PageRange {
    PageRange {
        handle: handle.to_string(),
        start: PageNum::Absolute(1),
        end: PageNum::End,
        qualifier: Qualifier::All,
        rotation: Rotation::North,
    }
}

fn single_page_range(handle: &str, page_number: u32) -> PageRange {
    PageRange {
        handle: handle.to_string(),
        start: PageNum::Absolute(page_number),
        end: PageNum::Absolute(page_number),
        qualifier: Qualifier::All,
        rotation: Rotation::North,
    }
}

fn write_blank_page_pdf(path: &Path, media_box: [f32; 4]) -> AppResult<()> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let content_id = doc.add_object(Stream::new(dictionary! {}, Vec::new()));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Contents" => content_id,
        "MediaBox" => vec![
            media_box[0].into(),
            media_box[1].into(),
            media_box[2].into(),
            media_box[3].into(),
        ],
    });

    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![Object::Reference(page_id)],
            "Count" => 1,
            "MediaBox" => vec![
                media_box[0].into(),
                media_box[1].into(),
                media_box[2].into(),
                media_box[3].into(),
            ],
        }),
    );

    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(path)?;
    Ok(())
}

fn write_image_page_pdf(path: &Path, image_path: &Path) -> AppResult<()> {
    let mut doc = Document::with_version("1.5");
    let pages_id = doc.new_object_id();
    let image_stream = xobject::image(image_path).map_err(|error| {
        AppError::InvalidRequest(format!(
            "failed to import image {}: {error}. Supported formats: JPEG, PNG, TIFF, BMP, WebP",
            image_path.display()
        ))
    })?;
    let width = image_stream
        .dict
        .get(b"Width")
        .ok()
        .and_then(|value| value.as_i64().ok())
        .unwrap_or(612);
    let height = image_stream
        .dict
        .get(b"Height")
        .ok()
        .and_then(|value| value.as_i64().ok())
        .unwrap_or(792);
    let image_id = doc.add_object(image_stream);
    let image_name = b"Im0";
    let content = Content {
        operations: vec![
            Operation::new("q", vec![]),
            Operation::new(
                "cm",
                vec![width.into(), 0.into(), 0.into(), height.into(), 0.into(), 0.into()],
            ),
            Operation::new("Do", vec![Object::Name(image_name.to_vec())]),
            Operation::new("Q", vec![]),
        ],
    };
    let content_id = doc.add_object(Stream::new(
        dictionary! {},
        content.encode().map_err(|error| {
            AppError::InvalidRequest(format!("failed to encode image page content: {error}"))
        })?,
    ));
    let page_id = doc.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Contents" => content_id,
        "MediaBox" => vec![0.into(), 0.into(), width.into(), height.into()],
    });
    doc.add_xobject(page_id, image_name, image_id)
        .map_err(|error| AppError::InvalidRequest(format!("failed to attach image resource: {error}")))?;
    doc.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Count" => 1,
            "Kids" => vec![Object::Reference(page_id)],
        }),
    );
    let catalog_id = doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    doc.trailer.set("Root", catalog_id);
    doc.compress();
    doc.save(path)?;
    Ok(())
}

fn page_box_from_array(values: [f32; 4]) -> PageBox {
    PageBox {
        left: values[0],
        bottom: values[1],
        right: values[2],
        top: values[3],
    }
}

fn page_box_to_object(page_box: PageBox) -> Object {
    Object::Array(vec![
        page_box.left.into(),
        page_box.bottom.into(),
        page_box.right.into(),
        page_box.top.into(),
    ])
}

fn map_crop_error(error: CropError) -> AppError {
    match error {
        CropError::NegativeMargin => {
            AppError::InvalidRequest("crop margins cannot be negative".to_string())
        }
        CropError::MarginExceedsPage => {
            AppError::InvalidRequest("crop margins exceed the page bounds".to_string())
        }
    }
}

fn find_page_box(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<[f32; 4]> {
    let object = find_inherited_object(doc, page_id, key)?;
    parse_box(&object)
}

fn find_inherited_object(doc: &Document, start_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut current_id = start_id;

    for _ in 0..MAX_INHERITANCE_DEPTH {
        let dict = doc.get_dictionary(current_id).ok()?;
        if let Ok(value) = dict.get(key) {
            return Some(value.clone());
        }

        let parent_id = dict.get(b"Parent").ok()?.as_reference().ok()?;
        current_id = parent_id;
    }

    None
}

fn parse_box(object: &Object) -> Option<[f32; 4]> {
    let Object::Array(values) = object else {
        return None;
    };

    if values.len() != 4 {
        return None;
    }

    Some([
        object_to_f32(&values[0])?,
        object_to_f32(&values[1])?,
        object_to_f32(&values[2])?,
        object_to_f32(&values[3])?,
    ])
}

fn generate_page_thumbnail(
    doc: &Document,
    page_id: ObjectId,
    page_number: usize,
    media_box: [f32; 4],
) -> String {
    const THUMB_WIDTH: u32 = 180;
    const THUMB_HEIGHT: u32 = 240;

    if let Some(img_data) = extract_first_image_from_page(doc, page_id) {
        if let Ok(thumbnail) = create_thumbnail_from_image(&img_data, THUMB_WIDTH, THUMB_HEIGHT) {
            return thumbnail;
        }
    }

    generate_placeholder_thumbnail(page_number, media_box, THUMB_WIDTH, THUMB_HEIGHT)
}

fn extract_first_image_from_page(doc: &Document, page_id: ObjectId) -> Option<Vec<u8>> {
    let resources = find_inherited_object(doc, page_id, b"Resources")?;
    let resources_dict = object_to_dictionary(doc, &resources)?;
    let xobject = resources_dict.get(b"XObject").ok()?;
    let xobject_dict = object_to_dictionary(doc, xobject)?;

    for (_, value) in xobject_dict.iter() {
        let Object::Reference(id) = value else {
            continue;
        };

        let Ok(Object::Stream(stream)) = doc.get_object(*id) else {
            continue;
        };
        let Ok(Object::Name(subtype)) = stream.dict.get(b"Subtype") else {
            continue;
        };

        if subtype == b"Image" {
            let content = stream
                .decompressed_content()
                .unwrap_or_else(|_| stream.content.clone());
            return Some(content);
        }
    }

    None
}

fn object_to_dictionary<'a>(doc: &'a Document, value: &'a Object) -> Option<&'a lopdf::Dictionary> {
    match value {
        Object::Dictionary(dict) => Some(dict),
        Object::Reference(id) => match doc.get_object(*id).ok()? {
            Object::Dictionary(dict) => Some(dict),
            _ => None,
        },
        _ => None,
    }
}

fn create_thumbnail_from_image(
    img_data: &[u8],
    width: u32,
    height: u32,
) -> Result<String, image::ImageError> {
    let image = image::load_from_memory(img_data)?;
    let thumbnail = image.resize(width, height, imageops::FilterType::Lanczos3);

    let mut buffer = Vec::new();
    thumbnail.write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Png)?;

    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(buffer)
    ))
}

fn generate_placeholder_thumbnail(
    page_number: usize,
    media_box: [f32; 4],
    width: u32,
    height: u32,
) -> String {
    let page_width = (media_box[2] - media_box[0]).max(1.0);
    let page_height = (media_box[3] - media_box[1]).max(1.0);
    let page_ratio = (page_width / page_height) as f64;
    let thumb_ratio = width as f64 / height as f64;

    let (inner_width, inner_height) = if page_ratio >= thumb_ratio {
        let next_width = width.saturating_sub(24);
        let next_height = ((next_width as f64) / page_ratio) as u32;
        (next_width, next_height.max(1))
    } else {
        let next_height = height.saturating_sub(24);
        let next_width = ((next_height as f64) * page_ratio) as u32;
        (next_width.max(1), next_height)
    };

    let offset_x = ((width - inner_width) / 2) as i32;
    let offset_y = ((height - inner_height) / 2) as i32;
    let accent_seed = (page_number as u8).wrapping_mul(17);

    let mut image = ImageBuffer::from_pixel(width, height, Rgba([235, 240, 239, 255]));

    for y in 0..height as i32 {
        for x in 0..width as i32 {
            let is_page = x >= offset_x
                && x < offset_x + inner_width as i32
                && y >= offset_y
                && y < offset_y + inner_height as i32;

            let pixel = if is_page {
                if x < offset_x + 6 || y < offset_y + 6 {
                    Rgba([188, 210, 212, 255])
                } else {
                    Rgba([255, 255, 255, 255])
                }
            } else {
                Rgba([
                    225u8.saturating_add(accent_seed / 8),
                    230u8.saturating_sub(accent_seed / 10),
                    236u8.saturating_sub(accent_seed / 12),
                    255,
                ])
            };

            image.put_pixel(x as u32, y as u32, pixel);
        }
    }

    let mut buffer = Vec::new();
    image
        .write_to(&mut Cursor::new(&mut buffer), image::ImageFormat::Png)
        .expect("placeholder thumbnail should encode");

    format!("data:image/png;base64,{}", BASE64_STANDARD.encode(buffer))
}

fn object_to_f32(value: &Object) -> Option<f32> {
    match value {
        Object::Integer(number) => Some(*number as f32),
        Object::Real(number) => Some(*number),
        _ => None,
    }
}

fn object_to_i32(value: &Object) -> Option<i32> {
    match value {
        Object::Integer(number) => i32::try_from(*number).ok(),
        Object::Real(number) => Some(*number as i32),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::content::{Content, Operation};
    use lopdf::{dictionary, Document, Object, Stream};
    use tempfile::tempdir;

    fn create_text_fixture_with_pages(path: &std::path::Path, pages: &[(&str, i64, i64, i64)]) {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
        });
        let resources_id = doc.add_object(dictionary! {
            "Font" => dictionary! {
                "F1" => font_id,
            },
        });

        let mut page_refs = Vec::new();
        for (label, width, height, rotation) in pages {
            let content = Content {
                operations: vec![
                    Operation::new("BT", vec![]),
                    Operation::new("Tf", vec!["F1".into(), 18.into()]),
                    Operation::new("Td", vec![20.into(), (height - 30).into()]),
                    Operation::new("Tj", vec![Object::string_literal(*label)]),
                    Operation::new("ET", vec![]),
                ],
            };
            let content_id = doc.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "Contents" => content_id,
                "MediaBox" => vec![0.into(), 0.into(), (*width).into(), (*height).into()],
                "Rotate" => *rotation,
            });
            page_refs.push(page_id);
        }

        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => page_refs.iter().copied().map(Object::Reference).collect::<Vec<_>>(),
                "Count" => pages.len() as i64,
                "Resources" => resources_id,
            }),
        );

        let catalog_id = doc.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        doc.trailer.set("Root", catalog_id);
        doc.compress();
        doc.save(path).expect("failed to save text fixture");
    }

    fn extract_page_markers(path: &std::path::Path) -> Vec<String> {
        let doc = Document::load(path).expect("failed to load duplicated pdf");
        doc.get_pages()
            .values()
            .map(|page_id| {
                let content = doc
                    .get_page_content(*page_id)
                    .expect("missing page content for duplicated page");
                let decoded = Content::decode(&content).expect("failed to decode duplicated content");
                decoded
                    .operations
                    .iter()
                    .find_map(|operation| {
                        if operation.operator == "Tj" {
                            Some(
                                String::from_utf8(
                                    operation.operands[0]
                                        .as_str()
                                        .expect("Tj operand should be a string")
                                        .to_vec(),
                                )
                                .expect("page marker should be utf-8"),
                            )
                        } else {
                            None
                        }
                    })
                    .expect("missing page marker text")
            })
            .collect()
    }

    fn create_test_image(
        path: &std::path::Path,
        format: image::ImageFormat,
        rgba: [u8; 4],
    ) {
        let image = ImageBuffer::from_pixel(24, 16, Rgba(rgba));
        image
            .save_with_format(path, format)
            .expect("failed to save test image");
    }

    fn assert_page_marker(doc: &Document, page_id: ObjectId, expected: &str) {
        let content = doc
            .get_page_content(page_id)
            .expect("missing page content");
        let decoded = Content::decode(&content).expect("failed to decode page content");
        let marker = decoded
            .operations
            .iter()
            .find_map(|operation| {
                if operation.operator == "Tj" {
                    Some(
                        String::from_utf8(
                            operation.operands[0]
                                .as_str()
                                .expect("Tj operand should be a string")
                                .to_vec(),
                        )
                        .expect("page marker should be utf-8"),
                    )
                } else {
                    None
                }
            })
            .expect("missing page marker text");

        assert_eq!(marker, expected);
    }

    fn assert_page_contains_operator(doc: &Document, page_id: ObjectId, expected: &str) {
        let content = doc
            .get_page_content(page_id)
            .expect("missing page content");
        let decoded = Content::decode(&content).expect("failed to decode page content");
        assert!(
            decoded
                .operations
                .iter()
                .any(|operation| operation.operator == expected),
            "expected page to contain operator {expected}",
        );
    }

    fn create_large_text_fixture(path: &std::path::Path, page_count: usize) {
        let pages: Vec<_> = (1..=page_count)
            .map(|index| {
                let marker = format!("P{index}");
                (marker, 612_i64, 792_i64, 0_i64)
            })
            .collect();

        let page_refs: Vec<_> = pages
            .iter()
            .map(|(marker, width, height, rotation)| {
                (marker.as_str(), *width, *height, *rotation)
            })
            .collect();

        create_text_fixture_with_pages(path, &page_refs);
    }

    #[test]
    fn inspect_pdf_reports_page_boxes_and_rotation() {
        let dir = tempdir().expect("tempdir");
        let pdf_path = dir.path().join("inspect.pdf");
        create_text_fixture_with_pages(
            &pdf_path,
            &[("page-1", 612, 792, 0), ("page-2", 500, 700, 90)],
        );

        let summary = inspect_pdf(pdf_path.to_str().expect("utf-8 path")).expect("inspect pdf");

        assert_eq!(summary.page_count, 2);
        assert_eq!(
            summary.pages[0],
            PdfPageInfo {
                page_number: 1,
                media_box: [0.0, 0.0, 612.0, 792.0],
                crop_box: None,
                rotation: 0,
                thumbnail_data_url: summary.pages[0].thumbnail_data_url.clone(),
            }
        );
        assert_eq!(summary.pages[1].rotation, 90);
        assert_eq!(summary.pages[1].media_box, [0.0, 0.0, 500.0, 700.0]);
        assert!(
            summary.pages[0]
                .thumbnail_data_url
                .starts_with("data:image/png;base64,"),
            "inspect should include a thumbnail data url"
        );
    }

    #[test]
    fn merge_pdfs_writes_combined_output() {
        let dir = tempdir().expect("tempdir");
        let input_a = dir.path().join("a.pdf");
        let input_b = dir.path().join("b.pdf");
        let output = dir.path().join("merged.pdf");
        create_text_fixture_with_pages(&input_a, &[("a-1", 612, 792, 0)]);
        create_text_fixture_with_pages(&input_b, &[("b-1", 612, 792, 0), ("b-2", 612, 792, 0)]);

        let result = merge_pdfs(&MergePdfRequest {
            input_paths: vec![
                input_a.to_string_lossy().into_owned(),
                input_b.to_string_lossy().into_owned(),
            ],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("merge pdfs");

        assert_eq!(result.page_count, 3);
        assert!(output.exists(), "merge should create an output pdf");
    }

    #[test]
    fn split_pdf_extracts_selected_pages() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("split-input.pdf");
        let output = dir.path().join("split-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[
                ("p-1", 612, 792, 0),
                ("p-2", 612, 792, 0),
                ("p-3", 612, 792, 0),
            ],
        );

        let result = split_pdf(&SplitPdfRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![2, 3],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("split pdf");

        assert_eq!(result.page_count, 2);
        assert!(output.exists(), "split should create an output pdf");
    }

    #[test]
    fn rotate_pdf_swaps_page_dimensions_for_quarter_turns() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("rotate-input.pdf");
        let output = dir.path().join("rotate-output.pdf");
        create_text_fixture_with_pages(&input, &[("rotate", 612, 792, 0)]);

        rotate_pdf(&RotatePdfRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1],
            rotation_degrees: 90,
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("rotate pdf");

        let summary = inspect_pdf(output.to_str().expect("utf-8 path")).expect("inspect pdf");
        assert_eq!(summary.pages[0].rotation, 90);
        assert_eq!(summary.pages[0].media_box, [0.0, 0.0, 792.0, 612.0]);
    }

    #[test]
    fn rotate_pdf_rejects_non_quarter_turns() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("rotate-invalid-input.pdf");
        let output = dir.path().join("rotate-invalid-output.pdf");
        create_text_fixture_with_pages(&input, &[("rotate", 612, 792, 0)]);

        let error = rotate_pdf(&RotatePdfRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1],
            rotation_degrees: 45,
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect_err("non-quarter-turns should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
    }

    #[test]
    fn delete_pages_removes_selected_pages_and_rewrites_document() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("delete-input.pdf");
        let output = dir.path().join("delete-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[
                ("p-1", 612, 792, 0),
                ("p-2", 612, 792, 0),
                ("p-3", 612, 792, 0),
            ],
        );

        let result = delete_pages(&DeletePagesRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![2],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("delete pages");

        assert_eq!(result.page_count, 2);

        let summary = inspect_pdf(output.to_str().expect("utf-8 path")).expect("inspect pdf");
        assert_eq!(summary.page_count, 2);
    }

    #[test]
    fn delete_pages_rejects_removing_every_page() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("delete-all-input.pdf");
        let output = dir.path().join("delete-all-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("p-1", 612, 792, 0), ("p-2", 612, 792, 0)],
        );

        let error = delete_pages(&DeletePagesRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1, 2],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect_err("deleting all pages should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
    }

    #[test]
    fn duplicate_pages_inserts_selected_pages_after_their_originals() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("duplicate-input.pdf");
        let output = dir.path().join("duplicate-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("A", 612, 792, 0), ("B", 612, 792, 0), ("C", 612, 792, 0)],
        );

        let result = duplicate_pages(&DuplicatePagesRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![2],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("duplicate pages");

        assert_eq!(result.page_count, 4);
        assert_eq!(extract_page_markers(&output), vec!["A", "B", "B", "C"]);
    }

    #[test]
    fn insert_blank_page_adds_a_new_page_after_the_selected_page() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("insert-input.pdf");
        let output = dir.path().join("insert-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("A", 612, 792, 0), ("B", 400, 600, 0), ("C", 612, 792, 0)],
        );

        let result = insert_blank_page(&InsertBlankPageRequest {
            input_path: input.to_string_lossy().into_owned(),
            after_page_number: 2,
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("insert blank page");

        assert_eq!(result.page_count, 4);
        let summary = inspect_pdf(output.to_str().expect("utf-8 path")).expect("inspect pdf");
        assert_eq!(summary.page_count, 4);
        assert_eq!(summary.pages[2].media_box, [0.0, 0.0, 400.0, 600.0]);
    }

    #[test]
    fn copy_document_creates_a_distinct_pdf_copy() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("copy-input.pdf");
        let output = dir.path().join("nested/copy-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("A", 612, 792, 0), ("B", 612, 792, 0), ("C", 612, 792, 0)],
        );

        let result = copy_document(&CopyDocumentRequest {
            input_path: input.to_string_lossy().into_owned(),
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("copy document");

        assert_eq!(result.output_path, output.to_string_lossy());
        assert_eq!(result.page_count, 3);
        assert!(output.exists(), "copy should create an output pdf");
        assert_eq!(extract_page_markers(&output), vec!["A", "B", "C"]);
        assert_ne!(input, output, "copy target should stay distinct from input path");
    }

    #[test]
    fn reorder_pages_rewrites_document_in_the_requested_order() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("reorder-input.pdf");
        let output = dir.path().join("reorder-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("A", 612, 792, 0), ("B", 612, 792, 0), ("C", 612, 792, 0)],
        );

        let result = reorder_pages(&ReorderPagesRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![3, 1, 2],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect("reorder pages");

        assert_eq!(result.page_count, 3);
        assert_eq!(extract_page_markers(&output), vec!["C", "A", "B"]);
    }

    #[test]
    fn reorder_pages_rejects_duplicate_page_numbers() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("reorder-invalid-input.pdf");
        let output = dir.path().join("reorder-invalid-output.pdf");
        create_text_fixture_with_pages(
            &input,
            &[("A", 612, 792, 0), ("B", 612, 792, 0), ("C", 612, 792, 0)],
        );

        let error = reorder_pages(&ReorderPagesRequest {
            input_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1, 1, 3],
            output_path: output.to_string_lossy().into_owned(),
        })
        .expect_err("duplicate reorder pages should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
    }

    #[test]
    fn move_pages_between_documents_moves_a_page_into_the_target_position() {
        let dir = tempdir().expect("tempdir");
        let source = dir.path().join("move-source.pdf");
        let target = dir.path().join("move-target.pdf");
        create_text_fixture_with_pages(
            &source,
            &[("S1", 612, 792, 0), ("S2", 612, 792, 0), ("S3", 612, 792, 0)],
        );
        create_text_fixture_with_pages(
            &target,
            &[("T1", 612, 792, 0), ("T2", 612, 792, 0)],
        );

        move_pages_between_documents(&MovePagesBetweenDocumentsRequest {
            source_path: source.to_string_lossy().into_owned(),
            target_path: target.to_string_lossy().into_owned(),
            page_numbers: vec![2],
            target_position: 1,
        })
        .expect("move pages between documents");

        assert_eq!(extract_page_markers(&source), vec!["S1", "S3"]);
        assert_eq!(extract_page_markers(&target), vec!["T1", "S2", "T2"]);
    }

    #[test]
    fn move_pages_between_documents_rejects_moving_every_source_page() {
        let dir = tempdir().expect("tempdir");
        let source = dir.path().join("move-source-invalid.pdf");
        let target = dir.path().join("move-target-invalid.pdf");
        create_text_fixture_with_pages(&source, &[("S1", 612, 792, 0)]);
        create_text_fixture_with_pages(&target, &[("T1", 612, 792, 0)]);

        let error = move_pages_between_documents(&MovePagesBetweenDocumentsRequest {
            source_path: source.to_string_lossy().into_owned(),
            target_path: target.to_string_lossy().into_owned(),
            page_numbers: vec![1],
            target_position: 1,
        })
        .expect_err("moving every page out of source should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
    }

    #[test]
    fn crop_pdf_updates_crop_box_for_selected_pages() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("crop-input.pdf");
        create_text_fixture_with_pages(&input, &[("Crop", 612, 792, 0)]);

        let result = crop_pdf(&CropPdfRequest {
            input_path: input.to_string_lossy().into_owned(),
            output_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1],
            margins: CropMargins {
                left: 10.0,
                right: 20.0,
                top: 30.0,
                bottom: 40.0,
            },
        })
        .expect("crop should succeed");

        assert_eq!(result.page_count, 1);

        let summary = inspect_pdf(&input.to_string_lossy()).expect("inspect should succeed");
        assert_eq!(summary.pages[0].crop_box, Some([10.0, 40.0, 592.0, 762.0]));
    }

    #[test]
    fn crop_pdf_rejects_margins_that_exceed_the_page() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("crop-invalid.pdf");
        create_text_fixture_with_pages(&input, &[("Crop", 612, 792, 0)]);

        let error = crop_pdf(&CropPdfRequest {
            input_path: input.to_string_lossy().into_owned(),
            output_path: input.to_string_lossy().into_owned(),
            page_numbers: vec![1],
            margins: CropMargins {
                left: 400.0,
                right: 300.0,
                top: 0.0,
                bottom: 0.0,
            },
        })
        .expect_err("oversized crop should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
        assert!(error.to_string().contains("crop margins exceed the page bounds"));
    }

    #[test]
    fn import_images_inserts_pages_after_the_selected_page() {
        let dir = tempdir().expect("tempdir");
        let target = dir.path().join("image-import-target.pdf");
        let first_image = dir.path().join("image-1.png");
        let second_image = dir.path().join("image-2.webp");
        create_text_fixture_with_pages(&target, &[("T1", 612, 792, 0), ("T2", 612, 792, 0)]);
        create_test_image(&first_image, image::ImageFormat::Png, [255, 0, 0, 255]);
        create_test_image(&second_image, image::ImageFormat::WebP, [0, 128, 255, 255]);

        let result = import_images(&ImportImagesRequest {
            target_path: target.to_string_lossy().into_owned(),
            output_path: target.to_string_lossy().into_owned(),
            image_paths: vec![
                first_image.to_string_lossy().into_owned(),
                second_image.to_string_lossy().into_owned(),
            ],
            position: ImageImportPosition::AfterSelection,
            after_page_number: Some(1),
        })
        .expect("image import should succeed");

        assert_eq!(result.page_count, 4);
        let doc = Document::load(&target).expect("imported doc should load");
        let page_ids: Vec<_> = doc.get_pages().values().copied().collect();
        assert_page_marker(&doc, page_ids[0], "T1");
        assert_page_contains_operator(&doc, page_ids[1], "Do");
        assert_page_contains_operator(&doc, page_ids[2], "Do");
        assert_page_marker(&doc, page_ids[3], "T2");
    }

    #[test]
    fn import_images_requires_an_anchor_page_for_insert_after_selection() {
        let dir = tempdir().expect("tempdir");
        let target = dir.path().join("image-import-invalid.pdf");
        let image_path = dir.path().join("image-invalid.png");
        create_text_fixture_with_pages(&target, &[("T1", 612, 792, 0)]);
        create_test_image(&image_path, image::ImageFormat::Png, [255, 0, 0, 255]);

        let error = import_images(&ImportImagesRequest {
            target_path: target.to_string_lossy().into_owned(),
            output_path: target.to_string_lossy().into_owned(),
            image_paths: vec![image_path.to_string_lossy().into_owned()],
            position: ImageImportPosition::AfterSelection,
            after_page_number: None,
        })
        .expect_err("missing insertion anchor should fail");

        assert!(
            matches!(error, AppError::InvalidRequest(_)),
            "expected validation error, got {error:?}"
        );
    }

    #[test]
    fn inspect_pdf_handles_large_documents_with_500_pages() {
        let dir = tempdir().expect("tempdir");
        let input = dir.path().join("large-500-pages.pdf");
        create_large_text_fixture(&input, 500);

        let summary = inspect_pdf(&input.to_string_lossy()).expect("inspect should succeed");

        assert_eq!(summary.page_count, 500);
        assert_eq!(summary.pages.first().map(|page| page.page_number), Some(1));
        assert_eq!(summary.pages.last().map(|page| page.page_number), Some(500));
    }
}
