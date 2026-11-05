const assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const elements={},paints=[],requests=[],downloads=[];
const ctx=new Proxy({font:'',measureText(t){return {width:[...t].length*parseInt(this.font||'20')*.55}},fillText(t){paints.push(t)}},{get:(o,k)=>o[k]||(()=>{})});
function el(id){return elements[id]||=( {value:'',checked:false,disabled:false,files:[],children:[],handlers:{},addEventListener(k,f){this.handlers[k]=f},replaceChildren(){this.children=[]},append(x){this.children.push(x)},querySelectorAll(){return this.children.flatMap(x=>x.children)},getContext(){return ctx},click(){downloads.push(this.download)},toBlob(f){f(new Blob(['png']))}} );}
const box={document:{getElementById:el,createElement:()=>el(Math.random())},Studio:require('../docs/studio.js'),createImageBitmap:()=>{},setTimeout,URL,Blob,console,FormData:class{*[Symbol.iterator](){yield ['mode','demo']}},CafeEngine:{handle:()=>new Promise(resolve=>requests.push(resolve))}};
vm.createContext(box);vm.runInContext(fs.readFileSync('docs/app.js','utf8'),box);const run=s=>vm.runInContext(s,box);
const fixture={facts:{shop:'Fern',product:'Iced Latte',currency:'USD',price:'5.50',offer:'10% off. Weekdays only.'},mode:'demo',headline:'Hello',caption:'Iced Latte USD 5.50',shots:['a','b','c'],trace:[]};
function setup(){box.fixture=fixture;run('result=fixture;');el('headline').value='Hello';el('caption').value=fixture.caption;el('shots').children=[{children:[{value:'a'},{value:'b'},{value:'c'}]}];run('draw();checked=true;document.getElementById("confirm").checked=true;gate()');}
(async()=>{
setup();assert.ok(paints.join('').includes(fixture.facts.offer));
el('headline').value='X'.repeat(2000);run('draw()');assert.equal(el('png').disabled,true);assert.match(el('layout').textContent,/无法完整/);
setup();const check=run('check()');run('changed()');requests.shift()({flags:[],audit_id:'old'});assert.equal(await check,false);assert.equal(run('checked'),false);
setup();const download=run('download(false)');run('changed()');requests.shift()({result:fixture,markdown:'x'});await download;assert.equal(downloads.length,0);
setup();const generate=el('brief').handlers.submit({preventDefault(){}});requests.shift()(fixture);await new Promise(setImmediate);assert.equal(requests.length,1);el('status').textContent='changed status';run('changed();result=null');requests.shift()({flags:[],audit_id:'stale'});await generate;assert.equal(el('status').textContent,'changed status');
setup();const pending={},closed=[];box.createImageBitmap=f=>new Promise(r=>pending[f.name]=r);
el('photo').files=[{name:'old',type:'image/png',size:1}];const old=el('photo').onchange();assert.equal(el('confirm').disabled,true);
el('photo').files=[{name:'new',type:'image/png',size:1}];const newer=el('photo').onchange();pending.new({width:100,height:100,close:()=>closed.push('new')});await newer;
assert.equal(run('checked'),false);assert.equal(el('confirm').checked,false);
run('checked=true;document.getElementById("confirm").checked=true;gate()');pending.old({width:100,height:100,close:()=>closed.push('old')});await old;assert.deepEqual(closed,['old']);
el('photo').files=[];await el('photo').onchange();assert.deepEqual(closed,['old','new']);assert.equal(el('png').disabled,true);
setup();let blobCallback;el('poster').toBlob=f=>blobCallback=f;const png=run('download(true)');requests.shift()({result:fixture,markdown:'x'});await new Promise(setImmediate);run('changed()');blobCallback(new Blob(['png']));await png;assert.equal(downloads.length,0);
console.log('PASS actual app.js: offer drawn, overflow blocks, stale audit/export/generation-after-audit discarded (DOM/Canvas stubs; not browser)');
})().catch(e=>{console.error(e);process.exitCode=1});
