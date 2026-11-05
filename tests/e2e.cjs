// Real-browser check of the published page. Usage: BASE_URL=... node tests/e2e.cjs
const {chromium,webkit,devices}=require('playwright');
const assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
const BASE=process.env.BASE_URL,SHOTS=process.env.SHOT_DIR;
if(!BASE)throw Error('Set BASE_URL');
function crc(buf){let c,r=~0;for(const b of buf){c=(r^b)&255;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;r=(r>>>8)^c;}return ~r>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);}
function png(w,h,[r,g,b]){const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const row=Buffer.alloc(1+w*3);for(let i=0;i<w;i++){row[1+i*3]=r;row[2+i*3]=g;row[3+i*3]=b;}const raw=Buffer.concat(Array(h).fill(row));return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cafe-e2e-'));
const photo=path.join(dir,'photo.png');fs.writeFileSync(photo,png(800,600,[200,30,30]));
const bad=path.join(dir,'bad.png');fs.writeFileSync(bad,Buffer.from('not an image'));
const pngSize=f=>{const b=fs.readFileSync(f);assert.equal(b.toString('latin1',1,4),'PNG');return [b.readUInt32BE(16),b.readUInt32BE(20)];};
const steps=[];const ok=s=>{steps.push(s);};
const pixel=(page,x,y)=>page.evaluate(([x,y])=>[...document.getElementById('poster').getContext('2d').getImageData(x,y,1,1).data].slice(0,3),[x,y]);
const idle=async page=>{await page.waitForFunction(()=>/草稿已生成|自动检查仍有问题/.test(document.getElementById('status').textContent));};
const dl=async(page,click)=>{const [d]=await Promise.all([page.waitForEvent('download'),click()]);const f=path.join(dir,Date.now()+'-'+d.suggestedFilename());await d.saveAs(f);return [d.suggestedFilename(),f];};

async function core(name,browser,ctxOptions){
  const ctx=await browser.newContext({acceptDownloads:true,...ctxOptions});const page=await ctx.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const res=await page.goto(BASE);assert.equal(res.status(),200);
  await page.fill('[name=offer]','10% off. Weekdays only.');await page.click('#generate');await idle(page);
  assert.equal(await page.textContent('#badge'),'模板演示 · 未调用模型');
  assert.equal(await page.isDisabled('#png'),true,'export gated before confirmation');
  assert.match(await page.textContent('#caption')+await page.inputValue('#caption'),/USD 5\.50/);
  ok('generate');
  // Flag detection through the real UI.
  await page.fill('#caption',(await page.inputValue('#caption'))+'\nUSD -5.50 free today');await page.click('#check');
  await page.waitForFunction(()=>/金额/.test(document.getElementById('flags').textContent));
  const flags=await page.textContent('#flags');assert.match(flags,/-5\.50/);assert.match(flags,/free/);assert.match(flags,/today/);ok('flags');
  await page.fill('#caption',(await page.inputValue('#caption')).replace('\nUSD -5.50 free today',''));
  assert.equal(await page.isDisabled('#confirm'),true,'editing invalidates the check');
  await page.click('#check');await page.waitForFunction(()=>!document.getElementById('confirm').disabled);ok('edit-invalidates');
  // Real upload appears on the canvas.
  const before=await pixel(page,540,300);
  await page.setInputFiles('#photo',photo);await page.waitForFunction(()=>/图片已更换/.test(document.getElementById('status').textContent));
  const after=await pixel(page,540,470);assert.deepEqual(after,[200,30,30],'uploaded photo drawn');assert.notDeepEqual(before,after);
  assert.equal(await page.isDisabled('#confirm'),true,'new photo requires a new check');ok('upload');
  // Undecodable file is refused.
  await page.setInputFiles('#photo',bad);await page.waitForFunction(()=>/无法解码/.test(document.getElementById('status').textContent));
  await page.setInputFiles('#photo',photo);await page.waitForFunction(()=>/图片已更换/.test(document.getElementById('status').textContent));ok('bad-image');
  await page.click('#check');await page.waitForFunction(()=>!document.getElementById('confirm').disabled);
  await page.check('#confirm');
  const [pngName,pngFile]=await dl(page,()=>page.click('#png'));assert.equal(pngName,'cafe-poster.png');assert.deepEqual(pngSize(pngFile),[1080,1350]);ok('png-download');
  await page.waitForFunction(()=>!document.getElementById('download').disabled);
  const files={};const collect=d=>{files[d.suggestedFilename()]=d;};page.on('download',collect);
  await page.click('#download');await page.waitForTimeout(1500);page.off('download',collect);
  assert.ok(files['cafe-brief.json']&&files['cafe-brief.md'],'both files: '+Object.keys(files));
  const jf=path.join(dir,name+'.json'),mf=path.join(dir,name+'.md');await files['cafe-brief.json'].saveAs(jf);await files['cafe-brief.md'].saveAs(mf);
  const j=JSON.parse(fs.readFileSync(jf,'utf8'));assert.equal(j.mode,'demo');assert.equal(j.review.confirmed,true);assert.equal(j.call_count,0);assert.equal(j.facts.offer,'10% off. Weekdays only.');
  assert.match(fs.readFileSync(mf,'utf8'),/模板演示[\s\S]*审核记录/);ok('json-md-download');
  // Overflow blocks export.
  await page.fill('#headline','Long headline '.repeat(100));await page.waitForFunction(()=>/无法完整呈现/.test(document.getElementById('layout').textContent));
  assert.equal(await page.isDisabled('#png'),true);ok('overflow-block');
  // Changing a fact discards the draft.
  await page.fill('[name=price]','6.00');assert.equal(await page.isHidden('#results'),true);ok('fact-change');
  // Missing fact clarifies.
  await page.fill('[name=price]','5.50');await page.evaluate(()=>{const f=document.querySelector('[name=shop]');f.removeAttribute('required');});await page.fill('[name=shop]','');await page.click('#generate');
  await page.waitForFunction(()=>/请确认/.test(document.getElementById('status').textContent));ok('clarify');
  assert.deepEqual(errors,[],'no console errors');
  if(SHOTS){await page.reload();await page.setInputFiles('#photo',photo);await page.fill('[name=offer]','10% off. Weekdays only.');await page.click('#generate');await idle(page);await page.screenshot({path:path.join(SHOTS,name+'.png'),fullPage:true});}
  if(ctxOptions?.viewport&&ctxOptions.viewport.width<500){const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(w[0]<=w[1]+1,'no sideways scroll '+w);ok('narrow-screen');}
  await ctx.close();
}
async function live(browser){
  const ctx=await browser.newContext({acceptDownloads:true});const page=await ctx.newPage();
  const SECRET='SENTINEL_NOT_A_REAL_KEY';const bodies=[];
  const good={headline:'Hello',caption:'Iced Latte USD 5.50.',shots:['a','b','c']};
  await page.route('https://model.example.test/**',async route=>{
    const req=route.request();
    if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
    bodies.push({auth:req.headers().authorization,body:req.postData()});
    const reply=bodies.length===1?{...good,caption:'Iced Latte USD 50.'}:good;
    await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({choices:[{message:{content:JSON.stringify(reply)}}]})});
  });
  await page.goto(BASE);
  assert.equal(await page.isVisible('#apiKey'),false,'settings hidden in demo');
  await page.selectOption('[name=mode]','live');assert.equal(await page.isVisible('#apiKey'),true);
  await page.click('#generate');await page.waitForFunction(()=>/MODEL_CONFIG/.test(document.getElementById('status').textContent));
  assert.equal(await page.isHidden('#results'),true,'no silent fallback to template');ok('live-unconfigured');
  await page.fill('#apiUrl','https://model.example.test/v1/chat/completions');await page.fill('#apiModel','stub');await page.fill('#apiKey',SECRET);
  await page.click('#generate');await idle(page);
  assert.equal(bodies.length,2,'one bounded revision');assert.equal(bodies[0].auth,'Bearer '+SECRET);assert.ok(bodies.every(b=>!b.body.includes(SECRET)));
  assert.equal(await page.textContent('#badge'),'真实模型文本草稿 · 待人工复核');
  await page.check('#confirm');
  const files={};const collect=d=>{files[d.suggestedFilename()]=d;};page.on('download',collect);await page.click('#download');await page.waitForTimeout(1500);
  const jf=path.join(dir,'live.json');await files['cafe-brief.json'].saveAs(jf);const text=fs.readFileSync(jf,'utf8');
  assert.ok(!text.includes(SECRET),'key not exported');assert.equal(JSON.parse(text).model,'stub');
  const stored=await page.evaluate(()=>JSON.stringify([{...localStorage},{...sessionStorage},document.cookie]));assert.ok(!stored.includes(SECRET),'key not stored');
  await page.reload();assert.equal(await page.inputValue('#apiKey').catch(()=>''),'','key gone after reload');ok('live-injected-model');
  await page.route('https://model.example.test/**',r=>r.abort());
  await ctx.close();
}
(async()=>{
  const c=await chromium.launch(),w=await webkit.launch();
  try{
    for(const [name,b,o] of [['chromium-desktop',c,{viewport:{width:1280,height:900}}],['chromium-phone',c,{...devices['Pixel 7']}],['webkit-iphone',w,{...devices['iPhone 14']}]]){
      steps.length=0;await core(name,b,o);console.log('PASS',name,steps.join(', '));
    }
    steps.length=0;await live(c);console.log('PASS live',steps.join(', '),'(model reply injected; no real API)');
  }finally{await c.close();await w.close();}
})().catch(e=>{console.error('FAIL',steps.join(','),e);process.exit(1);});
