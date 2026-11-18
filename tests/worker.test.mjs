import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { createPasswordHash } from '../worker/index.mjs';

class Database {
  requests = new Map();
  rows = new Map();
  images = new Map();
  calls = 0;
  publicCalls = 0;
  async batch(statements) {
    const rows=structuredClone(this.rows),requests=structuredClone(this.requests);
    try {const results=[];for(const st of statements) {const r=await st.first();results.push({results:r?[r]:[]});}return results;}
    catch(e){this.rows=rows;this.requests=requests;throw e;}
  }
  prepare(sql) {
    return { bind: (...args) => ({
      first: async () => {
        if(sql.includes('INSERT INTO generation_requests')) {if(this.requests.has(args[0]))return null;this.requests.set(args[0],{fingerprint:args[1]});return {id:args[0]};}
        if(sql.includes('UPDATE generation_requests SET response')) {
          if(args.length>3 && this.rows.get(args[3])?.lease_until!==args[4])return null;
          Object.assign(this.requests.get(args[2]),{response:args[0],status:args[1]});return {id:args[2]};
        }
        if(sql.includes('SELECT fingerprint,response,status'))return this.requests.get(args[0]);
        if (sql.includes('INSERT INTO quota')) {
          const [key,until,now,lower,upper] = args;
          const row=this.rows.get(key)||{uses:0,lease_until:0};
          if(row.uses>=3||row.lease_until>=now||[...this.requests].some(([id,r])=>id>=lower&&id<upper&&r.status===202))return null;
          row.lease_until=until;this.rows.set(key,row);
          return {...row};
        }
        if (sql.includes('INSERT INTO unlock_attempts')) return { attempts: 1 };
        if (sql.includes('INSERT INTO generation_attempts')) return ++this.calls <= 6 ? { attempts:this.calls } : null;
        if (sql.includes('INSERT INTO public_budget')) return (this.publicCalls+=Number(args[1])) <= Number(args[2]) ? { attempts:this.publicCalls } : null;
        if (sql.includes('SELECT uses')) return { uses: this.rows.get(args[0])?.uses || 0 };
        if (sql.includes('SELECT source,visitor,expires_at FROM rendered_images')) return this.images.get(args[0])||null;
        if (sql.includes('UPDATE quota SET uses')) {
          const row=this.rows.get(args[0]);
          if(!row||row.lease_until!==args[1])return null;
          row.uses++;row.lease_until=0;return {...row};
        }
        return null;
      },
      run: async () => {
        if(sql.includes('DELETE FROM generation_requests WHERE id='))this.requests.delete(args[0]);
        if(sql.includes('UPDATE generation_requests SET response'))Object.assign(this.requests.get(args[2]),{response:args[0],status:args[1]});
        if (sql.includes('UPDATE quota SET lease_until')) {const row=this.rows.get(args[0]);if(row?.lease_until===args[1])row.lease_until=0;}
        if (sql.includes('INSERT INTO rendered_images')) this.images.set(args[0],{source:args[1],visitor:args[2],expires_at:args[3]});
      }
    }) };
  }
}
const facts = {shop:'松间咖啡',product:'燕麦拿铁',price:'28.00',highlights:'燕麦奶；冰饮',platform:'meituan'};
const IMAGE_DATA='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=';
const json = response => response.json();
const request = (path, data, headers={}) => new Request('https://example.workers.dev'+path,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.4',...headers},body:JSON.stringify(data)});
const env = async () => {
  const salt = '00112233445566778899aabbccddeeff';
  return { DB:new Database(), ARK_API_KEY:'test-key', ARK_MODEL:'test-model', SESSION_SECRET:'session-secret-for-tests', ADMIN_PASSWORD_SALT:salt, ADMIN_PASSWORD_HASH:await createPasswordHash('test-unlock', salt,'session-secret-for-tests') };
};
const plan = o => JSON.stringify({title:'松间咖啡燕麦拿铁',detail:'松间咖啡 燕麦拿铁 ¥28.00，燕麦奶、冰饮。',selling_points:['燕麦奶','冰饮'],visual_plan:'暖色木质吧台，柔和窗边光。',image_prompt:'以参考照片中的真实商品为主体，换成暖色木质吧台背景，保持商品不变。',...o});
const reply = o => new Response(JSON.stringify({choices:[{message:{content:plan(o)}}]}),{status:200});
const model = async () => reply({});

test('three generations are persisted and the fourth is refused', async () => {
  const e = await env();
  for(let i=0;i<3;i++) {
    const r=await worker.fetch(request('/api/generate',facts),e,{fetch:model});
    assert.equal(r.status,200,JSON.stringify(await r.clone().json()));
    assert.equal((await json(r)).remaining,2-i);
  }
  const fourth=await worker.fetch(request('/api/generate',facts),e,{fetch:model});
  assert.equal(fourth.status,429);
  assert.equal((await json(fourth)).code,'QUOTA_EXCEEDED');
});

test('unlock requires password and sets a signed HttpOnly cookie', async () => {
  const e=await env();
  const wrong=await worker.fetch(request('/api/unlock',{password:'wrong'}),e,{fetch:model});
  assert.equal(wrong.status,401);
  const success=await worker.fetch(request('/api/unlock',{password:'test-unlock'}),e,{fetch:model});
  assert.equal(success.status,200);
  const cookie=success.headers.get('set-cookie');
  assert.match(cookie,/HttpOnly/);
  assert.match(cookie,/SameSite=Lax/);
  for(let i=0;i<5;i++) assert.equal((await worker.fetch(request('/api/generate',facts,{cookie}),e,{fetch:model})).status,200);
  assert.equal(e.DB.rows.size,0);
});

test('model failure releases reservation without exposing provider response', async () => {
  const e=await env();
  const failed=await worker.fetch(request('/api/generate',facts),e,{fetch:async()=>new Response('secret upstream error',{status:500})});
  assert.equal(failed.status,502);
  assert.doesNotMatch(JSON.stringify(await json(failed)),/secret upstream error|test-key/);
  assert.equal([...e.DB.rows.values()][0].uses,0);
});

test('facts cannot be replaced with prompt instructions or an unsupported platform', async () => {
  const e=await env();
  const r=await worker.fetch(request('/api/generate',{...facts,platform:'other'}),e,{fetch:model});
  assert.equal(r.status,400);
  assert.equal(e.DB.rows.size,0);
});

test('unlimited access still has a per-minute generation rate limit', async () => {
  const e=await env();
  const login=await worker.fetch(request('/api/unlock',{password:'test-unlock'}),e,{fetch:model});
  const cookie=login.headers.get('set-cookie');
  for(let i=0;i<6;i++) assert.equal((await worker.fetch(request('/api/generate',facts,{cookie}),e,{fetch:model})).status,200);
  const denied=await worker.fetch(request('/api/generate',facts,{cookie}),e,{fetch:model});
  assert.equal(denied.status,429);
  assert.equal((await json(denied)).code,'RATE_LIMIT');
});

test('model cannot publish an extra price or unconfirmed health claim', async () => {
  const e=await env();
  const unsafe=async()=>reply({title:'保证减脂',detail:'松间咖啡 燕麦拿铁 28.00 元，现价9.90元，买一送一。',selling_points:['减肥']});//));
  const r=await worker.fetch(request('/api/generate',facts),e,{fetch:unsafe});
  assert.notEqual(r.status,200);
  assert.equal([...e.DB.rows.values()][0].uses,0);
});

test('text model can select and order only merchant supplied selling points', async () => {
  const e=await env();
  const reordered=async()=>reply({selling_points:['冰饮','燕麦奶']});
  const ok=await worker.fetch(request('/api/generate',facts),e,{fetch:reordered});
  assert.equal(ok.status,200);
  assert.deepEqual((await ok.json()).selling_points,['冰饮','燕麦奶']);
  const invented=async()=>reply({selling_points:['云南有机认证']});
  const bad=await worker.fetch(request('/api/generate',facts),e,{fetch:invented});
  assert.equal(bad.status,502);
  assert.equal([...e.DB.rows.values()][0].uses,1);
});

test('failed release has stable response and expired lease restores availability', async () => {
  const e=await env();
  const original=e.DB.prepare.bind(e.DB);
  e.DB.prepare=sql=>sql.startsWith('UPDATE quota SET lease_until')?{bind:()=>({run:async()=>{throw Error('DB unavailable')}})}:original(sql);
  const r=await worker.fetch(request('/api/generate',facts),e,{fetch:async()=>new Response('',{status:500})});
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'QUOTA_REPAIR_REQUIRED');
  assert.equal([...e.DB.rows.values()][0].uses,0);
  e.DB.prepare=original;
  const now=Date.now;
  try {
    Date.now=()=>now()+361000;
    const retry=await worker.fetch(request('/api/generate',facts),e,{fetch:model});
    assert.equal(retry.status,200);
    assert.equal([...e.DB.rows.values()][0].uses,1);
  } finally {Date.now=now;}
});

test('one package operation calls text and image models with one quota reservation', async () => {
  const e=await env();e.ARK_IMAGE_MODEL='doubao-seedream-5-0-pro-260628';
  const calls=[];
  const provider=async(url,options)=>{
    calls.push({url,body:JSON.parse(options.body),authorization:options.headers.authorization});
    if(url.endsWith('/images/generations'))return new Response(JSON.stringify({data:[{url:'https://example.volces.com/result.png'}]}));
    return model();
  };
  const input={...facts,image:IMAGE_DATA};
  const r=await worker.fetch(request('/api/package',input),e,{fetch:provider});
  assert.equal(r.status,200);
  const body=await r.json();
  assert.match(body.image_url,/^\/api\/rendered-image\?/);
  assert.doesNotMatch(body.image_url,/example\.volces\.com|result\.png/,'provider URL stays on server');
  assert.equal(body.remaining,2);
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.image,input.image);
  assert.equal(calls[1].body.model,'doubao-seedream-5-0-pro-260628');
  assert.equal(calls[1].body.size,'2K');
  assert.equal(calls[1].body.response_format,'url');
  assert.equal(calls[1].body.watermark,false);
  assert.match(calls[1].body.prompt,/商家确认的优先卖点：燕麦奶、冰饮/);
  assert.ok(calls.every(call=>call.authorization==='Bearer test-key'));
  const image=await worker.fetch(new Request('https://example.workers.dev'+body.image_url,{headers:{'cf-connecting-ip':'192.0.2.4'}}),e,{fetch:async()=>new Response(new Blob(['pixels'],{type:'image/png'}),{headers:{'content-type':'image/png'}})});
  assert.equal(image.status,200);
  assert.equal(image.headers.get('content-type'),'image/png');
  const tampered=await worker.fetch(new Request('https://example.workers.dev'+body.image_url.replace(/id=[^&]+/,'id=invalid')),e,{fetch:provider});
  assert.equal(tampered.status,403);
});

test('image-only route is separately charged and never calls text model',async()=>{
  const e=await env();e.ARK_IMAGE_MODEL='doubao-seedream-5-0-pro-260628';
  const calls=[];
  const r=await worker.fetch(request('/api/generate-image',{...facts,image:IMAGE_DATA}),e,{fetch:async(url)=>{
    calls.push(url);
    return new Response(JSON.stringify({data:[{url:'https://example.volces.com/result.png'}]}));
  }});
  assert.equal(r.status,200);
  assert.equal(calls.length,1);
  assert.match(calls[0],/images\/generations$/);
  assert.equal((await r.json()).remaining,2);
});

test('missing, truncated, or spoofed reference image is rejected before any paid call',async()=>{
  const e=await env();e.ARK_IMAGE_MODEL='image-model';
  let calls=0;
  const provider=async()=>{calls++;return model();};
  const fakePng=Uint8Array.from({length:24},()=>0x31);
  fakePng.set([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const fakePngData='data:image/png;base64,'+btoa(String.fromCharCode(...fakePng));
  for(const input of [{...facts},{...facts,image:'data:image/png;base64,YWJjZA=='},{...facts,image:fakePngData}]){
    const r=await worker.fetch(request('/api/package',input),e,{fetch:provider});
    assert.equal(r.status,400, JSON.stringify(await r.clone().json()));
  }
  assert.equal(calls,0);
  assert.equal(e.DB.rows.size,0);
});

test('public daily attempt budget also counts failed paid calls',async()=>{
  const e=await env();e.MAX_PUBLIC_DAILY_CALLS='2';
  const first=await worker.fetch(request('/api/generate',facts),e,{fetch:async()=>new Response('',{status:500})});
  assert.equal(first.status,502);
  const second=await worker.fetch(request('/api/generate',facts),e,{fetch:model});
  assert.equal(second.status,429);
  assert.equal((await second.json()).code,'PUBLIC_BUDGET_EXCEEDED');
});

test('proxy rejects oversized image even without Content-Length',async()=>{
  const e=await env();e.ARK_IMAGE_MODEL='image-model';
  const imageSource=async url=>url.endsWith('/images/generations')
    ?new Response(JSON.stringify({data:[{url:'https://example.volces.com/result.png'}]}))
    :model();
  const packaged=await worker.fetch(request('/api/package',{...facts,image:IMAGE_DATA}),e,{fetch:imageSource});
  const body=await packaged.json();
  const large=await worker.fetch(new Request('https://example.workers.dev'+body.image_url,{headers:{'cf-connecting-ip':'192.0.2.4'}}),e,{fetch:async()=>new Response(new Uint8Array(12_000_001),{headers:{'content-type':'image/png'}})});
  assert.equal(large.status,502);
});

test('Pages origin gets CORS and a usable unlock token; other origins are refused',async()=>{
  const e=await env();e.ALLOWED_ORIGINS='https://luyujun74-creator.github.io';
  const origin={origin:'https://luyujun74-creator.github.io'};
  const preflight=await worker.fetch(new Request('https://example.workers.dev/api/package',{method:'OPTIONS',headers:origin}),e,{fetch:model});
  assert.equal(preflight.status,204);
  assert.equal(preflight.headers.get('access-control-allow-origin'),origin.origin);
  assert.match(preflight.headers.get('access-control-allow-headers'),/authorization/);
  const denied=await worker.fetch(request('/api/generate',facts,{origin:'https://evil.example'}),e,{fetch:model});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get('access-control-allow-origin'),null);
  const login=await worker.fetch(request('/api/unlock',{password:'test-unlock'},origin),e,{fetch:model});
  assert.equal(login.headers.get('access-control-allow-origin'),origin.origin);
  const {token}=await login.json();
  const status=await worker.fetch(new Request('https://example.workers.dev/api/status',{headers:{'cf-connecting-ip':'192.0.2.4',authorization:'Bearer '+token,...origin}}),e,{fetch:model});
  assert.equal((await status.json()).unlimited,true);
  const forged=await worker.fetch(new Request('https://example.workers.dev/api/status',{headers:{'cf-connecting-ip':'192.0.2.4',authorization:'Bearer 9999999999999.'+'0'.repeat(64)}}),e,{fetch:model});
  assert.equal((await forged.json()).unlimited,false);
});

test('client cannot supply its own image prompt and shop name is optional',async()=>{
  const e=await env();e.ARK_IMAGE_MODEL='image-model';
  const prompts=[];
  const provider=async(url,options)=>{if(url.endsWith('/images/generations')){prompts.push(JSON.parse(options.body).prompt);return new Response(JSON.stringify({data:[{url:'https://example.volces.com/r.png'}]}));}return model();};
  const r=await worker.fetch(request('/api/package',{...facts,shop:'',image:IMAGE_DATA,scene_prompt:'draw something else entirely'}),e,{fetch:provider});
  assert.equal(r.status,200);
  assert.doesNotMatch(prompts[0],/draw something else/);
});

test('slow generation stays alive with whitespace, then ends in parseable JSON and settles the count', async () => {
  const e=await env();e.ARK_IMAGE_MODEL='image-model';e.HEARTBEAT_MS='5';
  const provider=async(url)=>{await new Promise(r=>setTimeout(r,40));if(url.endsWith('/images/generations'))return new Response(JSON.stringify({data:[{url:'https://example.volces.com/r.png'}]}));return model();};
  const r=await worker.fetch(request('/api/package',{...facts,shop:'',image:IMAGE_DATA}),e,{fetch:provider});
  assert.equal(r.status,200);
  assert.equal(r.headers.get('x-streamed'),'heartbeat');
  const text=await r.text();
  assert.match(text,/^ +\{/);
  const body=JSON.parse(text);
  assert.equal(body.code,undefined);
  assert.equal(body.remaining,2);
});

test('a slow failure reports its code in the streamed body and does not count', async () => {
  const e=await env();e.ARK_IMAGE_MODEL='image-model';e.HEARTBEAT_MS='5';
  const provider=async()=>{await new Promise(r=>setTimeout(r,30));return new Response('nope',{status:500});};
  const r=await worker.fetch(request('/api/package',{...facts,shop:'',image:IMAGE_DATA}),e,{fetch:provider});
  const body=JSON.parse(await r.text());
  assert.equal(r.status,200);
  assert.equal(body.code,'MODEL_FAILED');
  assert.equal(e.DB.rows.values().next().value.uses,0);
});

test('no upstream call uses redirect:error, which the Workers runtime rejects', async () => {
  const fs=await import('node:fs');
  assert.doesNotMatch(fs.readFileSync(new URL('../worker/index.mjs',import.meta.url),'utf8'),/redirect:\s*'error'/);
});

test('a full package reserves budget for its worst case of three model calls', async () => {
  const e=await env();e.ARK_IMAGE_MODEL='image-model';e.MAX_PUBLIC_DAILY_CALLS='2';
  let calls=0;
  const r=await worker.fetch(request('/api/package',{...facts,shop:'',image:IMAGE_DATA}),e,{fetch:async()=>{calls++;return model();}});
  assert.equal(r.status,429);
  assert.equal((await r.json()).code,'PUBLIC_BUDGET_EXCEEDED');
  assert.equal(calls,0);
});

test('offer is validated and returned unchanged as a fact', async()=>{
 const e=await env();
 const invalid=await worker.fetch(request('/api/generate',{...facts,offer:123}),e,{fetch:model});
 assert.equal(invalid.status,400);
 const offer='仅周一到店，第二杯半价；截止2026-12-31';
 const result=await worker.fetch(request('/api/generate',{...facts,offer}),e,{fetch:model});
 const body=await result.json(); assert.equal(body.offer,offer);assert.equal(body.currency,'CNY');
});

test('requestId replay returns stored output without a second model call or charge',async()=>{
 const e=await env();let calls=0;const fetch=async()=>{calls++;return model();};
 const data={...facts,requestId:'request-id-replay-0001'};
 const a=await worker.fetch(request('/api/generate',data),e,{fetch});
 const b=await worker.fetch(request('/api/generate',data),e,{fetch});
 assert.deepEqual(await a.json(),await b.json());assert.equal(calls,1);
 const c=await worker.fetch(request('/api/generate',{...data,price:'30'}),e,{fetch});assert.equal(c.status,409);
});

test('published copy deterministically preserves price shop and full offer',async()=>{
 const e=await env(),offer='仅周一到店，第二杯半价，2026-12-31截止';
 const r=await worker.fetch(request('/api/generate',{...facts,offer}),e,{fetch:model});const b=await r.json();
 assert.ok(b.detail.includes(offer));assert.ok(b.detail.includes('CNY ¥28.00'));assert.ok(b.detail.includes(facts.shop));
});

test('rate limited requestId can be retried after window reset',async()=>{
 const e=await env();e.DB.calls=6;const data={...facts,requestId:'rate-retry-request-0001'};
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch:model})).status,429);
 e.DB.calls=0;
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch:model})).status,200);
});
test('unbilled model failure requestId can retry successfully',async()=>{
 const e=await env(),data={...facts,requestId:'model-retry-request-0001'};
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch:async()=>new Response('',{status:500})})).status,502);
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch:model})).status,200);
});


test('settlement failure retries recorded result without another upstream call',async()=>{
 const e=await env(),data={...facts,requestId:'settle-retry-request-0001'};let calls=0;
 const fetch=async()=>{calls++;return model();};const batch=e.DB.batch.bind(e.DB);
 e.DB.batch=async()=>{throw Error('transaction unavailable')};
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch})).status,503);
 assert.equal([...e.DB.rows.values()][0].uses,0);
 e.DB.batch=batch;
 assert.equal((await worker.fetch(request('/api/generate',data),e,{fetch})).status,200);
 assert.equal(calls,1);assert.equal([...e.DB.rows.values()][0].uses,1);
});
