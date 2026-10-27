import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {graphemes,editDistance,boxIoU,centerOffset,blindAssignment,scoreRegion,summarize} from '../evaluate-core.mjs';
import {parseLayout} from '../layout.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('scores literal Unicode graphemes and line breaks',()=>{
  assert.equal(graphemes('👩‍🔬').length,1);
  assert.equal(editDistance('A\nB','A B'),1);
  assert.equal(editDistance('研究👩‍🔬','研究🧑‍🔬'),1);
  assert.equal(editDistance('é','é'),1);
});

test('boxes calculate exact overlap and normalized center displacement',()=>{
  const a={x:10,y:20,w:50,h:40};
  assert.equal(boxIoU(a,a),1);
  assert.equal(boxIoU(a,{x:100,y:100,w:10,h:10}),0);
  assert.equal(centerOffset(a,a,200,100),0);
  assert.ok(centerOffset(a,{x:20,y:20,w:50,h:40},200,100)>0);
});

test('compiled non-square yxyx prompt requires original dimensions and transposes correctly',()=>{
  const compiled={summary:{caption:'A poster'},items:[{label:'text',caption:'White title',text:'MOSS',bbox:[-288,-592,352,32]}],bbox_coord_space:'abs_centralized',bbox_format:'yxyx'};
  assert.throws(()=>parseLayout(compiled),/width/);
  const state=parseLayout(compiled,{width:1536,height:1024});
  assert.deepEqual([state.items[0].x,state.items[0].y,state.items[0].w,state.items[0].h],[176,224,624,640]);
});

test('blind assignment swaps the two model identities without changing labels',()=>{
  assert.deepEqual(blindAssignment(0),{A:'Base',B:'SFT'});
  assert.deepEqual(blindAssignment(1),{A:'SFT',B:'Base'});
  assert.throws(()=>blindAssignment(256),RangeError);
});

test('missing text counts as a full miss and illegible remains unscored',()=>{
  const target={text:'TITLE',x:10,y:10,w:100,h:40};
  assert.deepEqual(scoreRegion(target,{status:'missing'},400,200),{status:'missing',exact:false,edit_distance:5,normalized_error:1,iou:0,center_offset:null});
  assert.equal(scoreRegion(target,{status:'illegible'},400,200).exact,null);
  assert.throws(()=>scoreRegion(target,{status:'visible',transcription:'TITLE',box:null},400,200),/observed box/);
});

test('A/B summary retains pair-specific manual scores without a model ranking',()=>{
  const target=[{text:'HELLO',x:10,y:10,w:100,h:40}];
  const annotations={A:[{status:'visible',transcription:'HELLO',box:{x:10,y:10,w:100,h:40}}],B:[{status:'missing'}]};
  const result=summarize(target,annotations,400,200);
  assert.equal(result.A.exact,1);
  assert.equal(result.A.mean_iou,1);
  assert.equal(result.B.exact,0);
  assert.equal(result.B.mean_normalized_error,1);
});

test('the public evaluator route links local assets and pinned publisher sources',()=>{
  const home=readFileSync(resolve(root,'index.html'),'utf8');
  const html=readFileSync(resolve(root,'evaluate.html'),'utf8');
  assert.match(home,/href="evaluate\.html"/);
  assert.match(html,/evaluate\.mjs/);
  assert.match(html,/f972bd4b4b9e3852133cc5da954d87bc32cd8fb9/);
  assert.match(html,/85975793d8b3d432f1b6e27f352abaa4c2a4c0d3/);
  assert.match(html,/connect-src 'none'/);
  for(const name of ['evaluate.css','evaluate.mjs','evaluate-core.mjs','verify_evaluator.py'])assert.ok(statSync(resolve(root,name)).size>0,name);
  for(const name of ['evaluate.html','evaluate.css','evaluate.mjs','evaluate-core.mjs'])assert.doesNotMatch(readFileSync(resolve(root,name),'utf8'),/rotem|nimrod|nimo|grabo|—/i,name);
});
