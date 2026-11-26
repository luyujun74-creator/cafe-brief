import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLOUD_DOWN, CLOUD_NOTE, WORKER, absolute, cloudBase, cloudMessage, cloudPayload, parseCloudBody, sceneStyles } from '../docs/launch/cloud.mjs';
import { defaultPlacement, productRect, sceneLabel, scenes } from '../docs/launch/scenes.mjs';
import { colorMask } from '../docs/launch/cutout.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('线上 github.io 直连 Worker 绝对地址，本地走同源代理', () => {
  assert.equal(WORKER, 'https://cafe-brief.cafe-brief-web.workers.dev');
  assert.equal(cloudBase({ hostname: 'luyujun74-creator.github.io', origin: 'https://luyujun74-creator.github.io' }), WORKER);
  assert.equal(cloudBase({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:8776' }), 'http://127.0.0.1:8776/api/cloud');
  assert.equal(absolute('/api/status', WORKER), WORKER + '/status');
  assert.equal(absolute('/api/rendered-image?id=1', 'http://127.0.0.1:8776/api/cloud'), 'http://127.0.0.1:8776/api/cloud/rendered-image?id=1');
  assert.equal(absolute('https://x.dev/a.png', WORKER), 'https://x.dev/a.png');
});

test('Cloudflare 网络标注文案与不可用提示一字不差', async () => {
  assert.equal(CLOUD_NOTE, '在线 AI 生图经 Cloudflare 云接口，需在非中国大陆网络下使用');
  assert.equal(CLOUD_DOWN, '在线生图不可用（需非中国大陆网络）· 本地功能照常');
  const html = await read('../docs/launch/index.html');
  assert.ok(html.split(CLOUD_NOTE).length - 1 >= 2, 'AI 面板与换背景面板都要有标注');
  assert.match(cloudMessage('NETWORK'), /非中国大陆网络/);
});

test('Worker 先发心跳空格再发 JSON，错误放在 200 正文里也能识别', () => {
  assert.deepEqual(parseCloudBody('   \n {"scene_url":"/api/rendered-image?id=a","remaining":2}'), { scene_url: '/api/rendered-image?id=a', remaining: 2 });
  assert.throws(() => parseCloudBody('  {"code":"QUOTA_EXCEEDED","error":"x"}'), error => error.code === 'QUOTA_EXCEEDED' && /解锁密码/.test(error.message));
  assert.throws(() => parseCloudBody('<html>', 502), error => error.code === 'MODEL_FAILED');
  assert.throws(() => parseCloudBody('{"code":"RATE_LIMIT","error":"x"}', 429), error => error.code === 'RATE_LIMIT');
  for (const code of ['QUOTA_EXCEEDED', 'TIMEOUT', 'ABORTED', 'MODEL_FAILED', 'whatever']) assert.ok(cloudMessage(code).length > 4);
});

test('生图请求把价格从分换成元，风格限长，并带请求编号', () => {
  const body = cloudPayload({ name: ' 冰奶油拿铁 ', price: 2850 }, { brand: '街角咖啡', selling: '现萃', offer: '' }, 'data:image/jpeg;base64,AA==', '清晨窗边自然光');
  assert.equal(body.product, '冰奶油拿铁');
  assert.equal(body.price, '28.50');
  assert.equal(cloudPayload({ name: 'a', price: 2800 }).price, '28');
  assert.equal(body.platform, 'shop', 'Worker 要求 platform 为 shop 或 meituan');
  assert.equal(body.shop, '街角咖啡');
  assert.equal(body.offer, undefined);
  assert.match(body.requestId, /^cb_/);
  assert.ok(body.style.length <= 24);
  assert.deepEqual(sceneStyles.slice(0, 4).map(s => s.label), ['清晨窗边', '咖啡馆吧台', '秋日户外', '节日氛围']);
});

test('换背景提供 6 个本地场景，商品默认站在台面上且不超出画面', () => {
  assert.deepEqual(scenes.map(s => s.label), ['木吧台', '窗边晨光', '大理石台面', '绿植角落', '街角露台', '纯色影棚']);
  for (const scene of scenes) {
    const place = defaultPlacement({ kind: 'preset', id: scene.id });
    assert.ok(place.y > scene.floor && place.y <= .95, scene.label);
    for (const [w, h] of [[1080, 1080], [1080, 1920], [1920, 1080], [800, 600]]) {
      const rect = productRect(w, h, { width: 900, height: 600 }, place);
      assert.ok(rect.width <= w * .94 + 1e-6 && rect.top >= -1, `${scene.label} ${w}x${h}`);
    }
  }
  assert.equal(sceneLabel({ kind: 'ai' }), '豆包 AI 场景');
  assert.equal(sceneLabel({ kind: 'upload' }), '自选背景图');
  assert.equal(sceneLabel({ kind: 'preset', id: 'wood' }), '木吧台');
});

test('纯色背景上的商品可用颜色法抠出，背景被识别', () => {
  const w = 40;
  const h = 40;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inside = Math.hypot(x - 20, y - 22) < 11;
    data.set(inside ? [92, 58, 34, 255] : [244, 242, 238, 255], i);
  }
  const result = colorMask(data, w, h);
  assert.equal(result.usable, true);
});

test('换背景与 AI 抠图模型按需加载，首屏不引入', async () => {
  const html = await read('../docs/launch/index.html');
  const app = await read('../docs/launch/app.mjs');
  assert.doesNotMatch(html, /(src|href)="[^"]*(scene-panel|scenes|cutout|u2netp|onnx|vendor)[^"]*"/);
  assert.doesNotMatch(html, /rel="(preload|modulepreload)"/);
  assert.doesNotMatch(app, /^import .*(scene-panel|scenes|cutout)\.mjs/m);
  assert.match(app, /import\('\.\/scene-panel\.mjs\?v=/);
  const panel = await read('../docs/launch/scene-panel.mjs');
  assert.match(panel, /智能裁切\+柔化边缘/);
  const cutout = await read('../docs/launch/cutout.mjs');
  assert.match(cutout, /STALL_MS = 15_000/);
});
