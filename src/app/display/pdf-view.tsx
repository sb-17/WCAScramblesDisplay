"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask } from "pdfjs-dist";

/** Beyond this, canvases get large for no visible gain on a tablet. */
const MAX_PIXEL_RATIO = 2;

/**
 * Renders every page stacked and scrollable rather than offering page controls. A scramble
 * set is one or two pages, and adding navigation to this screen is exactly what the design
 * avoids -- a scrambler should never be able to reach anything but what was pushed.
 *
 * The PDF is drawn on white and never inverted: several events carry colour-coded
 * diagrams that inverting would corrupt.
 */
export default function PdfView({ pdf, passcode }: { pdf: Uint8Array; passcode: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Teardown lives on the loading task in pdf.js 6, not on the document proxy.
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    let renderToken = 0;

    void (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

      try {
        // pdf.js takes ownership of the buffer it is handed, so give it a copy -- the
        // original is kept so a resize can re-render without re-fetching.
        const task = pdfjs.getDocument({ data: pdf.slice(), password: passcode });
        taskRef.current = task;

        const doc = await task.promise;
        if (cancelled) return;

        const draw = async () => {
          const host = hostRef.current;
          if (!host) return;

          const token = ++renderToken;
          const width = host.clientWidth;
          if (width === 0) return;

          const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
          const canvases: HTMLCanvasElement[] = [];

          for (let number = 1; number <= doc.numPages; number += 1) {
            const page = await doc.getPage(number);
            if (cancelled || token !== renderToken) return;

            const unscaled = page.getViewport({ scale: 1 });
            const viewport = page.getViewport({ scale: (width / unscaled.width) * ratio });

            const canvas = document.createElement("canvas");
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvas.className = "pdf-page";
            await page.render({ canvas, viewport }).promise;
            if (cancelled || token !== renderToken) return;

            canvases.push(canvas);
          }

          // Swapped in together so a re-render never shows a half-drawn document.
          host.replaceChildren(...canvases);
        };

        await draw();
        if (cancelled) return;

        observer = new ResizeObserver(() => void draw());
        if (hostRef.current) observer.observe(hostRef.current);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      void taskRef.current?.destroy();
      taskRef.current = null;
    };
  }, [pdf, passcode]);

  if (error) {
    return (
      <div className="notice">
        <p>Could not draw this scramble sheet: {error}</p>
      </div>
    );
  }

  return <div className="pdf-host" ref={hostRef} />;
}
