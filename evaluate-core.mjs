export const EVALUATOR_VERSION = 1;
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

export function graphemes(value) {
  return [...segmenter.segment(String(value))].map(part => part.segment);
}

export function editDistance(expected, observed) {
  const a = graphemes(expected), b = graphemes(observed);
  if (a.length > 1000 || b.length > 1000) throw new RangeError('Text regions are limited to 1,000 graphemes for scoring.');
  let prior = Array.from({length: b.length + 1}, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, prior[j] + 1, prior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prior = current;
  }
  return prior[b.length];
}

export function validRect(rect, width, height) {
  return Boolean(rect && [rect.x,rect.y,rect.w,rect.h].every(Number.isFinite)
    && rect.w > 0 && rect.h > 0 && rect.x >= 0 && rect.y >= 0
    && rect.x + rect.w <= width + 1e-7 && rect.y + rect.h <= height + 1e-7);
}

export function boxIoU(first, second) {
  const overlapWidth = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
  const overlapHeight = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
  const intersection = overlapWidth * overlapHeight;
  const union = first.w * first.h + second.w * second.h - intersection;
  return union > 0 ? intersection / union : 0;
}

export function centerOffset(first, second, width, height) {
  const ax = first.x + first.w / 2, ay = first.y + first.h / 2;
  const bx = second.x + second.w / 2, by = second.y + second.h / 2;
  return Math.hypot(ax - bx, ay - by) / Math.hypot(width, height);
}

export function blindAssignment(randomByte) {
  if (!Number.isInteger(randomByte) || randomByte < 0 || randomByte > 255) throw new RangeError('Random byte must be 0 to 255.');
  return randomByte & 1 ? {A: 'SFT', B: 'Base'} : {A: 'Base', B: 'SFT'};
}

export function scoreRegion(target, annotation, width, height) {
  if (!target || typeof target.text !== 'string' || !validRect(target, width, height)) throw new TypeError('Invalid target text region.');
  if (!annotation || !['visible','missing','illegible'].includes(annotation.status)) throw new TypeError('Choose visible, missing or illegible.');
  if (annotation.status === 'illegible') return {status:'illegible',exact:null,edit_distance:null,normalized_error:null,iou:null,center_offset:null};
  if (annotation.status === 'missing') {
    return {status:'missing',exact:false,edit_distance:graphemes(target.text).length,normalized_error:1,iou:0,center_offset:null};
  }
  if (typeof annotation.transcription !== 'string' || !annotation.transcription.length || !validRect(annotation.box,width,height)) {
    throw new TypeError('Visible text needs a transcription and observed box.');
  }
  const distance=editDistance(target.text,annotation.transcription);
  return {status:'visible',exact:distance===0,edit_distance:distance,normalized_error:distance/Math.max(1,graphemes(target.text).length),iou:boxIoU(target,annotation.box),center_offset:centerOffset(target,annotation.box,width,height)};
}

export function summarize(textItems, annotations, width, height) {
  const sides={};
  for (const side of ['A','B']) {
    const scores=textItems.map((item,index)=>scoreRegion(item,annotations[side][index],width,height));
    const assessed=scores.filter(item=>item.status!=='illegible');
    const mean=(values)=>values.length?values.reduce((total,value)=>total+value,0)/values.length:null;
    sides[side]={regions:scores,assessed:assessed.length,missing:scores.filter(item=>item.status==='missing').length,illegible:scores.filter(item=>item.status==='illegible').length,exact:assessed.filter(item=>item.exact).length,mean_normalized_error:mean(assessed.map(item=>item.normalized_error)),mean_iou:mean(assessed.map(item=>item.iou))};
  }
  return sides;
}
