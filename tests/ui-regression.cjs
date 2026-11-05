const assert=require('node:assert/strict');
const {fit,Asset}=require('../docs/studio.js');
const ctx={font:'',measureText(t){return {width:[...t].length*parseInt(this.font)*.6}}};
const plan=fit(ctx,'Weekdays only · 10% off',950,180,36,22);
assert.equal(plan.lines.join(''),'Weekdays only · 10% off');
assert.equal(fit(ctx,'X'.repeat(2000),950,180,58,24),null);
assert.ok(fit(ctx,'Long product name '.repeat(5),950,150,38,22));
(async()=>{const resolvers={},closed=[];const a=new Asset();const decode=f=>new Promise((r,j)=>resolvers[f]={r,j});
const p=a.load('old',decode),q=a.load('new',decode);
resolvers.new.r({close:()=>closed.push('new')});await q;
resolvers.old.r({close:()=>closed.push('old')});assert.equal(await p,false);assert.deepEqual(closed,['old']);
const z=a.load('bad',decode);assert.deepEqual(closed,['old','new']);resolvers.bad.j(Error('decode'));await assert.rejects(z);assert.equal(a.bitmap,null);assert.equal(a.loading,false);
await a.load(null,decode);assert.equal(a.bitmap,null);assert.equal(a.loading,false);
{const c={font:'',measureText(t){return {width:[...t].length*10}}};
 assert.deepEqual(fit(c,'Cool Comfort at Fern Coffee - Iced Latte',170,400,20,20).lines,['Cool Comfort at','Fern Coffee -','Iced Latte']);
 const long=fit(c,'a Supercalifragilistic',100,400,20,20);assert.equal(long.lines.join('').replace(/ /g,''),'aSupercalifragilistic');assert.ok(long.lines.every(l=>c.measureText(l).width<=100));
 assert.equal(fit(c,'把一杯咖啡变成下一条好内容',60,400,20,20).lines.join(''),'把一杯咖啡变成下一条好内容');}
console.log('PASS layout completeness/overflow, word wrap, reversed image decode, release, failure, clear (Node unit tests; not browser)');
})().catch(e=>{console.error(e);process.exitCode=1});
