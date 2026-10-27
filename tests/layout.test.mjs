import test from 'node:test';
import assert from 'node:assert/strict';
import { compileDraft, makeComfyDraft, makeDraft, makeLayout, parseLayout, parseStrictJSON, toCentralBox, fromCentralBox, resizeLayout, validateDraft, clampRect } from '../layout.mjs';

const draft = () => ({ width: 1536, height: 1024, bbox_coord_space: 'abs', bbox_format: 'xyxy', summary: { caption: 'A ceramic campaign.', meta: ['poster'], canvas: 'single', palette: ['ivory'] }, items: [{ label: 'text', caption: 'Dark-green lettering.', text: '把日常，过成诗。\n"MOSS" 🪴', bbox: [928, 272, 1408, 448], tags: ['title'], palette: ['green'] }] });

test('official landscape example converts to centered yxyx without content loss or mutation', () => {
  const source = draft(), before = structuredClone(source), out = compileDraft(source);
  assert.deepEqual(out.items[0].bbox, [-240, 160, -64, 640]);
  assert.deepEqual(out.summary, source.summary); assert.equal(out.items[0].text, source.items[0].text);
  assert.deepEqual(out.items[0].tags, ['title']); assert.deepEqual(out.items[0].palette, ['green']);
  assert.equal(out.bbox_coord_space, 'abs_centralized'); assert.equal(out.bbox_format, 'yxyx');
  assert.equal('width' in out, false); assert.equal('height' in out, false); assert.deepEqual(source, before);
});
test('portrait, fractions and compiler precision enclose before center subtraction', () => {
  assert.deepEqual(toCentralBox([0, 0, 768, 1344], 768, 1344), [-672, -384, 672, 384]);
  assert.deepEqual(toCentralBox([10.9, 20.1, 100.01, 200.99], 768, 1344), [-652, -374, -471, -283]);
  assert.deepEqual(toCentralBox([1.00000000001, 2, 100, 200], 768, 1344), [-670, -383, -472, -284]);
  assert.deepEqual(toCentralBox([0, 0, 99.99999999999, 199.99999999999], 768, 1344), [-672, -384, -472, -284]);
});
test('draft and compiled round trips retain optional creative fields and literal Unicode', () => {
  const source = draft(), state = parseLayout(JSON.stringify(source));
  assert.deepEqual(makeDraft(state), source);
  assert.deepEqual(makeLayout(parseLayout(JSON.stringify(compileDraft(source)), { width: 1536, height: 1024 })), compileDraft(source));
  assert.equal('id' in makeDraft(state).items[0], false);
  assert.equal(state.items[0].text, source.items[0].text);
});
test('ComfyUI draft preserves the compiled prompt at fractional pixel edges', () => {
  const source = draft(), before = structuredClone(source);
  source.items[0].bbox = [927.9999999999, 271.9999999999, 1408.0000000001, 448.0000000001];
  const sourceBefore = structuredClone(source);
  const handoff = makeComfyDraft(source);
  assert.deepEqual(handoff.items[0].bbox, [928, 272, 1408, 448]);
  assert.deepEqual(compileDraft(handoff), compileDraft(source));
  assert.deepEqual(handoff.summary, before.summary);
  assert.equal(handoff.items[0].text, before.items[0].text);
  assert.deepEqual(source, sourceBefore);
  assert.notStrictEqual(handoff.items[0], source.items[0]);
});
test('compiled import requires dimensions and honors non-square axis order', () => {
  const source = compileDraft(draft()); assert.throws(() => parseLayout(JSON.stringify(source)), /width/);
  const r = fromCentralBox([-288, -592, 352, 32], 1536, 1024);
  assert.deepEqual(r, { x: 176, y: 224, w: 624, h: 640 });
});
test('invalid numeric geometry, zero area and out-of-canvas boxes are rejected', () => {
  for (const box of [[-1,0,100,100], [0,0,1537,100], [100,0,50,100], [0,0,0,100], [0,0,100], [true,0,100,100], [0,0,NaN,100], [0,0,Infinity,100], [1,0,1.00000000001,100]]) {
    const source = draft(); source.items[0].bbox = box; assert.throws(() => compileDraft(source));
  }
  const source = draft(); source.width = 1535; assert.equal(validateDraft(source).valid, false);
});
test('unknown fields, nested layouts and blank content cannot be silently lost', () => {
  const modifications = [s=>s.other='unknown', s=>s.items[0].children=[], s=>s.items[0].id='editor-id', s=>s.summary.meta=[''], s=>s.summary.caption=' ', s=>s.items[0].text='', s=>s.items=[], s=>s.items[0].label='face', s=>s.summary.canvas='other'];
  for (const modify of modifications) { const source = draft(); modify(source); assert.throws(() => compileDraft(source)); }
  const source = draft(); delete source.items[0].text; assert.throws(() => compileDraft(source), /literal text/);
});
test('strict import rejects duplicate keys including escaped keys and invalid JSON constants', () => {
  for (const value of ['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"a":{"x":1,"x":2}}', '[NaN]', '{"x":Infinity}', '{"x":1e400}', '{"x":01}', '{"x":1,}', 'null trailing', '"unterminated']) assert.throws(() => parseStrictJSON(value));
  assert.deepEqual(parseStrictJSON('{"__proto__":{"polluted":true}}'), JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
});
test('width and height retain JSON integer-literal semantics', () => {
  const source = JSON.stringify(draft());
  assert.throws(() => parseLayout(source.replace('"width":1536', '"width":1536.0')), /integer JSON literal/);
  assert.throws(() => parseLayout(source.replace('"height":1024', '"height":1.024e3')), /integer JSON literal/);
  assert.equal(parseLayout(source).width, 1536);
});
test('resolution recommendations produce warnings and are separate from accepted schema', () => {
  const source = draft(); source.width = source.height = 8192;
  const result = validateDraft(source); assert.equal(result.valid, true); assert.equal(result.warnings.length, 1);
});
test('text validation follows Python Unicode whitespace without normalization', () => {
  for (const space of ['\u0085', '\u001c', '\u2007', '\u3000']) {
    const source = draft(); source.summary.caption = space; assert.equal(validateDraft(source).valid, false);
  }
  const source = draft(); source.summary.caption = '\ufeff';
  assert.equal(compileDraft(source).summary.caption, '\ufeff');
});
test('overlap remains permitted and exact text, tags and arrays retain order', () => {
  const source = draft(); source.items.push({ ...structuredClone(source.items[0]), text: 'Second\nline' });
  assert.deepEqual(compileDraft(source).items.map(x=>x.bbox), [[-240,160,-64,640],[-240,160,-64,640]]);
  assert.deepEqual(makeDraft(parseLayout(JSON.stringify(source))), source);
});
test('explicit scaling versus local clamp policy preserves inputs and enforces edit bounds', () => {
  const state = parseLayout(JSON.stringify(draft())), before = structuredClone(state);
  const half = resizeLayout(state, 768, 512);
  assert.equal(half.items[0].x, state.items[0].x/2); assert.equal(half.items[0].h, state.items[0].h/2);
  const clamped = resizeLayout(state, 768, 512, { scale:false });
  assert.equal(clamped.items[0].x+clamped.items[0].w,768); assert.equal(clamped.items[0].y+clamped.items[0].h,448);
  assert.deepEqual(state,before); assert.deepEqual(clampRect({x:-9,y:999,w:50,h:50},1024,1024), {x:0,y:974,w:50,h:50});
});
