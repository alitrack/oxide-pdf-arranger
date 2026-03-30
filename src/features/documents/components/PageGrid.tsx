import type { PdfPageInfo } from "../../backend/types/pdf";

interface PageGridProps {
  pages: PdfPageInfo[];
  isLoading: boolean;
}

function getAspectRatio(page: PdfPageInfo) {
  const width = Math.max(page.mediaBox[2] - page.mediaBox[0], 1);
  const height = Math.max(page.mediaBox[3] - page.mediaBox[1], 1);
  return `${width} / ${height}`;
}

function getPageLabel(page: PdfPageInfo) {
  return `Page ${page.pageNumber}`;
}

export function PageGrid({ pages, isLoading }: PageGridProps) {
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
              <article className="page-card" key={page.pageNumber}>
                <div className="page-preview-wrap">
                  <div className="page-preview" style={{ aspectRatio: getAspectRatio(page) }}>
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
              </article>
            ))}
      </div>
    </div>
  );
}
