// Harness adapted from 独立评审官 recovery-independent.mjs, 2026-11-14; no edits to original.
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=decodeURIComponent(new URL('..',import.meta.url).pathname);
const original=fs.readFileSync(root+'/docs/app.js','utf8');
function harness(){
 const elements=new Map(),images=[],revoked=[];let objectId=0;
 class Element {
  constructor(key){this.key=key;this.dataset={};this.style={setProperty(){}};this.attrs={};this.listeners={};this.children=[];this.value='';this.hidden=false;this.textContent='';}
  addEventListener(n,f){this.listeners[n]=f;}
  setAttribute(n,v){this.attrs[n]=String(v)} removeAttribute(n){delete this.attrs[n]}
  async fire(n,e={}){return this.listeners[n]?.(e)}
  set innerHTML(s){this.html=s;if(this.key==='#vers')this.children=[...s.matchAll(/data-i="(\d+)"/g)].map(m=>{const e=new Element('version');e.dataset.i=m[1];return e});if(this.key==='#strip')this.children=(s?['main','square','banner','poster']:[]).map(id=>{const e=new Element('strip');e.dataset.id=id;return e});}
  get innerHTML(){return this.html||''}
  querySelector(s){if(s.startsWith('button[data-id='))return this.children.find(x=>x.dataset.id===s.match(/=(.*?)\]/)[1]);return element(this.key+' '+s)}
  querySelectorAll(s){return s==='button'?this.children:[]}
  append(){} showModal(){this.open=true}
 }
 const element=s=>{if(!elements.has(s))elements.set(s,new Element(s));return elements.get(s)};
 const fid=[new Element('raw'),new Element('scene')];fid[0].value='raw';fid[1].value='scene';
 const scene=[new Element('wood')];scene[0].value='wood';
 let fetcher;
 const c={document:{documentElement:{},querySelector:element,querySelectorAll:s=>s==='#vers button'?element('#vers').children:s==='input[name=fid]'?fid:s==='input[name=scene]'?scene:[],createElement:()=>new Element('new'),createTextNode:s=>s},window:{scrollTo(){}},Image:class{constructor(){images.push(this)}async decode(){}},URL:{createObjectURL:()=> 'blob:fixture-'+(++objectId),revokeObjectURL:u=>revoked.push(u)},CB_ASSETS:{photo:'fake-photo'},Uint32Array,TextEncoder,Blob,DataView,ArrayBuffer,URLSearchParams,console,setTimeout:()=>0,clearTimeout(){},cancelAnimationFrame(){},requestAnimationFrame:()=>0,fetch:(...a)=>fetcher(...a)};
 vm.createContext(c);
 // Keep actual drawStrip and updateResult/event binding. Skip Canvas rendering only.
 vm.runInContext(original.replace('  boot();','  render=()=>[]; window.review={S,generate,updateResult,drawStrip,pending:()=>pendingFile}; mountStudio();'),c);
 const a=c.window.review;
 Object.assign(a.S,{live:true,isSample:true,remaining:1,name:'拿铁',price:'18',shop:'示例',offer:'',photo:{},phase:'result',sheet:'main'});
 for(const id of ['main','square','banner','poster'])a.S.kit[id]={status:'done',mode:'scene',seed:2,scene:'wood',versions:[{mode:'scene',sceneImg:{tag:'v1'}},{mode:'scene',sceneImg:{tag:'v2'}}],cur:1};
 a.updateResult();
 return {...a,element,images,revoked,fid,scene,fetch:f=>fetcher=f};
}
const ok=()=>new Response(JSON.stringify({image_url:'/api/rendered-image?id=paid-first',remaining:0,unlimited:false,title:'paid-first',detail:'拿铁18元'}));
for (const entry of ['again','go']) for(const imageFails of [false,true]) test(`${entry}: duplicate activation preserves first success, image failure=${imageFails}`,async()=>{
 const a=harness();let release;const calls=[];
 a.fetch(async(u,o)=>{calls.push({url:u,method:o?.method||'GET'});if(o?.method==='POST'){if(calls.filter(x=>x.method==='POST').length===1)return new Promise(r=>release=r);return new Response(JSON.stringify({code:'GENERATION_BUSY',error:'busy'}),{status:409});}return new Response('pixels',{status:imageFails?502:200});});
 const first=a.element('#'+entry).fire('click');
 await a.element('#'+entry).fire('click');
 assert.equal(calls.filter(x=>x.method==='POST').length,1,'重复激活不能发第二POST');
 assert.equal(a.element('#'+entry).disabled,true,'原生按钮必须禁用');
 release(ok());await first;
 assert.equal(a.S.remaining,0);assert.equal(a.S.phase,imageFails?'error':'result');
 assert.equal(calls.filter(x=>x.method==='GET').length,1);
 if(imageFails){a.fetch(async(u,o)=>{assert.equal(o?.method,undefined);assert.equal(u,'/api/rendered-image?id=paid-first');return new Response('pixels');});await a.element('#errRetry').fire('click');assert.equal(a.S.phase,'result');}
 assert.equal(a.element('#'+entry).disabled,false);
});
test('old task finally cannot release newer generation controls',async()=>{
 const a=harness();let oldRelease,newRelease;let posts=0;
 a.fetch(async(u,o)=>o?.method==='POST'?new Promise(r=>{if(++posts===1)oldRelease=r;else newRelease=r;}):new Response('pixels'));
 const old=a.element('#again').fire('click');await a.element('#cancel').fire('click');
 const newer=a.element('#go').fire('click');oldRelease(ok());await old;
 assert.equal(a.element('#go').disabled,true);assert.equal(a.element('#again').disabled,true);
 newRelease(ok());await newer;assert.equal(a.element('#go').disabled,false);
});
function choose(a,name,type='image/jpeg',size=10){a.element('#file').fire('change',{target:{files:[{name,type,size}]}});const im=a.images.at(-1);im.naturalWidth=im.naturalHeight=1000;return im;}
for(const late of ['load','error']) test(`selection A→B, B loads first; late A ${late} cannot alter B`,async()=>{
 const a=harness();const old=choose(a,'old.jpg'),newer=choose(a,'new.jpg');newer.onload();
 const pending=a.pending(),text=a.element('#photoMsg').innerHTML,phase=a.S.phase;
 old[late==='load'?'onload':'onerror']();
 assert.equal(a.S.photo,newer);assert.equal(a.pending(),pending);assert.equal(a.pending().name,'new.jpg');
 assert.equal(a.element('#photoMsg').innerHTML,text);assert.equal(a.element('#photoMsg').dataset.kind,'');assert.equal(a.S.phase,phase);
 assert.equal(a.revoked.filter(u=>u===old.src).length,1);assert.equal(a.revoked.filter(u=>u===newer.src).length,1);
});
for(const boundary of ['invalid type','oversize','cancel','restart','errBack']) for(const late of ['load','error']) test(`pending selection invalidated by ${boundary}, late ${late} is cleanup only`,async()=>{
 const a=harness();const original=a.S.photo,old=choose(a,'old.jpg');
 if(boundary==='invalid type')choose(a,'bad.txt','text/plain');
 else if(boundary==='oversize')choose(a,'huge.jpg','image/jpeg',11*1024*1024);
 else await a.element('#'+boundary).fire('click');
 const text=a.element('#photoMsg').textContent,kind=a.element('#photoMsg').dataset.kind,phase=a.S.phase;
 old[late==='load'?'onload':'onerror']();
 assert.equal(a.S.photo,original);assert.equal(a.pending(),null);assert.equal(a.element('#photoMsg').textContent,text);assert.equal(a.element('#photoMsg').dataset.kind,kind);assert.equal(a.S.phase,phase);
 assert.equal(a.revoked.filter(u=>u===old.src).length,1);
});
for(const [firstId,secondId] of [['again','go'],['go','again']]) test(`generation task lock is shared: ${firstId} then ${secondId}`,async()=>{
 const a=harness();let release,posts=0;
 a.fetch(async(u,o)=>{if(o?.method==='POST'){posts++;return new Promise(r=>release=r);}return new Response('pixels');});
 const first=a.element('#'+firstId).fire('click');await a.element('#'+secondId).fire('click');assert.equal(posts,1);
 release(ok());await first;assert.equal(a.S.remaining,0);assert.equal(a.S.phase,'result');
});
for(const late of ['load','error']) test(`B failure remains current when A ${late} arrives late`,()=>{
 const a=harness(),original=a.S.photo,old=choose(a,'old.jpg'),newer=choose(a,'new.jpg');newer.onerror();
 const message=a.element('#photoMsg').textContent,phase=a.S.phase;
 old[late==='load'?'onload':'onerror']();
 assert.equal(a.S.photo,original);assert.equal(a.pending(),null);assert.equal(a.S.phase,phase);
 assert.equal(a.element('#photoMsg').textContent,message);assert.equal(a.element('#photoMsg').dataset.kind,'err');
 assert.equal(a.revoked.filter(u=>u===old.src).length,1);assert.equal(a.revoked.filter(u=>u===newer.src).length,1);
});
