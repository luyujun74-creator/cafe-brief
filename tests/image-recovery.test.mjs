// Executes real app event handlers in a VM; canvas/layout are outside this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
function app() {
  const els = new Map();
  const el = s => {
    if (!els.has(s)) els.set(s, {value:'', textContent:'', dataset:{}, style:{setProperty(){}}, children:[],
      addEventListener(n,f){this[n]=f;}, setAttribute(){}, removeAttribute(){}, append(){}, showModal(){this.open=true;}});
    return els.get(s);
  };
  let fetcher;
  const c = {document:{documentElement:{},querySelector:el,querySelectorAll:()=>[],createElement:()=>el(Symbol()),createTextNode:s=>s},
    window:{scrollTo(){}},Image:class{async decode(){}},URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},
    Uint32Array,TextEncoder,Blob,DataView,ArrayBuffer,URLSearchParams,console,
    setTimeout:f=>{queueMicrotask(f);return 0;},clearTimeout(){},cancelAnimationFrame(){},requestAnimationFrame:()=>0,
    CB_ASSETS:{photo:'data:image/jpeg;base64,fixture'}, fetch:(...a)=>fetcher(...a)};
  vm.createContext(c);
  vm.runInContext(source.replace('  boot();', '  drawStrip = () => {}; window.review = {S, generate, selectSheet, exportCopy, currentFacts}; mountStudio();'), c);
  const a=c.window.review;
  Object.assign(a.S,{live:true,isSample:true,remaining:1,name:'拿铁',price:'18',photo:{},phase:'result',sheet:'main'});
  for (const id of ['main','square','banner','poster']) a.S.kit[id]={status:'done',mode:'scene',seed:2,scene:'wood',versions:[{mode:'scene'}],cur:0};
  return {...a,el,fetch:f=>fetcher=f};
}
const result = (id='original',remaining=0) => new Response(JSON.stringify({image_url:'/api/rendered-image?id='+id,remaining,unlimited:false,title:'拿铁',detail:'售价18元',selling_points:[]}));
const image = () => new Response('image-fixture');
async function failed(a,kind='again') {
  const calls=[];
  a.fetch(async url=>{calls.push(url);return url.includes('rendered-image')?new Response('',{status:502}):result();});
  await (kind==='again'?a.el('#again').click():a.generate());
  return calls;
}
test('image-only success updates quota even when subsequent image GET fails; recovery never generates again',async()=>{
  const a=app();const calls=await failed(a);
  assert.equal(a.S.remaining,0);
  assert.match(a.el('#quotaChip').textContent,/0 次/);
  assert.match(a.el('#errTitle').textContent,/已生成/);
  assert.match(a.el('#errRetry span').textContent,/重新加载/);
  a.fetch(async url=>{calls.push(url);return image();});
  await a.el('#errRetry').click();
  assert.equal(a.S.phase,'result');assert.equal(a.S.kit.main.versions.length,2);
  assert.equal(calls.filter(u=>u.includes('generate-image')).length,1);
  assert.deepEqual(calls.filter(u=>u.includes('rendered-image')),Array(2).fill('/api/rendered-image?id=original'));
  assert.equal(a.S.remaining,0);
});
test('package image failure retains package/copy and retries only the returned image URL',async()=>{
  const a=app();const calls=await failed(a,'package');
  assert.match(a.el('#errTitle').textContent,/已生成/);
  a.fetch(async url=>{calls.push(url);return image();});
  await a.el('#errRetry').click();
  assert.equal(a.S.phase,'result');assert.equal(a.S.aiDetail,'售价18元');
  assert.equal(calls.filter(u=>u.includes('/api/package')).length,1);
  assert.equal(a.S.remaining,0);
});
for(const action of ['cancel','restart','errBack','product','sheet','new request']) test(`late recovery cannot overwrite state after ${action}`,async()=>{
  const a=app();await failed(a);
  let release,entered;
  const started=new Promise(r=>entered=r);
  a.fetch(async()=>{entered();return new Promise(r=>release=r);});
  const old=a.el('#errRetry').click();await started;
  if(action==='product') a.el('#iName').input({target:{value:'新商品'}});
  else if(action==='sheet') a.selectSheet('square');
  else if(action==='new request') {a.fetch(async()=>result('new',2)); const newer=a.el('#again').click(); await newer;}
  else a.el('#'+action).click();
  const phase=a.S.phase,versions=a.S.kit.main.versions.length,remaining=a.S.remaining;
  release(image());await old;
  assert.equal(a.S.phase,phase);assert.equal(a.S.kit.main.versions.length,versions);assert.equal(a.S.remaining,remaining);
});
test('late generation response cannot replace quota or result after cancellation',async()=>{
  const a=app();let release;
  a.fetch(()=>new Promise(r=>release=r));const old=a.el('#again').click();
  a.el('#cancel').click();a.S.remaining=2;release(result('old',0));await old;
  assert.equal(a.S.remaining,2);assert.equal(a.S.phase,'ready');assert.equal(a.S.kit.main.versions.length,1);
});
test('repeated load failures and double retry retain identity without extra generation or duplicate versions',async()=>{
  const a=app();const calls=await failed(a);
  a.fetch(async url=>{calls.push(url);return new Response('',{status:502});});
  await a.el('#errRetry').click();
  assert.match(a.el('#errTitle').textContent,/已生成/);assert.equal(a.S.remaining,0);
  let release,entered;const started=new Promise(r=>entered=r);
  a.fetch(async url=>{calls.push(url);entered();return new Promise(r=>release=r);});
  const retry=a.el('#errRetry').click();await started;await a.el('#errRetry').click();
  release(image());await retry;
  assert.equal(a.S.kit.main.versions.length,2);assert.equal(calls.length,4);
  assert.deepEqual(calls.slice(1),Array(3).fill('/api/rendered-image?id=original'));
});
test('late package recovery cannot replace a newer package/copy',async()=>{
  const a=app();await failed(a,'package');
  let release,entered;const started=new Promise(r=>entered=r);
  a.fetch(async()=>{entered();return new Promise(r=>release=r);});
  const old=a.el('#errRetry').click();await started;
  a.S.remaining=1;
  a.fetch(async url=>url.includes('/api/package')?new Response(JSON.stringify({image_url:'/api/rendered-image?id=new',remaining:0,unlimited:false,title:'新标题',detail:'新文案'})):image());
  await a.generate();
  const current=a.S.kit.main.sceneImg;
  release(image());await old;
  assert.equal(a.S.aiDetail,'新文案');assert.equal(a.S.kit.main.sceneImg,current);assert.equal(a.S.kit.main.versions.length,1);
});
test('fact-edit regression: input handlers omit stale generated facts from export',()=>{
  // Reuse the independent review's prior front-end contract with actual input handlers.
  const a=app();
  for(const [id,value] of [['#iName','新商品'],['#iPrice','20']]) {
    Object.assign(a.S,{phase:'ready',name:'拿铁',price:'18',aiTitle:'拿铁18',aiDetail:'售价18元',copyStale:false});
    a.el(id).input({target:{value}});
    assert.equal(a.S.copyStale,true);
    const out=a.exportCopy(a.currentFacts());
    assert.ok(!out.includes('商品标题：'));assert.ok(!out.includes('商品描述：'));assert.ok(out.includes(value));
  }
});
