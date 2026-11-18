// 在所选 Browser 中，先加载 browser-in-page.js 与 review-regression-in-page.js。
cbTest.visual=async function(){
 const measurements=[];
 for(const [width,height] of [[1440,900],[1280,720],[1280,800],[390,844],[320,568]]){
  const w=await this.open(width,height),d=w.document;
  const more=d.querySelector('#moreBriefDetails');
  this.assert(!!more&&!more.open,`${width}选填默认折叠`);
  const go=d.querySelector('#go').getBoundingClientRect();
  this.assert(width<900||go.bottom<=height,`${width}×${height}生成位置符合桌面首屏/移动滚动规则`);
  const trigger=d.querySelector('#svcToggle'),panel=d.querySelector('#svcDetails');
  this.assert(d.querySelector('#svcBanner').getBoundingClientRect().height>0,`${width}服务短文本可见`);
  trigger.click();this.assert(!panel.hidden&&trigger.getAttribute('aria-expanded')==='true',`${width}状态可展开`);
  panel.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  this.assert(panel.hidden&&d.activeElement===trigger,`${width}Escape关闭并回焦`);
  trigger.click();d.querySelector('#viewTitle').click();this.assert(panel.hidden,`${width}外点关闭`);
  trigger.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  this.assert(!panel.hidden,`${width}键盘展开`);trigger.click();
  more.open=true;d.querySelector('#iShop').value='商家原值';d.querySelector('#iShop').dispatchEvent(new w.Event('input',{bubbles:true}));
  this.assert(d.querySelector('#moreBriefCount').textContent.includes('1'),`${width}已填计数`);
  more.open=false;this.assert(d.querySelector('#iShop').value==='商家原值',`${width}折叠保留值`);
  d.querySelector('#iShop').dispatchEvent(new w.FocusEvent('focusin',{bubbles:true}));this.assert(more.open,`${width}聚焦自动展开`);
  more.open=false;d.querySelector('#iShop').dispatchEvent(new w.Event('invalid'));this.assert(more.open,`${width}校验错误自动展开`);
  more.open=false;d.querySelector('#trySample').click();await this.until(()=>w.__cb.S.photo);
  this.assert(d.querySelector('#moreBriefCount').textContent.includes('1'),`${width}示例同步计数`);
  for(const view of ['studio','phone','compare','guide']){w.__cb.switchView(view);this.assert(d.documentElement.scrollWidth<=width,`${width} ${view}无横向溢出`);}
  measurements.push({width,height,goBottom:go.bottom,bannerHeight:d.querySelector('#svcBanner').getBoundingClientRect().height});
  this.assert(w.testErrors.length===0,`${width}视觉交互无脚本异常`);
 }
 return measurements;
};

cbTest.visualStates=async function(){
 const states=[];
 for(const mode of ['ready','online','demo','locked']){
  const w=await this.open(1280,720,mode),d=w.document;
  await this.until(()=>d.querySelector('#svcCard').dataset.state===mode);
  const banner=d.querySelector('#svcBanner'),height=banner.getBoundingClientRect().height;
  this.assert(height>0,`${mode}状态短文本可见`);
  d.querySelector('#svcToggle').click();
  this.assert(!d.querySelector('#svcDetails').hidden&&d.querySelector('#svcSub').getBoundingClientRect().height>0,`${mode}详情可见`);
  states.push({state:mode,text:banner.textContent,height,color:w.getComputedStyle(d.querySelector('.svc-dot')).backgroundColor});
 }
 return states;
};

// 视觉红队收口：审核顺序、按钮尺寸、移动示例名称、对比度与桌面随屏。
cbTest.visualClosure=async function(){
 const rows=[];
 const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 for(const [width,height] of [[1440,900],[1280,720],[1280,800],[390,844],[320,568]]){
  const w=await this.open(width,height),d=w.document,cs=(e,pseudo)=>w.getComputedStyle(e,pseudo),rect=e=>e.getBoundingClientRect();
  w.__cb.switchView('compare');
  const note=d.querySelector('#factsCopyNote'),exp=d.querySelector('.compare-export');
  this.assert(!!exp&&!!(note.compareDocumentPosition(exp)&w.Node.DOCUMENT_POSITION_FOLLOWING),`${width}先审核后确认导出`);
  const all=d.querySelector('#compareAll'),one=d.querySelector('#compareOne');
  this.assert(exp.contains(all)&&exp.contains(one)&&exp.contains(d.querySelector('#compareConfirm')),`${width}确认和下载同组`);
  this.assert(rect(all).width<rect(exp).width-20&&rect(one).width<rect(exp).width-20,`${width}按钮不拉满审核区`);
  const buttonWidths=[rect(one).width,rect(all).width];
  w.__cb.switchView('studio');
  const pills=[...d.querySelectorAll('.sample-presets button')];
  this.assert(pills.every(b=>!cs(b,'::before').content.includes('·'))&&pills.map(b=>b.textContent.trim()).join('/')==='影棚/木台/窗边',`${width}示例名称无孤立圆点`);
  const fg=cs(d.querySelector('.dial-ends')).color.match(/[\d.]+/g).slice(0,3).map(Number);
  // 取摄影台最暗基底为保守下界；白色玻璃与暖光只会提高背景亮度。
  const minSurface=[226,216,201],ratio=(lum(minSurface)+.05)/(lum(fg)+.05);
  this.assert(ratio>=4.5,`${width}辅助灰字保守对比度 >=4.5 (${ratio.toFixed(2)})`);
  const stage=d.querySelector('.stage-card');
  this.assert(width<900||cs(stage).position==='sticky',`${width}桌面摄影台sticky`);
  const frame=cs(d.querySelector('.stage-frame'));
  this.assert(Number(frame.backgroundColor.match(/[\d.]+/g)[3])<=.48,`${width}空态玻璃通透`);
  this.assert(cs(d.querySelector('.stage-viewport')).backgroundImage.includes('linear-gradient'),`${width}摄影台具有天光和台面层次`);
  rows.push({width,height,contrast:ratio,buttonWidths,sticky:cs(stage).position});
 }
 return rows;
};

// 场景必须在空态、用户原片与示例预览中立即反馈，且不提前载入示例。
cbTest.sceneFeedback=async function(){
 const rows=[];
 for(const [width,height] of [[1440,900],[1280,720],[1280,800],[390,844],[320,568]]){
  const w=await this.open(width,height),d=w.document;
  const select=async id=>{d.querySelector(`input[name=scene][value=${id}]`).click();await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));};
  const names={seam:'纯色影棚',wood:'木吧台',stone:'石材台面',window:'窗边光'},backgrounds=[];
  for(const [id,name] of Object.entries(names)){
   await select(id);
   this.assert(d.documentElement.dataset.scene===id,`${width}空态同步${id}`);
   const bg=w.getComputedStyle(d.querySelector('.stage-viewport')).backgroundImage;backgrounds.push(bg);
   this.assert(bg.includes('scene-'+id+'.webp'),`${width} ${id}使用实拍背景`);
   const photo=new w.Image();photo.src='/assets/scene-'+id+'.webp';await photo.decode();
   this.assert(photo.naturalWidth>0,`${width} ${id}实拍图解码成功无404`);
   const thumb=w.getComputedStyle(d.querySelector('.scene-'+id+' i'));
   this.assert(thumb.display!=='none'&&thumb.backgroundImage.includes('scene-'+id+'.webp'),`${width} ${id}实拍缩略图可见`);
   this.assert(bg.includes('linear-gradient'),`${width} ${id}摄影台渐变`);
   this.assert(d.querySelector('#stageNote').textContent.includes(name)&&d.querySelector('#stageScene').textContent.includes(name),`${width}空态场景名称反馈${id}`);
   const overlay=w.getComputedStyle(d.querySelector('#dropOverlay'));
   const glass=w.getComputedStyle(d.querySelector('.stage-frame'));
   const alphas=[...overlay.backgroundImage.matchAll(/rgba\([^)]*,\s*([.\d]+)\)/g)].map(m=>+m[1]);
   const glassAlpha=+glass.backgroundColor.match(/[\d.]+/g)[3];
   const minWhite=glassAlpha+(1-glassAlpha)*Math.min(...alphas);
   const lum=rgb=>rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
   const fg=w.getComputedStyle(d.querySelector('.drop span')).color.match(/[\d.]+/g).slice(0,3).map(Number);
   const ratio=(lum([255*minWhite,255*minWhite,255*minWhite])+.05)/(lum(fg)+.05);
   this.assert(ratio>=4.5,`${width} ${id}上传文字即使底图全黑仍达4.5:1 (${ratio.toFixed(2)})`);
   this.assert(!d.querySelector('#dropOverlay').hidden,`${width}空态上传入口保留${id}`);
  }
  this.assert(new Set(backgrounds).size===4,`${width}四种光影各异`);
  this.assert(!w.performance.getEntriesByType('resource').some(e=>/sample-|woff|data\.js/.test(e.name)),`${width}空态切换零样本请求`);
  d.querySelector('#trySample').click();await this.until(()=>w.__cb.S.photo);
  const go=d.querySelector('#go').getBoundingClientRect();
  this.assert(width<900||go.bottom<=Math.min(height,720),`${width}实拍缩略图后生成按钮首屏可见`);
  const pixels=[];
  for(const [id,name] of Object.entries(names)){
   await select(id);const c=d.querySelector('#stageCanvas');pixels.push(c.toDataURL());
   this.assert(d.documentElement.dataset.scene===id&&d.querySelector('#stageNote').textContent.includes(name),`${width}示例反馈${id}`);
  }
  const exportCanvas=d.createElement('canvas');exportCanvas.width=240;exportCanvas.height=80;
  const exports=[];
  for(const id of Object.keys(names)) for(let roast=1;roast<=5;roast++){
   w.__cb.setRoast(roast);w.__cb.render(exportCanvas,'banner',{mode:'ai',scene:id,seed:2});
   const blob=await new Promise(r=>exportCanvas.toBlob(r,'image/jpeg'));
   this.assert(blob?.size>1000,`${width} ${id} ${roast}实拍示例可同源导出`);
   exports.push(exportCanvas.toDataURL());
  }
  this.assert(new Set(exports).size===20,`${width}四场景五档烘焙度各不相同`);
  this.assert(new Set(pixels).size===4,`${width}示例合成四场景像素不同`);
  // CSS atmosphere alone must never tint or alter the shared export renderer.
  const fixed=d.createElement('canvas');fixed.width=160;fixed.height=120;
  const draw=()=>{w.__cb.render(fixed,'main',{mode:'ai',scene:'wood',seed:2});return fixed.toDataURL();};
  const baseline=draw();
  for(const id of Object.keys(names)){d.documentElement.dataset.scene=id;this.assert(draw()===baseline,`${width} CSS ${id}不改变固定规格导出像素`);}
  // 主图完整原片像素不随色调改变；海报/Banner 原有文字与底色排版仍按色板工作。
  // 明确选主图，避免继承此前的海报规格并把文字色板变化误判为原片重绘。
  d.querySelector('[data-spec=main]').click();
  // 使用真正文件输入和图片解码路径模拟用户原片。
  const blob=await (await w.fetch('/assets/sample-photo.webp')).blob(),dt=new w.DataTransfer();dt.items.add(new w.File([blob],'upload.webp',{type:'image/webp'}));
  d.querySelector('#file').files=dt.files;d.querySelector('#file').dispatchEvent(new w.Event('change'));
  await this.until(()=>w.__cb.S.photo&&!w.__cb.S.isSample&&w.__cb.S.phase==='ready');
  const rawPixels=[];
  for(const [id,name] of Object.entries(names)){
   await select(id);for(let roast=1;roast<=5;roast++){
    w.__cb.setRoast(roast);await new Promise(r=>w.requestAnimationFrame(()=>w.requestAnimationFrame(r)));rawPixels.push(d.querySelector('#stageCanvas').toDataURL());
   }
   this.assert(d.documentElement.dataset.scene===id&&d.querySelector('#stageNote').textContent.includes(name)&&d.querySelector('#stageNote').textContent.includes('原片排版'),`${width}原片反馈${id}`);
  }
  this.assert(new Set(rawPixels).size===1,`${width}场景氛围不修改原片画布像素`);
  this.assert(d.documentElement.scrollWidth<=width&&w.testErrors.length===0,`${width}场景切换无溢出或异常`);
  rows.push({width,height,scenes:4,rawPixelsUnchanged:true});
 }
 return rows;
};
