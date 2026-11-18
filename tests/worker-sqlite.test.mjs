import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import worker from '../worker/index.mjs';

// Executes the actual schema and SQL; only the remote model and DB faults are simulated.
class SqlDatabase {
  db=new DatabaseSync(':memory:'); failJournal=0; failBatch=0; failRelease=0;
  constructor(){this.db.exec(readFileSync(new URL('../worker/schema.sql',import.meta.url),'utf8'));}
  prepare(sql){return {bind:(...args)=>({sql,args,
    first:async()=>this.db.prepare(sql).get(...args)??null,
    run:async()=>{
      if(sql.startsWith('UPDATE quota SET lease_until=0')&&this.failRelease-- > 0)throw Error('injected release failure');
      if(sql.startsWith('UPDATE generation_requests SET response')&&this.failJournal-- > 0)throw Error('injected journal failure');
      return this.db.prepare(sql).run(...args);
    }
  })};}
  async batch(statements){
    if(this.failBatch-- > 0)throw Error('injected settlement outage');
    this.db.exec('BEGIN');
    try{const out=statements.map(({sql,args})=>({results:this.db.prepare(sql).all(...args)}));this.db.exec('COMMIT');return out;}
    catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  quota(){return this.db.prepare('SELECT * FROM quota').get();}
}
const facts={shop:'松间咖啡',product:'燕麦拿铁',price:'28.00',highlights:'燕麦奶；冰饮',platform:'meituan'};
function fixture(t){
  const db=new SqlDatabase();t.after(()=>db.db.close());let calls=0, failModel=false;
  const env={DB:db,ARK_API_KEY:'test',ARK_MODEL:'test',SESSION_SECRET:'test-secret'};
  const fetch=async()=>{calls++;if(failModel)return new Response('',{status:500});return Response.json({choices:[{message:{content:JSON.stringify({title:'松间咖啡燕麦拿铁',detail:'松间咖啡 燕麦拿铁 ¥28.00，燕麦奶、冰饮。',selling_points:['燕麦奶','冰饮'],visual_plan:'木台',image_prompt:'商品主体不变，暖色木质吧台'})}}]});};
  const send=(id,headers={})=>worker.fetch(new Request('https://example.workers.dev/api/generate',{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.4',...headers},body:JSON.stringify({...facts,requestId:id})}),env,{fetch});
  return {db,send,calls:()=>calls,failModel:v=>failModel=v};
}
test('SQL journal write failure releases unbilled request for same-id retry',async t=>{
  const f=fixture(t);f.db.failJournal=1;
  assert.equal((await f.send('journal-failure-0001')).status,503);
  assert.equal(f.db.quota().uses,0);
  assert.equal(f.db.quota().lease_until,0);
  assert.equal((await f.send('journal-failure-0001')).status,200);
  assert.equal(f.db.quota().uses,1);
  assert.equal(f.calls(),2);
});
test('SQL pending settlement survives expiry without a new request overwriting its lease',async t=>{
  const f=fixture(t);f.db.failBatch=1;
  assert.equal((await f.send('expiry-request-0001')).status,503);
  const now=Date.now;t.mock.method(Date,'now',()=>now()+361000);
  assert.equal((await f.send('expiry-request-0002')).status,409);
  assert.equal(f.calls(),1);
  assert.equal((await f.send('expiry-request-0001')).status,200);
  assert.equal(f.db.quota().uses,1);
  assert.equal((await f.send('expiry-request-0002')).status,200);
  assert.equal(f.db.quota().uses,2);
});
test('SQL simultaneous replays settle one result once and eventually return it',async t=>{
  const f=fixture(t);f.db.failBatch=1;
  assert.equal((await f.send('concurrent-request-0001')).status,503);
  const results=await Promise.all([f.send('concurrent-request-0001'),f.send('concurrent-request-0001')]);
  for(const response of results)assert.ok([200,503].includes(response.status));
  assert.equal((await f.send('concurrent-request-0001')).status,200);
  assert.equal(f.db.quota().uses,1);assert.equal(f.calls(),1);
});

test('SQL model failure with failed release removes pending id and retries after lease expiry',async t=>{
 const f=fixture(t);f.failModel(true);f.db.failRelease=1;
 const first=await f.send('release-failure-0001');assert.equal(first.status,503);
 assert.equal(f.db.quota().uses,0);
 assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM generation_requests').get().n,0);
 f.failModel(false);
 // The failed release still holds the quota lease; retry after its documented expiry.
 const now=Date.now;t.mock.method(Date,'now',()=>now()+361000);
 assert.equal((await f.send('release-failure-0001')).status,200);
 assert.equal(f.db.quota().uses,1);
});
test('SQL admin result log failure removes pending id so same id can retry',async t=>{
 const f=fixture(t);f.db.failJournal=1;
 const expiry=String(Date.now()+60000);
 const signature=createHmac('sha256','test-secret').update('admin:'+expiry).digest('hex');
 const headers={authorization:'Bearer '+expiry+'.'+signature};
 assert.equal((await f.send('admin-log-failure-0001',headers)).status,503);
 assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM generation_requests').get().n,0);
 const response=await f.send('admin-log-failure-0001',headers);
 assert.equal(response.status,200);assert.equal((await response.json()).unlimited,true);
 assert.equal(f.db.quota(),undefined);
});
