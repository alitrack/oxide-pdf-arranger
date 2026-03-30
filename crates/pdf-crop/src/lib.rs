use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct PageBox {
    pub left: f32,
    pub bottom: f32,
    pub right: f32,
    pub top: f32,
}

impl PageBox {
    pub fn width(self) -> f32 {
        self.right - self.left
    }

    pub fn height(self) -> f32 {
        self.top - self.bottom
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct CropMargins {
    pub left: f32,
    pub right: f32,
    pub top: f32,
    pub bottom: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CropError {
    NegativeMargin,
    MarginExceedsPage,
}

pub fn crop_page_box(page_box: PageBox, margins: CropMargins) -> Result<PageBox, CropError> {
    if margins.left < 0.0 || margins.right < 0.0 || margins.top < 0.0 || margins.bottom < 0.0 {
        return Err(CropError::NegativeMargin);
    }

    let cropped = PageBox {
        left: page_box.left + margins.left,
        bottom: page_box.bottom + margins.bottom,
        right: page_box.right - margins.right,
        top: page_box.top - margins.top,
    };

    if cropped.left >= cropped.right || cropped.bottom >= cropped.top {
        return Err(CropError::MarginExceedsPage);
    }

    Ok(cropped)
}

pub fn crop_margins_are_empty(margins: CropMargins) -> bool {
    margins.left == 0.0 && margins.right == 0.0 && margins.top == 0.0 && margins.bottom == 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crops_page_box_by_margins() {
        let page_box = PageBox {
            left: 0.0,
            bottom: 0.0,
            right: 595.0,
            top: 842.0,
        };
        let margins = CropMargins {
            left: 10.0,
            right: 15.0,
            top: 20.0,
            bottom: 25.0,
        };

        let cropped = crop_page_box(page_box, margins).expect("crop should succeed");

        assert_eq!(
            cropped,
            PageBox {
                left: 10.0,
                bottom: 25.0,
                right: 580.0,
                top: 822.0,
            }
        );
        assert_eq!(cropped.width(), 570.0);
        assert_eq!(cropped.height(), 797.0);
    }

    #[test]
    fn rejects_negative_margins() {
        let page_box = PageBox {
            left: 0.0,
            bottom: 0.0,
            right: 100.0,
            top: 100.0,
        };
        let margins = CropMargins {
            left: -1.0,
            ..CropMargins::default()
        };

        let error = crop_page_box(page_box, margins).expect_err("negative margins should fail");
        assert_eq!(error, CropError::NegativeMargin);
    }

    #[test]
    fn rejects_overlapping_crop_box() {
        let page_box = PageBox {
            left: 0.0,
            bottom: 0.0,
            right: 100.0,
            top: 100.0,
        };
        let margins = CropMargins {
            left: 60.0,
            right: 40.0,
            top: 0.0,
            bottom: 0.0,
        };

        let error = crop_page_box(page_box, margins).expect_err("oversized margins should fail");
        assert_eq!(error, CropError::MarginExceedsPage);
    }

    #[test]
    fn reports_empty_margins() {
        assert!(crop_margins_are_empty(CropMargins::default()));
        assert!(!crop_margins_are_empty(CropMargins {
            top: 1.0,
            ..CropMargins::default()
        }));
    }
}
