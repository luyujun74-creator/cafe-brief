/* 在所选 Browser 表面执行；不另启浏览器。iframe 使用真实布局视口，导出在 DOM 下载边界捕获。 */
window.cbTest = {
 results:[], errors:[],
 async open(width,height,mode='demo',cache='warm') {
  let f=document.querySelector('#testFrame');if(!f){f=document.createElement('iframe');f.id='testFrame';document.body.replaceChildren(f);}
  f.style.cssText=`width:${width}px;height:${height}px;border:0;transform:scale(${Math.min(1,1240/width,700/height)});transform-origin:top left`;
  const html=await (await fetch('/index.html',{cache:'no-store'})).text();
  const setup=`<base href="${location.origin}/"><script>
   history.replaceState=()=>{};sessionStorage.removeItem('cb_status_v2');window.testCalls=[];window.testDownloads=[];window.testErrors=[];
   addEventListener('error',e=>testErrors.push(e.message));
   const originalFetch=fetch.bind(window);let left=1;
   window.fetch=async(u,o)=>{testCalls.push({url:String(u),method:o?.method||'GET'});
    if(String(u).includes('/api/status')){if('${mode}'==='ready')return new Promise(()=>{});if('${mode}'==='demo')throw Error('offline');return new Response(JSON.stringify({remaining:'${mode}'==='locked'?0:left,unlimited:false}));}
    if(String(u).includes('/api/package')||String(u).includes('/api/generate-image')){left=0;return new Response(JSON.stringify({title:'拿铁',detail:'拿铁',remaining:0,unlimited:false,image_url:'/assets/sample-photo.webp'}));}
    return originalFetch(u,o);};
   document.addEventListener('click',e=>{const a=e.target.closest('a[download]');if(a){e.preventDefault();testDownloads.push(fetch(a.href).then(r=>r.blob()).then(async b=>({name:a.download,type:b.type,bytes:b.size,head:[...new Uint8Array(await b.slice(0,4).arrayBuffer())]})));}},true);
  <\/script>`;
  let body=html.replace('<head>','<head>'+setup);
  if(cache==='cold' || true) body=body.replace(/(src|href)="(app.js|config.js|proto.css|tokens.css)"/g,(_,a,b)=>`${a}="${b}?cold=${Math.random()}"`);
  f.srcdoc=body;
  await new Promise(r=>f.onload=r);const w=f.contentWindow;
  await this.until(()=>w.__cb && w.performance.getEntriesByName('app-interactive').length);
  return w;
 },
 async until(fn){const start=Date.now();while(!fn()){if(Date.now()-start>10000)throw Error('等待超时');await new Promise(r=>setTimeout(r,20));}},
 assert(ok,label){if(!ok)throw Error(label);this.results.push(label);},
 async smoke(width,height){
  const w=await this.open(width,height);const d=w.document;this.assert(!d.documentElement.scrollWidth||d.documentElement.scrollWidth<=width,'无横向溢出 '+width);
  this.assert(!w.testCalls.some(x=>/sample|data.js|woff/.test(x.url)),'首屏无示例/字体 '+width);
  const ids=[...d.querySelectorAll('[id]')].map(x=>x.id);this.assert(new Set(ids).size===ids.length,'ID唯一 '+width);
  if(width>=1280)this.assert(d.querySelector('#go').getBoundingClientRect().bottom<=height,'生成按钮首屏可见 '+width);
  d.querySelector('#trySample').click();await this.until(()=>w.__cb.S.photo);d.querySelector('#go').click();await this.until(()=>w.__cb.S.phase==='result');
  this.assert(w.testCalls.filter(x=>/sample-/.test(x.url)).length<=2,'示例只按需加载 '+width);
  d.querySelector('#resCopy').textContent='商家确认的文案';d.querySelector('#resCopy').dispatchEvent(new w.Event('input'));
  this.assert(!w.__cb.S.cupOk,'编辑重置确认 '+width);
  d.querySelector('#cupOk').click();d.querySelector('#exportOne').click();await this.until(()=>w.testDownloads.length===1);
  const one=await w.testDownloads[0];this.assert(one.bytes>2000 && one.type==='image/jpeg','单张导出 '+width);
  d.querySelector('#exportAll').click();await this.until(()=>w.testDownloads.length===2);const zip=await w.testDownloads[1];
  this.assert(zip.head[0]===80&&zip.head[1]===75&&w.__lastExport.length===5,'ZIP四图和文案 '+width);
  w.__cb.switchView('phone');d.querySelector('#phInputPrice').value='19.9';d.querySelector('#phInputPrice').dispatchEvent(new w.Event('input'));
  this.assert(w.__cb.S.price==='19.9'&&d.querySelector('#iPrice').value==='19.9'&&!w.__cb.S.cupOk,'手机事实同步 '+width);
  w.__cb.switchView('compare');d.querySelector('#fOffer').value='仅周一到店第二杯半价';d.querySelector('#fOffer').dispatchEvent(new w.Event('input'));
  this.assert(w.__cb.S.offer===d.querySelector('#iOffer').value,'四图活动同步 '+width);
  for(const v of ['guide','studio','phone','compare'])w.__cb.switchView(v);
  this.assert(w.testErrors.length===0,'无脚本错误 '+width);
  return {viewport:[width,height],interactive:w.performance.getEntriesByName('app-interactive')[0].startTime,one,zip,errors:w.testErrors};
 }
};
cbTest.races=async function(){
 const w=await this.open(1280,800,'online'),d=w.document;d.querySelector('#trySample').click();await this.until(()=>w.__cb.S.photo);
 const real=w.fetch;let release,posts=0,gets=0,failImage=true;
 w.fetch=async(u,o)=>{if(o?.method==='POST'){posts++;return new Promise(r=>release=r);}if(String(u).includes('/api/rendered-image')){gets++;return failImage?new w.Response('',{status:502}):real('/assets/sample-photo.webp');}return real(u,o);};
 d.querySelector('#go').click();d.querySelector('input[name=scene][value=wood]').checked=true;d.querySelector('input[name=scene][value=wood]').dispatchEvent(new w.Event('change'));
 d.querySelector('#go').click();this.assert(posts===1,'在途换场景仍只有一次POST');release(new w.Response(JSON.stringify({title:'旧稿',detail:'旧稿',remaining:0,unlimited:false,image_url:'/api/rendered-image?id=test'})));
 await this.until(()=>w.__cb.S.lateResults.length===1);this.assert(w.__cb.S.aiTitle!=='旧稿','晚到不覆盖新稿');
 d.querySelector('#lateResult').click();await this.until(()=>w.__cb.S.phase==='error');failImage=false;d.querySelector('#errRetry').click();await this.until(()=>w.__cb.S.phase==='result');
 this.assert(posts===1&&gets===2,'图片恢复只有GET不重复生成');
 d.querySelector('#restart').click();const dt=new w.DataTransfer();dt.items.add(new w.File(['bad'],'bad.txt',{type:'text/plain'}));d.querySelector('#file').files=dt.files;d.querySelector('#file').dispatchEvent(new w.Event('change'));
 this.assert(/不是 JPG/.test(d.querySelector('#photoMsg').textContent),'坏文件明确报错');
 this.assert(w.testErrors.length===0,'竞态流程无脚本错误');return this.results;
};
