import type { MouseEvent } from "react";
import type { PdfPageInfo } from "../../backend/types/pdf";

interface PageGridProps {
  pages: PdfPageInfo[];
  isLoading: boolean;
  selectedPageNumbers: number[];
  onPageClick(pageNumber: number, mode: "replace" | "toggle" | "range"): void;
}

function getAspectRatio(page: PdfPageInfo) {
  const width = Math.max(page.mediaBox[2] - page.mediaBox[0], 1);
  const height = Math.max(page.mediaBox[3] - page.mediaBox[1], 1);
  return `${width} / ${height}`;
}

function getPageLabel(page: PdfPageInfo) {
  return `Page ${page.pageNumber}`;
}

function getSelectionMode(event: MouseEvent<HTMLButtonElement>) {
  if (event.shiftKey) {
    return "range" as const;
  }

  if (event.metaKey || event.ctrlKey) {
    return "toggle" as const;
  }

  return "replace" as const;
}

export function PageGrid({
  pages,
  isLoading,
  selectedPageNumbers,
  onPageClick,
}: PageGridProps) {
  const skeletons = Array.from({ length: 6 }, (_, index) => `skeleton-${index}`);

  return (
    <div className="page-grid-shell">
      <div className="page-grid-header">
        <div>
          <p className="panel-kicker">Page Grid</p>
          <h3>Responsive document surface</h3>
        </div>
        <p className="page-grid-caption">
          先用页面尺寸和旋转元数据建立网格布局，后续可直接替换成真实缩略图渲染结果。
        </p>
      </div>

      <div className="page-grid">
        {isLoading && pages.length === 0
          ? skeletons.map((key) => (
              <article className="page-card skeleton" key={key}>
                <div className="page-preview" />
                <div className="page-meta">
                  <span />
                  <span />
                </div>
              </article>
            ))
          : pages.map((page) => (
              <button
                aria-pressed={selectedPageNumbers.includes(page.pageNumber)}
                className={`page-card${selectedPageNumbers.includes(page.pageNumber) ? " selected" : ""}`}
                key={page.pageNumber}
                onClick={(event) => onPageClick(page.pageNumber, getSelectionMode(event))}
                type="button"
              >
                <div className="page-preview-wrap">
                  <div className="page-preview" style={{ aspectRatio: getAspectRatio(page) }}>
                    <img
                      alt={`${getPageLabel(page)} preview`}
                      className="page-preview-image"
                      src={page.thumbnailDataUrl}
                    />
                    <span className="page-badge">{getPageLabel(page)}</span>
                    <div className="page-preview-center">
                      <strong>{page.pageNumber}</strong>
                      <small>{page.rotation}°</small>
                    </div>
                  </div>
                </div>
                <div className="page-meta">
                  <span>{page.mediaBox[2] - page.mediaBox[0]} × {page.mediaBox[3] - page.mediaBox[1]}</span>
                  <span>Rotate {page.rotation}°</span>
                </div>
              </button>
            ))}
      </div>
    </div>
  );
}
