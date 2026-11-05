const E=require('../docs/engine.js');
const strip=r=>Array.isArray(r)?r.map(strip):r&&typeof r==='object'?Object.fromEntries(Object.entries(r).filter(([k])=>k!=='elapsed_ms').map(([k,v])=>[k,strip(v)])):r;
const run=async fn=>{try{return {ok:await fn()};}catch(e){if(e instanceof E.ValueError)return {error:true};throw e;}};
(async()=>{
 const c=JSON.parse(require('fs').readFileSync(0,'utf8'));
 const facts=E.validate(c.base),offer=E.validate(c.offer);
 const out={audit:c.texts.map(t=>E.audit(t,facts)),audit_offer:c.texts.map(t=>E.audit(t,offer)),validate:[],agent:[],markdown:[E.exportMarkdown(E.generateDemo(c.base)),E.exportMarkdown(E.generateDemo(c.offer))]};
 for(const d of c.inputs){out.validate.push(await run(()=>E.validate(d)));out.agent.push(strip(await run(()=>E.runAgent(d))));}
 process.stdout.write(JSON.stringify(out));
})().catch(e=>{console.error(e);process.exit(1)});
