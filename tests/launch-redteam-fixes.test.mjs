// 阶段 3 红队评审打回项的回归测试：P0-1 草稿换背景、P0-2 右侧面板遮挡、P1-1 启动期点击被吞等。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const body = (source, signature) => {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const end = source.indexOf('\n}\n', start);
  return source.slice(start, end);
};

test('P0-1 回首页清掉上一份草稿的合成图；继续编辑先重建合成图再显示画布', async () => {
  const app = await read('../docs/launch/app.mjs');
  const home = body(app, 'async function goHome()');
  assert.match(home, /scenePic = null;/);
  assert.match(home, /sceneHistory\.length = 0;/);
  assert.match(home, /sceneTools\?\.reset\(\);/);
  const resume = body(app, 'async function resumeDraft(');
  const rebuild = resume.indexOf('await rebuildScenePicture();');
  assert.ok(rebuild > 0, '继续编辑必须重建换背景合成图');
  assert.ok(resume.indexOf('scenePic = null;') < rebuild, '先丢掉内存里上一份草稿的合成图，避免串图');
  assert.ok(rebuild < resume.indexOf('show(stage);'), '合成图要在显示画布之前就绪');
  // 导出与画布共用 pictureFor → sceneApplies，合成图就绪即导出合成图。
  assert.match(app, /const pictureFor = channel => sceneApplies\(channel\) \? scenePic : \$\('photoPreview'\);/);
});

test('P1-4 回首页关掉工具面板；等待态的换背景要关闭画布上的实时预览', async () => {
  const app = await read('../docs/launch/app.mjs');
  const home = body(app, 'async function goHome()');
  assert.match(home, /openTool = null;\s*renderTool\(\);/);
  const tool = body(app, 'function renderTool()');
  assert.match(tool, /if \(openTool !== 'scene' \|\| waiting\) sceneTools\?\.close\(\);/);
});

test('P0-2 右侧面板：就绪卡与三标签不 sticky、不靠未定义变量；只有内容区滚动', async () => {
  const css = await read('../docs/launch/workbench.css');
  assert.doesNotMatch(css, /--ready-h/);
  const rule = selector => {
    const match = css.match(new RegExp('^' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm'));
    assert.ok(match, selector);
    return match[1];
  };
  assert.match(rule('.ai-panel'), /overflow: hidden/);
  assert.match(rule('.ai-panel > :not(.pane)'), /flex: none/);
  const pane = rule('.ai-panel > .pane');
  assert.match(pane, /min-height: 0/);
  assert.match(pane, /overflow: auto/);
  assert.doesNotMatch(rule('.ready-card'), /sticky/);
  assert.doesNotMatch(rule('.panel-tabs'), /sticky/);
  // 手机抽屉同理：外层不滚，内容区滚。
  assert.match(css, /\.ai-panel \{ position: fixed;[^}]*overflow: hidden;/);
});

test('P1-5 导出就绪卡只用一句话列出还差的项，不再铺一排胶囊；生成完成后步骤收成一行', async () => {
  const app = await read('../docs/launch/app.mjs');
  const ready = body(app, 'function renderReady()');
  assert.match(ready, /还差 \$\{left\.length\} 项：\$\{left\.map\(step => step\.short\)\.join\('、'\)\}/);
  assert.match(ready, /\$\('readySteps'\)\.hidden = true;/);
  assert.match(app, /\$\('aiRun'\)\.dataset\.collapsed = 'true';/);
  const css = await read('../docs/launch/workbench.css');
  assert.match(css, /\.ai-run\[data-collapsed="true"\] :is\(\.ai-steps, \.fact-chips\) \{ display: none; \}/);
});

// 从 index.html 取出早期点击拦截脚本，在模拟 DOM 里跑一遍。
async function earlyScript() {
  const html = await read('../docs/launch/index.html');
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(code => code.includes('__cbEarly'));
  assert.ok(script, '需要早期点击拦截脚本');
  return script;
}
function fakePage() {
  const listeners = [];
  const button = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const outside = {};
  const window = {};
  const document = {
    documentElement: { dataset: {} },
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture }); },
  };
  const click = target => {
    const event = {
      target: { closest: selector => (selector === '#intake button' && target === button ? button : null) },
      prevented: false, stopped: false,
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const l of listeners) if (l.type === 'click') l.fn(event);
    return event;
  };
  return { window, document, listeners, button, outside, click };
}

test('P1-1 工作台就绪前点首页按钮：点击被接住并记下，就绪后不再拦截', async () => {
  const page = fakePage();
  vm.runInNewContext(await earlyScript(), { window: page.window, document: page.document });
  assert.equal(page.listeners[0].capture, true, '捕获阶段拦截，早于任何按钮自身的处理');
  const early = page.click(page.button);
  assert.equal(early.prevented && early.stopped, true);
  assert.equal(page.window.__cbEarly, page.button);
  assert.equal(page.button.attrs['aria-busy'], 'true');
  assert.equal(page.document.documentElement.dataset.booting, 'true');
  const other = page.click(page.outside);
  assert.equal(other.prevented, false, '首页以外的点击不受影响');
  page.window.__cbReady = true;
  const late = page.click(page.button);
  assert.equal(late.prevented, false, '就绪后交给正常处理');
});

test('P1-1 启动不再锁住首页；就绪后补执行被接住的点击；核心模块预加载', async () => {
  const app = await read('../docs/launch/app.mjs');
  const boot = app.slice(app.lastIndexOf('void refreshStatus();') - 200);
  assert.doesNotMatch(boot, /setBusy\(true\)/, '启动读取草稿时不能把 #intake 设成 inert');
  assert.match(boot, /finally \{\s*replayEarlyClick\(\);\s*\}/);
  const replay = body(app, 'function replayEarlyClick()');
  assert.match(replay, /window\.__cbReady = true;/);
  assert.match(replay, /draft\.stage === 'intake'[^\n]*button\.click\(\)/);
  const html = await read('../docs/launch/index.html');
  const preloads = [...html.matchAll(/rel="modulepreload" href="\.\.\/launch\/([\w-]+)\.mjs\?v=/g)].map(m => m[1]);
  for (const name of ['workflow', 'media', 'works', 'canvas-board', 'storage', 'landing', 'ai-engine', 'cloud']) assert.ok(preloads.includes(name), name);
  // 预加载的每个核心模块都必须是 app.mjs 静态依赖链上的，且版本号与入口一致。
  const version = html.match(/app\.mjs\?v=(\d+)/)[1];
  for (const [, v] of html.matchAll(/rel="modulepreload" href="[^"]+\?v=(\d+)"/g)) assert.equal(v, version);
});

test('P1-2 手机：面板链接打开抽屉；主按钮、缩放钮、品牌链接触控区 ≥44px；底栏不截断', async () => {
  const app = await read('../docs/launch/app.mjs');
  assert.match(app, /querySelector\('\.jump'\)\.addEventListener\('click', event => \{\s*event\.preventDefault\(\);\s*openDrawer\(true\);/);
  const css = await read('../docs/launch/workbench.css');
  const mobile = css.slice(css.lastIndexOf('@media (max-width: 760px)'));
  assert.match(mobile, /\.ai-go, \.brand \{ min-height: var\(--hit-touch\); \}/);
  assert.match(mobile, /\.canvas-zoom button \{ min-width: var\(--hit-touch\); \}/);
  assert.match(mobile, /\.tile-caption \.move \{ display: none; \}/);
  const html = await read('../docs/launch/index.html');
  for (const [, label] of html.matchAll(/data-tool="\w+"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span class="rail-label">([^<]+)<\/span>/g)) assert.ok(!label.includes("/") && label.length <= 5, label);
});

test('P1-3 豆包不可达：顶栏只留一条提示、状态字用警示色、方位写对、重试有反馈', async () => {
  const app = await read('../docs/launch/app.mjs');
  const render = body(app, 'function renderCloud()');
  assert.match(render, /\$\('cloudHint'\)\.hidden = !cloud\.ok && !cloud\.pending;/);
  assert.match(render, /\$\('aiSceneQuota'\)\.dataset\.state = status\.dataset\.state;/);
  assert.doesNotMatch(app, /下方本地场景/);
  assert.match(app, /上方 6 个本地场景可直接使用/);
  assert.match(app, /正在重新检测云接口连接…/);
  const css = await read('../docs/launch/workbench.css');
  assert.match(css, /#aiSceneQuota\[data-state="down"\] \{ color: #A6531B; \}/);
  assert.doesNotMatch(css, /#aiSceneQuota \{ color: var\(--brand\)/);
});


// 执行生产函数而不是只匹配源码：A 有背景、B 没背景，画布与导出共用的选图必须隔离。
test('P0-1 执行 A 草稿恢复→回首页→B 草稿恢复，合成图与导出选图不串用', async () => {
  const source = await read('../docs/launch/app.mjs');
  const extract = signature => body(source, signature) + '\n}';
  const nodes = new Map();
  const context = vm.createContext({
    busy: false, draft: {}, scenePic: { stale: true }, sceneHistory: ['stale'],
    openTool: 'recent', runShown: false, activeChannel: 'shop', lastChannel: 'shop',
    $: id => { if (!nodes.has(id)) nodes.set(id, {}); return nodes.get(id); },
    finishRemoval: async () => {}, continueStage: () => 'review', remember() {},
    persist(value) { context.draft = value; }, canvas: { restore() {} },
    sceneTools: { reset() {} }, emptyDraft: () => ({ stage: 'intake' }),
    closeRewrite() {}, renderTool() {}, showPhoto: async () => {},
    // 合成模块以轻量替身返回，保持 resumeDraft 与 pictureFor 的生产路径。
    rebuildScenePicture: async () => { context.scenePic = context.draft.scene ? { composite: context.draft.scene.label } : null; },
    show(stage) { context.shown = { stage, picture: context.scenePic }; },
  });
  vm.runInContext(extract('async function resumeDraft(') + '\n' + extract('async function goHome()') + '\n' +
    source.slice(source.indexOf('const sceneApplies ='), source.indexOf('function sceneNote(')), context);
  context.savedA = { productId: 'A', scene: { label: '窗边晨光', applyTo: 'all' } };
  await vm.runInContext("resumeDraft('current', savedA)", context);
  assert.equal(context.shown.picture.composite, '窗边晨光');
  assert.equal(vm.runInContext("pictureFor({id:'shop'}).composite", context), '窗边晨光', '导出必须选合成图');
  await vm.runInContext('goHome()', context);
  assert.equal(context.scenePic, null);
  assert.equal(context.sceneHistory.length, 0);
  await vm.runInContext("resumeDraft('current', {productId:'B'})", context);
  assert.equal(context.shown.picture, null);
  assert.equal(vm.runInContext("pictureFor({id:'shop'})", context), nodes.get('photoPreview'), 'B 必须使用自己的原片');
});

test('P1-1 实际补执行函数只重放一次早期点击', async () => {
  const app = await read('../docs/launch/app.mjs');
  let count = 0;
  const button = { isConnected: true, disabled: false, removeAttribute() {}, click() { count++; } };
  const context = vm.createContext({ window: { __cbEarly: button }, document: { documentElement: { dataset: { booting: 'true' } } }, draft: { stage: 'intake' } });
  vm.runInContext(body(app, 'function replayEarlyClick()') + '\n}', context);
  vm.runInContext('replayEarlyClick(); replayEarlyClick();', context);
  assert.equal(count, 1);
  assert.equal(context.window.__cbReady, true);
  assert.equal(context.document.documentElement.dataset.booting, undefined);
});

// 重探的异步窗口必须锁住两个入口，程序化重复调用也不能开始生图。
test('P1-B 云接口慢重探期间锁住两个按钮，重复调用不生图，结束后允许再试', async () => {
  const source = await read('../docs/launch/app.mjs');
  const nodes = new Map();
  let release, probes = 0, generated = 0;
  const context = vm.createContext({
    cloud: { ok: false, pending: false }, sceneJob: null,
    draft: { photo: { type: 'image/jpeg' }, stage: 'review' },
    CLOUD_DOWN: '不可用', CLOUD_NOTE: '网络说明',
    $: id => {
      if (!nodes.has(id)) nodes.set(id, { dataset: {}, lastChild: { textContent: '' } });
      return nodes.get(id);
    },
    cloudStatus: () => { probes++; return new Promise(resolve => { release = resolve; }); },
    cloudMessage: code => code,
    base64Photo: async () => { generated++; return ''; },
  });
  for (const signature of ['function quotaText()', 'function renderCloud()', 'async function probeCloud(', 'async function runAiScene()']) {
    vm.runInContext(body(source, signature) + '\n}', context);
  }
  const first = vm.runInContext('runAiScene()', context);
  assert.equal(probes, 1);
  for (const id of ['aiSceneGo', 'aiSceneFromAi']) assert.equal(nodes.get(id).disabled, true, id + ' 在重探期间应保持禁用');
  await vm.runInContext('runAiScene()', context);
  assert.equal(probes, 1, '重复调用不能另开探测');
  assert.equal(generated, 0, '探测未完成不得生成');
  release({ ok: false, configured: true, code: 'NETWORK' });
  await first;
  for (const id of ['aiSceneGo', 'aiSceneFromAi']) assert.equal(nodes.get(id).disabled, false, '失败后允许重试');
  const next = vm.runInContext('runAiScene()', context);
  assert.equal(probes, 2);
  release({ ok: false, configured: true, code: 'NETWORK' });
  await next;
});
