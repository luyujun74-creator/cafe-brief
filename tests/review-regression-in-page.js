cbTest.review=async function(){
 const w=await this.open(1280,800),d=w.document;
 w.__cb.switchView('compare');d.querySelector('#compareOne').click();d.querySelector('#compareAll').click();
 this.assert(w.testErrors.length===0,'空态导出无异常');
 const c=d.createElement('canvas');c.width=c.height=900;const x=c.getContext('2d');x.fillStyle='#f24c32';x.fillRect(0,0,900,900);
 const b=await new Promise(r=>c.toBlob(r,'image/png')),dt=new w.DataTransfer();dt.items.add(new w.File([b],'merchant.png',{type:'image/png'}));
 w.__cb.switchView('studio');d.querySelector('#file').files=dt.files;d.querySelector('#file').dispatchEvent(new w.Event('change'));await this.until(()=>w.__cb.S.photo);
 for(const [id,value] of [['iName','商家拿铁'],['iPrice','18']]){d.getElementById(id).value=value;d.getElementById(id).dispatchEvent(new w.Event('input'));}
 d.querySelector('#go').click();await this.until(()=>w.__cb.S.phase==='result');await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
 const stage=d.querySelector('#stageCanvas');
 const px=stage.getContext('2d').getImageData(stage.width/2,stage.height/2,1,1).data;
 this.assert(px[3]===255 && px[0]>200,'真实照片生成后画布有原图像素');
 d.querySelector('#holdCompare').dispatchEvent(new w.PointerEvent('pointerdown'));await new Promise(r=>w.requestAnimationFrame(r));
 const raw=stage.getContext('2d').getImageData(stage.width/2,stage.height/2,1,1).data;
 this.assert(raw[3]===255,'按住原片对照有像素');d.querySelector('#holdCompare').dispatchEvent(new w.PointerEvent('pointerup'));
 const jpeg=await new Promise(r=>stage.toBlob(r,'image/jpeg')),im=await w.createImageBitmap(jpeg);const verify=d.createElement('canvas');verify.width=im.width;verify.height=im.height;verify.getContext('2d').drawImage(im,0,0);
 this.assert(verify.getContext('2d').getImageData(im.width/2,im.height/2,1,1).data[0]>200,'导出JPEG解码非黑图');
 d.querySelector('#iOffer').value='仅周一到店第二杯半价，不可与其他优惠同享。'.repeat(6);d.querySelector('#iOffer').dispatchEvent(new w.Event('input'));
 d.querySelector('#cupOk').click();d.querySelector('#exportAll').click();await new Promise(r=>w.requestAnimationFrame(r));
 this.assert(w.testDownloads.length===0 && /太长/.test(d.querySelector('#exportHint').textContent),'未访问其他规格也阻止长活动裁切导出');
 d.querySelector('[data-sample=wood]').click();await this.until(()=>w.__cb.S.isSample);
 this.assert(d.querySelector('input[name=scene]:checked').value==='wood','示例场景同步radio');
 d.querySelector('#sampleUndo').click();this.assert(!w.__cb.S.isSample && w.__cb.S.scene==='seam' && d.querySelector('#sampleUndo').hidden,'撤销示例恢复照片和场景');
 for(const width of [320,390,1280,1440]){
  const z=await this.open(width,width<500?844:900);for(const view of ['studio','phone','compare','guide']){z.__cb.switchView(view);this.assert(z.document.documentElement.scrollWidth<=width,`${width} ${view}无横向溢出`);}
  const banner=z.document.querySelector('#svcBanner');this.assert(banner.getBoundingClientRect().height>0,`${width}服务状态可见`);
 }
 return this.results;
};

// 真实布局回归：完整画布须落在 crop 内，且保持导出规格的宽高比。
cbTest.proofBounds=async function(){
 const measurements=[];
 for(const [width,height] of [[1280,800],[1440,900],[390,844]]){
  const w=await this.open(width,height),d=w.document;
  d.querySelector('#trySample').click();await this.until(()=>w.__cb.S.photo);
  d.querySelector('#go').click();await this.until(()=>w.__cb.S.phase==='result');
  w.__cb.switchView('compare');
  await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));
  const canvases=[...d.querySelectorAll('#proofs canvas')];
  this.assert(canvases.length===4,`${width}×${height} 四规格齐全`);
  for(const [i,c] of canvases.entries()){
   const crop=c.closest('.crop'),a=c.getBoundingClientRect(),b=crop.getBoundingClientRect(),cs=w.getComputedStyle(crop);
   const left=b.left+parseFloat(cs.borderLeftWidth),right=b.right-parseFloat(cs.borderRightWidth);
   const top=b.top+parseFloat(cs.borderTopWidth),bottom=b.bottom-parseFloat(cs.borderBottomWidth);
   measurements.push({viewport:[width,height],spec:i,canvas:{width:a.width,height:a.height},crop:{width:right-left,height:bottom-top}});
   this.assert(a.width>0&&a.height>0,`${width} 规格${i}画布非零`);
   this.assert(a.left>=left-0.5&&a.right<=right+0.5&&a.top>=top-0.5&&a.bottom<=bottom+0.5,`${width} 规格${i}完整位于crop内容框内`);
   this.assert(Math.abs(a.width/a.height-c.width/c.height)<0.02,`${width} 规格${i}保持原始宽高比`);
  }
  this.assert(w.testErrors.length===0,`${width} 四图页无脚本异常`);
 }
 return {measurements,results:this.results};
};

cbTest.upgradeReview = async function () {
 const w = await this.open(1280, 900, 'online'), d = w.document;
 const $ = id => d.querySelector(id);
 const input = (id, value) => {
  $(id).value = value;
  $(id).dispatchEvent(new w.Event('input', {bubbles:true}));
 };
 $('#trySample').click();
 await this.until(() => w.__cb.S.photo && w.__cb.S.live);
 for (const [price, hint] of [['', /填写售价/], ['0', /大于 0/], ['-1', /大于 0/], ['abc', /数字/]]) {
  input('#iPrice', price);
  this.assert($('#go').getAttribute('aria-disabled') === 'true' && hint.test($('#priceErr').textContent), '输入无效售价立即解释 ' + price);
 }
 input('#iPrice', '28');
 input('#iName', '测试拿铁');
 $('#go').click();
 await this.until(() => w.__cb.S.phase === 'result');
 $('#resCopy').textContent = '手改文案保留';
 $('#resCopy').dispatchEvent(new w.Event('input', {bubbles:true}));
 $('#cupOk').click();
 w.__cb.switchView('compare');
 this.assert($('#compareConfirm').checked && /手改文案保留/.test($('#factsCopy').textContent), '跨页同步确认与手改文案');
 w.history.back();
 await this.until(() => w.__cb.S.view === 'studio');
 w.history.forward();
 await this.until(() => w.__cb.S.view === 'compare');
 this.assert($('#compareConfirm').checked, '前进后退保留草稿和确认');
 w.__cb.switchView('phone');
 input('#phInputName', '新商品拿铁');
 input('#phInputPrice', '30');
 w.__cb.switchView('compare');
 this.assert(!$('#compareConfirm').checked && !$('#cupOk').checked, '手机编辑事实同时撤销两页确认');
 this.assert(/新商品拿铁/.test($('#factsCopy').textContent) && /¥30/.test($('#factsCopy').textContent) && !/手改文案保留/.test($('#factsCopy').textContent) && /过期/.test($('#factsCopyNote').textContent), '对比页显示实际导出事实和过期提示');
 w.__cb.switchView('studio');
 this.assert(/手改文案保留/.test($('#resCopy').textContent), '过期手改文案仍可编辑');
 input('#iName', '测试拿铁');
 $('#cupOk').click();
 $('#exportAll').click();
 await this.until(() => w.testDownloads.length);
 const zip = await w.testDownloads[0];
 this.assert(zip.name === 'CafeBrief_测试拿铁.zip' && w.__lastExport[0].name.startsWith('测试拿铁'), 'ZIP 文件名及条目保留中文');
 this.assert(w.testErrors.length === 0, '升级流程无脚本错误');
 return this.results;
};

cbTest.longTitlesAndProgress = async function () {
 const w = await this.open(390, 844, 'online'), d = w.document;
 const $ = id => d.querySelector(id);
 const input = (id, value) => {
  $(id).value = value;
  $(id).dispatchEvent(new w.Event('input'));
 };
 $('#trySample').click();
 await this.until(() => w.__cb.S.photo && w.__cb.S.live);
 const product = '季节精选冰奶油海盐燕麦拿铁与双份浓缩'.repeat(3).slice(0, 40);
 input('#iName', product);
 let stream;
 const fetchFixture = w.fetch;
 w.fetch = (url, options) => {
  if (!url.includes('/api/package')) return fetchFixture(url, options);
  this.assert(url.includes('progress=1'), '前端主动请求真实进度');
  return Promise.resolve(new w.Response(new w.ReadableStream({ start(controller) { stream = controller; } }),
    {headers:{'content-type':'application/x-ndjson'}}));
 };
 const event = value => stream.enqueue(new w.TextEncoder().encode(JSON.stringify(value) + '\n'));
 $('#go').click();
 await this.until(() => stream);
 this.assert(/等待/.test($('#steps').textContent), '收到服务端事件前不推测进度');
 event({stage:'copy'}); await this.until(() => /生成文案/.test($('#steps').textContent));
 event({heartbeat:true}); event({stage:'scene'}); await this.until(() => /生成商品场景/.test($('#steps').textContent));
 event({stage:'settling'}); await this.until(() => /确认生成记录/.test($('#steps').textContent));
 event({result:{title:product, detail:product, remaining:0, image_url:'/assets/sample-photo.webp'}});
 stream.close();
 await this.until(() => w.__cb.S.phase === 'result');
 this.assert(w.__cb.S.remaining === 0, '流式响应正常加载结果和额度');

 const frame = w.__cb;
 for (const mode of ['raw', 'scene', 'ai']) for (const fit of ['contain', 'cover']) {
  for (const spec of frame.SHEETS.filter(s => s.text)) {
   const canvas = d.createElement('canvas');
   canvas.width = spec.w; canvas.height = spec.h;
   const ctx = canvas.getContext('2d'), fillText = ctx.fillText.bind(ctx), lines = [];
   ctx.fillText = (text, x, y, maxWidth) => {
    if (text && product.includes(text)) {
     const measured = ctx.measureText(text);
     lines.push({ text, left:x, right:x + Math.min(measured.width, maxWidth), top:y - measured.actualBoundingBoxAscent, bottom:y + measured.actualBoundingBoxDescent });
    }
    return fillText(text, x, y, maxWidth);
   };
   const kit = frame.S.kit[spec.id];
   frame.render(canvas, spec.id, { mode, fit, fixedSize:true, scene:kit.scene, sceneImg:kit.sceneImg,
    facts:{ name:product, shop:'测试门店', price:'28', offer:'周末限定' } });
   this.assert(lines.map(x => x.text).join('') === product, `${spec.id} ${mode} ${fit} 长标题完整`);
   const right = spec.id === 'banner' && mode === 'scene' && fit === 'contain' ? spec.w * .56 : spec.w;
   this.assert(lines.every(x => x.left >= 0 && x.right <= right && x.top > 0 && x.bottom < spec.h), `${spec.id} ${mode} ${fit} 长标题留在安全区域`);
  }
 }
 input('#iName', '测试/拿铁:?');
 $('#cupOk').click(); $('#exportAll').click();
 await this.until(() => w.testDownloads.length);
 const zip = await w.testDownloads[0];
 this.assert(zip.name === 'CafeBrief_测试_拿铁__.zip' && w.__lastExport.every(f => !/[:/?]/.test(f.name)), 'ZIP 内外文件名去除路径分隔符及保留中文');
 this.assert(w.testErrors.length === 0, '长标题和流式进度无脚本错误');
 return this.results;
};
