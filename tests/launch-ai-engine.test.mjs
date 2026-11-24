import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  contrastRatio, fallbackPalette, firstQuestion, paletteFromPixels, parseInstruction, rewriteCandidates, safeCandidate,
  titleOverflow, toneCopy, tones,
} from '../docs/launch/ai-engine.mjs';
import { validatedCopy } from '../docs/launch/workflow.mjs';

const placeholder = '周五上青梅冷萃，28 元，仅限堂食，做柜台和朋友圈两版，清爽一点';
const facts = { name: '青梅冷萃', price: 2800, day: '周五', scope: 'store' };

test('一句话识别出商品、价格、日期、范围、渠道和语气', () => {
  const parsed = parseInstruction(placeholder);
  assert.deepEqual(parsed.facts, facts);
  assert.deepEqual(parsed.channels, ['poster', 'social']);
  assert.equal(parsed.tone, 'fresh');
  assert.equal(firstQuestion(parsed.facts), null);
});

test('其他常见写法：外卖、自由语序、多个日期', () => {
  const delivery = parseInstruction('周六上桂花拿铁，26 元，堂食和外卖都上，温暖一点');
  assert.equal(delivery.facts.name, '桂花拿铁');
  assert.equal(delivery.facts.scope, 'all');
  assert.equal(delivery.tone, 'warm');
  const loose = parseInstruction('冬季热可可，22 元');
  assert.equal(loose.facts.name, '冬季热可可');
  assert.equal(loose.facts.price, 2200);
  assert.deepEqual(firstQuestion(loose.facts), ['day', '哪天开始上新？']);
  assert.equal(parseInstruction('11月28日至12月5日上新桂花拿铁，26 元').ambiguous.day, true);
});

test('只有照片没有商品名时先问「这款商品叫什么？」', () => {
  const parsed = parseInstruction('帮我做一张海报');
  assert.equal(parsed.facts.name, '');
  assert.deepEqual(firstQuestion(parsed.facts), ['name', '这款商品叫什么？']);
});

test('四种语气的整套文案都通过事实校验，不写价格日期', () => {
  for (const tone of Object.keys(tones)) {
    const copy = toneCopy(facts, tone);
    assert.ok(Object.keys(copy).length >= 4, tone + ' 至少覆盖堂食的 4 个渠道');
    assert.deepEqual(copy, validatedCopy(copy, facts), tone + ' 二次校验不丢句子');
    for (const { title, body } of Object.values(copy)) assert.ok(safeCandidate(title) && safeCandidate(body), title + body);
  }
});

test('改写给出两种安全写法，并响应「更短」「更活泼」「换一批」', () => {
  const base = rewriteCandidates({ text: '青梅冷萃', kind: 'title', facts, baseId: 'poster' });
  assert.deepEqual(base.map(item => item.label), ['简洁直给', '轻松亲切']);
  assert.ok(base.every(item => item.text && safeCandidate(item.text) && item.text !== '青梅冷萃'));
  const shorter = rewriteCandidates({ text: '青梅冷萃新品上架欢迎来店里尝一尝', kind: 'title', facts, baseId: 'banner', mode: 'shorter' });
  assert.ok(shorter.every(item => [...item.text].length <= 9), JSON.stringify(shorter));
  const livelier = rewriteCandidates({ text: '青梅冷萃', kind: 'title', facts, mode: 'livelier' });
  assert.ok(livelier.some(item => /[！!]/.test(item.text)));
  const again = rewriteCandidates({ text: '青梅冷萃', kind: 'title', facts, seed: 1 });
  assert.notDeepEqual(again.map(item => item.text), base.map(item => item.text));
  const body = rewriteCandidates({ text: '入口清透，适合配一段轻松时光。', kind: 'body', facts });
  assert.equal(body.length, 2);
  assert.ok(body.every(item => !/\d|元|周/.test(item.text)));
});

test('从像素取色：两套配色文字对比度达标，无像素时返回 null 走高对比兜底', () => {
  const pixels = new Uint8ClampedArray(4 * 64);
  for (let i = 0; i < 64; i++) pixels.set(i < 40 ? [120, 170, 70, 255] : [250, 250, 245, 255], i * 4);
  const result = paletteFromPixels(pixels);
  assert.equal(result.match.label, '原片同色');
  assert.equal(result.contrast.label, '高对比');
  for (const option of [result.match, result.contrast]) assert.ok(contrastRatio(option.ink, option.paper) >= 4.5, JSON.stringify(option));
  assert.equal(paletteFromPixels(new Uint8ClampedArray(16)), null);
  assert.ok(contrastRatio(fallbackPalette.ink, fallbackPalette.paper) >= 7);
});

test('标题超出只按渠道上限判断', () => {
  assert.equal(titleOverflow('青梅冷萃', 'banner'), false);
  assert.equal(titleOverflow('青梅冷萃清爽上新快来尝', 'banner'), true);
  assert.equal(titleOverflow('青梅冷萃清爽上新快来尝', 'poster'), false);
});

test('工作台页面：左侧工具栏、AI 输入框、示例兜底和失败文案都在', async () => {
  const html = await readFile(new URL('../docs/launch/index.html', import.meta.url), 'utf8');
  assert.match(html, /localStorage\.getItem\('cafe-brief:rail'\)/);
  assert.match(html, /id="railToggle"[^>]*aria-expanded=/);
  for (const tool of ['upload', 'ai', 'template', 'text', 'channels', 'export', 'recent']) assert.match(html, new RegExp(`data-tool="${tool}"`));
  assert.match(html, /id="aiPrompt"[^>]*placeholder="周五上青梅冷萃，28 元，仅限堂食，做柜台和朋友圈两版，清爽一点"/);
  assert.match(html, />试用拿铁示例</);
  assert.match(html, />直接使用文字示例</);
  assert.match(html, /AI 文案暂不可用，照片和版式已保留/);
  assert.match(html, />自己写标题</);
  assert.match(html, />重试文案</);
  assert.match(html, /标题已更新，请与当前版本对比后再应用/);
  for (const step of ['detect', 'write', 'layout', 'render']) assert.match(html, new RegExp(`data-step="${step}"`));
  assert.doesNotMatch(html, /加载中/);
});

test('示例照片不再 4 秒超时就报错，失败时改用示意插画', async () => {
  const app = await readFile(new URL('../docs/launch/app.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /AbortSignal\.timeout\(4000\)/);
  assert.match(app, /示例照片加载较慢，已改用示意插画继续生成/);
  assert.doesNotMatch(app, /加载中/);
});

test('所有模块与样式使用同一个版本号，避免新旧缓存混用', async () => {
  const dir = new URL('../docs/launch/', import.meta.url);
  const versions = new Set();
  for (const file of await readdir(dir)) {
    if (!/\.(mjs|html)$/.test(file)) continue;
    const text = await readFile(new URL(file, dir), 'utf8');
    for (const [, spec] of text.matchAll(/(?:from |import\(|src=|href=)['"](\.{1,2}\/[^'"]+\.(?:mjs|css))(\?v=\d+)?['"]/g)) {
      const version = text.slice(text.indexOf(spec) + spec.length).match(/^\?v=(\d+)/)?.[1];
      assert.ok(version, `${file} 引用 ${spec} 缺少版本号`);
      versions.add(version);
    }
  }
  assert.equal(versions.size, 1, [...versions].join(','));
});
