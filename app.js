import { makeComfyDraft, makeDraft, makeLayout, parseLayout, toCentralBox, resizeLayout, validateDraft } from './layout.mjs';

const $ = id => document.getElementById(id);
const copy = value => JSON.parse(JSON.stringify(value));
const examples = {
  poster: {
    width: 1024, height: 1024, meta: ['travel poster'], canvas: 'single',
    caption: 'A minimalist travel poster on warm cream paper. A bold dark-blue title sits above a flat blue mountain illustration. A small Japanese subtitle anchors the lower edge. Generous negative space, clean geometric shapes, restrained ink texture.',
    items: [
      { id: 'p-title', label: 'text', text: 'EXPLORE', caption: 'Large dark-blue uppercase title, centered, crisp heavy lettering with generous spacing.', x: 128, y: 96, w: 768, h: 128 },
      { id: 'p-mountain', label: 'object', caption: 'A flat blue mountain illustration with angular peaks and a pale-blue rising sun, filling the lower center.', x: 208, y: 304, w: 608, h: 480 },
      { id: 'p-subtitle', label: 'text', text: 'まだ見ぬ場所へ', caption: 'A small dark-blue Japanese subtitle, centered in light, clean lettering.', x: 224, y: 864, w: 576, h: 64 }
    ]
  },
  cup: {
    width: 1536, height: 1024, meta: ['product campaign', 'studio photography'], canvas: 'single',
    caption: 'A warm studio campaign for a handmade ceramic cup, with an ivory backdrop, soft side lighting and restrained dark-green typography. Keep the ceramic texture tactile and the composition calm.',
    items: [
      { id: 'c-cup', label: 'object', caption: 'An ivory ceramic cup with a rounded handle, fine speckled glaze and a soft contact shadow, photographed at a three-quarter angle.', x: 176, y: 224, w: 624, h: 640 },
      { id: 'c-title', label: 'text', text: '把日常，过成诗。', caption: 'Large dark-green Chinese title in crisp, moderately heavy lettering, with generous spacing and no backing panel.', x: 928, y: 272, w: 480, h: 176 },
      { id: 'c-copy', label: 'text', text: '一杯温暖\n一刻从容', caption: 'Smaller dark-green Chinese supporting copy, comfortably legible on two lines.', x: 928, y: 512, w: 448, h: 144 }
    ]
  },
  type: {
    width: 1024, height: 1280, meta: ['typographic poster'], canvas: 'single',
    caption: 'An expressive typographic poster on pale-yellow paper. Three independent text blocks in English, Arabic and Japanese share an asymmetric composition with a small pink abstract sculpture. Preserve the exact characters and line breaks. Airy spacing, ink-blue and hot-pink accents.',
    items: [
      { id: 't-en', label: 'text', text: 'MAKE\nROOM.', caption: 'Oversized dark-blue condensed Latin lettering, left aligned, two lines.', x: 80, y: 96, w: 704, h: 320 },
      { id: 't-ar', label: 'text', text: 'مساحة للخيال', caption: 'Dark-blue Arabic lettering with clear connected forms, right aligned.', x: 176, y: 496, w: 736, h: 160 },
      { id: 't-ja', label: 'text', text: '想像の余白', caption: 'Small dark-blue Japanese lettering with generous spacing.', x: 96, y: 1056, w: 544, h: 96 },
      { id: 't-sculpture', label: 'object', caption: 'A playful pink abstract folded-paper sculpture, casting one soft shadow.', x: 592, y: 752, w: 288, h: 256 }
    ]
  }
};

let currentExample = 'poster';
let state = copy(examples.poster);
let selectedId = state.items[0].id;
let activeTab = 'prompt';
let history = [copy(state)];
let historyIndex = 0;
let nextId = 1;
let pointerAction = null;
let compiled = null;
let draft = null;
let comfyDraft = null;
let exportError = '';

function announce(message, error = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', error);
}

function selected() { return state.items.find(item => item.id === selectedId); }

function pushHistory() {
  if (JSON.stringify(state) === JSON.stringify(history[historyIndex])) return;
  history = history.slice(0, historyIndex + 1);
  history.push(copy(state));
  if (history.length > 60) history.shift();
  historyIndex = history.length - 1;
  renderHistory();
}

function renderHistory() {
  $('undo').disabled = historyIndex < 1;
  $('redo').disabled = historyIndex >= history.length - 1;
}

function renderCanvasSize() {
  $('canvas-width').value = state.width;
  $('canvas-height').value = state.height;
  $('canvas-readout').textContent = `${state.width} × ${state.height} px`;
  $('stage').style.aspectRatio = `${state.width} / ${state.height}`;
  // Preserve the actual aspect ratio even when a tall canvas meets the height limit.
  $('stage').style.maxWidth = `${620 * state.width / state.height}px`;
}

function renderScene() {
  $('scene-caption').value = state.caption;
  $('canvas-kind').value = state.canvas || 'single';
  $('scene-meta').value = '';
  const fragment = document.createDocumentFragment();
  (state.meta || []).forEach((tag, index) => {
    const chip = document.createElement('span'); chip.className = 'tag-chip';
    const text = document.createElement('span'); text.textContent = tag;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove genre tag ${tag}`);
    remove.addEventListener('click', () => {
      state.meta.splice(index, 1); pushHistory(); renderScene(); renderExport(); announce('Genre tag removed.');
    });
    chip.append(text, remove); fragment.append(chip);
  });
  $('scene-tags').replaceChildren(fragment);
}

function nameOf(item) {
  return item.label === 'text' ? item.text || 'Untitled text' : item.caption || `New ${item.label}`;
}

function renderLayers() {
  $('element-count').textContent = state.items.length;
  const fragment = document.createDocumentFragment();
  state.items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'layer';
    button.dataset.itemId = item.id;
    button.setAttribute('aria-pressed', String(item.id === selectedId));
    button.setAttribute('aria-label', `Select ${item.label} ${index + 1}: ${nameOf(item)}`);
    const dot = document.createElement('span'); dot.className = `dot ${item.label}-dot`; dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.className = 'layer-label'; title.textContent = `${index + 1}. ${nameOf(item)}`;
    const type = document.createElement('span'); type.className = 'layer-type'; type.textContent = item.label;
    button.append(dot, title, type);
    button.addEventListener('click', () => selectItem(item.id, false));
    fragment.append(button);
  });
  $('layers').replaceChildren(fragment);
}

function paintBox(element, item) {
  element.style.left = `${100 * item.x / state.width}%`;
  element.style.top = `${100 * item.y / state.height}%`;
  element.style.width = `${100 * item.w / state.width}%`;
  element.style.height = `${100 * item.h / state.height}%`;
  element.setAttribute('aria-pressed', String(item.id === selectedId));
  const content = element.querySelector('.box-content');
  if (item.label === 'text') {
    const lines = (item.text || '').split('\n');
    const longest = Math.max(1, ...lines.map(line => Array.from(line).length));
    const boardWidth = $('stage').getBoundingClientRect().width;
    const pxWidth = boardWidth * item.w / state.width;
    const pxHeight = boardWidth * item.h / state.width;
    content.style.fontSize = `${Math.max(8, Math.min(62, pxWidth / (longest * .64), pxHeight / (lines.length * 1.45)))}px`;
  }
}

function renderStage() {
  const fragment = document.createDocumentFragment();
  state.items.forEach((item, index) => {
    const box = document.createElement('button');
    box.type = 'button'; box.className = `layout-box ${item.label}`; box.dataset.itemId = item.id;
    box.setAttribute('aria-label', `${item.label} ${index + 1}: ${nameOf(item)}. Arrow keys move; Alt plus arrows resize.`);
    box.title = `${item.label} ${index + 1}. Drag to move. Alt + arrows to resize.`;
    const number = document.createElement('span'); number.className = 'box-number'; number.textContent = `${String(index + 1).padStart(2, '0')} / ${item.label.toUpperCase()}`;
    const content = document.createElement('span'); content.className = 'box-content'; content.dir = 'auto';
    content.textContent = item.label === 'text' ? item.text : item.caption;
    const handle = document.createElement('span'); handle.className = 'resize-handle'; handle.setAttribute('aria-hidden', 'true');
    box.append(number, content, handle);
    box.addEventListener('pointerdown', startPointer);
    box.addEventListener('click', () => selectItem(item.id, false));
    box.addEventListener('keydown', boxKeydown);
    box.addEventListener('focus', () => {
      if (selectedId !== item.id) selectItem(item.id);
    });
    paintBox(box, item);
    fragment.append(box);
  });
  $('stage').replaceChildren(fragment);
}

function renderInspector() {
  const item = selected();
  $('empty-selection').hidden = Boolean(item);
  $('selection-fields').hidden = !item;
  if (!item) return;
  $('item-label').value = item.label;
  $('literal-field').hidden = item.label !== 'text';
  $('item-text').value = item.text || '';
  $('item-caption').value = item.caption;
  ['x', 'y', 'w', 'h'].forEach(key => { $(`box-${key}`).value = item[key]; });
  try { $('centered-readout').textContent = `[${toCentralBox(item, state.width, state.height).join(', ')}]`; }
  catch { $('centered-readout').textContent = 'Review box geometry'; }
}

function renderExport() {
  exportError = '';
  let warnings = [];
  try {
    draft = makeDraft(state);
    const validation = validateDraft(draft);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    warnings = validation.warnings;
    compiled = makeLayout(state);
    comfyDraft = makeComfyDraft(draft);
  } catch (error) {
    compiled = null; draft = null; comfyDraft = null; exportError = error.message;
  }
  const isPrompt = activeTab === 'prompt';
  $('json-output').value = exportError ? `Draft needs attention:\n${exportError}` : JSON.stringify(isPrompt ? compiled : draft, null, 2);
  $('json-output').setAttribute('aria-label', isPrompt ? 'Compiled MOSS model prompt' : 'Editable MOSS layout draft');
  $('copy').textContent = isPrompt ? 'Copy model prompt ↗' : 'Copy editable draft ↗';
  $('copy').disabled = $('download').disabled = $('download-comfy').disabled = Boolean(exportError);
  $('layout-warning').hidden = !warnings.length;
  $('layout-warning').textContent = warnings.join(' ');
  $('format-help').textContent = isPrompt ? 'Centered pixels · yxyx · image dimensions stay in your generation settings' : 'Top-left pixels · xyxy · includes image dimensions for editing';
  for (const tab of ['prompt', 'draft']) {
    $(`tab-${tab}`).setAttribute('aria-selected', String(tab === activeTab));
    $(`tab-${tab}`).tabIndex = tab === activeTab ? 0 : -1;
  }
}

function renderAll() {
  renderCanvasSize(); renderScene(); renderLayers(); renderStage(); renderInspector(); renderExport(); renderHistory();
}

function selectItem(id, focus = false, keepStage = false) {
  selectedId = id;
  renderLayers(); renderInspector();
  if (!keepStage) {
    for (const box of $('stage').querySelectorAll('.layout-box')) box.setAttribute('aria-pressed', String(box.dataset.itemId === id));
  }
  if (focus) $('stage').querySelector(`[data-item-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
}

function saveEdit(message) {
  pushHistory(); renderAll();
  if (exportError) announce(exportError, true); else if (message) announce(message);
}

function startPointer(event) {
  if (event.button !== 0) return;
  const box = event.currentTarget;
  const item = state.items.find(candidate => candidate.id === box.dataset.itemId);
  selectItem(item.id);
  box.focus({ preventScroll: true });
  const rect = $('stage').getBoundingClientRect();
  pointerAction = {
    id: item.id, pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY,
    initial: copy(item), scaleX: state.width / rect.width, scaleY: state.height / rect.height,
    resize: event.target.classList.contains('resize-handle'), changed: false
  };
  box.classList.add('dragging');
  box.setPointerCapture(event.pointerId);
  event.preventDefault();
}

$('stage').addEventListener('pointermove', event => {
  if (!pointerAction || pointerAction.pointerId !== event.pointerId) return;
  const action = pointerAction;
  const item = state.items.find(candidate => candidate.id === action.id);
  const dx = Math.round((event.clientX - action.startX) * action.scaleX);
  const dy = Math.round((event.clientY - action.startY) * action.scaleY);
  const before = action.initial;
  if (action.resize) {
    item.w = Math.max(1, Math.min(state.width - before.x, Math.round(before.w + dx)));
    item.h = Math.max(1, Math.min(state.height - before.y, Math.round(before.h + dy)));
  } else {
    item.x = Math.max(0, Math.min(state.width - before.w, Math.round(before.x + dx)));
    item.y = Math.max(0, Math.min(state.height - before.h, Math.round(before.y + dy)));
  }
  action.changed = true;
  paintBox(event.target.closest('.layout-box'), item);
  renderInspector(); renderExport();
});

function endPointer(event) {
  if (!pointerAction || event.pointerId !== pointerAction.pointerId) return;
  const changed = pointerAction.changed;
  pointerAction = null;
  for (const box of $('stage').querySelectorAll('.dragging')) box.classList.remove('dragging');
  if (changed) {
    pushHistory(); renderLayers(); renderExport();
    announce('Box updated. Model coordinates and JSON are ready.');
  }
}
$('stage').addEventListener('pointerup', endPointer);
$('stage').addEventListener('pointercancel', endPointer);
$('stage').addEventListener('lostpointercapture', endPointer);

function boxKeydown(event) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const item = state.items.find(candidate => candidate.id === event.currentTarget.dataset.itemId);
  selectedId = item.id;
  const step = event.shiftKey ? 10 : 1;
  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  if (event.altKey) {
    const key = horizontal ? 'w' : 'h';
    item[key] = Math.max(1, Math.min((horizontal ? state.width - item.x : state.height - item.y), item[key] + step * sign));
  } else {
    const key = horizontal ? 'x' : 'y';
    item[key] = Math.max(0, Math.min((horizontal ? state.width - item.w : state.height - item.h), item[key] + step * sign));
  }
  paintBox(event.currentTarget, item);
  renderInspector(); renderExport(); pushHistory();
}

for (const [field, key] of [['scene-caption', 'caption'], ['canvas-kind', 'canvas']]) {
  $(field).addEventListener('change', () => {
    state[key] = $(field).value;
    pushHistory(); renderExport();
    announce(exportError || 'Scene updated.', Boolean(exportError));
  });
}
function addGenre() {
  const tag = $('scene-meta').value;
  if (!tag.trim()) return;
  if (!state.meta) state.meta = [];
  state.meta.push(tag); pushHistory(); renderScene(); renderExport(); announce('Genre tag added.');
}
$('add-meta').addEventListener('click', addGenre);
$('scene-meta').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addGenre(); } });

$('apply-size').addEventListener('click', () => {
  const width = Number($('canvas-width').value), height = Number($('canvas-height').value);
  try {
    if (width > 8192 || height > 8192) throw new Error('This editor supports canvas edges up to 8192 px. MOSS hardware requirements depend on your generation setup.');
    if (!$('scale-boxes').checked && state.items.some(item => item.x + item.w > width || item.y + item.h > height)) {
      throw new Error('Some boxes would fall outside the new canvas. Enable scaling, or move and resize those boxes first.');
    }
    state = resizeLayout(state, width, height, { scale: $('scale-boxes').checked });
    saveEdit(`Canvas set to ${width} × ${height} px. ${$('scale-boxes').checked ? 'Boxes scaled proportionally.' : 'Box pixel positions preserved.'}`);
  } catch (error) { announce(error.message, true); }
});

$('show-grid').addEventListener('change', () => $('stage').classList.toggle('grid', $('show-grid').checked));

for (const label of ['text', 'object', 'character']) {
  $(`add-${label}`).addEventListener('click', () => {
    const w = Math.max(1, Math.round(state.width * .4)), h = Math.max(1, Math.round(state.height * (label === 'text' ? .15 : .35)));
    const item = { id: `new-${nextId++}`, label, caption: label === 'text' ? 'Clear dark lettering with a readable size and generous spacing.' : label === 'character' ? 'A friendly illustrated character with a simple expressive pose.' : 'A geometric sculptural object with soft lighting and a clean silhouette.', x: Math.round((state.width - w) / 2), y: Math.round((state.height - h) / 2), w, h };
    if (label === 'text') item.text = 'YOUR WORDS';
    state.items.push(item); selectedId = item.id; saveEdit(`${label[0].toUpperCase() + label.slice(1)} added.`); selectItem(item.id, true);
  });
}

$('item-label').addEventListener('change', () => {
  const item = selected(); if (!item) return;
  item.label = $('item-label').value;
  if (item.label === 'text' && !item.text) item.text = 'YOUR WORDS';
  saveEdit('Element type updated.');
});
for (const [field, key] of [['item-text', 'text'], ['item-caption', 'caption']]) {
  $(field).addEventListener('change', () => {
    const item = selected(); if (!item) return;
    item[key] = $(field).value;
    pushHistory(); renderLayers(); renderStage(); renderExport();
    announce(exportError || 'Element updated.', Boolean(exportError));
  });
}

for (const key of ['x', 'y', 'w', 'h']) {
  $(`box-${key}`).addEventListener('change', () => {
    const item = selected(); if (!item) return;
    const value = Number($(`box-${key}`).value);
    const candidate = { ...item, [key]: value };
    if (!Number.isFinite(value) || $(`box-${key}`).value.trim() === '' || candidate.x < 0 || candidate.y < 0 || candidate.w <= 0 || candidate.h <= 0 || candidate.x + candidate.w > state.width || candidate.y + candidate.h > state.height) {
      announce('Use finite pixel values with a positive box size fully inside the canvas.', true); renderInspector(); return;
    }
    item[key] = value;
    pushHistory(); renderStage(); renderInspector(); renderExport(); announce('Exact box geometry updated.');
  });
}

$('duplicate').addEventListener('click', () => {
  const item = selected(); if (!item) return;
  const duplicate = copy(item); duplicate.id = `new-${nextId++}`;
  duplicate.x = Math.min(state.width - duplicate.w, duplicate.x + 24);
  duplicate.y = Math.min(state.height - duplicate.h, duplicate.y + 24);
  state.items.push(duplicate); selectedId = duplicate.id; saveEdit('Element duplicated.');
});
$('delete').addEventListener('click', () => {
  if (state.items.length <= 1) { announce('Keep at least one element in a layout. You can change this element instead.', true); return; }
  const index = state.items.findIndex(item => item.id === selectedId);
  state.items.splice(index, 1); selectedId = state.items[Math.min(index, state.items.length - 1)].id; saveEdit('Element removed. Undo restores it.');
});

function loadExample(name) {
  state = copy(examples[name]); currentExample = name; selectedId = state.items[0].id;
  document.querySelectorAll('[data-example]').forEach(button => button.classList.toggle('active', button.dataset.example === name));
  saveEdit(`Loaded ${name === 'cup' ? 'the official ceramic campaign example' : name === 'type' ? 'the Unicode type playground' : 'the travel poster'}. Undo restores your previous draft.`);
}
document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => loadExample(button.dataset.example)));
$('reset').addEventListener('click', () => loadExample(currentExample));

for (const [id, direction] of [['undo', -1], ['redo', 1]]) {
  $(id).addEventListener('click', () => {
    const index = historyIndex + direction;
    if (index < 0 || index >= history.length) return;
    historyIndex = index; state = copy(history[index]);
    if (!selected()) selectedId = state.items[0].id;
    renderAll(); announce(direction < 0 ? 'Edit undone.' : 'Edit restored.');
  });
}

function switchTab(tab) { activeTab = tab; renderExport(); }
for (const tab of ['prompt', 'draft']) {
  $(`tab-${tab}`).addEventListener('click', () => switchTab(tab));
  $(`tab-${tab}`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'prompt' : event.key === 'End' ? 'draft' : tab === 'prompt' ? 'draft' : 'prompt';
    switchTab(next); $(`tab-${next}`).focus();
  });
}

$('copy').addEventListener('click', async () => {
  if (exportError) return;
  try {
    await navigator.clipboard.writeText($('json-output').value);
    announce(activeTab === 'prompt' ? `Model prompt copied. Generate at ${state.width} × ${state.height} px.` : 'Editable draft copied, including the canvas dimensions.');
  } catch {
    $('json-output').focus(); $('json-output').select();
    announce('Clipboard access is unavailable. The JSON is selected; use your device’s Copy command.');
  }
});

$('download').addEventListener('click', () => {
  if (exportError) return;
  const blob = new Blob([$('json-output').value + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `moss-${activeTab}-${state.width}x${state.height}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`${activeTab === 'prompt' ? 'Model prompt' : 'Editable draft'} downloaded.`);
});

$('download-comfy').addEventListener('click', () => {
  if (exportError) return;
  const blob = new Blob([JSON.stringify(comfyDraft, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `moss-comfyui-draft-${state.width}x${state.height}.json`;
  anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce(`ComfyUI draft downloaded at ${state.width} × ${state.height} px.`);
});

$('import').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  try {
    if (file.size > 1_000_000) throw new Error('Import a layout JSON file smaller than 1 MB.');
    const imported = parseLayout(await file.text(), { width: state.width, height: state.height });
    if (imported.items.length > 200) throw new Error('This visual editor supports up to 200 layout elements.');
    if (imported.width > 8192 || imported.height > 8192) throw new Error('This visual editor supports canvas edges up to 8192 px.');
    state = imported;
    // Assign fresh internal IDs. These are never written into either JSON format.
    state.items.forEach(item => { item.id = `import-${nextId++}`; });
    selectedId = state.items[0].id;
    saveEdit(`Layout imported at ${state.width} × ${state.height} px. Compiled prompts use the current canvas dimensions because they contain none.`);
    document.querySelectorAll('[data-example]').forEach(button => button.classList.remove('active'));
  } catch (error) { announce(`Import failed: ${error.message}`, true); }
  event.target.value = '';
});

new ResizeObserver(() => {
  for (const box of $('stage').querySelectorAll('.layout-box')) {
    const item = state.items.find(candidate => candidate.id === box.dataset.itemId);
    if (item) paintBox(box, item);
  }
}).observe($('stage'));

renderAll();
