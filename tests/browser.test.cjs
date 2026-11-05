/* 真实浏览器回归。运行：NODE_PATH=<含 playwright-core 的 node_modules> node tests/browser.test.cjs [截图目录] */
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core');
const root=path.join(__dirname,'..','docs'),shots=process.argv[2]||null;
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.jpg':'image/jpeg'};
const server=http.createServer((q,r)=>{const p=path.join(root,decodeURIComponent(q.url.split('?')[0]).replace(/\/$/,'/index.html'));fs.readFile(p,(e,b)=>{if(e){r.writeHead(404);return r.end('nf');}r.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'});r.end(b);});});
const JPEG=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==','base64');
(async()=>{
  await new Promise(r=>server.listen(0,r));const base=`http://127.0.0.1:${server.address().port}/`;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const errors=[];
  const open=async(viewport,mock)=>{const ctx=await browser.newContext({viewport,hasTouch:viewport.width<500,acceptDownloads:true});const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));if(mock)await mock(page);await page.goto(base+'?nointro');await page.waitForFunction(()=>window.__cb);return page;};
  const shot=async(p,n,full)=>{if(shots)await p.screenshot({path:path.join(shots,n+'.png'),fullPage:!!full});};
  // 离线：无后端时明确标注示例
  let p=await open({width:1280,height:800});
  assert.match(await p.textContent('#svcBanner'),/正在接入/);
  const html=await p.content();
  for(const dead of ['模板演示','免费公共模型','Pollinations','样稿','口令 demo'])assert.ok(!html.includes(dead),dead);
  assert.equal(await p.evaluate(()=>[...document.querySelectorAll('dialog')].filter(d=>getComputedStyle(d).display!=='none').length),0,'未打开的弹窗不可见');
  await shot(p,'home-desktop',true);
  await p.click('#trySample');await p.waitForSelector('#go');
  assert.match(await p.textContent('#quotaChip'),/示例模式/);
  await p.click('#go');await p.waitForSelector('#paneResult:not([hidden])',{timeout:15000});
  await shot(p,'offline-result');
  assert.match(await p.textContent('#toast'),/未调用/);
  await p.check('#cupOk');
  const [dl]=await Promise.all([p.waitForEvent('download'),p.click('#exportOne')]);
  assert.ok(fs.statSync(await dl.path()).size>2000,'导出非空');
  await p.context().close();
  // 坏文件
  p=await open({width:390,height:844});
  await shot(p,'home-mobile');
  await p.goto(base+'?nointro#studio');await p.waitForSelector('#file',{state:'attached'});
  await p.setInputFiles('#file',{name:'a.txt',mimeType:'text/plain',buffer:Buffer.from('x')});
  assert.match(await p.textContent('#photoMsg'),/不是 JPG/);
  await p.setInputFiles('#file',{name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('not image')});
  await p.waitForFunction(()=>/打不开/.test(document.querySelector('#photoMsg').textContent));
  await shot(p,'studio-mobile');
  await p.context().close();
  // 接通服务：验证上传、结果、下载、限次、解锁（模型回复为模拟，真实调用另行验收）
  const scene=shots&&fs.existsSync('/tmp/cb/out-small.jpg')?fs.readFileSync('/tmp/cb/out-small.jpg'):JPEG;
  let left=1,unlocked=false,sent=null;
  const mock=async page=>{
    await page.route('**/api/**',async r=>{const u=new URL(r.request().url()).pathname,j=(s,o)=>r.fulfill({status:s,contentType:'application/json',body:JSON.stringify(o)});
      if(u==='/api/status')return j(200,{unlimited:unlocked,remaining:left});
      if(u==='/api/rendered-image')return r.fulfill({status:200,contentType:'image/jpeg',body:scene});
      if(u==='/api/unlock'){const b=r.request().postDataJSON();if(b.password!=='right')return j(401,{code:'UNLOCK_INVALID',error:'密码不对'});unlocked=true;return j(200,{unlimited:true,remaining:null,token:'tok'});}
      if(u==='/api/package'||u==='/api/generate-image'){sent=r.request().postDataJSON();if(!unlocked&&left<=0)return j(429,{code:'QUOTA_EXCEEDED',error:'免费包装次数已用完'});if(!unlocked)left--;return j(200,{title:'真实标题',detail:'真实详情文案 冰奶油拿铁',selling_points:[],image_url:'/api/rendered-image?id=1',remaining:unlocked?null:left,unlimited:unlocked});}
      return j(404,{});});};
  p=await open({width:390,height:844},mock);
  assert.match(await p.textContent('#svcBanner'),/已接通/);
  await p.goto(base+'?nointro#studio');await p.waitForFunction(()=>window.__cb);
  await p.setInputFiles('#file',{name:'c.jpg',mimeType:'image/jpeg',buffer:scene});
  await p.waitForFunction(()=>/已选用/.test(document.querySelector('#photoMsg').textContent));
  await p.fill('#iName','冰奶油拿铁');await p.fill('#iPrice','18');await p.fill('#iOffer','周一第二杯半价');
  await p.click('#go');await p.waitForSelector('#paneResult:not([hidden])',{timeout:15000});
  assert.match(sent.image,/^data:image\/jpeg;base64,/);assert.equal(sent.product,'冰奶油拿铁');
  assert.match(await p.textContent('#resCopy'),/真实标题/);
  assert.match(await p.textContent('#quotaChip'),/还能免费包装 0 次/);
  for(const id of ['main','poster']){await p.evaluate(i=>document.querySelector(`#strip button[data-id=${i}]`).click(),id);await shot(p,'live-'+id);}
  await p.check('#cupOk');
  const [d2]=await Promise.all([p.waitForEvent('download'),p.click('#exportOne')]);
  assert.ok(fs.statSync(await d2.path()).size>1000);
  assert.equal(await p.evaluate(()=>document.querySelector('#unlock').open),false);
  await p.click('#again');await p.waitForFunction(()=>document.querySelector('#unlock').open);
  await p.fill('#ulPwd','wrong');await p.click('#ulGo');await p.waitForFunction(()=>/不对/.test(document.querySelector('#ulErr').textContent));
  await p.fill('#ulPwd','right');await p.click('#ulGo');await p.waitForFunction(()=>!document.querySelector('#unlock').open);
  assert.match(await p.textContent('#quotaChip'),/不限次数/);
  assert.equal(await p.evaluate(()=>localStorage.getItem('cb_unlock')),'tok');
  await p.context().close();
  assert.deepEqual(errors,[],'页面无脚本错误');
  console.log('browser tests passed');
  await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1);});
