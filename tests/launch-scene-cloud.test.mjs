import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CLOUD_DOWN, CLOUD_NOTE, WORKER, absolute, cloudBase, cloudMessage, cloudPayload, parseCloudBody, sceneStyles } from '../docs/launch/cloud.mjs';
import { defaultPlacement, productRect, sceneLabel, scenes } from '../docs/launch/scenes.mjs';
import { aiCutout, colorMask } from '../docs/launch/cutout.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('线上 github.io 直连 Worker 绝对地址，本地走同源代理', () => {
  assert.equal(WORKER, 'https://cafe-brief.cafe-brief-web.workers.dev');
  const live = cloudBase({ hostname: 'luyujun74-creator.github.io', origin: 'https://luyujun74-creator.github.io' });
  assert.equal(live, WORKER + '/api');
  // Worker 只在 /api/* 下提供接口，线上地址必须保留 /api（曾因去掉 /api 导致 404）。
  assert.equal(absolute('/api/status', live), WORKER + '/api/status');
  assert.equal(absolute('/api/rendered-image?id=1', live), WORKER + '/api/rendered-image?id=1');
  assert.equal(cloudBase({ hostname: '127.0.0.1', origin: 'http://127.0.0.1:8776' }), 'http://127.0.0.1:8776/api/cloud');
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
  // 只允许预加载首页本来就要用的核心小模块；换背景、抠图模型等重资源一律不得预加载。
  for (const [, href] of html.matchAll(/rel="(?:preload|modulepreload)" href="([^"]+)"/g)) {
    assert.doesNotMatch(href, /scene-panel|scenes|cutout|vendor|onnx|wasm|woff|\.(ttf|otf|eot|jpe?g|png|webp|avif)/i, href);
  }
  assert.doesNotMatch(app, /^import .*(scene-panel|scenes|cutout)\.mjs/m);
  assert.match(app, /import\('\.\/scene-panel\.mjs\?v=/);
  const panel = await read('../docs/launch/scene-panel.mjs');
  assert.match(panel, /智能裁切\+柔化边缘/);
  const cutout = await read('../docs/launch/cutout.mjs');
  assert.match(cutout, /STALL_MS = 15_000/);
});

// 模拟加载器：每 tick 毫秒报一次下载进度，共 steps 次后完成；推理耗时 inferMs。
function fakeLoader({ tick = 20, steps = 10, stallAfter = Infinity, inferMs = 5, sessionMs = 0, hangFirstSession = false } = {}) {
  const calls = { aborted: 0, sessions: 0, resets: 0 };
  let cached = null;
  return {
    calls,
    download(onBytes) {
      let timer;
      const promise = new Promise(resolve => {
        let n = 0;
        timer = setInterval(() => {
          if (n >= stallAfter) { if (calls.aborted) clearInterval(timer); return; }
          n++;
          onBytes(n * 1000, steps * 1000);
          if (n >= steps) { clearInterval(timer); resolve({ files: true }); }
        }, tick);
      });
      return { promise, release: () => {} };
    },
    abortDownload() { calls.aborted++; },
    session() {
      if (cached) return cached;
      calls.sessions++;
      cached = hangFirstSession && calls.sessions === 1
        ? new Promise(() => {})
        : new Promise(r => setTimeout(() => r({}), sessionMs));
      return cached;
    },
    resetSession() { calls.resets++; cached = null; },
    infer: () => new Promise(r => setTimeout(() => r('mask'), inferMs)),
  };
}

test('AI 抠图：下载持续有进度时，超过总时长也不超时', async () => {
  const seen = [];
  // 下载约 400ms，远超 totalMs=150ms；但每 20ms 有进度，不该被判停或超时。
  const result = await aiCutout(null, { stallMs: 80, totalMs: 150, loader: fakeLoader({ tick: 20, steps: 20 }), onProgress: (r, t) => seen.push(t) });
  assert.equal(result.method, 'ai');
  assert.equal(result.mask, 'mask');
  assert.ok(seen.some(t => t.startsWith('下载 AI 抠图模型')));
});

test('AI 抠图：下载无进展超过停滞上限才放弃，并标明是下载阶段', async () => {
  const loader = fakeLoader({ tick: 20, steps: 20, stallAfter: 3 });
  await assert.rejects(aiCutout(null, { stallMs: 80, totalMs: 10_000, loader }), error => error.phase === 'download' && /没有进展/.test(error.message));
  assert.equal(loader.calls.aborted, 1);
});

test('AI 抠图：总时长只计下载完成后的启动与推理', async () => {
  const loader = fakeLoader({ tick: 10, steps: 3, inferMs: 400 });
  await assert.rejects(aiCutout(null, { stallMs: 10_000, totalMs: 120, loader }), error => error.phase === 'infer' && /超过/.test(error.message));
  assert.equal(loader.calls.aborted, 0);
});

test('换背景面板打开时空闲预取模型，首屏不预取', async () => {
  const panel = await read('../docs/launch/scene-panel.mjs');
  assert.match(panel, /prefetchCutoutModel\(\)/);
  assert.match(panel, /模型还在下载，可稍后再点 AI 精细抠图/);
  const cutout = await read('../docs/launch/cutout.mjs');
  assert.match(cutout, /requestIdleCallback/);
  const app = await read('../docs/launch/app.mjs');
  assert.doesNotMatch(app, /prefetchCutoutModel/);
});

test('AI 助手不平铺全部渠道文案：只展开选中作品，其余折叠', async () => {
  const app = await read('../docs/launch/app.mjs');
  assert.match(app, /其余 \$\{rest\.length\} 件/);
  assert.match(app, /work\.id === activeChannel/);
  assert.match(app, /ai-stream-more/);
});

test('AI 抠图：启动模型阶段没有进度事件，只要不到总时长就不判停', async () => {
  // 启动 300ms，远超 stallMs=80ms；总时长 1000ms 内完成，应成功。
  const loader = fakeLoader({ tick: 10, steps: 3, sessionMs: 300 });
  const result = await aiCutout(null, { stallMs: 80, totalMs: 1000, loader });
  assert.equal(result.method, 'ai');
  assert.equal(loader.calls.resets, 0);
});

test('AI 抠图：启动超时后丢弃挂起的会话，再点一次会新建并成功', async () => {
  const loader = fakeLoader({ tick: 10, steps: 3, hangFirstSession: true });
  await assert.rejects(aiCutout(null, { stallMs: 80, totalMs: 150, loader }), error => error.phase === 'infer' && /超过/.test(error.message));
  assert.equal(loader.calls.resets, 1);
  const result = await aiCutout(null, { stallMs: 80, totalMs: 1000, loader });
  assert.equal(result.method, 'ai');
  assert.equal(loader.calls.sessions, 2);
});
