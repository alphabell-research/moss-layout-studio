import {parseLayout,parseStrictJSON,makeDraft,SOURCE_REVISION} from './layout.mjs';
import {EVALUATOR_VERSION,graphemes,validRect,blindAssignment,summarize} from './evaluate-core.mjs';

const STUDIO_REVISION='1210c33a99640fdcc7ae8dbc0cdddc03bafa4632';
const byId=id=>document.getElementById(id);
const layoutInput=byId('layout-json'), widthInput=byId('layout-width'), heightInput=byId('layout-height');
const baseInput=byId('base-image'),sftInput=byId('sft-image'),setupError=byId('setup-error'),evaluationError=byId('evaluation-error');
const sideNodes={A:document.querySelector('.side[data-side="A"]'),B:document.querySelector('.side[data-side="B"]')};
let session=null;
const dragging={A:null,B:null};

function error(message){setupError.textContent=message;}
function sha256(buffer){return crypto.subtle.digest('SHA-256',buffer).then(bytes=>[...new Uint8Array(bytes)].map(value=>value.toString(16).padStart(2,'0')).join(''));}
function annotation(){return {status:null,transcription:'',box:null};}
function targetRegion(item){return {text:item.text,x:item.x,y:item.y,w:item.w,h:item.h};}
function complete(item,width,height){return item.status==='missing'||item.status==='illegible'||(item.status==='visible'&&item.transcription.length>0&&validRect(item.box,width,height));}
function imageFor(side){return session.images[session.assignment[side]==='Base'?0:1];}

byId('layout-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];
  if(!file)return;
  if(file.size>1_000_000){error('Layout JSON must be smaller than 1 MB.');return;}
  layoutInput.value=await file.text();
  error('');
});
function updateImageStatus(){
  const count=Number(Boolean(baseInput.files?.[0]))+Number(Boolean(sftInput.files?.[0]));
  byId('image-status').textContent=count===2?'Base and SFT images ready. File names will be hidden during annotation.':`${count} of 2 images ready.`;
}
baseInput.addEventListener('change',updateImageStatus);
sftInput.addEventListener('change',updateImageStatus);

byId('start').addEventListener('click',async()=>{
  error('');
  let layout;
  try{
    if(!layoutInput.value.trim())throw new Error('Import an editable draft or compiled layout JSON.');
    if(layoutInput.value.length>1_000_000)throw new Error('Layout JSON must be smaller than 1 MB.');
    const source=parseStrictJSON(layoutInput.value);
    if(source?.bbox_coord_space==='abs_centralized'&&(!widthInput.value||!heightInput.value))throw new Error('Compiled prompts omit dimensions. Enter the exact original generation width and height.');
    const width=Number(widthInput.value),height=Number(heightInput.value);
    layout=parseLayout(layoutInput.value,{width,height});
    if(layout.width>8192||layout.height>8192)throw new Error('This visual check supports dimensions up to 8,192 pixels.');
    const textItems=layout.items.filter(item=>item.label==='text');
    if(!textItems.length)throw new Error('The layout needs at least one text item to check.');
    if(textItems.length>50)throw new Error('This visual check supports up to 50 text items.');
    if(textItems.some(item=>graphemes(item.text).length>1000))throw new Error('Each target text region must be 1,000 graphemes or shorter.');
    if(!baseInput.files?.[0]||!sftInput.files?.[0])throw new Error('Choose one Base image and one SFT image.');
    widthInput.value=layout.width;
    heightInput.value=layout.height;
    const files=[baseInput.files[0],sftInput.files[0]];
    const loaded=[];
    try{
      for(const file of files){
        if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Use PNG, JPEG or WebP images.');
        if(file.size>20_000_000)throw new Error('Each image must be 20 MB or smaller.');
        const bytes=await file.arrayBuffer();
        const bitmap=await createImageBitmap(new Blob([bytes],{type:file.type}));
        loaded.push({bitmap,sha256:await sha256(bytes),width:bitmap.width,height:bitmap.height});
        if(bitmap.width!==layout.width||bitmap.height!==layout.height)throw new Error(`Both images must be ${layout.width} × ${layout.height} pixels, matching the generation layout.`);
      }
    }catch(loadError){loaded.forEach(image=>image.bitmap.close());throw loadError;}
    const random=new Uint8Array(1);crypto.getRandomValues(random);
    session={layout,textItems,images:loaded,assignment:blindAssignment(random[0]),annotations:{A:textItems.map(annotation),B:textItems.map(annotation)},index:0,revealed:false,generationNotes:byId('generation-notes').value};
    byId('setup').hidden=true;
    byId('evaluation').hidden=false;
    renderStep();
    byId('evaluation').scrollIntoView({block:'start'});
  }catch(problem){error(problem.message||'Could not start the blind check.');}
});

function draw(side,temporary=null){
  if(!session)return;
  const node=sideNodes[side],canvas=node.querySelector('canvas'),context=canvas.getContext('2d');
  const {width,height}=session.layout;
  const scale=Math.min(1,960/width,700/height);
  const displayWidth=Math.max(1,Math.round(width*scale)),displayHeight=Math.max(1,Math.round(height*scale));
  if(canvas.width!==displayWidth||canvas.height!==displayHeight){canvas.width=displayWidth;canvas.height=displayHeight;}
  context.clearRect(0,0,displayWidth,displayHeight);
  context.drawImage(imageFor(side).bitmap,0,0,displayWidth,displayHeight);
  const sx=displayWidth/width,sy=displayHeight/height;
  session.textItems.forEach((item,index)=>{
    context.strokeStyle=index===session.index?'#38d4f5':'#a7d9e380';
    context.lineWidth=index===session.index?Math.max(2,3*scale):1;
    context.setLineDash(index===session.index?[]:[5,4]);
    context.strokeRect(item.x*sx,item.y*sy,item.w*sx,item.h*sy);
  });
  context.setLineDash([]);
  const observed=temporary||session.annotations[side][session.index].box;
  if(observed){context.fillStyle='#f29c3738';context.fillRect(observed.x*sx,observed.y*sy,observed.w*sx,observed.h*sy);context.strokeStyle='#ffad43';context.lineWidth=Math.max(2,3*scale);context.strokeRect(observed.x*sx,observed.y*sy,observed.w*sx,observed.h*sy);}
}

function renderSide(side){
  const node=sideNodes[side],item=session.annotations[side][session.index],locked=session.revealed;
  for(const button of node.querySelectorAll('[data-status]')){
    button.setAttribute('aria-pressed',String(button.dataset.status===item.status));
    button.disabled=locked;
  }
  const text=node.querySelector('textarea');
  text.value=item.transcription;
  text.disabled=locked||item.status==='missing'||item.status==='illegible';
  for(const input of node.querySelectorAll('[data-coordinate]')){
    input.value=item.box?.[input.dataset.coordinate]??'';
    input.disabled=locked||item.status==='missing'||item.status==='illegible';
  }
  draw(side);
}

function renderProgress(){
  const all=[...session.annotations.A,...session.annotations.B];
  const done=all.filter(item=>complete(item,session.layout.width,session.layout.height)).length;
  byId('progress-label').textContent=`Text region ${session.index+1} of ${session.textItems.length}`;
  byId('progress-count').textContent=`${done} of ${all.length} observations complete`;
  byId('previous').disabled=session.index===0;
  byId('next').disabled=session.index===session.textItems.length-1;
  byId('reveal').disabled=done!==all.length||session.revealed;
}

function renderStep(){
  const item=session.textItems[session.index];
  byId('target-text').textContent=item.text;
  byId('target-caption').textContent=item.caption;
  byId('target-coordinates').textContent=`Target box: x ${Math.round(item.x)}, y ${Math.round(item.y)}, w ${Math.round(item.w)}, h ${Math.round(item.h)}`;
  evaluationError.textContent='';
  renderSide('A');renderSide('B');renderProgress();
}

for(const side of ['A','B']){
  const node=sideNodes[side],canvas=node.querySelector('canvas');
  node.querySelectorAll('[data-status]').forEach(button=>button.addEventListener('click',()=>{
    if(!session||session.revealed)return;
    const item=session.annotations[side][session.index];
    item.status=button.dataset.status;
    if(item.status!=='visible'){item.transcription='';item.box=null;}
    renderSide(side);renderProgress();
  }));
  node.querySelector('textarea').addEventListener('input',event=>{
    if(!session||session.revealed)return;
    const item=session.annotations[side][session.index];
    item.transcription=event.target.value;
    if(item.status!== 'visible'){
      item.status='visible';
      node.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status==='visible')));
    }
    renderProgress();
  });
  node.querySelectorAll('[data-coordinate]').forEach(input=>input.addEventListener('input',()=>{
    if(!session||session.revealed)return;
    const item=session.annotations[side][session.index];
    const values=Object.fromEntries([...node.querySelectorAll('[data-coordinate]')].map(field=>[field.dataset.coordinate,field.value===''?NaN:Number(field.value)]));
    item.box=validRect(values,session.layout.width,session.layout.height)?values:null;
    item.status='visible';
    node.querySelectorAll('[data-status]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.status==='visible')));
    draw(side);renderProgress();
  }));
  const point=event=>{
    const bounds=canvas.getBoundingClientRect();
    return {x:Math.max(0,Math.min(session.layout.width,Math.round((event.clientX-bounds.left)/bounds.width*session.layout.width))),y:Math.max(0,Math.min(session.layout.height,Math.round((event.clientY-bounds.top)/bounds.height*session.layout.height)))};
  };
  canvas.addEventListener('pointerdown',event=>{
    if(!session||session.revealed)return;
    dragging[side]={start:point(event),id:event.pointerId};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!session||!dragging[side]||dragging[side].id!==event.pointerId)return;
    const start=dragging[side].start,end=point(event);
    draw(side,{x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)});
  });
  canvas.addEventListener('pointerup',event=>{
    if(!session||!dragging[side]||dragging[side].id!==event.pointerId)return;
    const start=dragging[side].start,end=point(event);
    dragging[side]=null;
    canvas.releasePointerCapture(event.pointerId);
    const box={x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),w:Math.abs(start.x-end.x),h:Math.abs(start.y-end.y)};
    if(!validRect(box,session.layout.width,session.layout.height)){
      evaluationError.textContent='Draw a rectangle with a positive width and height.';
      draw(side);return;
    }
    const item=session.annotations[side][session.index];
    item.box=box;item.status='visible';
    renderSide(side);renderProgress();
  });
  canvas.addEventListener('pointercancel',()=>{dragging[side]=null;draw(side);});
}

byId('previous').addEventListener('click',()=>{if(session&&session.index>0){session.index--;renderStep();}});
byId('next').addEventListener('click',()=>{if(session&&session.index<session.textItems.length-1){session.index++;renderStep();}});
byId('reveal').addEventListener('click',()=>{
  if(!session||session.revealed)return;
  const all=[...session.annotations.A,...session.annotations.B];
  if(!all.every(item=>complete(item,session.layout.width,session.layout.height))){evaluationError.textContent='Finish both observations for every text region before revealing the labels.';return;}
  session.scores=summarize(session.textItems.map(targetRegion),session.annotations,session.layout.width,session.layout.height);
  session.revealed=true;
  renderStep();
  const container=byId('result-cards');container.replaceChildren();
  for(const side of ['A','B']){
    const stats=session.scores[side],card=document.createElement('article');
    const headline=document.createElement('p');headline.textContent=`Image ${side} revealed`;
    const title=document.createElement('h3');title.textContent=session.assignment[side];
    const list=document.createElement('dl');
    const rows=[['Exact text',`${stats.exact} of ${stats.assessed} assessed`],['Missing',String(stats.missing)],['Illegible',String(stats.illegible)],['Mean text error',stats.mean_normalized_error===null?'No scored regions':stats.mean_normalized_error.toFixed(3)],['Mean box overlap',stats.mean_iou===null?'No scored regions':stats.mean_iou.toFixed(3)]];
    for(const [label,value] of rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;list.append(dt,dd);}
    card.append(headline,title,list);container.append(card);
  }
  byId('results').hidden=false;
  byId('results').scrollIntoView({block:'start'});
});

byId('download').addEventListener('click',()=>{
  if(!session?.revealed)return;
  const output={schema_version:EVALUATOR_VERSION,created_at:new Date().toISOString(),studio_revision:STUDIO_REVISION,upstream_layout_revision:SOURCE_REVISION,layout:makeDraft(session.layout),generation_notes:session.generationNotes||'unknown',images:{A:{model:session.assignment.A,sha256:imageFor('A').sha256,width:session.layout.width,height:session.layout.height},B:{model:session.assignment.B,sha256:imageFor('B').sha256,width:session.layout.width,height:session.layout.height}},annotations:session.annotations,scores:session.scores,scope:'Manual observations on one image pair. No image bytes, OCR, inference or general model ranking.'};
  const blob=new Blob([JSON.stringify(output,null,2)+'\n'],{type:'application/json'});
  const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='moss-blind-layout-check.json';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
});
