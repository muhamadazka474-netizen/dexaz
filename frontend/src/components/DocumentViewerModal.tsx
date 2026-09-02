"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { Document as PdfDocument, Page as PdfPage, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { init as initPptxPreview } from "pptx-preview";
import { AppDocument, fetchDocumentBytes } from "@/lib/api";

// Bundled locally by webpack (see next.config.ts is untouched — this URL
// pattern is enough on its own), so the worker ships inside the app's own
// static assets and never needs internet access at runtime.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.2;
const PPTX_SLIDE_WIDTH = 960;
const PPTX_SLIDE_HEIGHT = 540;
// How long the floating nav controls stay visible after the last
// mouse/touch activity before they fade themselves out.
const CONTROLS_HIDE_DELAY_MS = 2500;

export function DocumentViewerModal({ doc, onClose }: { doc: AppDocument; onClose: () => void }) {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // PDF state
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);

  // PPTX state
  const pptxContainerRef = useRef<HTMLDivElement>(null);
  const pptxPreviewerRef = useRef<ReturnType<typeof initPptxPreview> | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideCount, setSlideCount] = useState(0);

  const frameRef = useRef<HTMLDivElement>(null);

  const isPdf = doc.file_type === "pdf";
  const isPptx = doc.file_type === "pptx" || doc.file_type === "ppt";

  // Auto-hiding floating nav controls (replaces the pptx-preview library's
  // own always-visible, content-blocking next/prev buttons).
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wakeControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    hideControlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, []);

  // Start hidden-after-delay as soon as a document is ready to browse, and
  // clean up the timer on unmount.
  useEffect(() => {
    wakeControls();
    return () => {
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    };
  }, [wakeControls]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDocumentBytes(doc.id)
      .then((buf) => {
        if (!cancelled) setBytes(buf);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat dokumen.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  // Mount the pptx-preview renderer once we have bytes and a container.
  useEffect(() => {
    if (!isPptx || !bytes || !pptxContainerRef.current) return;
    const previewer = initPptxPreview(pptxContainerRef.current, {
      width: PPTX_SLIDE_WIDTH,
      height: PPTX_SLIDE_HEIGHT,
      mode: "slide",
    });
    pptxPreviewerRef.current = previewer;
    previewer
      .preview(bytes.slice(0))
      .then(() => {
        setSlideCount(previewer.slideCount ?? 0);
        setSlideIndex(previewer.currentIndex ?? 0);
      })
      .catch(() => setError("Gagal menampilkan file PowerPoint."));

    return () => {
      previewer.destroy();
      pptxPreviewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPptx, bytes]);

  const goNextSlide = useCallback(() => {
    const p = pptxPreviewerRef.current;
    if (!p) return;
    p.renderNextSlide();
    setSlideIndex(p.currentIndex ?? 0);
  }, []);

  const goPrevSlide = useCallback(() => {
    const p = pptxPreviewerRef.current;
    if (!p) return;
    p.renderPreSlide();
    setSlideIndex(p.currentIndex ?? 0);
  }, []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2))), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2))), []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      frameRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keyboard: arrows to navigate, +/- to zoom, Escape to close (when not
  // fullscreen — fullscreen already gets Escape natively from the browser).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        if (isPdf) setPageNumber((p) => Math.min(numPages, p + 1));
        if (isPptx) goNextSlide();
        wakeControls();
      } else if (e.key === "ArrowLeft") {
        if (isPdf) setPageNumber((p) => Math.max(1, p - 1));
        if (isPptx) goPrevSlide();
        wakeControls();
      } else if (e.key === "+" || e.key === "=") {
        zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        zoomOut();
      } else if (e.key === "Escape" && !document.fullscreenElement) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPdf, isPptx, numPages, goNextSlide, goPrevSlide, zoomIn, zoomOut, onClose, wakeControls]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        ref={frameRef}
        // Solid bg-void (near-black), not the dbx-glass-strong navy gradient —
        // that gradient was showing through as a visible blue tint whenever
        // the modal fills the whole screen (e.g. in fullscreen/presentation
        // mode), instead of a clean black backdrop around the document.
        className="w-full h-full flex flex-col bg-void"
      >
        {/* Toolbar */}
        <div className="shrink-0 border-b border-border-glass px-4 py-2.5 flex items-center gap-3">
          <p className="text-sm text-text truncate flex-1 min-w-0">{doc.filename}</p>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={zoomOut}
              title="Perkecil (-)"
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-xs text-text-faint tabular-nums w-11 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={zoomIn}
              title="Perbesar (+)"
              className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors"
            >
              <ZoomIn size={16} />
            </button>
          </div>

          {isPdf && numPages > 0 && (
            <div className="flex items-center gap-1 shrink-0 border-l border-border-glass pl-3">
              <button
                onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                disabled={pageNumber <= 1}
                className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-faint tabular-nums w-16 text-center">
                {pageNumber} / {numPages}
              </span>
              <button
                onClick={() => setPageNumber((p) => Math.min(numPages, p + 1))}
                disabled={pageNumber >= numPages}
                className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {isPptx && slideCount > 0 && (
            <div className="flex items-center gap-1 shrink-0 border-l border-border-glass pl-3">
              <button
                onClick={goPrevSlide}
                disabled={slideIndex <= 0}
                className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-text-faint tabular-nums w-20 text-center">
                Slide {slideIndex + 1} / {slideCount}
              </span>
              <button
                onClick={goNextSlide}
                disabled={slideIndex >= slideCount - 1}
                className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-panel/60 transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          <button
            onClick={toggleFullscreen}
            title={isFullscreen ? "Keluar dari mode presentasi" : "Presentasikan (layar penuh)"}
            className="p-1.5 rounded-lg text-text-muted hover:text-cyan hover:bg-panel/60 transition-colors border-l border-border-glass pl-3 ml-1"
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
          <button
            onClick={onClose}
            title="Tutup"
            className="p-1.5 rounded-lg text-text-muted hover:text-danger hover:bg-panel/60 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div
          className="relative flex-1 overflow-auto dbx-scrollbar flex items-start justify-center p-8"
          onMouseMove={wakeControls}
          onTouchStart={wakeControls}
        >
          {loading && (
            <div className="flex items-center gap-2 text-sm text-text-muted py-20">
              <Loader2 size={18} className="animate-spin" />
              Memuat dokumen...
            </div>
          )}

          {!loading && error && (
            <div className="flex flex-col items-center gap-2 text-sm text-danger py-20">
              <AlertTriangle size={22} />
              {error}
            </div>
          )}

          {!loading && !error && bytes && isPdf && (
            <PdfDocument
              file={bytes}
              onLoadSuccess={({ numPages: n }) => {
                setNumPages(n);
                setPageNumber(1);
              }}
              onLoadError={() => setError("Gagal menampilkan file PDF.")}
              loading={
                <div className="flex items-center gap-2 text-sm text-text-muted py-20">
                  <Loader2 size={18} className="animate-spin" />
                  Merender PDF...
                </div>
              }
            >
              <PdfPage pageNumber={pageNumber} scale={zoom} />
            </PdfDocument>
          )}

          {!loading && !error && bytes && isPptx && (
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
                width: PPTX_SLIDE_WIDTH,
                height: PPTX_SLIDE_HEIGHT,
              }}
            >
              <div ref={pptxContainerRef} />
            </div>
          )}

          {/* Auto-hiding floating nav controls. Replaces the pptx-preview
              library's own permanently-visible next/prev buttons, which sat
              on top of the slide and blocked its content. These fade in on
              mouse/touch activity and fade themselves out after a few
              seconds idle. */}
          {!loading && !error && bytes && (isPdf ? numPages > 0 : slideCount > 0) && (
            <div
              className={`pointer-events-none fixed inset-x-0 bottom-6 z-10 flex items-center justify-center gap-4 transition-opacity duration-300 ${
                controlsVisible ? "opacity-100" : "opacity-0"
              }`}
            >
              <button
                onClick={isPdf ? () => setPageNumber((p) => Math.max(1, p - 1)) : goPrevSlide}
                disabled={isPdf ? pageNumber <= 1 : slideIndex <= 0}
                title="Sebelumnya"
                className="pointer-events-auto p-2.5 rounded-full bg-panel/80 text-text border border-border-glass hover:bg-panel hover:text-cyan transition-colors disabled:opacity-30 disabled:pointer-events-none backdrop-blur-md"
              >
                <ChevronLeft size={18} />
              </button>
              <span className="pointer-events-auto px-3 py-1 rounded-full bg-panel/80 text-xs text-text-muted tabular-nums border border-border-glass backdrop-blur-md">
                {isPdf ? `${pageNumber} / ${numPages}` : `Slide ${slideIndex + 1} / ${slideCount}`}
              </span>
              <button
                onClick={isPdf ? () => setPageNumber((p) => Math.min(numPages, p + 1)) : goNextSlide}
                disabled={isPdf ? pageNumber >= numPages : slideIndex >= slideCount - 1}
                title="Berikutnya"
                className="pointer-events-auto p-2.5 rounded-full bg-panel/80 text-text border border-border-glass hover:bg-panel hover:text-cyan transition-colors disabled:opacity-30 disabled:pointer-events-none backdrop-blur-md"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
