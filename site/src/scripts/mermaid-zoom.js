// Pan/zoom viewer for rendered mermaid diagrams.
//
// Diagrams stay static inline (wheel-zoom on the page would hijack scrolling).
// Activating one opens a modal viewer where it can be panned and zoomed.
//
// The transform math is exported separately from the DOM wiring so it can be
// unit tested without a browser.

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 8;
export const ZOOM_STEP = 1.25;

/** Keeps a scale inside the supported range. */
export function clampScale(scale) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Scales `state` by `factor` about the viewport point (px, py), which is what
 * makes wheel-zoom track the pointer instead of drifting toward the origin.
 * The point under the cursor keeps the same screen position.
 */
export function zoomAt(state, factor, px, py) {
  const scale = clampScale(state.scale * factor);
  const ratio = scale / state.scale;
  return {
    scale,
    x: px - (px - state.x) * ratio,
    y: py - (py - state.y) * ratio,
  };
}

/**
 * Scale that fits content into the stage, with a little padding. Small
 * diagrams are allowed to grow, but only up to `maxUpscale`, so a three-node
 * flowchart does not open as a wall of pixels.
 */
export function fitScale(contentW, contentH, viewW, viewH, maxUpscale = 1.5) {
  if (!contentW || !contentH || !viewW || !viewH) return 1;
  const pad = 0.92;
  return clampScale(Math.min((viewW * pad) / contentW, (viewH * pad) / contentH, maxUpscale));
}

/** Centers content of the given natural size at `scale` within the stage. */
export function centerAt(contentW, contentH, viewW, viewH, scale) {
  return {
    scale,
    x: (viewW - contentW * scale) / 2,
    y: (viewH - contentH * scale) / 2,
  };
}

/** Natural pixel size of a rendered mermaid SVG, preferring its viewBox. */
export function naturalSize(svg) {
  const vb = svg.viewBox?.baseVal;
  if (vb && vb.width && vb.height) return { width: vb.width, height: vb.height };
  const rect = svg.getBoundingClientRect();
  return { width: rect.width || 800, height: rect.height || 600 };
}

const VIEWER_MARKUP = `
  <div class="mermaid-viewer__bar">
    <button type="button" class="mermaid-viewer__btn" data-act="out" aria-label="Zoom out">&minus;</button>
    <output class="mermaid-viewer__level" data-level aria-live="polite">100%</output>
    <button type="button" class="mermaid-viewer__btn" data-act="in" aria-label="Zoom in">+</button>
    <button type="button" class="mermaid-viewer__btn" data-act="fit" aria-label="Fit diagram to window">Fit</button>
    <button type="button" class="mermaid-viewer__btn mermaid-viewer__btn--close" data-act="close" aria-label="Close diagram viewer">Close</button>
  </div>
  <div class="mermaid-viewer__stage" data-stage>
    <div class="mermaid-viewer__canvas" data-canvas></div>
  </div>
`;

/**
 * Creates the single modal viewer shared by every diagram on the page.
 * Returns an object with `open(svg, label)`.
 */
export function createViewer(doc = document) {
  const dialog = doc.createElement("dialog");
  dialog.className = "mermaid-viewer";
  dialog.setAttribute("aria-label", "Diagram viewer");
  dialog.innerHTML = VIEWER_MARKUP;
  doc.body.appendChild(dialog);

  const stage = dialog.querySelector("[data-stage]");
  const canvas = dialog.querySelector("[data-canvas]");
  const level = dialog.querySelector("[data-level]");

  let state = { scale: 1, x: 0, y: 0 };
  let natural = { width: 0, height: 0 };
  let cloneSeq = 0;
  const pointers = new Map();
  let pinchStart = null;

  const apply = () => {
    canvas.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
    level.textContent = `${Math.round(state.scale * 100)}%`;
  };

  const stageSize = () => {
    const r = stage.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  const fit = () => {
    const { w, h } = stageSize();
    state = centerAt(natural.width, natural.height, w, h, fitScale(natural.width, natural.height, w, h));
    apply();
  };

  /** Zoom about the stage center, for the toolbar buttons and keyboard. */
  const zoomCentered = (factor) => {
    const { w, h } = stageSize();
    state = zoomAt(state, factor, w / 2, h / 2);
    apply();
  };

  const localPoint = (clientX, clientY) => {
    const r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const p = localPoint(event.clientX, event.clientY);
      // Trackpads report small deltas continuously; exponentiating keeps the
      // response even across both trackpad and notched mouse wheels.
      const factor = Math.exp(-event.deltaY * 0.002);
      state = zoomAt(state, factor, p.x, p.y);
      apply();
    },
    { passive: false },
  );

  stage.addEventListener("pointerdown", (event) => {
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: state.scale };
    }
    stage.dataset.dragging = "true";
  });

  stage.addEventListener("pointermove", (event) => {
    const prev = pointers.get(event.pointerId);
    if (!prev) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, next);

    if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchStart.dist > 0) {
        const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
        const target = clampScale(pinchStart.scale * (dist / pinchStart.dist));
        state = zoomAt(state, target / state.scale, mid.x, mid.y);
        apply();
      }
      return;
    }

    state = { ...state, x: state.x + (next.x - prev.x), y: state.y + (next.y - prev.y) };
    apply();
  });

  const endPointer = (event) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) delete stage.dataset.dragging;
  };
  stage.addEventListener("pointerup", endPointer);
  stage.addEventListener("pointercancel", endPointer);

  stage.addEventListener("dblclick", (event) => {
    const p = localPoint(event.clientX, event.clientY);
    // Toggle between fit and 100% at the point that was double-clicked.
    if (state.scale > 1.05) fit();
    else {
      state = zoomAt(state, 1 / state.scale, p.x, p.y);
      apply();
    }
  });

  dialog.addEventListener("click", (event) => {
    const act = event.target.closest?.("[data-act]")?.dataset.act;
    if (act === "in") zoomCentered(ZOOM_STEP);
    else if (act === "out") zoomCentered(1 / ZOOM_STEP);
    else if (act === "fit") fit();
    else if (act === "close") dialog.close();
    // Clicking the backdrop (the dialog itself, outside the stage) closes.
    else if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 120 : 40;
    const keys = {
      "+": () => zoomCentered(ZOOM_STEP),
      "=": () => zoomCentered(ZOOM_STEP),
      "-": () => zoomCentered(1 / ZOOM_STEP),
      "0": () => fit(),
      ArrowLeft: () => { state = { ...state, x: state.x + step }; apply(); },
      ArrowRight: () => { state = { ...state, x: state.x - step }; apply(); },
      ArrowUp: () => { state = { ...state, y: state.y + step }; apply(); },
      ArrowDown: () => { state = { ...state, y: state.y - step }; apply(); },
    };
    const handler = keys[event.key];
    if (handler) {
      event.preventDefault();
      handler();
    }
  });

  // Keep the diagram framed when the window changes size.
  window.addEventListener("resize", () => {
    if (dialog.open) fit();
  });

  dialog.addEventListener("close", () => {
    canvas.replaceChildren();
  });

  return {
    dialog,
    open(svg, label) {
      natural = naturalSize(svg);

      // Mermaid emits a <style> block inside the SVG whose every rule is scoped
      // by the SVG's own id, and references its markers through url(#id-...).
      // A plain cloneNode that drops or duplicates that id yields an unstyled
      // diagram: invisible nodes and clipped labels. Re-id the copy instead,
      // rewriting the id everywhere it appears.
      const oldId = svg.id;
      const newId = `mermaid-viewer-${++cloneSeq}`;
      let html = svg.outerHTML;
      if (oldId) html = html.split(oldId).join(newId);
      canvas.innerHTML = html;

      const clone = canvas.firstElementChild;
      // Mermaid caps rendered diagrams at the column width. In the viewer the
      // canvas transform owns sizing, so that cap has to go.
      clone.style.maxWidth = "none";
      clone.style.width = `${natural.width}px`;
      clone.style.height = `${natural.height}px`;
      // The inline diagram keeps the accessible name; this copy is decorative.
      clone.setAttribute("aria-hidden", "true");
      dialog.setAttribute("aria-label", label ? `Diagram viewer: ${label}` : "Diagram viewer");
      dialog.showModal();
      fit();
    },
  };
}

/**
 * Names a diagram for its expand control. Mermaid only emits a <title> when the
 * source declares one, and a page with several diagrams would otherwise offer a
 * screen reader several buttons all reading "Expand diagram". Falls back to the
 * nearest preceding heading.
 */
export function describe(figure, svg) {
  const title = svg.querySelector("title")?.textContent?.trim();
  if (title) return title;

  // Starlight wraps each heading in <div class="sl-heading-wrapper">, so the
  // heading is not always the sibling itself.
  const SELECTOR = "h1, h2, h3, h4, h5, h6";
  let node = figure.previousElementSibling;
  while (node) {
    const heading = node.matches(SELECTOR) ? node : node.querySelector(SELECTOR);
    if (heading) {
      // Drop the anchor-link affordance, whose visually hidden text would
      // otherwise land in the label ("Section titled ...").
      const copy = heading.cloneNode(true);
      copy.querySelectorAll("a").forEach((a) => a.remove());
      const text = copy.textContent.trim();
      if (text) return text;
    }
    node = node.previousElementSibling;
  }
  return "";
}

/**
 * Gives every rendered diagram an expand control and click-to-open, wrapping
 * each in a figure so the control can sit outside the scroll container.
 * Safe to call again after a re-render: existing wrappers are reused.
 */
export function attachZoom(blocks, viewer, doc = document) {
  for (const pre of blocks) {
    const svg = pre.querySelector("svg");
    if (!svg) continue;

    let figure = pre.parentElement;
    if (!figure || !figure.classList.contains("mermaid-figure")) {
      figure = doc.createElement("div");
      figure.className = "mermaid-figure";
      pre.replaceWith(figure);
      figure.appendChild(pre);
    }

    const label = describe(figure, svg);

    if (!figure.querySelector(".mermaid-figure__expand")) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "mermaid-figure__expand";
      button.setAttribute("aria-label", label ? `Expand diagram: ${label}` : "Expand diagram");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
        '<path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"/></svg><span>Expand</span>';
      button.addEventListener("click", () => viewer.open(figure.querySelector("svg"), label));
      figure.appendChild(button);
    }

    // Clicking the diagram itself opens it too. The button stays the
    // keyboard-reachable control.
    if (!pre.dataset.zoomBound) {
      pre.dataset.zoomBound = "true";
      pre.addEventListener("click", () => {
        const current = figure.querySelector("svg");
        if (current) viewer.open(current, label);
      });
    }
  }
}
