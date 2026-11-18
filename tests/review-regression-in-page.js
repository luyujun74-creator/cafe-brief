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
