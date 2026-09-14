// Application points: detailed data sheet and graphical location on the images.
import { h, button, card, field, empty } from '../dom.js';
import { textField, textInput } from '../fields.js';
import { listEditor, subList } from '../list.js';
import { newPoint, newCharacteristic, newMarker } from '../../model/schema.js';
import { codeOf, markerLabel, labelOf, computeIndex } from '../../model/codes.js';
import { figureCrop, markerRegion } from '../figure.js';
import { markerArea } from '../../model/schema.js';
import { assetUrl } from '../../io/images.js';

// Navigation state of the graphical editor: survives redraws.
const view = { imageId: '', zoom: 1, dx: 0, dy: 0, placing: false };

export function pointsSection(store) {
  const doc = store.resolvedDoc();
  const codes = store.codes();
  const intro = h('p', { class: 'hint' },
    'Each point is identified by its code in the steps; here you describe connector, pin and ',
    'connection characteristics, and mark it on the images.');

  return listEditor(store, {
    key: 'points', title: 'Application points', singular: 'Point',
    factory: newPoint, intro,
    row: (e) => [
      h('span', { class: 'code' }, codeOf(codes, e.id)), ' ',
      h('strong', {}, e.name || '(unnamed)'),
      e.connector || e.pin ? h('span', { class: 'muted' }, ` · ${[e.connector, e.pin && 'pin ' + e.pin].filter(Boolean).join(' ')}`) : null,
      (e.markers || []).length ? null : h('span', { class: 'badge badge-warning', title: 'Not marked on any image' }, '!'),
    ],
    detail: (p, path) => h('div', {},
      card('Identification',
        textField(store, [...path, 'name'], 'Name', { placeholder: 'e.g. Battery positive' }),
        h('div', { class: 'field-row' },
          textField(store, [...path, 'connector'], 'Connector', { placeholder: 'e.g. J1' }),
          textField(store, [...path, 'pin'], 'Pin', { placeholder: 'e.g. 3' })),
        h('div', { class: 'field-row' },
          textField(store, [...path, 'signal'], 'Signal', { placeholder: 'e.g. VBAT' }),
          textField(store, [...path, 'contactType'], 'Contact type', { placeholder: 'e.g. spring probe, clamp, tip' }))),
      card('Connection characteristics',
        subList(store, {
          path: [...path, 'characteristics'], items: p.characteristics, factory: newCharacteristic,
          addLabel: '+ characteristic',
          row: (c, cp) => h('span', { class: 'row-3' },
            textInput(store, [...cp, 'name'], { placeholder: 'e.g. Max current / Contact force' }),
            textInput(store, [...cp, 'value'], { placeholder: 'e.g. 10' }),
            textInput(store, [...cp, 'unit'], { placeholder: 'e.g. A / N' })),
        }),
        textField(store, [...path, 'notes'], 'Notes', { multiline: true, rows: 2 })),
      card('Location on the images', markerEditor(store, doc, codes, p, path))),
  });
}

function markerEditor(store, doc, codes, point, path) {
  const index = computeIndex(doc);
  const images = doc.images || [];
  if (!images.length) return empty('Upload at least one image in the «Images» section first.');
  if (!images.some((i) => i.id === view.imageId)) view.imageId = images[0].id;
  const image = images.find((i) => i.id === view.imageId);

  const scene = h('div', { class: 'scene' });
  const canvas = h('div', { class: ['canvas', view.placing && 'canvas-place'] }, scene);
  const img = h('img', { class: 'scene-img', src: assetUrl(store.state.assets, image.assetId), alt: image.name || '', draggable: 'false' });
  scene.appendChild(img);

  // The scene is sized, not scaled: a transform would blow the markers up together with the
  // board, which is the opposite of what one zooms in for.
  const applyTransform = () => {
    const base = canvas.clientWidth || 640;
    scene.style.width = `${Math.round(base * view.zoom)}px`;
    scene.style.left = `${view.dx}px`;
    scene.style.top = `${view.dy}px`;
  };
  applyTransform();
  requestAnimationFrame(applyTransform); // once the canvas has its real width

  // Markers of every point on the current image: the one being edited is highlighted.
  for (const other of doc.points || []) {
    for (const m of other.markers || []) {
      if (m.imageId !== image.id) continue;
      const own = other.id === point.id;
      // On the image only the number: the full code would cover the board. The whole
      // label stays in the tooltip.
      const el = h('div', {
        class: ['marker', own ? 'marker-active' : 'marker-other'],
        style: { left: m.x * 100 + '%', top: m.y * 100 + '%' },
        title: `${labelOf(codes, index, other.id, 40)}${own ? ' — drag to move' : ''}`,
      }, h('span', { class: 'marker-label' }, markerLabel(other, codeOf(codes, other.id)) || (other.name || '').slice(0, 4)));
      if (own) enableDragging(el, scene, store, [...path, 'markers', '#' + m.id]);
      scene.appendChild(el);
    }
  }

  canvas.addEventListener('click', (ev) => {
    if (!view.placing) return;
    const r = img.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    store.add([...path, 'markers'], newMarker(image.id, round(x), round(y)));
    view.placing = false;
    store.refresh();
  });

  // Panning with a drag on the background, zooming with the wheel.
  // The handlers live on the element (with pointer capture), not on window, so they
  // disappear together with the element at every redraw.
  let dragging = null;
  canvas.addEventListener('pointerdown', (ev) => {
    if (view.placing || ev.target.closest('.marker')) return;
    dragging = { x: ev.clientX - view.dx, y: ev.clientY - view.dy };
    canvas.setPointerCapture(ev.pointerId);
    canvas.classList.add('canvas-drag');
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    view.dx = ev.clientX - dragging.x;
    view.dy = ev.clientY - dragging.y;
    applyTransform();
  });
  const endPan = () => { dragging = null; canvas.classList.remove('canvas-drag'); };
  canvas.addEventListener('pointerup', endPan);
  canvas.addEventListener('pointercancel', endPan);
  canvas.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    applyTransform();
  }, { passive: false });

  const zoom = (f) => { view.zoom = Math.min(8, Math.max(0.2, view.zoom * f)); };

  const markerList = (point.markers || []).map((m) => {
    const markerImage = images.find((i) => i.id === m.imageId);
    const imageName = (markerImage || {}).name || '⟨missing image⟩';
    const area = markerArea(m);
    const areaSelect = h('select', { class: 'inp inp-area', title: 'How much of the picture the detail view shows around this marker' },
      ...AREAS.map((a) => h('option', { value: String(a.value), selected: Math.abs(a.value - area) < 0.001 }, a.label)));
    areaSelect.addEventListener('change', () => {
      store.write([...path, 'markers', '#' + m.id, 'area'], Number(areaSelect.value), null);
      store.refresh();
    });
    const asset = markerImage ? (store.state.assets || {})[markerImage.assetId] || {} : {};
    return h('li', { class: 'marker-row' },
      markerImage
        ? figureCrop({
            src: assetUrl(store.state.assets, markerImage.assetId), alt: imageName,
            width: asset.width, height: asset.height,
            region: markerRegion(m, area),
            markers: [{ x: m.x, y: m.y, label: markerLabel(point, codeOf(codes, point.id)) }],
          })
        : null,
      h('div', { class: 'marker-row-body' },
        h('div', {}, imageName, h('span', { class: 'muted' }, ` — x ${(m.x * 100).toFixed(1)}% · y ${(m.y * 100).toFixed(1)}%`)),
        h('div', { class: 'subrow' },
          h('span', { class: 'field-label' }, 'Zoom area'), areaSelect,
          button('Show', () => { view.imageId = m.imageId; store.refresh(); }, { class: 'btn-small' }),
          button('✕', () => { store.remove([...path, 'markers', '#' + m.id]); store.refresh(); }, { class: 'btn-icon btn-danger', title: 'Remove marker' }))));
  });

  return h('div', {},
    h('div', { class: 'toolstrip' },
      h('select', {
        class: 'inp', onChange: (ev) => { view.imageId = ev.target.value; store.refresh(); },
      }, ...images.map((i) => h('option', { value: i.id, selected: i.id === view.imageId }, i.name || '(image)'))),
      button(view.placing ? '● Click on the image…' : '+ Place marker', () => { view.placing = !view.placing; store.refresh(); },
        { class: view.placing ? 'btn-primary' : '' }),
      button('−', () => { zoom(1 / 1.3); applyTransform(); }, { class: 'btn-icon', title: 'Zoom out' }),
      button('+', () => { zoom(1.3); applyTransform(); }, { class: 'btn-icon', title: 'Zoom in' }),
      button('Fit', () => { view.zoom = 1; view.dx = 0; view.dy = 0; applyTransform(); }, { class: 'btn-small' })),
    canvas,
    markerList.length ? h('ul', { class: 'marker-list' }, ...markerList) : empty('No marker for this point.'),
    h('p', { class: 'hint' }, 'The zoom area is what the reader is shown when this point is opened in the document: the crop above, and under it the whole picture with the area outlined.'));
}

/** Sizes of the region shown around a marker, as a fraction of the picture. */
const AREAS = [
  { value: 0.15, label: '15 % — a connector' },
  { value: 0.3, label: '30 % — an area of the board' },
  { value: 0.5, label: '50 % — half the picture' },
  { value: 1, label: '100 % — the whole picture' },
];

function enableDragging(el, scene, store, markerPath) {
  el.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const img = scene.querySelector('.scene-img');
    const move = (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      el.style.left = x * 100 + '%';
      el.style.top = y * 100 + '%';
      el.dataset.x = x;
      el.dataset.y = y;
    };
    const end = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', end);
      if (el.dataset.x == null) return;
      store.write([...markerPath, 'x'], round(Number(el.dataset.x)), null);
      store.write([...markerPath, 'y'], round(Number(el.dataset.y)), null);
      store.refresh();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', end);
  });
}

const round = (n) => Math.round(n * 10000) / 10000;

