import {
  applyFacts, artworkTitle, channelLead, channels, editCopy, factLine, fields, money, normalizeBrand, normalizeFacts,
  generatedForFacts, ruleChange, ruleFacts, scopeLabel, staleEvidence,
} from './workflow.mjs?v=202611242';
import { art, getBlob, base64Photo, loadPhoto, packageAssets, shrinkPhoto } from './media.mjs?v=202611242';
import { works, duplicateWork, deleteWork, restoreWork } from './works.mjs?v=202611242';
import { mountCanvas } from './canvas-board.mjs?v=202611242';
import { listDrafts, loadDraft, openDraftStore, putBackDraft, removeDraft, saveDraft } from './storage.mjs?v=202611242';
import { SESSION_KEY, UNDO_MS, continueStage, draftSummary, recentDrafts, resumeStage } from './landing.mjs?v=202611242';
import {
  channelNames, fallbackPalette, firstQuestion, paletteFromPixels, parseInstruction, rewriteCandidates, titleLimit, titleOverflow, toneCopy, tones,
} from './ai-engine.mjs?v=202611242';
import { illustrationFile } from './illustration.mjs?v=202611242';

const $ = id => document.getElementById(id);
const formScope = () => $('factsForm').querySelector('input[name="scope"]:checked')?.value ?? '';
const emptyDraft = () => ({
  productId: crypto.randomUUID(), stage: 'intake', revision: 0, note: '', photo: null,
  facts: normalizeFacts(), sources: {}, edits: {}, choices: {}, command: '', unconfirmed: [],
});
let draft = emptyDraft();
let db;
let activeChannel;
let lastChannel;
let lastPreview;
let busy = false;
let saveNumber = 0;
let lastSavedToken = null;
let saveQueue = Promise.resolve();
let anotherTabSaved = false;
const mobile = matchMedia('(max-width: 760px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const stages = ['intake', 'facts', 'review'];
const currentWorks = () => works(draft);
const choices = id => currentWorks().find(channel => channel.id === id);
const sourceItem = { id: 'source', title: '商品原片' };
const canvasItems = () => [sourceItem, ...currentWorks()];
const pending = () => currentWorks().filter(c => draft.edits[c.id]?.pending);
const buffers = () => draft.copyBuffers ?? {};
const unconfirmed = () => draft.unconfirmed ?? [];
const allReady = () => Boolean(draft.photo && draft.revision > 0 && Object.values(draft.facts).every(Boolean) && !unconfirmed().length);
const valueText = (id, value) => id === 'price' ? money(value) : id === 'scope' ? scopeLabel(value) : value;
const notice = message => {
  const review = draft.stage === 'review';
  $('notice').textContent = review ? '' : message;
  $('reviewNotice').textContent = review ? message : '';
};

const canvas = mountCanvas({
  viewport: $('canvasViewport'),
  world: $('board'),
  controls: { out: $('zoomOut'), zoomIn: $('zoomIn'), fit: $('fitCanvas'), percent: $('zoomValue') },
  onCamera(camera) { if (draft.stage === 'review') persist({ ...draft, camera }); },
  onMove(id, point) { persist({ ...draft, positions: { ...draft.positions, [id]: point } }); },
});

function remember(productId) {
  try {
    if (productId) sessionStorage.setItem(SESSION_KEY, productId);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* 隐私模式下无会话存储时，刷新会回到首页。 */ }
}

function persist(next) {
  draft = { ...next, updatedAt: Date.now() };
  remember(draft.productId);
  if (!db) {
    $('saved').textContent = '浏览器存储不可用';
    return;
  }
  const number = ++saveNumber;
  const payload = { ...draft, saveToken: crypto.randomUUID() };
  $('saved').textContent = '正在保存';
  saveQueue = saveQueue.then(async () => {
    try {
      if (!anotherTabSaved) {
        anotherTabSaved = !(await saveDraft(db, payload, lastSavedToken));
        if (!anotherTabSaved) lastSavedToken = payload.saveToken;
      }
      if (number === saveNumber) $('saved').textContent = anotherTabSaved
        ? '另一标签页已保存。本页改动尚未保存，可先导出再刷新。' : '草稿已保存于本机浏览器';
    } catch {
      if (number === saveNumber) $('saved').textContent = '草稿保存失败，请先导出物料';
    }
  });
}

function show(stage, focus = true) {
  document.body.dataset.stage = stage;
  for (const id of stages) $(id).hidden = id !== stage;
  if (stage === 'intake') {
    $('resumeFirstDraft').hidden = !draft.photo || draft.stage !== 'facts';
    if (openTool !== 'recent') dockRecent(false);
  }
  syncRecentVisibility();
  if (stage === 'intake' || openTool === 'recent') void renderRecent();
  if (stage === 'facts') renderFacts();
  if (stage === 'review') {
    activeChannel = draft.focusedWork === undefined && mobile.matches ? currentWorks()[0]?.id ?? 'source' : draft.focusedWork;
    lastChannel = draft.lastWork;
    renderReview();
  }
  renderTool();
  if (focus) {
    notice('');
    $(stage + 'Title').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
}

function setBusy(value) {
  busy = value;
  for (const id of stages) {
    $(id).inert = value;
    $(id).setAttribute('aria-busy', String(value));
  }
  syncReview();
}

async function withProgress(message, execute, button) {
  if (busy) return;
  if (button) button.disabled = true;
  setBusy(true);
  const start = performance.now();
  notice(message);
  const timer = setInterval(() => notice(`${message}（已用时 ${Math.floor((performance.now() - start) / 1000)} 秒）`), 1000);
  try {
    return await execute();
  } catch (error) {
    notice(error.message);
  } finally {
    clearInterval(timer);
    setBusy(false);
    if (button) button.disabled = false;
  }
}

async function request(action, body, timeout = 68_000) {
  const response = await fetch('/api/launch/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  }).catch(error => { void refreshStatus(); throw error; });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '本机服务不可用，请重试。');
  const result = await response.json();
  if (result.source === 'rules' && result.reason) void refreshStatus();
  return result;
}

async function refreshStatus() {
  try {
    const response = await fetch('/api/launch/status', { signal: AbortSignal.timeout(2700) });
    if (!response.ok) throw new Error();
    const status = await response.json();
    modelReady = Boolean(status.available);
  } catch {
    modelReady = false;
  }
  setAiStatus();
}
// 顶栏 AI 状态：永远是明确的「就绪 / 生成中」，不会长时间停在等待态。
let modelReady = false;
function setAiStatus(text) {
  const status = $('modelStatus');
  status.lastChild.textContent = text ?? (modelReady ? 'AI 就绪 · 本机大模型' : 'AI 就绪');
  status.dataset.ready = text ? 'busy' : modelReady ? 'model' : 'local';
}

async function showPhoto() {
  const picture = $('photoPreview');
  picture.hidden = !draft.photo;
  $('clearPhoto').hidden = !draft.photo;
  if (draft.photo) {
    await loadPhoto(draft.photo, picture);
    $('photoState').textContent = draft.illustrated ? '示意插画 · 可换成实拍照' : (draft.photoName ?? '商品照片') + ' · 已载入';
  } else {
    picture.removeAttribute('src');
    $('photoState').textContent = '可拖入照片 · 不传也能出稿';
  }
}
$('clearPhoto').addEventListener('click', async () => {
  if (busy) return;
  persist({ ...draft, photo: null, photoName: '', illustrated: false });
  await showPhoto();
  $('photo').focus({ preventScroll: true });
});

async function acceptPhoto(file, note, illustrated = false) {
  const photo = await shrinkPhoto(file);
  persist({ ...draft, photo, photoName: file.name, illustrated, note: note ?? draft.note, paletteSuggest: null });
  if (note != null) $('aiPrompt').value = note;
  await showPhoto();
  notice('');
}

const submitPhoto = file => withProgress('正在读取商品照片', async () => {
  await acceptPhoto(file);
  if (draft.stage === 'facts') renderFacts();
  if (draft.stage === 'intake') {
    $('photoState').textContent = (draft.photoName ?? '商品照片') + ' · 已载入，再说一句商品名和价格';
    $('aiPrompt').focus({ preventScroll: true });
  }
});
$('photo').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await submitPhoto(file);
});
const carriesFiles = event => event.dataTransfer.types.includes('Files');
window.addEventListener('dragover', event => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = busy || $('productDialog').open ? 'none' : 'copy';
});
window.addEventListener('drop', event => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  if (busy || $('productDialog').open) return;
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (draft.stage === 'review') void replacePhoto(file);
  else void submitPhoto(file);
});

$('replacement').addEventListener('change', event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (draft.stage === 'review') void replacePhoto(file);
  else void submitPhoto(file);
});
async function replacePhoto(file) {
  await withProgress('正在读取新照片', async () => {
    await acceptPhoto(file);
    persist({ ...draft, revision: draft.revision + 1 });
    renderReview();
    notice('照片已替换，整套物料已更新。');
  });
}

// ———— 一句话生成整套：识别商品 → 写文案 → 排版 → 出图，每步显示真实进度与用时 ————
const wait = ms => new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : ms));
const allChannelIds = () => channels({ scope: 'all' }).map(channel => channel.id);
const announce = text => { $('announcer').textContent = text; };
let runToken = 0;
let runShown = false;

function stepState(id, state, detail = '') {
  const item = $('aiSteps').querySelector(`[data-step="${id}"]`);
  item.dataset.state = state;
  item.querySelector('small').textContent = detail;
}

function resetRun(label) {
  runShown = true;
  $('aiRun').hidden = false;
  $('aiRunLabel').textContent = label;
  $('aiRunTime').textContent = '';
  for (const item of $('aiSteps').children) stepState(item.dataset.step, 'pending');
  $('aiChips').replaceChildren();
  $('aiStream').replaceChildren();
  $('aiFallback').hidden = true;
  $('aiSuggest').hidden = true;
}

async function timedStep(id, work, minimum = 160) {
  stepState(id, 'active');
  const start = performance.now();
  const result = await work();
  const elapsed = performance.now() - start;
  if (elapsed < minimum) await wait(minimum - elapsed);
  stepState(id, result?.failed ? 'failed' : 'done', result?.detail ?? ((performance.now() - start) / 1000).toFixed(1) + ' 秒');
  return result;
}

function factChips(facts, plan, pendingChecks) {
  const wanted = plan.channels?.length ? plan.channels.map(id => channelNames[id]).join('、') : '全部渠道';
  const rows = [
    ['商品', facts.name], ['售价', facts.price == null ? '' : money(facts.price), 'price'], ['上新', facts.day, 'day'],
    ['范围', facts.scope ? scopeLabel(facts.scope) : '', 'scope'], ['渠道', wanted], ['语气', tones[plan.tone]?.label ?? '清爽'],
  ];
  return rows.map(([label, value, id]) => {
    const chip = document.createElement('span');
    const term = document.createElement('b');
    term.textContent = label;
    chip.append(term, (value || '待补充') + (id && pendingChecks.includes(id) ? ' · 待确认' : ''));
    if (!value || (id && pendingChecks.includes(id))) chip.dataset.missing = '';
    return chip;
  });
}

async function streamCopy() {
  const list = $('aiStream');
  list.replaceChildren();
  for (const work of currentWorks()) {
    const item = document.createElement('li');
    const label = document.createElement('small');
    label.textContent = work.title;
    const title = document.createElement('strong');
    title.textContent = artworkTitle(draft, work);
    const body = document.createElement('span');
    body.textContent = channelLead(draft, work);
    item.append(label, title, body);
    list.append(item);
    await wait(120);
  }
}

async function photoPalette() {
  try {
    if (new URLSearchParams(location.search).has('paletteFail')) throw new Error('取色失败');
    const image = $('photoPreview');
    if (!image.complete || !image.naturalWidth) await image.decode();
    const sample = document.createElement('canvas');
    sample.width = sample.height = 48;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, 48, 48);
    const result = paletteFromPixels(context.getImageData(0, 0, 48, 48).data);
    if (!result) throw new Error('没有可用像素');
    return { ok: true, base: result.base, options: [result.match, result.contrast] };
  } catch {
    return { ok: false, options: [fallbackPalette] };
  }
}

async function runPipeline(facts, plan, pendingChecks, { template = false } = {}) {
  if (busy) return;
  const token = ++runToken;
  const started = performance.now();
  const wanted = (plan.channels ?? []).filter(id => id !== 'delivery' || facts.scope === 'all');
  const removedWorks = wanted.length ? allChannelIds().filter(id => !wanted.includes(id)) : [];
  persist({
    ...draft, stage: 'review', facts, extracted: { ...facts }, plan, generated: {}, choices: {}, edits: {}, copyBuffers: {},
    removedWorks, planRemoved: removedWorks, variants: [], positions: {}, layers: {}, artSettings: {}, unconfirmed: pendingChecks, proposal: null,
    previousFacts: null, focusedWork: null, lastWork: null, paletteSuggest: null, ambiguous: null, revision: draft.revision + 1,
  });
  activeChannel = null;
  setAiStatus('AI 生成中');
  show('review', false);
  resetRun('AI 正在生成整套物料');
  for (const tile of $('board').children) tile.dataset.generating = '';
  setBusy(true);
  try {
    await timedStep('detect', async () => {
      $('aiChips').replaceChildren(...factChips(facts, plan, pendingChecks));
      return { detail: draft.illustrated ? '示意插画' : '已读取照片' };
    });
    $('aiStream').replaceChildren(...currentWorks().map(() => Object.assign(document.createElement('li'), { className: 'skeleton' })));
    const copy = await timedStep('write', async () => {
      if (template) return { generated: {}, detail: '使用模板' };
      try {
        const result = await compose(facts, draft.branding, plan.tone);
        return { ...result, detail: result.source === 'model' ? '本机大模型' : tones[plan.tone]?.label + '语气' };
      } catch {
        return { failed: true, generated: {}, detail: '暂不可用' };
      }
    }, 320);
    if (token !== runToken) return;
    persist({ ...draft, generated: copy.generated, copyReason: copy.failed ? 'AI 文案暂不可用' : copy.reason ?? (template ? '已选择模板' : '') });
    if (copy.failed) {
      $('aiStream').replaceChildren();
      $('aiFallback').hidden = false;
    }
    else await streamCopy();
    await timedStep('layout', async () => {
      const palette = await photoPalette();
      persist({ ...draft, paletteSuggest: palette });
      return { detail: currentWorks().length + ' 个尺寸' };
    });
    await timedStep('render', async () => {
      renderReview();
      canvas.fit();
      const tiles = [...$('board').children];
      for (const tile of tiles) tile.dataset.generating = '';
      for (const tile of tiles) {
        await wait(90);
        delete tile.dataset.generating;
      }
      return { detail: currentWorks().length + ' 件' };
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    $('aiRunLabel').textContent = copy.failed ? '版式已生成，文案待补' : `已生成 ${currentWorks().length} 件物料`;
    $('aiRunTime').textContent = '用时 ' + seconds + ' 秒';
    $('aiSuggest').hidden = false;
    announce(`${$('aiRunLabel').textContent}，用时 ${seconds} 秒。` + (pendingChecks.length ? '导出前请确认价格与日期。' : ''));
  } finally {
    for (const tile of $('board').children) delete tile.dataset.generating;
    setBusy(false);
    setAiStatus();
    canvas.reveal();
  }
}

async function generate(prompt) {
  if (busy) return;
  const text = prompt.trim();
  if (!text) {
    notice('先说一句：卖什么、多少钱、哪天上。也可以点下面的示例。');
    $('aiPrompt').focus();
    return;
  }
  const parsed = parseInstruction(text);
  const facts = normalizeFacts(parsed.facts);
  if (parsed.ambiguous.price) facts.price = null;
  if (parsed.ambiguous.day) facts.day = '';
  persist({ ...draft, note: text });
  if (!draft.photo || draft.illustrated) {
    try {
      await acceptPhoto(await illustrationFile(text), text, true);
    } catch {
      notice('浏览器无法生成示意图，请上传一张商品照片。');
      return;
    }
  }
  const plan = { channels: parsed.channels, tone: parsed.tone };
  const question = parsed.ambiguous.day ? 'day' : parsed.ambiguous.price ? 'price' : firstQuestion({ ...facts, scope: facts.scope || 'store' })?.[0];
  if (question) {
    persist({ ...draft, stage: 'facts', facts, extracted: { ...facts }, sources: {}, plan, ambiguous: parsed.ambiguous, extractionReason: null });
    show('facts');
    const field = question === 'scope' ? $('factsForm').querySelector('input[type=radio]') : $(question);
    field.focus({ preventScroll: true });
    return;
  }
  const pendingChecks = ['price', 'day', ...(facts.scope ? [] : ['scope'])];
  await runPipeline({ ...facts, scope: facts.scope || 'store' }, plan, pendingChecks);
}

$('aiForm').addEventListener('submit', event => {
  event.preventDefault();
  void generate($('aiPrompt').value);
});
$('aiPrompt').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('aiForm').requestSubmit();
  }
});
for (const chip of document.querySelectorAll('[data-prompt]')) chip.addEventListener('click', () => {
  if (busy) return;
  $('aiPrompt').value = chip.dataset.prompt;
  void generate(chip.dataset.prompt);
});

// 示例照片：悬停/聚焦时预取，6 秒没到就改用示意插画继续，不再卡在「signal timed out」。
const samplePrompt = '周五上冰奶油拿铁，28 元，仅限堂食，清爽一点。';
let samplePhoto = null;
function prefetchSample() {
  samplePhoto ??= fetch(new URL('../assets/sample-photo.webp', import.meta.url), { signal: AbortSignal.timeout(6000) })
    .then(response => { if (!response.ok) throw new Error('示例照片不可用'); return response.blob(); })
    .then(blob => new File([blob], '示例-冰奶油拿铁.webp', { type: blob.type || 'image/webp' }))
    .catch(() => { samplePhoto = null; return null; });
  return samplePhoto;
}
for (const type of ['pointerenter', 'focus', 'touchstart']) $('sample').addEventListener(type, () => void prefetchSample(), { passive: true });
$('sample').addEventListener('click', async () => {
  if (busy) return;
  $('sample').disabled = true;
  $('photoState').textContent = '正在载入示例照片…';
  try {
    const file = new URLSearchParams(location.search).has('sampleFail') ? null
      : await Promise.race([prefetchSample(), new Promise(resolve => setTimeout(() => resolve(null), 6000))]);
    if (file) await acceptPhoto(file, samplePrompt);
    else persist({ ...draft, photo: null, photoName: '', illustrated: false });
    $('aiPrompt').value = samplePrompt;
    await generate(samplePrompt);
    if (!file) notice('示例照片加载较慢，已改用示意插画继续生成，可随时换成实拍照。');
  } finally {
    $('sample').disabled = false;
  }
});
$('textSample').addEventListener('click', async () => {
  if (busy) return;
  const text = $('aiPrompt').placeholder;
  persist({ ...draft, photo: null, photoName: '', illustrated: false });
  $('aiPrompt').value = text;
  await generate(text);
});

$('writeOwn').addEventListener('click', () => {
  const first = currentWorks()[0];
  if (!first) return;
  openChannel(first.id, false);
  $('artTitle').focus();
});
$('retryCopy').addEventListener('click', async () => {
  const result = await withProgress('AI 正在重写文案', () => compose(draft.facts, draft.branding, draft.plan?.tone), $('retryCopy'));
  if (!result) {
    $('aiFallback').hidden = false;
    return;
  }
  persist({ ...draft, generated: result.generated, copyReason: result.reason ?? '', revision: draft.revision + 1 });
  $('aiFallback').hidden = true;
  stepState('write', 'done', '已重试');
  renderReview();
  await streamCopy();
  $('aiRunLabel').textContent = `已生成 ${currentWorks().length} 件物料`;
  notice('AI 文案已补上。');
});
$('openPalette').addEventListener('click', () => openToolPanel('template'));
$('openChannels').addEventListener('click', () => openToolPanel('channels'));

// ———— 价格与日期核对：AI 识别的售价和日期确认前不进入导出图 ————
const checkLabels = {
  price: () => ['售价 ' + money(draft.facts.price), '确认', '改价', 'editPrice'],
  day: () => ['上新 ' + draft.facts.day, '确认', '改日期', 'editDay'],
  scope: () => ['范围 ' + scopeLabel(draft.facts.scope) + '（默认）', '确认', '修改', 'editScope'],
};
function confirmFacts(ids) {
  persist({ ...draft, unconfirmed: unconfirmed().filter(id => !ids.includes(id)) });
  syncReview();
  if (!unconfirmed().length) notice('售价、日期和范围已确认，可以导出了。');
}
function renderFactCheck() {
  const list = unconfirmed();
  $('factCheck').hidden = draft.stage !== 'review' || !list.length;
  $('factCheckList').replaceChildren(...list.filter(id => checkLabels[id]).map(id => {
    const [label, ok, change, field] = checkLabels[id]();
    const row = document.createElement('li');
    const text = document.createElement('span');
    text.textContent = label;
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'primary';
    confirm.textContent = ok;
    confirm.setAttribute('aria-label', ok + label);
    confirm.addEventListener('click', () => confirmFacts([id]));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.textContent = change;
    edit.addEventListener('click', () => {
      $('editProduct').click();
      $(field).focus();
    });
    row.append(text, confirm, edit);
    return row;
  }));
}
$('confirmAll').addEventListener('click', () => confirmFacts(['price', 'day', 'scope']));

// ———— 左侧工具栏：一键收起/展开，状态记在本机 ————
const RAIL_KEY = 'cafe-brief:rail';
function syncRail() {
  const open = document.documentElement.dataset.rail !== 'collapsed';
  $('railToggle').setAttribute('aria-expanded', String(open));
  $('railToggle').querySelector('.rail-label').textContent = open ? '收起工具栏' : '展开工具栏';
  $('railToggle').setAttribute('aria-label', open ? '收起工具栏' : '展开工具栏');
}
$('railToggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.rail === 'collapsed' ? 'expanded' : 'collapsed';
  document.documentElement.dataset.rail = next;
  try { localStorage.setItem(RAIL_KEY, next); } catch { /* 无本机存储时仅本次有效。 */ }
  syncRail();
  setTimeout(() => canvas.fitIfAutomatic(), 220);
});
syncRail();

let openTool = null;
const toolTitles = { upload: '上传/商品', ai: 'AI 生成', template: '模板版式', text: '文字', channels: '渠道适配', export: '导出', recent: '最近草稿' };
const reviewTools = ['ai', 'template', 'text', 'channels', 'export'];
const recentHome = { parent: $('recent').parentElement, next: $('recent').nextElementSibling };

function dockRecent(inPanel) {
  const section = $('recent');
  if (inPanel && section.parentElement !== $('recentSlot')) $('recentSlot').append(section);
  if (!inPanel && section.parentElement === $('recentSlot')) recentHome.parent.insertBefore(section, recentHome.next);
}
function syncRecentVisibility() {
  const section = $('recent');
  section.hidden = section.parentElement === $('recentSlot') ? false : document.body.dataset.stage !== 'intake' || !section.dataset.filled;
}
function openToolPanel(name) {
  if (openTool !== name) toggleTool(name);
}
function toggleTool(name) {
  openTool = openTool === name || !name ? null : name;
  renderTool();
  if (openTool) $('toolTitle').focus({ preventScroll: true });
  setTimeout(() => canvas.fitIfAutomatic(), 220);
}
function renderTool() {
  const panel = $('toolPanel');
  panel.hidden = !openTool;
  document.body.dataset.tool = openTool ?? '';
  for (const button of document.querySelectorAll('.rail-item')) button.setAttribute('aria-pressed', String(button.dataset.tool === openTool));
  dockRecent(openTool === 'recent');
  syncRecentVisibility();
  if (!openTool) return;
  $('toolTitle').textContent = toolTitles[openTool];
  const waiting = reviewTools.includes(openTool) && draft.stage !== 'review';
  for (const section of panel.querySelectorAll('[data-panel]')) section.hidden = waiting || section.dataset.panel !== openTool;
  $('toolEmpty').hidden = !waiting;
  if (!waiting) renderToolBody();
}
function renderToolBody() {
  if (openTool === 'upload') renderUploadPanel();
  if (openTool === 'template') renderTemplatePanel();
  if (openTool === 'text') renderTextPanel();
  if (openTool === 'channels') renderChannelPanel();
  if (openTool === 'export') renderExportPanel();
  if (openTool === 'recent') void renderRecent();
}
for (const button of document.querySelectorAll('.rail-item')) button.addEventListener('click', () => toggleTool(button.dataset.tool));
$('closeTool').addEventListener('click', () => {
  const tool = openTool;
  toggleTool(null);
  document.querySelector(`.rail-item[data-tool="${tool}"]`)?.focus({ preventScroll: true });
});
$('toolPanel').addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  $('closeTool').click();
});

function renderUploadPanel() {
  const picture = $('toolPhoto');
  picture.hidden = !draft.photo;
  if (draft.photo) picture.src = $('photoPreview').src;
  const ready = draft.stage === 'review' && draft.facts.name;
  $('toolProduct').textContent = draft.facts.name || (draft.photo ? '未命名商品' : '还没有商品');
  $('toolFacts').textContent = ready ? factLine(draft.facts) + (draft.illustrated ? ' · 示意插画' : '')
    : draft.photo ? (draft.illustrated ? '示意插画，可换成实拍照' : '照片已载入') : '上传照片或在中间输入一句话';
  $('editProduct').hidden = draft.stage !== 'review';
}

// 模板版式：从商品照取主色，给出「原片同色」「高对比」两套可预览配色。
function paletteTargets() {
  return choices(activeChannel) ? [activeChannel] : currentWorks().map(work => work.id);
}
function setArtSettings(update) {
  const artSettings = { ...draft.artSettings };
  for (const id of paletteTargets()) artSettings[id] = update({ ...(artSettings[id] ?? {}) });
  persist({ ...draft, artSettings, revision: draft.revision + 1 });
  renderReview();
}
function renderTemplatePanel() {
  const suggest = draft.paletteSuggest;
  const target = choices(activeChannel) ?? currentWorks()[0];
  if (!target) return;
  if (!suggest) {
    $('paletteCards').replaceChildren();
    $('paletteStatus').textContent = '正在从商品照取色…';
    void photoPalette().then(palette => {
      persist({ ...draft, paletteSuggest: palette });
      if (openTool === 'template') renderTemplatePanel();
    });
    return;
  }
  const current = draft.artSettings?.[target.id] ?? {};
  $('paletteCards').replaceChildren(...suggest.options.map(option => {
    const card = document.createElement('article');
    card.className = 'palette-card';
    const active = current.palette?.paper === option.paper && current.palette?.ink === option.ink;
    if (active) card.dataset.active = '';
    const preview = art(target, draft.facts, $('photoPreview'), {
      ...artOptions(target, draft, true), settings: { ...current, style: '', palette: option },
    });
    const swatches = document.createElement('div');
    swatches.className = 'swatches';
    for (const color of [option.paper, option.ink, option.accent]) {
      const swatch = document.createElement('i');
      swatch.style.background = color;
      swatches.append(swatch);
    }
    const name = document.createElement('strong');
    name.textContent = option.label;
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = active ? '' : 'primary';
    apply.textContent = active ? '已应用' : '应用';
    apply.disabled = busy || Boolean(draft.proposal);
    apply.setAttribute('aria-label', `应用${option.label}配色到${choices(activeChannel) ? target.title : '整套'}`);
    apply.addEventListener('click', () => {
      setArtSettings(settings => ({ ...settings, style: '', palette: { paper: option.paper, ink: option.ink, accent: option.accent } }));
      $('paletteStatus').textContent = `已应用「${option.label}」配色，可随时换回原版。`;
    });
    card.append(preview, name, swatches, apply);
    return card;
  }));
  $('paletteStatus').textContent = suggest.ok ? `取自商品照主色 ${suggest.base}，预览为「${target.title}」。`
    : '没能从照片取色，先给你一版高对比配色，应用后仍可修改。';
  for (const button of $('styleCards').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(!current.palette && (current.style ?? '') === button.dataset.style));
    button.disabled = busy || Boolean(draft.proposal);
  }
}
for (const button of $('styleCards').querySelectorAll('button')) button.addEventListener('click', () => {
  if (busy || draft.proposal) return;
  setArtSettings(settings => {
    const next = { ...settings, style: button.dataset.style };
    delete next.palette;
    return next;
  });
});

// 文字：列出每件作品的标题和文案，点一下即可让 AI 改写。
function renderTextPanel() {
  $('textList').replaceChildren(...currentWorks().map(work => {
    const item = document.createElement('li');
    const head = document.createElement('div');
    head.className = 'row';
    const name = document.createElement('small');
    name.textContent = work.title;
    head.append(name);
    const title = document.createElement('strong');
    title.textContent = buffers()[work.id]?.title || artworkTitle(draft, work);
    const body = document.createElement('small');
    body.textContent = buffers()[work.id]?.text ?? draft.edits[work.id]?.text ?? channelLead(draft, work);
    const actions = document.createElement('div');
    actions.className = 'row';
    for (const [kind, label] of [['title', '改写标题'], ['body', '改写文案']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-button';
      button.textContent = label;
      button.setAttribute('aria-label', label + '：' + work.title);
      button.disabled = busy || Boolean(draft.proposal);
      button.addEventListener('click', () => {
        openChannel(work.id, false);
        if (mobile.matches) toggleTool(null);
        openRewrite(kind, true);
      });
      actions.append(button);
    }
    item.append(head, title, body, actions);
    return item;
  }));
}

// ———— 选区改写：两种写法并排比较，只替换选中部分，可撤销 ————
let rewriteState = null;
let rewriteUndo = null;
let lastField = 'title';
const rewriteField = kind => $(kind === 'title' ? 'artTitle' : 'copy');

function openRewrite(kind, whole = false) {
  const work = choices(activeChannel);
  if (!work || draft.proposal || busy) return;
  const field = rewriteField(kind);
  let start = whole ? 0 : field.selectionStart ?? 0;
  let end = whole ? field.value.length : field.selectionEnd ?? 0;
  if (start === end) [start, end] = [0, field.value.length];
  if (!field.value) field.value = kind === 'title' ? artworkTitle(draft, work) : channelLead(draft, work);
  if (end === 0) end = field.value.length;
  rewriteState = { kind, start, end, source: field.value.slice(start, end), fieldValue: field.value, channel: activeChannel, mode: '', seed: 0 };
  $('rewriteFloat').hidden = true;
  $('rewriteUndoRow').hidden = true;
  $('rewriteTitle').textContent = kind === 'title' ? '改写标题 · 比较两种写法' : '改写文案 · 比较两种写法';
  $('rewrite').hidden = false;
  renderRewrite();
  $('rewrite').scrollIntoView({ block: 'nearest' });
  $('rewriteOptions').querySelector('button')?.focus({ preventScroll: true });
}
function renderRewrite() {
  const state = rewriteState;
  if (!state) return;
  const work = choices(state.channel);
  const stale = rewriteField(state.kind).value !== state.fieldValue;
  $('rewriteSource').textContent = state.source;
  $('rewriteStale').hidden = !stale;
  $('rewriteStale').textContent = (state.kind === 'title' ? '标题' : '文案') + '已更新，请与当前版本对比后再应用';
  for (const chip of $('rewrite').querySelectorAll('[data-mode]')) chip.setAttribute('aria-pressed', String(chip.dataset.mode === state.mode));
  const candidates = rewriteCandidates({ text: state.source, kind: state.kind, facts: draft.facts, baseId: work.baseId ?? work.id, mode: state.mode, seed: state.seed });
  $('rewriteOptions').replaceChildren(...candidates.map(candidate => {
    const card = document.createElement('article');
    card.className = 'rewrite-option';
    const label = document.createElement('small');
    label.textContent = candidate.label;
    const text = document.createElement('p');
    text.textContent = candidate.text;
    const adopt = document.createElement('button');
    adopt.type = 'button';
    adopt.className = 'primary';
    adopt.textContent = '采用这版';
    adopt.disabled = stale;
    adopt.setAttribute('aria-label', '采用这版：' + candidate.text);
    adopt.addEventListener('click', () => adoptRewrite(candidate.text));
    card.append(label, text, adopt);
    return card;
  }));
  if (!candidates.length) $('rewriteOptions').textContent = '这句暂时想不出更好的写法，可以点「换一批」。';
}
function closeRewrite() {
  rewriteState = null;
  $('rewrite').hidden = true;
  $('rewriteFloat').hidden = true;
}
function adoptRewrite(text) {
  const state = rewriteState;
  if (!state || state.channel !== activeChannel) return;
  const field = rewriteField(state.kind);
  if (field.value !== state.fieldValue) {
    renderRewrite();
    return;
  }
  rewriteUndo = { channel: activeChannel, edit: draft.edits[activeChannel], buffer: buffers()[activeChannel], revision: draft.revision };
  field.value = field.value.slice(0, state.start) + text + field.value.slice(state.end);
  closeRewrite();
  bufferCopy();
  $('editCopy').requestSubmit();
  $('rewriteDone').textContent = `已采用「${text}」`;
  $('rewriteUndoRow').hidden = false;
  $('rewriteUndo').focus({ preventScroll: true });
}
$('rewriteUndo').addEventListener('click', () => {
  const previous = rewriteUndo;
  if (!previous || busy) return;
  const edits = { ...draft.edits };
  const copyBuffers = { ...buffers() };
  if (previous.edit) edits[previous.channel] = previous.edit;
  else delete edits[previous.channel];
  if (previous.buffer) copyBuffers[previous.channel] = previous.buffer;
  else delete copyBuffers[previous.channel];
  rewriteUndo = null;
  persist({ ...draft, edits, copyBuffers, revision: draft.revision + 1 });
  $('rewriteUndoRow').hidden = true;
  renderReview();
  $('detailStatus').textContent = '已撤销改写，恢复原来的写法。';
});
$('closeRewrite').addEventListener('click', () => {
  const kind = rewriteState?.kind ?? 'title';
  closeRewrite();
  rewriteField(kind).focus({ preventScroll: true });
});
for (const chip of $('rewrite').querySelectorAll('[data-mode]')) chip.addEventListener('click', () => {
  const state = rewriteState;
  if (!state) return;
  const field = rewriteField(state.kind);
  if (field.value !== state.fieldValue) Object.assign(state, { start: 0, end: field.value.length, source: field.value, fieldValue: field.value });
  if (chip.dataset.mode === 'again') state.seed += 1;
  else state.mode = state.mode === chip.dataset.mode ? '' : chip.dataset.mode;
  renderRewrite();
});
for (const button of document.querySelectorAll('[data-rewrite]')) button.addEventListener('click', () => openRewrite(button.dataset.rewrite));

function placeFloat(kind) {
  const field = rewriteField(kind);
  const float = $('rewriteFloat');
  if (field.readOnly || field.selectionStart === field.selectionEnd || document.activeElement !== field) {
    float.hidden = true;
    return;
  }
  lastField = kind;
  float.hidden = false;
  float.style.top = Math.max(0, field.offsetTop - float.offsetHeight - 4) + 'px';
  float.style.left = Math.max(0, field.offsetLeft + field.offsetWidth - float.offsetWidth) + 'px';
}
for (const kind of ['title', 'body']) {
  const field = rewriteField(kind);
  for (const type of ['select', 'mouseup', 'keyup']) field.addEventListener(type, () => placeFloat(kind));
  field.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement !== $('rewriteFloat')) $('rewriteFloat').hidden = true;
  }, 120));
  field.addEventListener('input', () => {
    $('rewriteFloat').hidden = true;
    if (rewriteState?.kind === kind) renderRewrite();
  });
}
$('rewriteFloat').addEventListener('pointerdown', event => event.preventDefault());
$('rewriteFloat').addEventListener('click', () => openRewrite(lastField));

// ———— 渠道适配：5 种尺寸逐个出缩略图，只有标题超长的版本提示缩短 ————
let channelRender = 0;
function shortTitleFor(work, title) {
  return rewriteCandidates({ text: title, kind: 'title', facts: draft.facts, baseId: work.baseId ?? work.id, mode: 'shorter' })
    .map(candidate => candidate.text).find(text => !titleOverflow(text, work.baseId ?? work.id)) ?? [...draft.facts.name].slice(0, titleLimit(work.baseId ?? work.id)).join('');
}
function renderChannelPanel() {
  const number = ++channelRender;
  const removed = draft.removedWorks ?? [];
  const list = channels({ scope: 'all' });
  let overflowCount = 0;
  const rows = list.map(work => {
    const available = work.id !== 'delivery' || draft.facts.scope === 'all';
    const included = available && !removed.includes(work.id);
    const row = document.createElement('li');
    if (!included) row.dataset.off = '';
    const thumb = document.createElement('div');
    thumb.className = 'channel-thumb';
    const info = document.createElement('div');
    info.className = 'channel-info';
    const label = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = included;
    box.disabled = !available || busy || Boolean(draft.proposal);
    box.addEventListener('change', () => toggleChannel(work.id, box.checked));
    label.append(box, work.title);
    const size = document.createElement('small');
    size.textContent = available ? `${work.width} × ${work.height}` : '仅限堂食，不做外卖图';
    info.append(label, size);
    row.append(thumb, info);
    const title = buffers()[work.id]?.title || artworkTitle(draft, work);
    if (included && titleOverflow(title, work.id)) {
      overflowCount++;
      const badge = document.createElement('span');
      badge.className = 'overflow-badge';
      badge.textContent = `标题超出 · ${[...title].length}/${titleLimit(work.id)} 字`;
      info.append(badge);
      const fix = document.createElement('div');
      fix.className = 'channel-fix';
      const shorten = document.createElement('button');
      shorten.type = 'button';
      shorten.textContent = 'AI 缩短标题';
      shorten.addEventListener('click', () => {
        const candidate = shortTitleFor(work, title);
        const text = document.createElement('span');
        text.textContent = '建议：' + candidate;
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'primary';
        apply.textContent = '应用';
        apply.addEventListener('click', () => {
          if (busy || draft.proposal) return;
          const body = buffers()[work.id]?.text ?? draft.edits[work.id]?.text ?? channelLead(draft, work);
          const copyBuffers = { ...buffers() };
          delete copyBuffers[work.id];
          persist({ ...editCopy(draft, work.id, body, candidate), copyBuffers });
          renderReview();
          $('channelStatus').textContent = `${work.title}标题已缩短为「${candidate}」。`;
        });
        fix.replaceChildren(text, apply);
        apply.focus();
      });
      fix.append(shorten);
      row.append(fix);
    }
    if (included) setTimeout(() => {
      if (number !== channelRender) return;
      thumb.replaceChildren(art(work, draft.facts, $('photoPreview'), artOptions(work, draft, true)));
    }, 80 * (list.indexOf(work) + 1));
    return row;
  });
  $('channelPanel').replaceChildren(...rows);
  const count = currentWorks().filter(work => !work.baseId || work.baseId === work.id).length;
  $('channelStatus').textContent = `已适配 ${count} 个尺寸` + (overflowCount ? `，${overflowCount} 个标题超出` : '，标题长度都合适') + '。';
}
function toggleChannel(id, on) {
  if (busy || draft.proposal) return;
  const removed = (draft.removedWorks ?? []).filter(item => item !== id);
  if (!on) {
    if (currentWorks().length <= 1) {
      $('channelStatus').textContent = '至少保留一个渠道。';
      renderChannelPanel();
      return;
    }
    removed.push(id);
  }
  if (activeChannel === id && !on) activeChannel = null;
  persist({ ...draft, removedWorks: removed, revision: draft.revision + 1, focusedWork: activeChannel });
  renderReview();
}

// ———— 导出：逐项核对后一次打包 ————
function renderExportPanel() {
  const checks = [
    [Boolean(draft.photo), draft.illustrated ? '使用示意插画（建议换成实拍照）' : '商品照片已载入', true],
    [!unconfirmed().includes('price'), draft.facts.price == null ? '售价待填写' : '售价 ' + money(draft.facts.price) + (unconfirmed().includes('price') ? ' 待确认' : ' 已确认')],
    [!unconfirmed().includes('day'), '上新日期' + (unconfirmed().includes('day') ? '待确认' : '已确认')],
    [!unconfirmed().includes('scope'), '销售范围' + (unconfirmed().includes('scope') ? '待确认' : '已确认')],
    [!pending().length, pending().length ? '有手改文案待核对' : '手改文案已核对'],
    [!Object.keys(buffers()).length, Object.keys(buffers()).length ? '有文案未保存' : '文案已保存'],
    [!draft.proposal, draft.proposal ? '有改动待应用或取消' : '没有待应用的改动'],
  ];
  $('exportChecks').replaceChildren(...checks.map(([ok, label]) => {
    const item = document.createElement('li');
    item.dataset.state = ok ? 'ok' : 'todo';
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    return item;
  }));
  $('exportAll').disabled = $('approve').disabled;
  $('exportAll').textContent = `打包整套 ZIP（${currentWorks().length} 件）`;
  if ($('exportAll').disabled && !$('exportStatus').textContent) $('exportStatus').textContent = '完成上面带「!」的项目后即可导出。';
}
$('exportAll').addEventListener('click', () => download(currentWorks(), text => { $('exportStatus').textContent = text; }));

// ———— AI 生成面板：换语气重新出候选，确认「应用到整套」后才改画布 ————
let regenTone = null;
let regenCandidate = null;
for (const chip of $('regenForm').querySelectorAll('[data-tone]')) chip.addEventListener('click', () => {
  regenTone = regenTone === chip.dataset.tone ? null : chip.dataset.tone;
  for (const other of $('regenForm').querySelectorAll('[data-tone]')) other.setAttribute('aria-pressed', String(other.dataset.tone === regenTone));
});
$('regenForm').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || draft.stage !== 'review') return;
  const text = $('regenPrompt').value.trim();
  const parsed = parseInstruction(text);
  const tone = regenTone ?? (text && tones[parsed.tone]?.words.test(text) ? parsed.tone : draft.plan?.tone ?? 'fresh');
  const generated = toneCopy(draft.facts, tone, draft.branding);
  regenCandidate = { generated, tone, channels: parsed.channels };
  $('regenTone').textContent = tones[tone].label + (parsed.channels.length ? ' · 仅' + parsed.channels.map(id => channelNames[id]).join('、') : '');
  const preview = { ...draft, generated };
  $('regenList').replaceChildren(...currentWorks().filter(work => !parsed.channels.length || parsed.channels.includes(work.baseId ?? work.id)).map(work => {
    const item = document.createElement('li');
    const label = document.createElement('small');
    label.textContent = work.title + (draft.edits[work.id] ? ' · 已手改，不会覆盖' : '');
    const title = document.createElement('strong');
    title.textContent = artworkTitle({ ...preview, edits: {} }, work);
    const body = document.createElement('span');
    body.textContent = channelLead(preview, work);
    item.append(label, title, body);
    return item;
  }));
  $('regenPreview').hidden = false;
  $('regenStatus').textContent = '候选只在这里预览，点「应用到整套」才会改画布。';
});
$('regenApply').addEventListener('click', () => {
  if (!regenCandidate || busy || draft.proposal) return;
  const { generated, tone, channels: wanted } = regenCandidate;
  const usable = wanted.filter(id => id !== 'delivery' || draft.facts.scope === 'all');
  const removedWorks = usable.length ? allChannelIds().filter(id => !usable.includes(id)) : draft.removedWorks;
  persist({ ...draft, generated, plan: { ...draft.plan, tone, channels: usable.length ? usable : draft.plan?.channels ?? [] }, removedWorks, choices: {}, revision: draft.revision + 1 });
  regenCandidate = null;
  $('regenPreview').hidden = true;
  renderReview();
  $('regenStatus').textContent = `已应用「${tones[tone].label}」文案到整套，手改过的文案保持不变。`;
});
$('regenDismiss').addEventListener('click', () => {
  regenCandidate = null;
  $('regenPreview').hidden = true;
  $('regenStatus').textContent = '';
});

$('resumeFirstDraft').addEventListener('click', () => {
  persist({ ...draft, stage: 'facts' });
  show('facts');
});

$('back').addEventListener('click', () => {
  persist({ ...draft, stage: 'intake' });
  show('intake');
});

function renderFacts() {
  const { facts, extractionReason } = draft;
  const ask = draft.ambiguous?.day ? ['day', '活动从哪天开始？'] : draft.ambiguous?.price ? ['price', '这款实际卖多少钱？']
    : firstQuestion(facts) ?? [null, '核对商品信息'];
  $('factsTitle').textContent = ask[1];
  $('factsTitle').dataset.field = ask[0] ?? '';
  const branding = normalizeBrand(draft.branding);
  $('brand').value = branding.brand;
  $('selling').value = branding.selling;
  $('offer').value = branding.offer;
  $('name').value = facts.name;
  $('price').value = facts.price == null ? '' : money(facts.price).slice(1);
  $('day').value = facts.day;
  for (const radio of $('factsForm').querySelectorAll('input[type=radio]')) radio.checked = facts.scope === radio.value;
  const poster = channels(draft.facts).find(item => item.id === 'poster');
  $('firstDraft').replaceChildren(art(poster, normalizeFacts(), $('photoPreview'), {
    thumbnail: true, title: '今日新品', provisional: true, settings: { style: 'editorial', cover: true },
  }));
  $('extractionSource').textContent = draft.ambiguous?.day ? '这句话里出现了多个日期。请填写开始日期，可写成「11月28日起至12月5日」。'
    : draft.ambiguous?.price ? '这句话里出现了多个价格，请填写实际售价。'
    : extractionReason ?? '已从你的描述里识别出下面的信息，补齐后 AI 继续生成。';
  updateFactHints();
}

function updateFactHints() {
  for (const [id, value] of Object.entries(draft.facts)) {
    $('source-' + id).textContent = !value ? '待补充' : draft.extracted?.[id] !== value ? '商户填写'
      : 'AI 从你的描述识别';
  }
  $('factPlan').textContent = draft.facts.scope
    ? channels(draft.facts).map(c => c.title).join('、') + (draft.facts.scope === 'store' ? '。仅限堂食，跳过外卖主图。' : '。')
    : '确认销售范围后确定渠道。';
}

function readFacts() {
  return normalizeFacts({
    name: $('name').value, price: Math.round(Number($('price').value) * 100),
    day: $('day').value, scope: formScope(),
  });
}

$('factsForm').addEventListener('input', event => {
  event.target.setCustomValidity?.('');
  persist({ ...draft, facts: readFacts(), branding: normalizeBrand({ brand: $('brand').value, selling: $('selling').value, offer: $('offer').value }) });
});
$('factsForm').addEventListener('change', updateFactHints);

$('factsForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const facts = readFacts();
  const missing = Object.keys(fields).find(id => !facts[id]);
  if (missing) {
    const field = missing === 'scope' ? $('factsForm').querySelector('input[type=radio]') : $(missing);
    field.setCustomValidity(missing === 'price' ? '请输入 0.01 至 9999.99 元。' : '请补充' + fields[missing] + '。');
    field.reportValidity();
    return;
  }
  const branding = normalizeBrand({ brand: $('brand').value, selling: $('selling').value, offer: $('offer').value });
  persist({ ...draft, branding, ambiguous: null });
  await runPipeline(facts, draft.plan ?? { channels: [], tone: 'fresh' }, [], { template: event.submitter?.id === 'template' });
});

// 写文案：本机大模型可用时先试（限时），否则或超时都用浏览器本地 AI 文案，结果一律经过事实校验。
let failOnce = new URLSearchParams(location.search).has('aiFail');
async function compose(facts, branding, tone = draft.plan?.tone ?? 'fresh', deadline = 6000) {
  if (failOnce) {
    failOnce = false;
    throw new Error('AI 文案暂不可用');
  }
  const local = toneCopy(facts, tone, branding);
  if (!modelReady) return { generated: local, source: 'local' };
  try {
    const result = await request('compose', { facts, branding }, deadline);
    const generated = { ...local, ...(result.generated ?? {}) };
    return { generated, source: Object.keys(result.generated ?? {}).length ? 'model' : 'local' };
  } catch {
    return { generated: local, source: 'local', reason: '本机大模型超时，已用本地 AI 文案' };
  }
}

$('editProduct').addEventListener('click', () => {
  const { name, price, day, scope } = draft.facts;
  const { brand, selling, offer } = normalizeBrand(draft.branding);
  $('editName').value = name;
  $('editPrice').value = money(price).slice(1);
  $('editDay').value = day;
  $('editScope').value = scope;
  $('editBrand').value = brand;
  $('editSelling').value = selling;
  $('editOffer').value = offer;
  $('productError').textContent = '';
  $('productDialog').showModal();
});
$('cancelProduct').addEventListener('click', () => $('productDialog').close());
$('productForm').addEventListener('submit', event => {
  event.preventDefault();
  const facts = normalizeFacts({ name: $('editName').value, price: Math.round(Number($('editPrice').value) * 100),
    day: $('editDay').value, scope: $('editScope').value });
  if (Object.values(facts).some(value => !value)) {
    $('productError').textContent = '请填写商品名、上新时间和 0.01 至 9999.99 元范围内的售价。';
    return;
  }
  const branding = normalizeBrand({ brand: $('editBrand').value, selling: $('editSelling').value, offer: $('editOffer').value });
  const patch = Object.fromEntries(Object.entries(facts).filter(([id, value]) => value !== draft.facts[id]));
  const brandChanged = Object.entries(branding).some(([id, value]) => value !== normalizeBrand(draft.branding)[id]);
  $('productDialog').close();
  if (!Object.keys(patch).length && !brandChanged) {
    if (unconfirmed().length) {
      persist({ ...draft, unconfirmed: [] });
      renderReview();
      notice('售价、日期和范围已确认，可以导出了。');
    }
    return;
  }
  const updated = Object.keys(patch).length ? applyFacts(draft, patch) : { ...draft, revision: draft.revision + 1 };
  persist({ ...updated, branding, proposal: null, unconfirmed: [], previousFacts: Object.keys(patch).length ? draft.facts : draft.previousFacts,
    generated: brandChanged ? {} : updated.generated, copyReason: brandChanged || patch.name || patch.scope ? '商品资料已更新' : draft.copyReason });
  renderReview();
  notice('商品资料已更新，可继续编辑当前作品。');
});
$('writeCopy').addEventListener('click', () => openTool === 'ai' ? $('regenPrompt').focus() : toggleTool('ai'));

function sourceImage() {
  const photo = document.createElement('img');
  photo.src = $('photoPreview').src;
  photo.alt = '商品原片';
  photo.draggable = false;
  return photo;
}

function renderReview() {
  const fixtures = currentWorks();
  const items = canvasItems();
  if (activeChannel && !items.some(item => item.id === activeChannel)) activeChannel = fixtures[0]?.id ?? 'source';
  if (lastChannel && !items.some(item => item.id === lastChannel)) lastChannel = activeChannel;
  const tiles = items.map(channel => {
    const tile = document.createElement('article');
    tile.className = 'tile';
    tile.dataset.channel = channel.id;
    tile.dataset.base = channel.baseId ?? channel.id;
    tile.style.setProperty('--level', draft.layers?.[channel.id] ?? 0);
    tile.dataset.conflict = String(Boolean(draft.edits[channel.id]?.pending));

    const artwork = document.createElement('button');
    artwork.type = 'button';
    artwork.className = 'tile-art';
    artwork.setAttribute('aria-label', '聚焦' + channel.title);
    artwork.addEventListener('click', () => openChannel(channel.id));

    const caption = document.createElement('div');
    caption.className = 'tile-caption';
    const title = document.createElement('strong');
    title.textContent = channel.title;
    const meta = document.createElement('small');
    if (channel.id === 'source') {
      artwork.append(sourceImage());
      meta.textContent = '上传照片';
    }
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'move';
    move.dataset.move = channel.id;
    move.textContent = '⠿';
    move.setAttribute('aria-label', '移动' + channel.title + '，可用方向键');
    caption.append(title, meta, move);
    tile.append(artwork, caption);
    return tile;
  });
  lastPreview = Symbol('new tiles');
  canvas.render(tiles, draft.positions);
  $('channelList').replaceChildren(...items.map(channel => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.focus = channel.id;
    button.textContent = channel.title;
    button.addEventListener('click', () => openChannel(channel.id, false));
    return button;
  }));
  renderMode();
  const list = Object.entries(fields).flatMap(([id, label]) => {
    const term = document.createElement('dt');
    const value = document.createElement('dd');
    term.textContent = label;
    value.textContent = valueText(id, draft.facts[id]);
    return [term, value];
  });
  $('factSummary').replaceChildren(...list);
  $('excluded').hidden = draft.facts.scope !== 'store';
  $('version').textContent = 'v' + draft.revision;
  const editedCount = fixtures.filter(c => draft.edits[c.id]).length;
  const modelCount = fixtures.filter(c => !draft.edits[c.id] && draft.generated?.[c.baseId ?? c.id]).length;
  const templateCount = fixtures.length - editedCount - modelCount;
  const summary = [
    `${fixtures.length} 件作品`,
    editedCount ? `${editedCount} 份手改文案` : '',
    modelCount ? `${modelCount} 份 AI 文案` : '',
    templateCount ? `${templateCount} 份本地模板` + (!modelCount && draft.copyReason ? '（' + draft.copyReason + '）' : '') : '',
  ];
  $('planSource').textContent = summary.filter(Boolean).join(' · ');
  if (activeChannel) renderDetail();
  $('command').value = draft.command;
  renderDiff();
  syncReview();
  if (openTool && openTool !== 'export' && openTool !== 'recent' && openTool !== 'ai') renderToolBody();
}

function syncReview() {
  const conflicts = pending();
  const unsaved = currentWorks().filter(c => c.id in buffers());
  const messages = [
    conflicts.length ? `待核对 ${conflicts.map(c => c.title).join('、')}的手改文案。` : '',
    unsaved.length ? `请保存 ${unsaved.map(c => c.title).join('、')}的文案再打包。` : '',
    unconfirmed().length ? `请先确认${unconfirmed().map(id => fields[id]).join('、')}，确认后才能导出。` : '',
  ].filter(Boolean);
  $('conflict').hidden = messages.length === 0;
  $('conflict').textContent = messages.join(' ');
  $('approve').disabled = busy || !allReady() || !currentWorks().length || messages.length > 0 || Boolean(draft.proposal);
  syncDetailExports();
  $('undo').hidden = !draft.previousFacts;
  $('canvasRecovery').hidden = !(draft.removedWorks ?? []).some(id => !(draft.planRemoved ?? []).includes(id));
  renderFactCheck();
  if (openTool === 'export') renderExportPanel();
}

function renderImpact() {
  const proposal = draft.proposal;
  if (lastPreview === proposal) return;
  lastPreview = proposal;
  const preview = previewDraft();
  for (const tile of $('board').children) {
    const channel = choices(tile.dataset.channel);
    if (!channel) continue;
    tile.dataset.impact = String(Boolean(proposal));
    tile.querySelector('.tile-art').replaceChildren(art(channel, preview.facts, $('photoPreview'), artOptions(channel, preview, true)));
    tile.querySelector('small').textContent = proposal
      ? Object.entries(proposal.patch).map(([id, value]) => valueText(id, draft.facts[id]) + ' → ' + valueText(id, value)).join(' · ')
      : draft.edits[channel.id]?.pending ? '待核对手改文案' : channel.width + ' × ' + channel.height;
  }
}

function renderDiff() {
  renderImpact();
  $('diff').hidden = !draft.proposal;
  if (!draft.proposal) return;
  $('diffList').replaceChildren(...Object.entries(draft.proposal.patch).map(([id, value]) => {
    const row = document.createElement('li');
    row.textContent = `${fields[id]} ${valueText(id, draft.facts[id])} → ${valueText(id, value)}`;
    return row;
  }));
  const affected = currentWorks();
  const count = affected.filter(c => draft.edits[c.id] || c.id in buffers()).length;
  const deliveryImpact = draft.proposal.patch.scope
    ? (draft.proposal.patch.scope === 'all' ? '新增外卖主图。' : '移除外卖主图。') : '';
  $('diffImpact').textContent = `更新 ${affected.length} 件物料。` + deliveryImpact +
    (count ? `${count} 件手改文案待核对。` : '') +
    (draft.proposal.source === 'model' ? ' 本机大模型已解析。' : ' AI 已解析。');
  $('apply').textContent = draft.proposal.patch.price != null ? '确认改价' : '应用到整套';
}

$('command').addEventListener('input', () => {
  persist({ ...draft, command: $('command').value, proposal: null });
  renderDiff();
  syncReview();
});
$('change').addEventListener('submit', async event => {
  event.preventDefault();
  const command = $('command').value.trim();
  const facts = draft.facts;
  let result = ruleChange(command, facts);
  let source = 'rules';
  if (!result) {
    const reply = await withProgress('AI 正在理解改动', async () => modelReady ? request('change', { facts, command }, 8000)
      : { patch: {}, source: 'rules', reason: '没有识别到明确改动' }, event.submitter);
    if (!reply) return;
    result = reply.patch;
    source = reply.source;
    if (!Object.keys(result).length && reply.reason) {
      notice(`${reply.reason}。请使用明确写法，例如「改成 26 元，周六再上」。`);
      return;
    }
  }
  if (!Object.keys(result).length) {
    notice('当前信息无需变更，或本次没有识别到明确改动。可写「改成 26 元，周六再上」。');
    return;
  }
  notice('');
  persist({ ...draft, proposal: { patch: result, source } });
  renderDiff();
  syncReview();
  $('apply').focus({ preventScroll: true });
});
$('dismiss').addEventListener('click', () => {
  persist({ ...draft, proposal: null });
  renderDiff();
  syncReview();
  $('command').focus();
});
$('apply').addEventListener('click', () => {
  if (busy || !draft.proposal) return;
  const updated = applyFacts(draft, draft.proposal.patch);
  const settled = Object.keys(draft.proposal.patch);
  persist({ ...updated, previousFacts: draft.facts, proposal: null, command: '', unconfirmed: unconfirmed().filter(id => !settled.includes(id)) });
  renderReview();
  notice(`已更新整套物料至 v${draft.revision}。`);
  $('undo').focus({ preventScroll: true });
});
$('undo').addEventListener('click', () => {
  if (busy || !draft.previousFacts) return;
  persist({ ...applyFacts(draft, draft.previousFacts), previousFacts: null, proposal: null });
  renderReview();
  notice(`已恢复上一版的商品事实，手改文案仍保留。当前 v${draft.revision}。`);
  $('command').focus({ preventScroll: true });
});

function detailExportBlocked() {
  return busy || !choices(activeChannel) || !allReady() ||
    Boolean(draft.edits[activeChannel]?.pending || draft.proposal || activeChannel in buffers());
}

function syncDetailExports() {
  const blocked = detailExportBlocked();
  $('downloadOne').disabled = blocked;
  $('downloadJpeg').disabled = blocked;
}

function detailEvidence(text) {
  const history = [
    ...(draft.edits[activeChannel]?.history ?? []),
    ...(buffers()[activeChannel]?.history ?? []),
  ];
  return staleEvidence({ history }, text, draft.facts);
}

function renderMode() {
  const focused = Boolean(activeChannel);
  $('canvasViewport').hidden = focused;
  $('canvasZoom').hidden = focused;
  $('canvasHelp').hidden = focused;
  $('focusView').hidden = !focused;
  $('focusControls').hidden = !focused;
  $('canvasMode').hidden = focused;
  $('jumpToWork').hidden = !focused || activeChannel === 'source';
  $('deleteWork').hidden = !focused || activeChannel === 'source';
  $('detail').hidden = !focused || activeChannel === 'source';
  $('sourceDetail').hidden = activeChannel !== 'source';
  $('projectActions').hidden = focused;
  $('aiRun').hidden = focused || !runShown;
  $('canvasOverview').setAttribute('aria-pressed', String(!focused));
  $('canvasFocus').setAttribute('aria-pressed', String(focused));
  for (const button of $('channelList').children) {
    button.setAttribute('aria-pressed', String(button.dataset.focus === activeChannel));
  }
}

function renderDetail() {
  syncDetailExports();
  const list = canvasItems();
  $('focusCount').textContent = `${list.findIndex(item => item.id === activeChannel) + 1} / ${list.length}`;
  if (activeChannel === 'source') {
    $('previewSlot').replaceChildren(sourceImage());
    $('sourceFilename').textContent = draft.photoName ?? '商品照片';
    return;
  }
  const channel = choices(activeChannel);
  const edit = draft.edits[activeChannel];
  const settings = draft.artSettings?.[activeChannel] ?? {};
  $('artStyle').value = settings.style ?? '';
  $('artScene').value = settings.scene ?? '';
  $('artCover').checked = Boolean(settings.cover);
  $('peekPhoto').setAttribute('aria-pressed','false');
  $('phonePreview').hidden = (channel.baseId ?? channel.id) !== 'delivery';
  const preview = previewDraft();
  const generated = preview.generated?.[channel.baseId ?? channel.id];
  $('copySource').textContent = edit ? '已手改' : generated ? 'AI 文案' : '本地模板';
  for (const id of ['duplicate','raiseWork','lowerWork','deleteWork','artStyle','artScene','artCover']) $(id).disabled = Boolean(draft.proposal);
  $('duplicate').disabled ||= (draft.variants?.length ?? 0) >= 24;
  $('detailTitle').textContent = channel.title;
  $('detailFacts').textContent = factLine(preview.facts) + (draft.proposal ? ' · 变更预览' : '');
  $('artTitle').value = buffers()[activeChannel]?.title ?? edit?.title ?? generated?.title ?? '';
  $('artTitle').readOnly = Boolean(draft.proposal);
  renderFocusedArt(channel, preview);
  $('copy').value = buffers()[activeChannel]?.text ?? edit?.text ?? channelLead(preview, channel);
  $('copy').readOnly = Boolean(draft.proposal);
  $('editCopy').querySelector('[type="submit"]').disabled = Boolean(draft.proposal);
  $('resetCopy').disabled = Boolean(draft.proposal);
  const evidence = detailEvidence([$('artTitle').value, $('copy').value].join('\n'));
  $('detailConflict').hidden = !edit?.pending && !evidence.length;
  $('detailConflict').textContent = evidence.length ? `原稿与当前资料冲突 ${evidence.join('、')}，修改后保存。` : '商品信息已更新，请核对手改文案。';
  $('detailStatus').textContent = draft.proposal ? '先回全景应用或取消变更，之后可编辑文案。' : '';
}

function openChannel(id, focus = true) {
  if (busy || (id !== 'source' && !choices(id))) return;
  lastChannel = activeChannel = id;
  persist({ ...draft, focusedWork: id, lastWork: id });
  renderMode();
  renderDetail();
  const view = $('focusView');
  view.classList.remove('is-entering');
  requestAnimationFrame(() => { if (activeChannel === id) view.classList.add('is-entering'); });
  const strip = $('channelList');
  const selected = strip.querySelector(`[data-focus="${id}"]`);
  if (selected) {
    const tile = selected.getBoundingClientRect();
    const visible = strip.getBoundingClientRect();
    strip.scrollLeft += Math.min(0, tile.left - visible.left) || Math.max(0, tile.right - visible.right);
  }
  if (focus) $(id === 'source' ? 'sourceTitle' : 'detailTitle').focus({ preventScroll: true });
}

function showOverview(returnFocus = false) {
  const previous = activeChannel;
  activeChannel = null;
  persist({ ...draft, focusedWork: null });
  renderMode();
  canvas.fitIfAutomatic();
  if (returnFocus) $('canvasOverview').focus({ preventScroll: true });
  else if (previous && document.activeElement?.closest('#detail')) $('canvasOverview').focus({ preventScroll: true });
}

function switchChannel(direction) {
  const list = canvasItems();
  const index = list.findIndex(c => c.id === activeChannel);
  const next = index < 0 ? (direction > 0 ? 0 : list.length - 1) : (index + direction + list.length) % list.length;
  openChannel(list[next].id, false);
}

$('canvasOverview').addEventListener('click', () => showOverview());
$('review').querySelector('.jump').addEventListener('click', () => {
  if (activeChannel) showOverview();
});
$('canvasFocus').addEventListener('click', () => openChannel(lastChannel ?? currentWorks()[0]?.id ?? 'source', false));
$('closeDetail').addEventListener('click', () => {
  showOverview(true);
  $('canvasOverview').scrollIntoView({ block: 'nearest' });
});
$('jumpToWork').addEventListener('click', () => {
  $('detail').scrollIntoView({ block: 'start' });
  $('detailTitle').focus({ preventScroll: true });
});
$('returnWorkspace').addEventListener('click', () => {
  persist({ ...draft, focusedWork: activeChannel ?? null });
  void goHome();
});
$('previousChannel').addEventListener('click', () => switchChannel(-1));
$('nextChannel').addEventListener('click', () => switchChannel(1));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeChannel && !$('productDialog').open && !busy) showOverview(true);
});
let swipe;
$('focusView').addEventListener('touchstart', event => {
  swipe = event.touches.length === 1 ? event.touches[0] : null;
}, { passive: true });
$('focusView').addEventListener('touchend', event => {
  if (!swipe || event.touches.length) { swipe = null; return; }
  const touch = event.changedTouches[0];
  const dx = touch.clientX - swipe.clientX;
  const dy = touch.clientY - swipe.clientY;
  swipe = null;
  if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.5) switchChannel(dx < 0 ? 1 : -1);
}, { passive: true });
$('focusView').addEventListener('touchcancel', () => { swipe = null; });
function previewDraft() {
  if (!draft.proposal) return draft;
  const facts = { ...draft.facts, ...draft.proposal.patch };
  return { ...draft, facts, generated: generatedForFacts(draft, facts) };
}

function artOptions(channel, version = draft, thumbnail = false) {
  return { thumbnail, branding: version.branding, title: artworkTitle(version, channel), settings: version.artSettings?.[channel.id] };
}
function renderFocusedArt(channel, version = draft) {
  const options = artOptions(channel, version);
  $('previewSlot').replaceChildren(art(channel, version.facts, $('photoPreview'), {
    ...options, title: $('artTitle').value.trim() || options.title,
  }));
}

function bufferCopy() {
  if (!activeChannel || draft.proposal) return;
  const buffer = { history: buffers()[activeChannel]?.history ?? [], text: $('copy').value, title: $('artTitle').value };
  persist({ ...draft, copyBuffers: { ...buffers(), [activeChannel]: buffer } });
  syncReview();
}
$('copy').addEventListener('input', bufferCopy);
$('artTitle').addEventListener('input', () => {
  bufferCopy();
  const channel = choices(activeChannel);
  if (channel) renderFocusedArt(channel);
});
function withoutBuffer() {
  const copyBuffers = { ...buffers() };
  delete copyBuffers[activeChannel];
  return copyBuffers;
}
$('editCopy').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !activeChannel || draft.proposal) return;
  const text = $('copy').value.trim();
  const title = $('artTitle').value.trim();
  const evidence = detailEvidence([title, text].join('\n'));
  if (!text || evidence.length) {
    $('detailStatus').textContent = text ? `还需核对 ${evidence.join('、')}，请改成当前信息。` : '请填写渠道文案。';
    $('copy').focus();
    return;
  }
  persist({ ...editCopy(draft, activeChannel, text, title), copyBuffers: withoutBuffer() });
  renderReview();
  $('detailStatus').textContent = '已保存当前渠道文案。';
});
$('resetCopy').addEventListener('click', () => {
  if (busy || !activeChannel || draft.proposal) return;
  const edits = { ...draft.edits };
  delete edits[activeChannel];
  persist({ ...draft, edits, copyBuffers: withoutBuffer(), revision: draft.revision + 1 });
  renderReview();
  $('detailStatus').textContent = '已恢复默认标题和文案。';
});

function selectedWork() {
  return !busy && !draft.proposal && choices(activeChannel);
}

$('duplicate').addEventListener('click', () => {
  if (!selectedWork() || (draft.variants?.length ?? 0) >= 24) return;
  const [next, id] = duplicateWork(draft, activeChannel, canvas.positionOf(activeChannel));
  persist(next);
  openChannel(id, false);
  renderReview();
});
$('deleteWork').addEventListener('click', () => {
  if (!selectedWork()) return;
  persist(deleteWork(draft, activeChannel));
  showOverview();
  renderReview();
  $('undoDelete').focus();
});
$('undoDelete').addEventListener('click', () => {
  const id = draft.removedWorks?.at(-1);
  if (busy || !id) return;
  persist(restoreWork(draft));
  renderReview();
  ($('channelList').querySelector(`[data-focus="${id}"]`) ?? $('canvasOverview')).focus({ preventScroll: true });
  notice('作品已恢复。');
});
for (const [id, direction] of [['raiseWork', 1], ['lowerWork', -1]]) $(id).addEventListener('click', () => {
  if (!selectedWork()) return;
  const layers = draft.layers ?? {};
  const edge = direction > 0 ? Math.max : Math.min;
  persist({ ...draft, layers: { ...layers, [activeChannel]: edge(0, ...Object.values(layers)) + direction } });
  renderReview();
});
for (const id of ['artStyle','artScene','artCover']) $(id).addEventListener('change', () => {
  if (!selectedWork()) return;
  const previous = draft.artSettings?.[activeChannel] ?? {};
  const settings = { ...previous, style: $('artStyle').value, scene: $('artScene').value, cover: $('artCover').checked };
  if (settings.style !== (previous.style ?? '')) delete settings.palette;
  persist({ ...draft, revision: draft.revision + 1, artSettings: { ...draft.artSettings, [activeChannel]: settings } });
  renderReview();
});
$('peekPhoto').addEventListener('click', () => {
  if (!choices(activeChannel)) return;
  const original = $('peekPhoto').getAttribute('aria-pressed') === 'true';
  $('peekPhoto').setAttribute('aria-pressed', String(!original));
  if (original) renderFocusedArt(choices(activeChannel), previewDraft());
  else $('previewSlot').replaceChildren(sourceImage());
});
$('phonePreview').addEventListener('click', () => {
  const work = choices(activeChannel);
  if ((work?.baseId ?? work?.id) !== 'delivery') return;
  $('phoneArt').replaceChildren(art(work, draft.facts, $('photoPreview'), artOptions(work, draft, true)));
  $('phoneProduct').textContent = draft.facts.name;
  $('phonePrice').textContent = money(draft.facts.price);
  $('phoneDialog').showModal();
});
$('downloadJpeg').addEventListener('click', async () => {
  if (detailExportBlocked()) return;
  const work = choices(activeChannel);
  setBusy(true);
  try {
    const image = art(work, draft.facts, $('photoPreview'), artOptions(work));
    saveBlob(await getBlob(image, .91), work.title + '.jpg');
    $('detailStatus').textContent = '已下载当前作品 JPG。';
  } catch {
    $('detailStatus').textContent = '图片下载失败，请重试。';
  } finally {
    setBusy(false);
  }
});
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function download(selected, feedback = notice) {
  if (busy || !allReady() || draft.proposal || selected.some(c => draft.edits[c.id]?.pending || c.id in buffers())) return;
  setBusy(true);
  const snapshot = draft;
  try {
    feedback('正在打包当前版本。');
    const blob = await packageAssets(snapshot, selected, $('photoPreview'));
    const name = snapshot.facts.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    saveBlob(blob, `CafeBrief_${name}${selected.length === 1 ? '_' + selected[0].title : ''}_v${snapshot.revision}.zip`);
    feedback(`已打包 v${snapshot.revision}，包含 ${selected.length} 个渠道的图片和中文文案。`);
  } catch {
    feedback('打包失败，请重试。');
  } finally {
    setBusy(false);
  }
}
$('approve').addEventListener('click', () => download(currentWorks()));
$('downloadOne').addEventListener('click', () => {
  if (detailExportBlocked()) return;
  void download([choices(activeChannel)], text => { $('detailStatus').textContent = text; });
});
$('restart').addEventListener('click', async () => {
  await goHome();
  $('photo').focus({ preventScroll: true });
});

// 回到工作室首页：当前作品已存在本机，作为「最近草稿」列在上传入口下方。
async function goHome() {
  draft = emptyDraft();
  remember(null);
  activeChannel = null;
  lastChannel = null;
  canvas.restore(null);
  $('aiPrompt').value = '';
  closeRewrite();
  runShown = false;
  $('aiRun').hidden = true;
  $('saved').textContent = '';
  await showPhoto();
  show('intake');
}

let recentRender = 0;
async function renderRecent() {
  const number = ++recentRender;
  const section = $('recent');
  let entries = [];
  if (db) {
    await saveQueue;
    entries = recentDrafts(await listDrafts(db).catch(() => []), draft.photo ? draft.productId : null);
  }
  if (number !== recentRender) return;
  for (const url of section.querySelectorAll('img')) URL.revokeObjectURL(url.src);
  $('recentList').replaceChildren(...entries.map(recentItem));
  section.dataset.filled = entries.length || pendingRemoval ? 'true' : '';
  syncRecentVisibility();
  $('recentEmpty').hidden = entries.length > 0;
}

function recentItem({ key, draft: saved }) {
  const summary = draftSummary(saved);
  const item = document.createElement('li');
  item.className = 'recent-item';
  item.dataset.key = key;
  const thumb = document.createElement('img');
  thumb.className = 'recent-thumb';
  thumb.alt = '';
  thumb.width = 48;
  thumb.height = 48;
  thumb.decoding = 'async';
  if (saved.photo instanceof Blob) thumb.src = URL.createObjectURL(saved.photo);
  const text = document.createElement('div');
  text.className = 'recent-text';
  const title = document.createElement('strong');
  title.textContent = summary.title;
  const facts = document.createElement('span');
  facts.textContent = summary.facts;
  const meta = document.createElement('small');
  meta.textContent = summary.meta;
  text.append(title, facts, meta);
  const actions = document.createElement('div');
  actions.className = 'row recent-actions';
  const resume = document.createElement('button');
  resume.type = 'button';
  resume.className = 'primary';
  resume.textContent = '继续编辑';
  resume.setAttribute('aria-label', '继续编辑：' + summary.title);
  resume.addEventListener('click', () => void resumeDraft(key, saved));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'recent-delete';
  remove.textContent = '删除草稿';
  remove.setAttribute('aria-label', '删除草稿：' + summary.title);
  remove.addEventListener('click', () => void deleteDraft(key, saved, summary.title));
  actions.append(resume, remove);
  item.append(thumb, text, actions);
  return item;
}

async function resumeDraft(key, saved) {
  if (busy) return;
  await finishRemoval();
  if (openTool === 'recent') openTool = null;
  runShown = false;
  const stage = continueStage(saved);
  if (key === 'current') {
    draft = saved;
    remember(saved.productId);
  } else {
    persist({ ...saved, stage });
  }
  draft = { ...draft, stage };
  canvas.restore(saved.camera ?? null);
  $('aiPrompt').value = draft.note ?? '';
  $('saved').textContent = '已打开本机草稿';
  await showPhoto();
  show(stage);
}

let pendingRemoval = null;
async function deleteDraft(key, saved, title) {
  if (busy || !db) return;
  await finishRemoval();
  await saveQueue;
  try {
    await removeDraft(db, key);
  } catch {
    $('recentStatus').textContent = '删除失败，请重试。';
    return;
  }
  if (key === 'current') lastSavedToken = null;
  pendingRemoval = { key, saved, timer: setTimeout(() => void finishRemoval(), UNDO_MS) };
  $('recentStatus').textContent = `已删除「${title}」草稿。`;
  $('undoDraftDelete').hidden = false;
  await renderRecent();
  $('undoDraftDelete').focus({ preventScroll: true });
}

async function finishRemoval() {
  if (!pendingRemoval) return;
  clearTimeout(pendingRemoval.timer);
  pendingRemoval = null;
  const hadFocus = document.activeElement === $('undoDraftDelete');
  $('undoDraftDelete').hidden = true;
  $('recentStatus').textContent = '';
  await renderRecent();
  if (hadFocus) ($('recent').hidden ? $('aiPrompt') : $('recentTitle')).focus({ preventScroll: true });
}

$('undoDraftDelete').addEventListener('click', async () => {
  if (!pendingRemoval || !db) return;
  const { key, saved, timer } = pendingRemoval;
  clearTimeout(timer);
  pendingRemoval = null;
  await saveQueue;
  const target = await putBackDraft(db, key, saved);
  if (target === 'current') lastSavedToken = saved.saveToken ?? null;
  $('undoDraftDelete').hidden = true;
  $('recentStatus').textContent = '已恢复草稿。';
  await renderRecent();
  $('recentList').querySelector('button')?.focus({ preventScroll: true });
});

setBusy(true);
void refreshStatus();
try {
  db = await openDraftStore();
  const restored = await loadDraft(db);
  lastSavedToken = restored?.saveToken ?? null;
  let sessionProductId = null;
  try { sessionProductId = sessionStorage.getItem(SESSION_KEY); } catch { /* 无会话存储时按新打开处理。 */ }
  const navigationType = performance.getEntriesByType('navigation')[0]?.type ?? 'navigate';
  const stage = resumeStage({ navigationType, sessionProductId, stored: restored });
  if (stage) {
    draft = { ...restored, stage };
    if (restored.camera) canvas.restore(restored.camera);
    $('saved').textContent = '已恢复本机草稿';
  } else {
    remember(null);
  }
  $('aiPrompt').value = draft.note ?? '';
  await showPhoto();
  show(draft.stage, false);
} catch {
  db = null;
  draft = emptyDraft();
  $('saved').textContent = '浏览器无法恢复草稿';
  await showPhoto();
  show('intake', false);
} finally {
  setBusy(false);
}
