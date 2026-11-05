// Live-mode flow, receipts and secret handling. Model responses are injected; no real API is called.
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../docs/engine.js');
const FACTS={shop:'Fern Coffee',product:'Iced Latte',price:'5.50',currency:'USD',offer:'',tone:'warm'};
const GOOD={headline:'Hi',caption:'Iced Latte USD 5.50.',shots:['a','b','c']};
const LIVE={...FACTS,mode:'live'};
const fakeFetch=(body,ok=true)=>async()=>({ok,text:async()=>body});
const wrap=o=>JSON.stringify({choices:[{message:{content:typeof o==='string'?o:JSON.stringify(o)}}]});
const CONFIG={endpoint:'https://example.invalid/v1',key:'SECRET_SENTINEL',model:'test-model'};

test('clarifies missing facts with no model call',async()=>{const r=await E.runAgent({});assert.equal(r.status,'needs_input');assert.equal(r.call_count,0);});
test('revises flagged output once, passing the issues',async()=>{const seen=[];const r=await E.runAgent(LIVE,{caller:async(f,p,i)=>{seen.push(i);return seen.length===1?{...GOOD,caption:'USD50'}:GOOD;},modelName:'m'});assert.equal(r.status,'ready');assert.equal(r.call_count,2);assert.ok(seen[1].length);assert.equal(r.model,'m');assert.equal(r.label,'真实模型文本草稿 · 待人工复核');});
test('stops after two revisions and hands to a person',async()=>{const r=await E.runAgent(LIVE,{caller:async()=>({...GOOD,caption:'USD50'})});assert.equal(r.call_count,3);assert.equal(r.status,'human_review');assert.ok(r.flags.length);});
test('malformed output three times hands to a person',async()=>{const r=await E.runAgent(LIVE,{caller:async()=>({})});assert.equal(r.call_count,3);assert.equal(r.status,'human_review');assert.equal(r.facts,undefined);});
test('live mode with no settings never falls back to the template',async()=>{await assert.rejects(E.handle('generate',LIVE,{}),/MODEL_CONFIG/);await assert.rejects(E.handle('generate',LIVE,{...CONFIG,endpoint:'http://example.invalid'}),/MODEL_CONFIG/);});
test('request carries the key only in the auth header; network failure text hides it',async()=>{
 let captured;const f=async(url,init)=>{captured=init;throw Error('SECRET_SENTINEL');};
 await assert.rejects(E.modelCaller(CONFIG,f)(E.validate(FACTS)),e=>e.code==='MODEL_NETWORK'&&!e.message.includes('SECRET_SENTINEL'));
 assert.equal(captured.headers.Authorization,'Bearer SECRET_SENTINEL');assert.ok(!captured.body.includes('SECRET_SENTINEL'));
});
test('HTTP error and invalid bodies are reported',async()=>{
 await assert.rejects(E.modelCaller(CONFIG,fakeFetch('x',false))(E.validate(FACTS)),e=>e.code==='MODEL_NETWORK');
 await assert.rejects(E.modelCaller(CONFIG,fakeFetch('oops'))(E.validate(FACTS)),e=>e.code==='MODEL_FORMAT');
});
test('accepts a fenced JSON reply',async()=>{const r=await E.modelCaller(CONFIG,fakeFetch(wrap('```json\n'+JSON.stringify(GOOD)+'\n```')))(E.validate(FACTS));assert.equal(r.headline,'Hi');});
test('key never appears in result, review or export',async()=>{
 globalThis.fetch=fakeFetch(wrap(GOOD));
 const r=await E.handle('generate',LIVE,CONFIG);assert.equal(r.model,'test-model');
 const d={...r,revision:1,asset_revision:0};const a=await E.handle('audit',d);
 const out=await E.handle('export',{...d,audit_id:a.audit_id,confirmed:true});
 assert.ok(!JSON.stringify([r,a,out]).includes('SECRET_SENTINEL'));
});
test('export requires a current review and confirmation',async()=>{
 const s=E.createSession();const r=s.register(await E.runAgent(FACTS));Object.assign(r,{revision:1,asset_revision:2});
 const receipt=s.review(r);Object.assign(r,receipt,{confirmed:true});
 const out=s.export(r);assert.equal(out.result.review.asset_revision,2);assert.match(out.markdown,/审核记录/);
 for(const patch of [{mode:'invented'},{mode:'live'},{caption:'changed'},{asset_revision:3},{confirmed:false},{facts:{...r.facts,price:'9.00'}}])assert.throws(()=>s.export({...r,...patch}),E.ValueError,JSON.stringify(patch));
});
