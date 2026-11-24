import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { continueStage, draftSummary, prunable, recentDrafts, resumeStage } from '../docs/launch/landing.mjs';

const stored = { productId: 'p1', stage: 'review', photo: {}, facts: { name: '冰奶油拿铁', price: 2800, day: '周五', scope: 'store' } };

test('新打开链接一律落在首页，不回到上次停留的画布', () => {
  assert.equal(resumeStage({ navigationType: 'navigate', sessionProductId: 'p1', stored }), null);
  assert.equal(resumeStage({ navigationType: 'navigate', sessionProductId: null, stored }), null);
  assert.equal(resumeStage({ navigationType: 'reload', sessionProductId: null, stored }), null, '新标签页没有会话记录');
  assert.equal(resumeStage({ navigationType: 'reload', sessionProductId: 'other', stored }), null, '会话记的是另一份草稿');
  assert.equal(resumeStage({ navigationType: 'reload', sessionProductId: 'p1', stored: undefined }), null);
});

test('同一标签页刷新保留当前位置，旧版「当前草稿」页改回画布', () => {
  assert.equal(resumeStage({ navigationType: 'reload', sessionProductId: 'p1', stored }), 'review');
  assert.equal(resumeStage({ navigationType: 'back_forward', sessionProductId: 'p1', stored: { ...stored, stage: 'facts' } }), 'facts');
  assert.equal(resumeStage({ navigationType: 'reload', sessionProductId: 'p1', stored: { ...stored, stage: 'workspace' } }), 'review');
  assert.equal(continueStage({ stage: 'workspace' }), 'review');
  assert.equal(continueStage({ stage: 'intake', photo: {} }), 'facts');
  assert.equal(continueStage({ stage: 'intake', photo: null }), 'intake');
  assert.equal(continueStage({ stage: 'unknown' }), 'intake');
});

test('最近草稿只列有照片的本机草稿，排除正在编辑的一份，按更新时间倒序', () => {
  const entries = [
    { key: 'current', draft: { ...stored, updatedAt: 3 } },
    { key: 'archive:p2', draft: { productId: 'p2', photo: {}, updatedAt: 5 } },
    { key: 'archive:p3', draft: { productId: 'p3', photo: null, updatedAt: 9 } },
    { key: 'archive:p4', draft: { productId: 'p4', photo: {}, updatedAt: 1 } },
    { key: 'other', draft: { productId: 'p5', photo: {}, updatedAt: 99 } },
  ];
  assert.deepEqual(recentDrafts(entries, null).map(entry => entry.key), ['archive:p2', 'current', 'archive:p4']);
  assert.deepEqual(recentDrafts(entries, 'p1').map(entry => entry.key), ['archive:p2', 'archive:p4']);
  assert.deepEqual(recentDrafts(entries, null, 1).map(entry => entry.key), ['archive:p2']);
});

test('归档超过上限时只清理最旧的草稿', () => {
  const archived = [1, 7, 3, 9, 5, 2, 8].map(updatedAt => ({ productId: 'p' + updatedAt, updatedAt }));
  assert.deepEqual(prunable(archived, 5).map(item => item.updatedAt), [2, 1]);
  assert.deepEqual(prunable(archived.slice(0, 3), 5), []);
});

test('草稿卡片显示商品、价格、日期、范围和所处阶段', () => {
  const now = new Date(2026, 10, 24, 15, 0).getTime();
  const today = new Date(2026, 10, 24, 14, 5).getTime();
  assert.deepEqual(draftSummary({ ...stored, updatedAt: today }, now), {
    title: '冰奶油拿铁', facts: '¥28 · 周五 · 仅限堂食', meta: '创作画布 · 今天 14:05',
  });
  const earlier = draftSummary({ stage: 'facts', photoName: '桂花拿铁.jpg', facts: { name: '', price: null, day: '', scope: '' },
    updatedAt: new Date(2026, 10, 20, 9, 30).getTime() }, now);
  assert.equal(earlier.title, '桂花拿铁');
  assert.equal(earlier.facts, '商品信息待补充');
  assert.equal(earlier.meta, '核对信息 · 11 月 20 日 09:30');
});

test('首页结构：上传入口在前，最近草稿带删除和撤销，旧「当前草稿」页与单草稿弹窗移除', async () => {
  const html = await readFile(new URL('../docs/launch/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../docs/launch/app.mjs', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="photo"') < html.indexOf('id="recent"'), '上传入口先于最近草稿');
  assert.ok(html.indexOf('id="sample"') < html.indexOf('id="recent"'));
  assert.match(html, /<section id="recent"[^>]*hidden/);
  assert.match(html, /id="undoDraftDelete" type="button" hidden>撤销</);
  assert.match(html, /id="recentStatus" role="status"/);
  assert.doesNotMatch(html, /id="workspace"|id="newDraft"|继续编辑当前画布/);
  assert.match(app, /'删除草稿'/);
  assert.match(app, /UNDO_MS/);
  assert.match(html, /app\.mjs\?v=\d+/, '模块带版本号，避免线上缓存混用新旧代码');
});
