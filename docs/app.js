const $=id=>document.getElementById(id),form=$('brief'),asset=new Studio.Asset();
let result=null,revision=0,checked=false,busy=false,auditId=null,layoutOK=false;
const c=$('poster'),ctx=c.getContext('2d');
function gate(){const ok=result&&checked&&$('confirm').checked&&!busy&&!asset.loading&&layoutOK;$('download').disabled=!ok;$('png').disabled=!ok;$('confirm').disabled=!checked||asset.loading||busy||!layoutOK;}
function invalidate(){checked=false;auditId=null;$('confirm').checked=false;gate();}
function changed(){revision++;invalidate();}
function same(v){return revision===v;}
function current(){return {...result,headline:$('headline').value,caption:$('caption').value,shots:[...$('shots').querySelectorAll('textarea')].map(x=>x.value),revision,asset_revision:asset.version,audit_id:auditId,confirmed:$('confirm').checked};}
function draw(){
 ctx.fillStyle='#24594c';ctx.fillRect(0,0,1080,1350);ctx.fillStyle='#dce8da';ctx.fillRect(65,230,950,480);
 if(asset.bitmap){const p=asset.bitmap,s=Math.min(950/p.width,480/p.height);ctx.drawImage(p,65+(950-p.width*s)/2,230+(480-p.height*s)/2,p.width*s,p.height*s);}
 else{ctx.fillStyle='#49372d';ctx.beginPath();ctx.ellipse(540,455,140,160,0,0,Math.PI*2);ctx.fill();ctx.font='25px sans-serif';ctx.fillText('Illustration / not a product photo',300,680);}
 const f=result?.facts;const sections=[
  ['店名',f?.shop||'Your café, your story.',65,35,950,175,64,24],
  ['标题',$('headline').value||'A little pause, a lovely cup.',65,735,950,180,58,24],
  ['商品',f?.product||'Instagram creative study',65,925,950,115,38,22],
  ['价格',f?`${f.currency} ${f.price}`:'',65,1050,950,55,36,24],
  ['活动条件',f?.offer||'',65,1110,950,175,30,22]
 ];let errors=[];ctx.fillStyle='#fbfaf6';
 for(const [name,text,x,y,w,h,max,min] of sections){const plan=Studio.fit(ctx,text,w,h,max,min);if(!plan){errors.push(name+'无法完整呈现，请缩短后再导出');continue;}ctx.font=`${plan.size}px Georgia`;plan.lines.forEach((line,i)=>ctx.fillText(line,x,y+plan.size+i*plan.size*1.25));}
 ctx.font='18px sans-serif';ctx.fillText(result&&result.mode!=='demo'?'AI text / photo layout / human review required':'Template demo / photo layout / human review required',65,1325);
 layoutOK=errors.length===0;$('layout').textContent=errors.length?errors.join('；'):'海报全部文字已通过测量排版；请继续核对事实与条件。';gate();
}
const SECRET_FIELDS=['apiUrl','apiModel','apiKey','chatReply'];
function formData(){return Object.fromEntries(new FormData(form));}
function refreshPrompt(){try{$('chatPrompt').value=CafeEngine.chatPrompt(formData());}catch(e){$('chatPrompt').value='请先补全左侧信息：'+e.message;}}
function updateMode(mode){$('liveConfig').hidden=mode!=='live';$('freeNote').hidden=mode!=='free';$('chatConfig').hidden=mode!=='chat';$('generate').textContent=mode==='chat'?'检查并导入回复':'生成创意草稿';if(mode==='chat')refreshPrompt();}
async function copy(text,field){try{await navigator.clipboard.writeText(text);return true;}catch{field.select();return false;}}
function modelConfig(){return {endpoint:$('apiUrl').value.trim(),model:$('apiModel').value.trim(),key:$('apiKey').value.trim(),chatReply:$('chatReply').value};}
function api(path,data){return CafeEngine.handle(path,data,path==='generate'?modelConfig():undefined);}
async function check(){if(!result||asset.loading)return false;const v=revision,r=current();invalidate();const a=await api('audit',r);if(!same(v)||!result)return false;result.flags=a.flags;auditId=a.audit_id;$('flags').replaceChildren();for(const s of a.flags.length?a.flags:['规则未发现异常；仍需人工复核。']){const li=document.createElement('li');li.textContent=s;$('flags').append(li);}checked=true;gate();return true;}
form.addEventListener('input',e=>{if(e.target.id==='photo'||SECRET_FIELDS.includes(e.target.id))return;if(e.target.name==='mode')updateMode(e.target.value);else if(form.elements?.mode?.value==='chat')refreshPrompt();changed();result=null;$('headline').value='';$('results').hidden=true;$('badge').textContent='事实已修改 · 请重新生成';draw();});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy||asset.loading)return;changed();const v=revision;busy=true;gate();$('generate').disabled=true;$('status').textContent='正在处理；调用模型时最多三次，可能需要约一分钟…';
 try{const r=await api('generate',formData());if(!same(v))return;
 if(!r.facts){$('status').textContent=(r.questions||['需要人工处理']).join('；');return;}
 result=r;$('reviseChat').hidden=r.mode!=='chat';$('badge').textContent=r.label;$('headline').value=r.headline;$('caption').value=r.caption;$('shots').replaceChildren();r.shots.forEach((s,i)=>{const label=document.createElement('label');label.textContent=`${i*5}–${(i+1)*5} 秒`;const area=document.createElement('textarea');area.value=s;area.maxLength=1000;label.append(area);$('shots').append(label);});$('results').hidden=false;$('trace').textContent=JSON.stringify({status:r.status,call_count:r.call_count,elapsed_ms:r.elapsed_ms,trace:r.trace},null,2);draw();
 const ok=await check();if(same(v)&&ok)$('status').textContent=r.status==='human_review'?'自动检查仍有问题，请人工修改或明确接受提示。':'草稿已生成，请人工核对后确认。';
 }catch(e){if(same(v)){$('status').textContent=e.message;$('trace').textContent=JSON.stringify({trace:e.trace||[],call_count:e.call_count||0},null,2);}}finally{busy=false;$('generate').disabled=false;gate();}
});
$('results').addEventListener('input',e=>{if(e.target.id==='confirm'){gate();return;}changed();draw();});
$('check').onclick=async()=>{const v=revision;try{await check();}catch(e){if(same(v))$('status').textContent=e.message;}};
$('photo').onchange=async()=>{
 changed();let f=$('photo').files[0];const v=revision;
 if(f&&(!['image/png','image/jpeg','image/webp'].includes(f.type)||f.size>8*1024*1024)){f=null;$('photo').value='';$('status').textContent='请选择8MB以内PNG、JPEG或WebP';}
 const pending=asset.load(f,createImageBitmap);draw();gate();
 try{const applied=await pending;if(!applied)return;invalidate();draw();if(same(v))$('status').textContent=f?'图片已更换；重新检查并确认使用权。':'已清空图片，显示示意插画；请重新检查。';}
 catch{if(same(v)){$('status').textContent='图片无法解码或尺寸过大，请换图；旧图已释放。';draw();}}finally{gate();}
};
function save(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
async function download(png){
 if($('download').disabled)return;const v=revision,snapshot=current();busy=true;gate();
 try{const out=await api('export',snapshot);if(!same(v))return;
 if(png){const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));if(!same(v)||!blob)return;save(blob,'cafe-poster.png');}
 else{save(new Blob([JSON.stringify(out.result,null,2)],{type:'application/json'}),'cafe-brief.json');await new Promise(r=>setTimeout(r,400));save(new Blob([out.markdown],{type:'text/markdown'}),'cafe-brief.md');}
 if(same(v))$('status').textContent='已请求下载当前已审核版本。';
 }catch(e){if(same(v))$('status').textContent=e.message;}finally{busy=false;gate();}
}
$('copyPrompt').onclick=async()=>{refreshPrompt();$('copyPrompt').textContent=await copy($('chatPrompt').value,$('chatPrompt'))?'已复制，去网页版大模型粘贴':'已选中，请手动复制';};
$('reviseChat').onclick=async()=>{const d=current();$('chatPrompt').value=CafeEngine.chatPrompt(formData(),{previous:{headline:d.headline,caption:d.caption,shots:d.shots},issues:result.flags});$('reviseChat').textContent=await copy($('chatPrompt').value,$('chatPrompt'))?'修订指令已复制':'已选中左侧指令，请手动复制';$('status').textContent='把修订指令发给模型，再把新回复粘贴到左侧并导入。';};
updateMode(form.elements?.mode?.value||'demo');
$('download').onclick=()=>download(false);$('png').onclick=()=>download(true);draw();
