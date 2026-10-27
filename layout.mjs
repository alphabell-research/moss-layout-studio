/*
 * alphaBell MOSS Layout Studio geometry and schema helpers.
 * Draft validation and export follow OpenMOSS/MOSS-Image compile_prompt.py,
 * revision 52b87fca23acedc399d062d593bec388aee9926a (Apache-2.0).
 * This browser implementation adds import, editing and local precision checks.
 */

export const SOURCE_REVISION = '52b87fca23acedc399d062d593bec388aee9926a';
export const SOURCE_URL = `https://github.com/OpenMOSS/MOSS-Image/blob/${SOURCE_REVISION}/skills/moss-image-prompt-enhancer/scripts/compile_prompt.py`;

export class LayoutError extends Error {
  constructor(message, path = '') { super(path ? `${path}: ${message}` : message); this.name = 'LayoutError'; this.path = path; }
}
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const fail = (condition, message, path = '') => { if (!condition) throw new LayoutError(message, path); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const NUMBER_SYNTAX = Symbol('JSON number syntax');

function fields(value, allowed, required, path) {
  fail(object(value), 'must be an object', path);
  const extra = Object.keys(value).filter(key => !allowed.includes(key));
  fail(!extra.length, `unknown fields ${extra.join(', ')}`, path);
  const missing = required.filter(key => !own(value, key));
  fail(!missing.length, `missing fields ${missing.join(', ')}`, path);
}
// Match Python str.strip(), including NEL and the information separators.
const PYTHON_WHITESPACE = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
function text(value, path) { fail(typeof value === 'string' && !PYTHON_WHITESPACE.test(value), 'must be nonempty text', path); }
function strings(value, path) {
  fail(Array.isArray(value), 'must be an array', path);
  value.forEach((entry, i) => text(entry, `${path}[${i}]`));
}
export function validateDimensions(width, height) {
  for (const [name, value] of [['width', width], ['height', height]]) {
    fail(Number.isInteger(value) && value > 0 && value % 16 === 0, 'must be a positive integer multiple of 16', name);
    fail(Number.isSafeInteger(value), 'exceeds the browser editor\'s safe integer precision', name);
  }
  return { width, height };
}

// Python's round(value, 9) uses the actual binary float and ties-to-even.
// Integer arithmetic avoids the decimal boundary drift of Math.round/toFixed.
function roundNine(value) {
  if (value === 0) return value;
  const buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, Math.abs(value), false);
  const bits = view.getBigUint64(0, false);
  const exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = (exponent || 1) - 1075;
  let numerator = mantissa * 1000000000n, denominator = 1n;
  if (shift >= 0) numerator <<= BigInt(shift); else denominator <<= BigInt(-shift);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n)) quotient++;
  return Number(`${value < 0 ? '-' : ''}${quotient}e-9`);
}

function checkedRect(rect, width, height, path = 'bbox') {
  validateDimensions(width, height);
  fail(Array.isArray(rect) && rect.length === 4, 'must contain four edges [x1, y1, x2, y2]', path);
  fail(rect.every(value => typeof value === 'number' && Number.isFinite(value)), 'must contain four finite numbers', path);
  const [x1, y1, x2, y2] = rect;
  fail(x1 < x2 && y1 < y2, 'must have positive width and height', path);
  fail(x1 >= 0 && y1 >= 0 && x2 <= width && y2 <= height, `exceeds the ${width} x ${height} canvas`, path);
  return rect;
}

export function toCentralBox(rect, width, height) {
  const edges = Array.isArray(rect) ? rect : [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h];
  const [x1, y1, x2, y2] = checkedRect(edges, width, height);
  const result = [Math.floor(roundNine(y1)) - height / 2, Math.floor(roundNine(x1)) - width / 2,
    Math.ceil(roundNine(y2)) - height / 2, Math.ceil(roundNine(x2)) - width / 2];
  fail(result[0] < result[2] && result[1] < result[3], 'is too small at export precision', 'bbox');
  return result;
}
export function fromCentralBox(box, width, height) {
  validateDimensions(width, height);
  fail(Array.isArray(box) && box.length === 4 && box.every(x => typeof x === 'number' && Number.isFinite(x)), 'must contain four finite numbers', 'bbox');
  const [y1, x1, y2, x2] = box;
  checkedRect([x1 + width / 2, y1 + height / 2, x2 + width / 2, y2 + height / 2], width, height);
  return { x: x1 + width / 2, y: y1 + height / 2, w: x2 - x1, h: y2 - y1 };
}
export function toNormalizedRect(rect, width, height) {
  checkedRect([rect.x, rect.y, rect.x + rect.w, rect.y + rect.h], width, height);
  return { x: rect.x / width, y: rect.y / height, w: rect.w / width, h: rect.h / height };
}
export function fromNormalizedRect(rect, width, height) {
  const right = rect.x + rect.w, bottom = rect.y + rect.h;
  // Editing arithmetic can add a few ulps at a canvas edge. Snap only this
  // normalized helper's tiny arithmetic spill, never imported JSON geometry.
  const boundedRight = right > 1 && right <= 1 + 2 * Number.EPSILON ? 1 : right;
  const boundedBottom = bottom > 1 && bottom <= 1 + 2 * Number.EPSILON ? 1 : bottom;
  const x = rect.x * width, y = rect.y * height;
  const result = { x, y, w: boundedRight * width - x, h: boundedBottom * height - y };
  checkedRect([result.x, result.y, result.x + result.w, result.y + result.h], width, height);
  return result;
}

function checkSummary(summary) {
  fields(summary, ['caption', 'meta', 'canvas', 'palette'], ['caption'], 'summary');
  text(summary.caption, 'summary.caption');
  if (own(summary, 'canvas')) fail(['single', 'multi_panel', 'collage'].includes(summary.canvas), 'must be single, multi_panel or collage', 'summary.canvas');
  for (const key of ['meta', 'palette']) if (own(summary, key)) strings(summary[key], `summary.${key}`);
}
function checkItems(items, width, height, centralized = false) {
  fail(Array.isArray(items) && items.length > 0, 'must be a nonempty flat array', 'items');
  return items.map((item, i) => {
    const path = `items[${i}]`;
    fields(item, ['label', 'caption', 'bbox', 'text', 'tags', 'palette'], ['label', 'caption', 'bbox'], path);
    fail(['object', 'character', 'text'].includes(item.label), 'must be object, character or text', `${path}.label`);
    text(item.caption, `${path}.caption`);
    if (item.label === 'text') fail(own(item, 'text'), 'text items require literal text', path);
    if (own(item, 'text')) text(item.text, `${path}.text`);
    for (const key of ['tags', 'palette']) if (own(item, key)) strings(item[key], `${path}.${key}`);
    try {
      const bbox = centralized ? item.bbox : toCentralBox(checkedRect(item.bbox, width, height, `${path}.bbox`), width, height);
      if (centralized) fromCentralBox(bbox, width, height);
      return { ...copy(item), bbox: [...bbox] };
    } catch (error) { throw new LayoutError(error.message.replace(/^bbox: /, ''), `${path}.bbox`); }
  });
}

export function compileDraft(draft) {
  const keys = ['width', 'height', 'bbox_coord_space', 'bbox_format', 'summary', 'items'];
  fields(draft, keys, keys, 'Layout draft');
  const { width, height } = draft;
  for (const key of ['width', 'height']) if (draft[NUMBER_SYNTAX]?.[key] === 'float') throw new LayoutError('must use an integer JSON literal, without a decimal point or exponent', key);
  validateDimensions(width, height);
  fail(draft.bbox_coord_space === 'abs', 'must be abs', 'bbox_coord_space');
  fail(draft.bbox_format === 'xyxy', 'must be xyxy', 'bbox_format');
  checkSummary(draft.summary);
  return { summary: copy(draft.summary), items: checkItems(draft.items, width, height), bbox_coord_space: 'abs_centralized', bbox_format: 'yxyx' };
}

export function makeComfyDraft(draft) {
  const compiled = compileDraft(draft);
  const result = copy(draft);
  result.items = result.items.map((item, index) => {
    const rect = fromCentralBox(compiled.items[index].bbox, result.width, result.height);
    return { ...item, bbox: [rect.x, rect.y, rect.x + rect.w, rect.y + rect.h] };
  });
  return result;
}

export function validateDraft(draft) {
  try {
    compileDraft(draft);
    const pixels = draft.width * draft.height;
    const warnings = [];
    if (pixels < 512 * 512 || pixels > 4 * 1024 * 1024) warnings.push('This canvas is outside the 0.25M to 4M pixel extrapolation range described in the upstream user guide. This is guidance, not a layout schema rule.');
    return { valid: true, errors: [], warnings };
  } catch (error) { return { valid: false, errors: [error.message], warnings: [] }; }
}

export function makeDraft(state) {
  const summary = { caption: state.caption };
  for (const key of ['meta', 'canvas', 'palette']) if (own(state, key) && state[key] !== undefined) summary[key] = copy(state[key]);
  const items = state.items.map(item => {
    const result = { label: item.label, caption: item.caption, bbox: [item.x, item.y, item.x + item.w, item.y + item.h] };
    for (const key of ['text', 'tags', 'palette']) if (own(item, key) && item[key] !== undefined) result[key] = copy(item[key]);
    return result;
  });
  const draft = { width: state.width, height: state.height, bbox_coord_space: 'abs', bbox_format: 'xyxy', summary, items };
  compileDraft(draft);
  return draft;
}
export function makeLayout(state) { return compileDraft(makeDraft(state)); }

// Reject duplicate keys instead of letting JSON.parse silently discard content.
export function parseStrictJSON(source) {
  fail(typeof source === 'string', 'input must be JSON text');
  let index = 0;
  const skip = () => { while (/[\t\r\n ]/.test(source[index] || '\u0000')) index++; };
  function string() {
    const start = index++;
    while (index < source.length) {
      const char = source[index++];
      if (char === '\\') { index++; continue; }
      if (char === '"') return JSON.parse(source.slice(start, index));
    }
    throw new LayoutError('Unterminated JSON string');
  }
  function value() {
    skip();
    if (source[index] === '"') return string();
    if (source[index] === '{') {
      index++; skip(); const result = {}, seen = new Set();
      if (source[index] === '}') { index++; return result; }
      while (true) {
        skip(); fail(source[index] === '"', 'Expected a JSON object key');
        const key = string(); fail(!seen.has(key), `Duplicate JSON key: ${key}`); seen.add(key);
        skip(); fail(source[index++] === ':', 'Expected a colon after JSON key');
        skip(); const valueStart = index, child = value();
        const token = source.slice(valueStart, index);
        if (typeof child === 'number' && /[.eE]/.test(token)) {
          if (!result[NUMBER_SYNTAX]) Object.defineProperty(result, NUMBER_SYNTAX, { value: Object.create(null) });
          result[NUMBER_SYNTAX][key] = 'float';
        }
        Object.defineProperty(result, key, { value: child, enumerable: true, writable: true, configurable: true });
        skip(); const separator = source[index++];
        if (separator === '}') return result;
        fail(separator === ',', 'Expected a comma or closing object brace');
      }
    }
    if (source[index] === '[') {
      index++; skip(); const result = [];
      if (source[index] === ']') { index++; return result; }
      while (true) {
        result.push(value()); skip(); const separator = source[index++];
        if (separator === ']') return result;
        fail(separator === ',', 'Expected a comma or closing array bracket');
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(index));
    fail(match, 'Expected a JSON value'); index += match[0].length;
    const result = JSON.parse(match[0]);
    fail(typeof result !== 'number' || Number.isFinite(result), 'JSON number exceeds browser numeric precision');
    return result;
  }
  try { const result = value(); skip(); fail(index === source.length, 'Unexpected content after JSON value'); return result; }
  catch (error) { if (error instanceof LayoutError) throw error; throw new LayoutError(`Invalid JSON: ${error.message}`); }
}

export function parseLayout(json, dimensions = {}) {
  const source = typeof json === 'string' ? parseStrictJSON(json) : copy(json);
  fail(object(source), 'Layout must be a JSON object');
  let width, height, summary, items;
  if (source.bbox_coord_space === 'abs') {
    compileDraft(source);
    ({ width, height, summary, items } = source);
    items = items.map(item => ({ ...item, rect: { x: item.bbox[0], y: item.bbox[1], w: item.bbox[2] - item.bbox[0], h: item.bbox[3] - item.bbox[1] } }));
  } else {
    const keys = ['summary', 'items', 'bbox_coord_space', 'bbox_format'];
    fields(source, keys, keys, 'Compiled layout');
    fail(source.bbox_coord_space === 'abs_centralized', 'must be abs or abs_centralized', 'bbox_coord_space');
    fail(source.bbox_format === 'yxyx', 'must be yxyx for a compiled layout', 'bbox_format');
    ({ width, height } = dimensions); validateDimensions(width, height);
    checkSummary(source.summary); summary = source.summary;
    items = checkItems(source.items, width, height, true).map(item => ({ ...item, rect: fromCentralBox(item.bbox, width, height) }));
  }
  const state = { width, height, caption: summary.caption, items: [] };
  for (const key of ['meta', 'canvas', 'palette']) if (own(summary, key)) state[key] = copy(summary[key]);
  state.items = items.map((item, index) => {
    const result = { id: `item-${index + 1}`, label: item.label, caption: item.caption, ...item.rect };
    for (const key of ['text', 'tags', 'palette']) if (own(item, key)) result[key] = copy(item[key]);
    return result;
  });
  return state;
}

// This is an editor interaction policy, not an upstream compiler transformation.
export function clampRect(rect, width, height, minimum = 1) {
  validateDimensions(width, height);
  fail([rect.x, rect.y, rect.w, rect.h, minimum].every(Number.isFinite), 'Editor rectangle must contain finite numbers');
  fail(minimum > 0, 'Editor minimum size must be positive');
  const w = Math.min(width, Math.max(Math.min(minimum, width), rect.w));
  const h = Math.min(height, Math.max(Math.min(minimum, height), rect.h));
  return { x: Math.max(0, Math.min(width - w, rect.x)), y: Math.max(0, Math.min(height - h, rect.y)), w, h };
}
export function resizeLayout(state, width, height, { scale = true } = {}) {
  makeDraft(state); validateDimensions(width, height);
  const result = copy(state);
  result.items = state.items.map(item => ({ ...copy(item), ...(scale
    ? fromNormalizedRect(toNormalizedRect(item, state.width, state.height), width, height)
    : clampRect(item, width, height)) }));
  result.width = width; result.height = height;
  makeDraft(result);
  return result;
}
