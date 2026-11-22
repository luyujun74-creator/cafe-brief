import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFacts, channels, channelCopy, editCopy, modelChange, normalizeFacts, ruleChange, ruleFacts, noteAmbiguities, staleEvidence } from '../docs/launch/workflow.mjs';

const facts = { name: '桂花冷萃', price: 2850, day: '周五', scope: 'store' };
const draft = { facts, revision: 1, edits: {}, choices: {} };

test('堂食跳过外卖，全部渠道带商户确认的共享事实', () => {
  assert.equal(channels(facts).length, 4);
  assert.equal(channels({ ...facts, scope: 'all' }).length, 5);
  for (const channel of channels(facts)) {
    assert.match(channelCopy(draft, channel), /桂花冷萃.*¥28.50.*周五/s);
  }
});

test('变更只在应用后生效，保留手改并锁定旧事实', () => {
  const custom = editCopy(draft, 'social', '周五来店，28.50 元。');
  const patch = ruleChange('改成 26.50 元，周六再上', facts);
  assert.deepEqual(patch, { price: 2650, day: '周六' });
  assert.equal(custom.facts.price, 2850);
  const next = applyFacts(custom, patch);
  assert.equal(next.revision, 3);
  assert.equal(next.edits.social.text, '周五来店，28.50 元。');
  assert.deepEqual(staleEvidence(next.edits.social, next.edits.social.text, next.facts), ['¥28.50', '周五']);
  assert.deepEqual(staleEvidence(next.edits.social, '周六来店，26.50 元。', next.facts), []);
  assert.match(channelCopy(next, channels(facts)[0]), /¥26.50.*周六/s);
});

test('拦截错误金额、含糊变更及误匹配金额', () => {
  assert.deepEqual(normalizeFacts({ name: '  咖啡  ', price: -50, day: 5, scope: 'unknown' }), { name: '咖啡', price: null, day: '', scope: '' });
  assert.equal(ruleChange('先不改为 26 元', facts), null);
  assert.equal(ruleChange('降 2 元', facts), null);
  assert.equal(ruleChange('改成 26.555 元', facts), null);
  assert.deepEqual(staleEvidence({ history: [{ ...facts, price: 2800 }] }, '128元', { ...facts, price: 2600 }), []);
});

test('第二次改动及撤销仍保留独立手改和待核对来源', () => {
  const hand = editCopy(draft, 'social', '周五来店，¥28.50。');
  const second = applyFacts(applyFacts(hand, { price: 2600 }), { day: '周六' });
  assert.deepEqual(staleEvidence(second.edits.social, second.edits.social.text, second.facts), ['¥28.50', '周五']);
  assert.deepEqual(staleEvidence(second.edits.social, second.edits.social.text, facts), []);
});

test('未保存的渠道文案随共享事实改动保存校验历史', () => {
  const copy = '星期五来店，售价28.50。';
  const editing = { ...draft, copyBuffers: { social: { text: copy, history: [] } } };
  const next = applyFacts(applyFacts(editing, { price: 2600 }), { day: '周六' });
  assert.equal(next.copyBuffers.social.text, copy);
  assert.deepEqual(staleEvidence(next.copyBuffers.social, copy, next.facts), ['¥28.50', '周五']);
});

test('明确标价和星期别名也能定位旧事实', () => {
  const edit = { history: [facts] };
  assert.deepEqual(staleEvidence(edit, '售价28.5，星期五来店。', { ...facts, price: 2600, day: '周六' }), ['¥28.50', '周五']);
  assert.deepEqual(staleEvidence(edit, '星期五来店。', { ...facts, day: '下周五' }), ['周五']);
  assert.deepEqual(staleEvidence(edit, '下星期五来店。', { ...facts, day: '下周五' }), []);
  const calendar = { history: [{ ...facts, day: '2026-11-05' }] };
  assert.deepEqual(staleEvidence(calendar, '2026 年 11 月 5 日来店。', { ...facts, day: '2026-11-06' }), ['2026-11-05']);
});

test('备注给出多个价格、日期或互斥销售范围时等待确认', () => {
  const note = '商品名：云顶乌龙，¥28 或 32 元，周五或周六上新，仅限堂食还是堂食和外卖待定。';
  assert.deepEqual(noteAmbiguities(note), { price: true, day: true, scope: true });
  assert.deepEqual(ruleFacts(note), { name: '云顶乌龙', price: null, day: '', scope: '' });
});

test('模型只提供改动候选，保留原日期并用整数分计算差价', () => {
  const command = '把上新时间往后挪到下周一，售价比现在便宜 2 元。';
  assert.deepEqual(modelChange({ day: '周一', priceYuan: -2, deltaYuan: -2 }, command, facts), { day: '下周一', price: 2650 });
  assert.deepEqual(modelChange({ priceYuan: 20 }, '售价不改成 20 元', facts), {});
  assert.deepEqual(modelChange({ priceYuan: 32 }, '就卖 29.9 元一杯', facts), {});
});

test('画布可解析改名和开放外卖，手稿仍会拦截旧品名和范围', () => {
  const patched = ruleChange('商品名改成冰美式，开放外卖', facts);
  assert.deepEqual(patched, { name: '冰美式', scope: 'all' });
  const hand = editCopy(draft, 'poster', '仅限堂食，欢迎尝试桂花冷萃。', '桂花冷萃');
  const next = applyFacts(hand, patched);
  assert.equal(next.edits.poster.title, '桂花冷萃');
  assert.deepEqual(staleEvidence(next.edits.poster, next.edits.poster.text, next.facts), ['桂花冷萃', '仅限堂食']);
});

test('渠道成稿只接受通过检查的独立文案，模板与手改标题均可落地', async () => {
  const { validatedCopy, artworkTitle, channelLead } = await import('../docs/launch/workflow.mjs');
  const copy = validatedCopy({
    menu: '点单时见，给自己留一杯清凉。',
    poster: '点单时见，给自己留一杯清凉。',
    banner: '买一送一，每杯 9 元！',
    social: '周六有货，外卖已开通。',
  }, facts);
  assert.deepEqual(copy, { menu: '点单时见，给自己留一杯清凉。' });
  const model = { ...draft, generated: copy };
  assert.equal(channelLead(model, channels(facts)[0]), copy.menu);
  const edited = editCopy(model, 'menu', '坐下来喝一杯', '今日桂花有风');
  assert.equal(artworkTitle(edited, channels(facts)[0]), '今日桂花有风');
  assert.match(channelCopy(edited, channels(facts)[0]), /今日桂花有风\n\n坐下来喝一杯/);
});
