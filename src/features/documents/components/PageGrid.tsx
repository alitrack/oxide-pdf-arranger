import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import type { PdfPageInfo } from "../../backend/types/pdf";
import { computeVirtualGridWindow } from "../lib/virtualGrid";

interface PageGridProps {
  pages: PdfPageInfo[];
  isLoading: boolean;
  gridItemWidth: number;
  onZoomIn(): void;
  onZoomOut(): void;
  onResetZoom(): void;
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
  gridItemWidth,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  selectedPageNumbers,
  onPageClick,
}: PageGridProps) {
  const skeletons = Array.from({ length: 6 }, (_, index) => `skeleton-${index}`);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(gridItemWidth * 4);
  const [viewportHeight, setViewportHeight] = useState(720);
  const virtualWindow = useMemo(
    () =>
      computeVirtualGridWindow({
        itemCount: pages.length,
        gridItemWidth,
        viewportWidth,
        viewportHeight,
        scrollTop,
      }),
    [gridItemWidth, pages.length, scrollTop, viewportHeight, viewportWidth],
  );
  const visiblePages = pages.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  const gridStyle = {
    "--page-grid-min": `${gridItemWidth}px`,
    "--page-preview-min-height": `${Math.round(gridItemWidth * 1.28)}px`,
  } as CSSProperties;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const syncMeasurements = () => {
      setViewportWidth(viewport.clientWidth);
      setViewportHeight(viewport.clientHeight);
    };

    syncMeasurements();

    const observer = new ResizeObserver(syncMeasurements);
    observer.observe(viewport);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
  }, [pages, gridItemWidth]);

  return (
    <div className="page-grid-shell" style={gridStyle}>
      <div className="page-grid-header">
        <div>
          <p className="panel-kicker">Page Grid</p>
          <h3>Responsive document surface</h3>
        </div>
        <div className="page-grid-tools">
          <p className="page-grid-caption">
            先用页面尺寸和旋转元数据建立网格布局，后续可直接替换成真实缩略图渲染结果。
          </p>
          <div className="zoom-controls" role="group" aria-label="Page grid zoom controls">
            <button onClick={onZoomOut} type="button">
              Compact
            </button>
            <button onClick={onResetZoom} type="button">
              Reset
            </button>
            <button onClick={onZoomIn} type="button">
              Detailed
            </button>
          </div>
        </div>
      </div>

      <div
        className={`page-grid-viewport${pages.length > 0 ? " virtualized" : ""}`}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        ref={viewportRef}
      >
        {pages.length > 0 ? (
          <div className="page-grid-virtual-stack">
            <div style={{ height: `${virtualWindow.paddingTop}px` }} />
            <div className="page-grid">
              {visiblePages.map((page) => (
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
                    <span>
                      {page.mediaBox[2] - page.mediaBox[0]} × {page.mediaBox[3] - page.mediaBox[1]}
                    </span>
                    <span>Rotate {page.rotation}°</span>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ height: `${virtualWindow.paddingBottom}px` }} />
          </div>
        ) : null}

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
          : null}
      </div>
    </div>
  );
}
