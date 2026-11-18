// Executes real app event handlers in a VM; canvas/layout are outside this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
function app() {
  const els = new Map();
  const el = s => {
    if (!els.has(s)) els.set(s, {id:typeof s==='string'?s.slice(1):'', value:'', textContent:'', dataset:{}, attributes:{}, style:{setProperty(){}}, children:[],
      querySelectorAll(){return [];}, addEventListener(n,f){this[n]=f;}, setAttribute(k,v){this.attributes[k]=v;}, removeAttribute(k){delete this.attributes[k];}, append(){}, showModal(){this.open=true;}});
    return els.get(s);
  };
  const lists = new Map([['#vers button',[el('#version0'),el('#version1')]], ['input[name=fid]',[el('#fidScene'),el('#fidRaw')]]]);
  el('#version0').dataset.i='0';el('#version1').dataset.i='1';
  el('#fidScene').value='scene';el('#fidRaw').value='raw';
  const storage=new Map();
  let fetcher;
  const c = {sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{documentElement:{dataset:{}},querySelector:el,querySelectorAll:s=>lists.get(s)||[],createElement:()=>el(Symbol()),createTextNode:s=>s},
    window:{scrollTo(){}},Image:class{async decode(){}},URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},
    Uint32Array,TextEncoder,Blob,DataView,ArrayBuffer,URLSearchParams,console,
    setTimeout:(f,ms)=>{if(ms<10000)queueMicrotask(f);return 0;},clearTimeout(){},cancelAnimationFrame(){},requestAnimationFrame:()=>0,
    CB_ASSETS:{photo:'data:image/jpeg;base64,fixture'}, fetch:(...a)=>fetcher(...a)};
  vm.createContext(c);
  vm.runInContext(source.replace('  boot();', '  drawStrip = () => {}; window.review = {S, generate, selectSheet, exportCopy, currentFacts, setRoast, retryProbe, restoreStatus, acceptQuota, renderAllCopy, finishSheet, mountCompareAndPhone, validate, updateGo}; mountStudio();'), c);
  const a=c.window.review;
  Object.assign(a.S,{live:true,isSample:true,remaining:1,name:'拿铁',price:'18',photo:{},phase:'result',sheet:'main'});
  for (const id of ['main','square','banner','poster']) a.S.kit[id]={status:'done',mode:'scene',seed:2,scene:'wood',versions:[{mode:'scene'}],cur:0};
  return {...a,el,storage,fetch:f=>fetcher=f};
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
 const snapshot=a.S.kit.main.versions.at(-1);assert.equal(snapshot.facts.price,'18');assert.ok(snapshot.createdAt>0);
 a.S.price='29';assert.equal(snapshot.facts.price,'18');
 for(let i=0;i<6;i++)a.finishSheet(a.S.kit.main);
 assert.equal(a.S.kit.main.versions.length,5);assert.equal(a.S.kit.main.cur,4);
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
  else if(action==='new request') {a.S.remaining=2;a.fetch(async()=>result('new',2)); const newer=a.el('#again').click(); await newer;}
  else a.el('#'+action).click();
  const phase=a.S.phase,versions=a.S.kit.main.versions.length,remaining=a.S.remaining;
  release(image());await old;
  assert.equal(a.S.phase,phase);assert.equal(a.S.kit.main.versions.length,versions);assert.equal(a.S.remaining,remaining);
});
test('late generation response updates quota and archives result after leaving wait',async()=>{
  const a=app();let release;
  a.fetch(()=>new Promise(r=>release=r));const old=a.el('#again').click();
  a.el('#cancel').click();a.S.remaining=2;release(result('old',0));await old;
  assert.equal(a.S.remaining,0);assert.equal(a.S.lateResults.length,1);assert.equal(a.S.phase,'ready');assert.equal(a.S.kit.main.versions.length,1);
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
  a.S.offer='第二杯半价';a.renderAllCopy();assert.match(a.el('#resCopy').textContent,/售价：CNY ¥18/);assert.match(a.el('#resCopy').textContent,/第二杯半价/);
  a.mountCompareAndPhone();a.el('#compareConfirm').checked=true;
  a.el('#fPrice').input({target:{value:'21'}});
  assert.equal(a.el('#compareConfirm').checked,false);assert.match(a.el('#resCopy').textContent,/CNY ¥21/);
  assert.equal(a.el('#iPrice').value,'21');
  a.el('#fOffer').input({target:{value:'仅周一'}});assert.match(a.exportCopy(a.currentFacts()),/仅周一/);
  assert.match(a.el('#resCopy').textContent,/仅周一/);
  a.S.aiDetail='售价21元';a.S.copyStale=false;a.el('#compareConfirm').checked=true;
  a.el('#fPrice').input({target:{value:'23'}});
  assert.equal(a.el('#compareConfirm').checked,false);assert.match(a.el('#factsCopy').textContent,/CNY ¥23/);assert.ok(!a.el('#factsCopy').textContent.includes('售价21元'));
  for(const [id,value] of [['#iName','新商品'],['#iPrice','20']]) {
    Object.assign(a.S,{phase:'ready',name:'拿铁',price:'18',aiTitle:'拿铁18',aiDetail:'售价18元',copyStale:false});
    a.el(id).input({target:{value}});
    assert.equal(a.S.copyStale,true);
    const out=a.exportCopy(a.currentFacts());
    assert.ok(!out.includes('商品标题：'));assert.ok(!out.includes('商品描述：'));assert.ok(out.includes(value));
  }
});

test('older status cannot overwrite generation quota',async()=>{
 const a=app();let release;a.fetch(()=>new Promise(r=>release=r));
 const probe=a.retryProbe();a.acceptQuota({remaining:0,unlimited:false});
 release(new Response(JSON.stringify({remaining:3,unlimited:false})));await probe;
 assert.equal(a.S.remaining,0);assert.equal(a.S.engine,'locked');
});
test('probe sequence discards late older status',async()=>{
 const a=app();let release,n=0;a.fetch(()=>++n===1?new Promise(r=>release=r):Promise.resolve(new Response(JSON.stringify({remaining:1,unlimited:false}))));
 const old=a.retryProbe();await a.retryProbe();release(new Response(JSON.stringify({remaining:3,unlimited:false})));await old;
 assert.equal(a.S.remaining,1);assert.equal(a.S.engine,'online');
});
test('SWR restores fresh and stale cache, rejects expired cache',()=>{
 const a=app();for(const [age,fresh] of [[1000,true],[30000,true],[60000,false],[300000,false],[301000,false]]){
 a.S.remaining=null;a.storage.set('cb_status_v2',JSON.stringify({at:Date.now()-age,st:{remaining:2,unlimited:false}}));
 assert.equal(a.restoreStatus(),fresh);assert.equal(a.S.remaining,age>300000?null:2);
 if(age<=300000) assert.equal(a.S.engine,fresh?'online':'ready');
 if(age===60000) assert.match(a.el('#svcSub').textContent,/上次成功/);
 }
});

for (const edited of [false,true]) for (const action of ['sheet','version','raw','roast']) test(`view ${action} preserves ${edited?'merchant':'AI'} copy and draft revision`,()=>{
  const a=app();
  Object.assign(a.S,{aiTitle:'实测AI标题',aiDetail:'实测AI详情 拿铁',editedCopy:edited?'商家保留文案':null,copyStale:false,cupOk:true});
  a.S.kit.main.versions.push({mode:'scene'});
  a.selectSheet('main'); // mounts actual version handlers
  a.S.cupOk=true;a.el('#cupOk').checked=true;a.el('#compareConfirm').checked=true;
  const revision=a.S.draftRevision;
  if(action==='sheet') a.selectSheet('square');
  if(action==='version') a.el('#version1').click();
  if(action==='raw') a.el('#fidRaw').change();
  if(action==='roast') a.setRoast(3);
  assert.equal(a.S.copyStale,false);
  assert.equal(a.S.draftRevision,revision);
  assert.equal(a.S.cupOk,false);assert.equal(a.el('#compareConfirm').checked,false);
  const out=a.exportCopy(a.currentFacts());
  if(edited) assert.match(out,/商家保留文案/);
  else {assert.match(out,/实测AI标题/);assert.match(out,/实测AI详情 拿铁/);}
});
test('invalid price and oversized name prevent generating while boundary values pass',()=>{
 const a=app();
 for(const price of ['0','0.00']) {a.S.price=price;assert.match(a.validate(),/大于 0/);a.updateGo();assert.equal(a.el('#go').attributes['aria-disabled'],'true');}
 a.S.price='0.01';a.S.name='茶'.repeat(41);assert.match(a.validate(),/40/);a.updateGo();assert.equal(a.el('#go').attributes['aria-disabled'],'true');
 a.S.name='茶'.repeat(40);assert.equal(a.validate(),'');a.updateGo();assert.equal(a.el('#go').attributes['aria-disabled'],'false');
});
