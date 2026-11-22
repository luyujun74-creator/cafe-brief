import test from 'node:test';
import assert from 'node:assert/strict';
import { works, duplicateWork, deleteWork, restoreWork } from '../docs/launch/works.mjs';
import { validatedCopy } from '../docs/launch/workflow.mjs';

const draft = { facts: {name:'冰拿铁',price:2800,day:'周五',scope:'store'}, revision:1, edits:{poster:{title:'门店手改'}}, positions:{poster:{x:61,y:80}}, layers:{poster:2} };
test('副本独立，删除及撤销保留坐标、层级、文案与导出名称', () => {
  const [copy,id] = duplicateWork(draft,'poster');
  assert.equal(works(copy).length, 5);
  assert.equal(copy.edits[id].title, '门店手改');
  assert.notEqual(works(copy).find(c=>c.id===id).title, works(copy).find(c=>c.id==='poster').title);
  const deleted = deleteWork(copy,id);
  assert.equal(works(deleted).length,4);
  const restored = restoreWork(deleted);
  assert.deepEqual(restored.positions[id],copy.positions[id]);
  assert.equal(restored.layers[id],copy.layers[id]);
  assert.deepEqual(restored.edits[id],copy.edits[id]);
});
test('生成标题和正文须整对校验，拦截相冲突日期、价格和虚构活动', () => {
  const ok={title:'给日常留杯咖啡',body:'来店小坐，留一点时间给自己。'};
  assert.deepEqual(validatedCopy({poster:ok},draft.facts),{poster:ok});
  assert.deepEqual(validatedCopy({poster:{...ok,title:'周六到店'}, menu:{...ok,title:'仅售十九块'}, social:{...ok,body:'到店第二杯半价。'}},draft.facts),{});
});

test('逐渠道回退无法证实的时效、价格和数量承诺', () => {
  const ok = { title: '坐下来喝杯咖啡', body: '忙里偷闲，来店坐坐吧。' };
  const result = validatedCopy({
    menu: ok,
    poster: { ...ok, title: '周末见一面', body: '有空就过来坐会儿。' },
    banner: { ...ok, title: '二十八元起', body: '给这一刻留些好心情。' },
    social: { ...ok, body: '数量有限，售完即止。' },
  }, draft.facts);
  assert.deepEqual(result, { menu: ok });
});

test('文案只可引用商品名或已确认卖点中的配料', () => {
  const offer = {
    menu: { title: '为自己留杯咖啡', body: '精选烘焙豆与香醇牛奶融合，开启美好一天。' },
    social: { title: '欢迎来店小坐', body: '下班后，来店坐坐，留一点时间给自己。' },
  };
  assert.deepEqual(validatedCopy(offer, draft.facts), { social: offer.social });
  assert.deepEqual(validatedCopy(offer, draft.facts, { selling: '精选烘焙豆和牛奶' }), offer);
});

test('朋友圈退回冒充顾客评价的文案', () => {
  const social = { title: '来北山坐坐', body: '最近发现了一家特别棒的咖啡馆，环境很舒服。' };
  assert.deepEqual(validatedCopy({ social }, draft.facts), {});
});
