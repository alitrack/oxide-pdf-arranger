import { usePdfDocumentStore } from "../../documents/store/pdfDocumentStore";
import { PageGrid } from "../../documents/components/PageGrid";

const operationCards = [
  {
    command: "inspect_pdf",
    title: "Inspect",
    description: "读取页数、MediaBox、CropBox 与 Rotate 元数据。",
    contract: "path -> PdfDocumentSummary",
  },
  {
    command: "merge_pdfs",
    title: "Merge",
    description: "按输入顺序合并多个 PDF，并返回输出文档页数。",
    contract: "MergePdfRequest -> PdfOperationResult",
  },
  {
    command: "split_pdf",
    title: "Split",
    description: "按显式页号提取新文档，适合作为后续页面选择的基础。",
    contract: "SplitPdfRequest -> PdfOperationResult",
  },
  {
    command: "rotate_pdf",
    title: "Rotate",
    description: "按 90 度步进修改页面旋转，并维护页面 box 尺寸。",
    contract: "RotatePdfRequest -> PdfOperationResult",
  },
] as const;

function formatBox(box: [number, number, number, number]) {
  return box.map((value) => value.toFixed(0)).join(" / ");
}

function formatSize(box: [number, number, number, number]) {
  return `${box[2] - box[0]} × ${box[3] - box[1]}`;
}

export function BackendWorkspace() {
  const pdfPath = usePdfDocumentStore((state) => state.draftPath);
  const lastError = usePdfDocumentStore((state) => state.lastError);
  const lastOperationMessage = usePdfDocumentStore(
    (state) => state.lastOperationMessage,
  );
  const documentSummary = usePdfDocumentStore((state) => state.activeDocument);
  const isInspecting = usePdfDocumentStore((state) => state.isInspecting);
  const isRotating = usePdfDocumentStore((state) => state.isRotating);
  const isDeleting = usePdfDocumentStore((state) => state.isDeleting);
  const selectedPageNumbers = usePdfDocumentStore((state) => state.selectedPageNumbers);
  const gridItemWidth = usePdfDocumentStore((state) => state.gridItemWidth);
  const setDraftPath = usePdfDocumentStore((state) => state.setDraftPath);
  const inspectPdf = usePdfDocumentStore((state) => state.inspectPdf);
  const selectPage = usePdfDocumentStore((state) => state.selectPage);
  const rotateSelectedPages = usePdfDocumentStore(
    (state) => state.rotateSelectedPages,
  );
  const deleteSelectedPages = usePdfDocumentStore(
    (state) => state.deleteSelectedPages,
  );
  const zoomInGrid = usePdfDocumentStore((state) => state.zoomInGrid);
  const zoomOutGrid = usePdfDocumentStore((state) => state.zoomOutGrid);
  const resetGridZoom = usePdfDocumentStore((state) => state.resetGridZoom);
  const isApplyingPageAction = isRotating || isDeleting;

  async function handleInspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await inspectPdf();
  }

  return (
    <div className="shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Oxide PDF Arranger</p>
          <h1>Backend-ready workspace for page arrangement.</h1>
          <p className="lead">
            当前前端先把 Rust/Tauri 能力接通：命令契约、错误归一化、以及最小可用的
            PDF inspect 工作台已经就位，后续可以直接继续接 Zustand、缩略图和页面栅格。
          </p>
        </div>
        <div className="hero-panel">
          <p className="hero-panel-label">Foundation Checkpoint</p>
          <ul className="checkpoint-list">
            <li>Rust core ops are tested</li>
            <li>Tauri commands are wired</li>
            <li>Frontend invoke wrapper is ready</li>
          </ul>
        </div>
      </header>

      <main className="workspace-grid">
        <section className="panel panel-operations">
          <div className="panel-header">
            <p className="panel-kicker">Command Surface</p>
            <h2>Backend contracts now exposed to the frontend</h2>
          </div>
          <div className="operation-grid">
            {operationCards.map((card) => (
              <article className="operation-card" key={card.command}>
                <div className="operation-card-topline">
                  <span>{card.title}</span>
                  <code>{card.command}</code>
                </div>
                <p>{card.description}</p>
                <p className="contract">{card.contract}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel panel-inspector">
          <div className="panel-header">
            <p className="panel-kicker">Live Probe</p>
            <h2>Inspect a PDF by absolute path</h2>
          </div>

          <form className="inspect-form" onSubmit={handleInspect}>
            <label className="field">
              <span>PDF path</span>
              <input
                name="pdfPath"
                value={pdfPath}
                onChange={(event) => setDraftPath(event.currentTarget.value)}
                placeholder="/absolute/path/to/document.pdf"
              />
            </label>

            <button className="primary-button" disabled={isInspecting} type="submit">
              {isInspecting ? "Inspecting..." : "Inspect PDF"}
            </button>
          </form>

          {lastError ? <div className="status-banner error">{lastError}</div> : null}
          {lastOperationMessage ? (
            <div className="status-banner success">{lastOperationMessage}</div>
          ) : null}

          {documentSummary ? (
            <div className="document-summary">
              <div className="summary-topline">
                <div>
                  <p className="summary-label">Document</p>
                  <h3>{documentSummary.path}</h3>
                </div>
                <div className="summary-pill">
                  <span>{documentSummary.pageCount}</span>
                  <small>pages</small>
                </div>
              </div>

              <div className="summary-selection">
                <span>Selected</span>
                <strong>{selectedPageNumbers.length}</strong>
                <small>{selectedPageNumbers.join(", ") || "none"}</small>
              </div>

              <div className="page-action-bar">
                <span>Rotate selected</span>
                <div className="page-action-buttons">
                  {[90, 180, 270].map((degrees) => (
                    <button
                      className="secondary-button"
                      disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                      key={degrees}
                      onClick={() => rotateSelectedPages(degrees as 90 | 180 | 270)}
                      type="button"
                    >
                      {isRotating ? "Applying..." : `${degrees}°`}
                    </button>
                  ))}
                  <button
                    className="secondary-button danger"
                    disabled={selectedPageNumbers.length === 0 || isApplyingPageAction}
                    onClick={() => deleteSelectedPages()}
                    type="button"
                  >
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </div>

              <div className="summary-metadata">
                <div className="summary-field">
                  <span>First page size</span>
                  <strong>{formatSize(documentSummary.pages[0].mediaBox)}</strong>
                </div>
                <div className="summary-field">
                  <span>First page box</span>
                  <strong>{formatBox(documentSummary.pages[0].mediaBox)}</strong>
                </div>
              </div>

              <PageGrid
                gridItemWidth={gridItemWidth}
                isLoading={isInspecting}
                onPageClick={selectPage}
                onResetZoom={resetGridZoom}
                onZoomIn={zoomInGrid}
                onZoomOut={zoomOutGrid}
                pages={documentSummary.pages}
                selectedPageNumbers={selectedPageNumbers}
              />
            </div>
          ) : (
            <div className="empty-state">
              <p>No document loaded yet.</p>
              <small>
                这里先验证 Tauri invoke 与返回结构；后续可在此基础上接入文件选择器和页面缩略图。
              </small>
            </div>
          )}

          {!documentSummary && isInspecting ? (
            <PageGrid
              gridItemWidth={gridItemWidth}
              isLoading={isInspecting}
              onPageClick={selectPage}
              onResetZoom={resetGridZoom}
              onZoomIn={zoomInGrid}
              onZoomOut={zoomOutGrid}
              pages={[]}
              selectedPageNumbers={selectedPageNumbers}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
