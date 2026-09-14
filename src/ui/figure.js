// Looking closely at a picture: the enlargement used by the appendix figures and by the
// detail card of an application point.
//
// One rule runs through all of it: the picture scales, the markers do not. A marker is a
// label, not part of the drawing — blowing it up with the image hides exactly the detail
// one opened the enlargement to see.
import { h, button, modal } from './dom.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The region of a picture worth looking at around a marker: a rectangle of `area` (a fraction
 * of the picture) centred on the marker and kept inside the picture.
 */
export function markerRegion(marker, area) {
  const f = clamp(Number(area) || 0.3, 0.05, 1);
  return {
    f,
    x0: clamp((Number(marker.x) || 0) - f / 2, 0, 1 - f),
    y0: clamp((Number(marker.y) || 0) - f / 2, 0, 1 - f),
  };
}

/**
 * The crop: the picture blown up so that only the region shows. The viewport keeps the
 * proportions of the picture, so the same percentage works horizontally and vertically.
 * @param {object} spec { src, alt, width, height, region, markers }
 *   markers: [{ x, y, label, own }] in picture coordinates
 */
export function figureCrop({ src, alt, width, height, region, markers = [] }) {
  const { f, x0, y0 } = region;
  const pct = (v) => `${v * 100}%`;
  const view = h('div', { class: 'fig-crop' },
    h('img', {
      src, alt: alt || '',
      style: { width: pct(1 / f), height: pct(1 / f), left: pct(-x0 / f), top: pct(-y0 / f) },
    }),
    ...markers
      .filter((m) => m.x >= x0 && m.x <= x0 + f && m.y >= y0 && m.y <= y0 + f)
      .map((m) => marker(m, (m.x - x0) / f, (m.y - y0) / f)));
  if (width && height) view.style.aspectRatio = `${width} / ${height}`;
  return view;
}

/** The whole picture with the region drawn on it, so one knows where the crop was taken. */
export function figureWithRegion({ src, alt, region, markers = [] }) {
  const pct = (v) => `${v * 100}%`;
  return h('div', { class: 'fig-whole' },
    h('img', { src, alt: alt || '' }),
    ...markers.map((m) => marker(m, m.x, m.y)),
    region
      ? h('span', {
          class: 'fig-region',
          style: { left: pct(region.x0), top: pct(region.y0), width: pct(region.f), height: pct(region.f) },
        })
      : null);
}

const marker = (m, x, y) => h('span', {
  class: ['fig-marker', m.own === false && 'fig-marker-other', String(m.label || '').length > 2 && 'fig-marker-wide'],
  style: { left: `${x * 100}%`, top: `${y * 100}%` },
  title: m.title || '',
}, m.label || '');

/**
 * The picture at full size, pannable and zoomable. The markers travel with the picture but
 * keep their size on screen, which is the whole point of enlarging.
 */
export function openFigure({ src, alt, title, caption, markers = [], width, height }) {
  const state = { zoom: 1, dx: 0, dy: 0 };
  const stage = h('div', { class: 'fig-stage' },
    h('img', { class: 'fig-stage-img', src, alt: alt || '', draggable: 'false' }),
    ...markers.map((m) => marker(m, m.x, m.y)));
  const viewport = h('div', { class: 'fig-viewport' }, stage);

  const apply = () => {
    // The stage is sized, not transformed: a transform would scale the markers with it.
    stage.style.width = `${state.zoom * 100}%`;
    stage.style.left = `${state.dx}px`;
    stage.style.top = `${state.dy}px`;
    readout.textContent = `${Math.round(state.zoom * 100)} %`;
  };
  const setZoom = (factor, anchor) => {
    const before = state.zoom;
    state.zoom = clamp(state.zoom * factor, 0.5, 8);
    // Zoom around the middle of the viewport, or around the pointer when there is one.
    const r = viewport.getBoundingClientRect();
    const ax = anchor ? anchor.x - r.left : r.width / 2;
    const ay = anchor ? anchor.y - r.top : r.height / 2;
    const k = state.zoom / before;
    state.dx = ax - (ax - state.dx) * k;
    state.dy = ay - (ay - state.dy) * k;
    apply();
  };
  const readout = h('span', { class: 'muted fig-readout' }, '100 %');

  viewport.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    setZoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, { x: ev.clientX, y: ev.clientY });
  }, { passive: false });

  viewport.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const from = { x: ev.clientX - state.dx, y: ev.clientY - state.dy };
    viewport.setPointerCapture(ev.pointerId);
    viewport.classList.add('fig-dragging');
    const move = (e) => { state.dx = e.clientX - from.x; state.dy = e.clientY - from.y; apply(); };
    const up = () => {
      viewport.classList.remove('fig-dragging');
      viewport.removeEventListener('pointermove', move);
      viewport.removeEventListener('pointerup', up);
    };
    viewport.addEventListener('pointermove', move);
    viewport.addEventListener('pointerup', up);
  });

  const fit = () => { state.zoom = 1; state.dx = 0; state.dy = 0; apply(); };

  modal({
    title: title || 'Figure',
    width: '96vw',
    content: h('div', { class: 'fig-large' },
      h('div', { class: 'toolstrip' },
        button('−', () => setZoom(1 / 1.3), { class: 'btn-icon', title: 'Zoom out' }),
        button('+', () => setZoom(1.3), { class: 'btn-icon', title: 'Zoom in' }),
        button('Fit', fit, { class: 'btn-small' }),
        readout,
        h('span', { class: 'hint' }, 'Drag to move, wheel to zoom. The markers keep their size so the picture stays readable underneath.')),
      viewport,
      caption ? h('p', { class: 'hint' }, caption) : null),
  });
  apply();
  return { fit };
}

/** Turns a rendered figure of the document into one that can be opened full size. */
export function makeZoomable(figure, open, label = 'Enlarge') {
  figure.classList.add('doc-figure-zoomable');
  figure.title = 'Click to see it full size';
  figure.addEventListener('click', open);
  figure.appendChild(h('button', {
    type: 'button', class: 'btn btn-small figure-zoom-btn',
    onClick: (e) => { e.stopPropagation(); open(); },
  }, '⤢ ' + label));
}
