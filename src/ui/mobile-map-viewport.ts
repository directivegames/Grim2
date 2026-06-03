/**
 * Touch pan + pinch zoom for the Burdenville map on mobile.
 */
const MIN_SCALE_FILL = 1;
const MIN_SCALE_PAN = 0.55;
const MAX_SCALE = 2.6;

export type MobileMapPanZoomOptions = {
  /** Stage matches viewport; map fills screen (cover). Pinch to zoom in only. */
  fillViewport?: boolean;
};

type TouchPoint = { x: number; y: number };

function touchDistance(a: TouchPoint, b: TouchPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function touchCenter(a: TouchPoint, b: TouchPoint): TouchPoint {
  return { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
}

function isMapMarkerTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('.grim-map-marker-enter'));
}

function isMapPanTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  return Boolean(
    target.closest('[data-grim-map-pan-surface]') &&
    !isMapMarkerTarget(target),
  );
}

export function attachMobileMapPanZoom(
  viewport: HTMLElement,
  stage: HTMLElement,
  options: MobileMapPanZoomOptions = {},
): () => void {
  const fillViewport = options.fillViewport ?? false;
  const minScale = fillViewport ? MIN_SCALE_FILL : MIN_SCALE_PAN;

  let scale = 1;
  let panX = 0;
  let panY = 0;

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let panStartX = 0;
  let panStartY = 0;

  let pinching = false;
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let pinchAnchorX = 0;
  let pinchAnchorY = 0;

  const applyTransform = (): void => {
    stage.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  };

  const clampPan = (): void => {
    if (fillViewport && scale <= 1.001) {
      panX = 0;
      panY = 0;
      return;
    }

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const sw = stage.offsetWidth * scale;
    const sh = stage.offsetHeight * scale;

    const minX = Math.min(0, vw - sw);
    const minY = Math.min(0, vh - sh);

    panX = Math.min(0, Math.max(minX, panX));
    panY = Math.min(0, Math.max(minY, panY));
  };

  const fitToViewport = (): void => {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const sw = stage.offsetWidth;
    const sh = stage.offsetHeight;
    if (vw <= 0 || vh <= 0 || sw <= 0 || sh <= 0) {
      return;
    }

    if (fillViewport) {
      scale = 1;
      panX = 0;
      panY = 0;
      applyTransform();
      return;
    }

    scale = Math.min(vw / sw, vh / sh) * 0.96;
    scale = Math.max(minScale, Math.min(MAX_SCALE, scale));
    panX = (vw - sw * scale) * 0.5;
    panY = (vh - sh * scale) * 0.5;
    clampPan();
    applyTransform();
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (!isMapPanTarget(e.target)) {
      return;
    }

    if (e.touches.length === 1) {
      if (fillViewport && scale <= 1.001) {
        return;
      }
      dragging = true;
      dragStartX = e.touches[0]!.clientX;
      dragStartY = e.touches[0]!.clientY;
      panStartX = panX;
      panStartY = panY;
      return;
    }

    if (e.touches.length === 2) {
      dragging = false;
      pinching = true;
      const a = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      const b = { x: e.touches[1]!.clientX, y: e.touches[1]!.clientY };
      const center = touchCenter(a, b);
      const rect = viewport.getBoundingClientRect();
      pinchStartDistance = touchDistance(a, b);
      pinchStartScale = scale;
      pinchAnchorX = center.x - rect.left;
      pinchAnchorY = center.y - rect.top;
      e.preventDefault();
    }
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (pinching && e.touches.length >= 2) {
      const a = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
      const b = { x: e.touches[1]!.clientX, y: e.touches[1]!.clientY };
      const dist = touchDistance(a, b);
      if (pinchStartDistance > 0) {
        const next = pinchStartScale * (dist / pinchStartDistance);
        const clamped = Math.max(minScale, Math.min(MAX_SCALE, next));
        const ratio = clamped / scale;
        panX = pinchAnchorX - (pinchAnchorX - panX) * ratio;
        panY = pinchAnchorY - (pinchAnchorY - panY) * ratio;
        scale = clamped;
        clampPan();
        applyTransform();
      }
      e.preventDefault();
      return;
    }

    if (dragging && e.touches.length === 1) {
      panX = panStartX + (e.touches[0]!.clientX - dragStartX);
      panY = panStartY + (e.touches[0]!.clientY - dragStartY);
      clampPan();
      applyTransform();
      e.preventDefault();
    }
  };

  const onTouchEnd = (): void => {
    dragging = false;
    pinching = false;
    if (fillViewport && scale <= 1.001) {
      panX = 0;
      panY = 0;
      applyTransform();
    }
  };

  viewport.addEventListener('touchstart', onTouchStart, { passive: false });
  viewport.addEventListener('touchmove', onTouchMove, { passive: false });
  viewport.addEventListener('touchend', onTouchEnd, { passive: true });
  viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const onResize = (): void => {
    fitToViewport();
  };
  window.addEventListener('resize', onResize, { passive: true });

  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => fitToViewport())
    : null;
  resizeObserver?.observe(viewport);

  requestAnimationFrame(() => {
    requestAnimationFrame(fitToViewport);
  });

  return () => {
    resizeObserver?.disconnect();
    viewport.removeEventListener('touchstart', onTouchStart);
    viewport.removeEventListener('touchmove', onTouchMove);
    viewport.removeEventListener('touchend', onTouchEnd);
    viewport.removeEventListener('touchcancel', onTouchEnd);
    window.removeEventListener('resize', onResize);
  };
}
