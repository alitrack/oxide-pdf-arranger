use lopdf::{Document, Object, ObjectId};
use pdf_core::{InputSource, PdfDocument, PdfError};
use pdf_merge::MergeEngine;
use pdf_page_range::{PageNum, PageRange, Qualifier, Rotation};
use pdf_rotate::RotateEngine;
use pdf_split::extract_pages;
use serde::ser::Serializer;
use serde::{Deserialize, Serialize};
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
        pages.push(PdfPageInfo {
            page_number: *page_number,
            media_box: find_page_box(&doc.inner, *page_id, b"MediaBox")
                .unwrap_or(DEFAULT_MEDIA_BOX),
            crop_box: find_page_box(&doc.inner, *page_id, b"CropBox"),
            rotation: find_inherited_object(&doc.inner, *page_id, b"Rotate")
                .and_then(|value| object_to_i32(&value))
                .unwrap_or(0),
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
            }
        );
        assert_eq!(summary.pages[1].rotation, 90);
        assert_eq!(summary.pages[1].media_box, [0.0, 0.0, 500.0, 700.0]);
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
}
