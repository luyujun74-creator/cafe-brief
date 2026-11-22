import {
  applyFacts, channels, editCopy, factLine, fields, money, normalizeFacts,
  ruleChange, ruleFacts, scopeLabel, staleEvidence,
} from './workflow.mjs';
import { art, base64Photo, loadPhoto, packageAssets, shrinkPhoto } from './media.mjs';
import { mountCanvas } from './canvas-board.mjs';
import { loadDraft, openDraftStore, saveDraft } from './storage.mjs';

const $ = id => document.getElementById(id);
const formScope = () => $('factsForm').querySelector('input[name="scope"]:checked')?.value ?? '';
const emptyDraft = () => ({
  productId: crypto.randomUUID(), stage: 'intake', revision: 0, note: '', photo: null,
  facts: normalizeFacts(), sources: {}, edits: {}, choices: {}, command: '',
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
const stages = ['intake', 'facts', 'review'];
const choices = id => channels(draft.facts).find(channel => channel.id === id);
const sourceItem = { id: 'source', title: '商品原片' };
const canvasItems = () => [sourceItem, ...channels(draft.facts)];
const pending = () => channels(draft.facts).filter(c => draft.edits[c.id]?.pending);
const buffers = () => draft.copyBuffers ?? {};
const allReady = () => Boolean(draft.photo && draft.revision > 0 && Object.values(draft.facts).every(Boolean));
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
  onMove(id, point) { persist({ ...draft, positions: { ...draft.positions, [id]: point } }); },
});

function persist(next) {
  draft = next;
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
  for (const id of stages) {
    $(id).hidden = id !== stage;
    if (id === stage) $('step-' + id).setAttribute('aria-current', 'step');
    else $('step-' + id).removeAttribute('aria-current');
  }
  if (stage === 'intake' && document.readyState === 'complete' && !draft.photo) loadHero();
  if (stage === 'facts') renderFacts();
  if (stage === 'review') renderReview();
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
  if (activeChannel) $('downloadOne').disabled = value || detailExportBlocked();
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

async function request(action, body) {
  const response = await fetch('/api/launch/' + action, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(68_000),
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
    $('modelStatus').textContent = status.available ? 'Gemma 3 已连接' : '本地规则可用';
    $('modelStatus').dataset.ready = String(status.available);
  } catch {
    $('modelStatus').textContent = '本地规则可用';
    $('modelStatus').dataset.ready = 'false';
  }
}

async function showPhoto() {
  const subject = $('heroSubject');
  const picture = $('photoPreview');
  subject.hidden = Boolean(draft.photo) || !subject.complete || !subject.naturalWidth;
  picture.hidden = !draft.photo;
  picture.classList.remove('is-ready');
  if (draft.photo) {
    await loadPhoto(draft.photo, picture);
    picture.classList.add('is-ready');
    $('photoState').textContent = (draft.photoName ?? '商品照片') + ' · 已载入';
  } else {
    $('photoState').textContent = '可拖入照片 · JPG、PNG、WebP，最大 15 MB';
  }
}

function loadHero() {
  if ($('heroSubject').getAttribute('src')) return;
  const subject = $('heroSubject');
  subject.addEventListener('load', () => {
    subject.hidden = Boolean(draft.photo);
    if (!draft.photo) subject.classList.add('is-ready');
  }, { once: true });
  subject.src = '/assets/sample-cut.webp';
}
window.addEventListener('load', () => {
  if (document.body.dataset.stage === 'intake' && !draft.photo) requestAnimationFrame(loadHero);
}, { once: true });

async function acceptPhoto(file, note) {
  const photo = await shrinkPhoto(file);
  persist({ ...draft, photo, photoName: file.name, note: note ?? draft.note });
  $('note').value = draft.note;
  await showPhoto();
  notice('');
}

const submitPhoto = file => withProgress('正在读取商品照片', () => acceptPhoto(file));
$('photo').addEventListener('change', async event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) await submitPhoto(file);
});
$('intake').addEventListener('dragover', event => event.preventDefault());
$('intake').addEventListener('drop', event => {
  event.preventDefault();
  const file = event.dataTransfer.files[0];
  if (file) void submitPhoto(file);
});
$('note').addEventListener('input', () => persist({ ...draft, note: $('note').value }));
$('sample').addEventListener('click', () => withProgress('正在读取示例照片', async () => {
    const response = await fetch('/assets/sample-photo.webp', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('示例照片读取失败，请上传商品照片。');
    await acceptPhoto(new File([await response.blob()], '冰奶油拿铁示例.webp', { type: 'image/webp' }),
      '周五上冰奶油拿铁，28 元，仅限堂食。');
}));

function confirmFields(result) {
  persist({
    ...draft, stage: 'facts', extracted: result.facts, facts: result.facts, sources: result.sources ?? {},
    extractionSource: result.source, extractionReason: result.reason,
  });
  show('facts');
}

$('brief').addEventListener('submit', async event => {
  event.preventDefault();
  if (!draft.photo) {
    $('photo').focus();
    notice('先选择一张商品照片。');
    return;
  }
  const result = await withProgress('正在用本机 Gemma 整理照片和备注', async () => {
    try {
      return await request('extract', { note: draft.note, image: await base64Photo(draft.photo) });
    } catch {
      return { facts: ruleFacts(draft.note), source: 'rules', reason: '本机模型接口暂不可用' };
    }
  }, event.submitter);
  if (result) confirmFields(result);
});

$('manual').addEventListener('click', () => {
  if (!draft.photo) {
    $('photo').focus();
    notice('先选择一张商品照片。');
    return;
  }
  confirmFields({ facts: ruleFacts(draft.note), source: 'rules', reason: '已选择手动整理' });
});
$('back').addEventListener('click', () => {
  persist({ ...draft, stage: 'intake' });
  show('intake');
});

function renderFacts() {
  $('factPhoto').src = $('photoPreview').src;
  $('factPhoto').hidden = !draft.photo;
  const { facts, extractionSource, extractionReason } = draft;
  $('name').value = facts.name;
  $('price').value = facts.price == null ? '' : money(facts.price).slice(1);
  $('day').value = facts.day;
  for (const radio of $('factsForm').querySelectorAll('input[type=radio]')) radio.checked = facts.scope === radio.value;
  $('originalNote').textContent = draft.note || '未填写备注';
  $('extractionSource').textContent = extractionSource === 'model'
    ? 'Gemma 已整理备注。确认候选信息并补齐缺项。'
    : `${extractionReason ?? '模型不可用'}，当前为本地规则整理，可直接手动核对。`;
  updateFactHints();
}

function updateFactHints() {
  for (const [id, value] of Object.entries(draft.facts)) {
    $('source-' + id).textContent = !value ? '待补充' : draft.extracted?.[id] !== value ? '商户填写'
      : draft.sources[id] === 'model' ? 'Gemma 从备注提取' : '本地规则从备注提取';
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
  persist({ ...draft, facts: readFacts() });
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
  const result = await withProgress(`正在规划 ${channels(facts).length} 个渠道并准备文案`, async () => {
    try {
      return await request('compose', { facts, note: draft.note });
    } catch {
      return { choices: {}, source: 'rules', reason: '本机模型接口暂不可用' };
    }
  }, event.submitter);
  if (!result) return;
  persist({
    ...draft, stage: 'review', facts, choices: result.choices, copySource: result.source,
    copyReason: result.reason, revision: draft.revision + 1,
  });
  show('review');
  canvas.fit();
  canvas.reveal();
});

function sourceImage() {
  const photo = document.createElement('img');
  photo.src = $('photoPreview').src;
  photo.alt = '商品原片';
  photo.draggable = false;
  return photo;
}

function renderReview() {
  const fixtures = channels(draft.facts);
  const items = canvasItems();
  const tiles = items.map(channel => {
    const tile = document.createElement('article');
    tile.className = 'tile';
    tile.dataset.channel = channel.id;
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
  $('planSource').textContent = `${fixtures.length} 个渠道 · ` + (draft.copySource === 'model'
    ? 'Gemma 推荐文案，照片在本机排版'
    : `本地模板文案${draft.copyReason ? '（' + draft.copyReason + '）' : ''}，照片在本机排版`);
  $('command').value = draft.command;
  renderDiff();
  syncReview();
}

function syncReview() {
  const conflicts = pending();
  const unsaved = channels(draft.facts).filter(c => c.id in buffers());
  const messages = [
    conflicts.length ? `待核对 ${conflicts.map(c => c.title).join('、')}的手改文案。` : '',
    unsaved.length ? `请保存 ${unsaved.map(c => c.title).join('、')}的文案再打包。` : '',
  ].filter(Boolean);
  $('conflict').hidden = messages.length === 0;
  $('conflict').textContent = messages.join(' ');
  $('approve').disabled = busy || !allReady() || messages.length > 0 || Boolean(draft.proposal);
  if (activeChannel) $('downloadOne').disabled = busy || detailExportBlocked();
  $('undo').hidden = !draft.previousFacts;
}

function renderImpact() {
  const proposal = draft.proposal;
  if (lastPreview === proposal) return;
  lastPreview = proposal;
  for (const tile of $('board').children) {
    const channel = choices(tile.dataset.channel);
    if (!channel) continue;
    const effective = { ...draft.facts, ...proposal?.patch };
    tile.dataset.impact = String(Boolean(proposal));
    tile.querySelector('.tile-art').replaceChildren(art(channel, effective, $('photoPreview'), true));
    tile.querySelector('small').textContent = proposal
      ? proposal.patch.price !== undefined ? money(draft.facts.price) + ' → ' + money(effective.price) : draft.facts.day + ' → ' + effective.day
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
  const affected = channels(draft.facts);
  const count = affected.filter(c => draft.edits[c.id] || c.id in buffers()).length;
  $('diffImpact').textContent = `更新 ${affected.map(c => c.title).join('、')}的图片和共享信息。` +
    (count ? `${count} 件手改文案将保留原文并标记待核对。` : '') +
    (draft.proposal.source === 'model' ? ' 候选由 Gemma 解析。' : ' 候选由本地规则解析。');
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
    const reply = await withProgress('正在用本机 Gemma 理解改动', async () => request('change', { facts, command }), event.submitter);
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
  $('apply').focus();
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
  persist({ ...updated, previousFacts: draft.facts, proposal: null, command: '' });
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
  return Boolean(draft.edits[activeChannel]?.pending || draft.proposal || activeChannel in buffers());
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
  $('focusCount').hidden = !focused;
  $('detail').hidden = !focused || activeChannel === 'source';
  $('sourceDetail').hidden = activeChannel !== 'source';
  $('projectActions').hidden = focused;
  $('canvasOverview').setAttribute('aria-pressed', String(!focused));
  $('canvasFocus').setAttribute('aria-pressed', String(focused));
  for (const button of $('channelList').children) {
    button.setAttribute('aria-pressed', String(button.dataset.focus === activeChannel));
  }
}

function renderDetail() {
  const list = canvasItems();
  $('focusCount').textContent = `${list.findIndex(item => item.id === activeChannel) + 1} / ${list.length}`;
  if (activeChannel === 'source') {
    $('previewSlot').replaceChildren(sourceImage());
    $('sourceFilename').textContent = draft.photoName ?? '商品照片';
    return;
  }
  const channel = choices(activeChannel);
  const edit = draft.edits[activeChannel];
  const effective = { ...draft.facts, ...draft.proposal?.patch };
  $('detailTitle').textContent = channel.title;
  $('detailFacts').textContent = factLine(effective) + (draft.proposal ? ' · 变更预览' : '');
  $('previewSlot').replaceChildren(art(channel, effective, $('photoPreview')));
  $('copy').value = buffers()[activeChannel]?.text ?? edit?.text ?? channel.leads[draft.choices[activeChannel] ?? 0];
  $('copy').readOnly = Boolean(draft.proposal);
  $('editCopy').querySelector('[type="submit"]').disabled = Boolean(draft.proposal);
  $('resetCopy').disabled = Boolean(draft.proposal);
  const evidence = detailEvidence($('copy').value);
  $('detailConflict').hidden = !edit?.pending && !evidence.length;
  $('detailConflict').textContent = evidence.length ? `原稿含旧事实 ${evidence.join('、')}，修改后保存。` : '商品信息已更新，请核对手改文案。';
  $('detailStatus').textContent = draft.proposal ? '先回全景应用或取消变更，之后可编辑文案。' : '';
  $('downloadOne').disabled = detailExportBlocked();
}

function openChannel(id, focus = true) {
  if (busy || (id !== 'source' && !choices(id))) return;
  lastChannel = activeChannel = id;
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
  renderMode();
  canvas.fit();
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
$('canvasFocus').addEventListener('click', () => openChannel(lastChannel ?? channels(draft.facts)[0].id, false));
$('closeDetail').addEventListener('click', () => showOverview(true));
$('closeSource').addEventListener('click', () => showOverview(true));
$('previousChannel').addEventListener('click', () => switchChannel(-1));
$('nextChannel').addEventListener('click', () => switchChannel(1));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && activeChannel && !$('newDraft').open && !busy) showOverview(true);
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
$('copy').addEventListener('input', () => {
  if (!activeChannel || draft.proposal) return;
  const buffer = { history: buffers()[activeChannel]?.history ?? [], text: $('copy').value };
  persist({ ...draft, copyBuffers: { ...buffers(), [activeChannel]: buffer } });
  syncReview();
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
  const evidence = detailEvidence(text);
  if (!text || evidence.length) {
    $('detailStatus').textContent = text ? `仍有旧事实 ${evidence.join('、')}，请改成当前信息。` : '请填写渠道文案。';
    $('copy').focus();
    return;
  }
  persist({ ...editCopy(draft, activeChannel, text), copyBuffers: withoutBuffer() });
  renderReview();
  renderDetail();
  $('detailStatus').textContent = '已保存当前渠道文案。';
});
$('resetCopy').addEventListener('click', () => {
  if (busy || !activeChannel || draft.proposal) return;
  const edits = { ...draft.edits };
  delete edits[activeChannel];
  persist({ ...draft, edits, copyBuffers: withoutBuffer(), revision: draft.revision + 1 });
  renderReview();
  renderDetail();
  $('detailStatus').textContent = '已恢复推荐文案。';
});

async function download(selected, feedback = notice) {
  if (busy || !allReady() || draft.proposal || selected.some(c => draft.edits[c.id]?.pending || c.id in buffers())) return;
  setBusy(true);
  $('downloadOne').disabled = true;
  const snapshot = draft;
  try {
    feedback('正在打包当前版本。');
    const blob = await packageAssets(snapshot, selected, $('photoPreview'));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const name = snapshot.facts.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    link.download = `CafeBrief_${name}${selected.length === 1 ? '_' + selected[0].title : ''}_v${snapshot.revision}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    feedback(`已打包 v${snapshot.revision}，包含 ${selected.length} 个渠道的图片和中文文案。`);
  } catch {
    feedback('打包失败，请重试。');
  } finally {
    setBusy(false);
    if (activeChannel) $('downloadOne').disabled = detailExportBlocked();
  }
}
$('approve').addEventListener('click', () => download(channels(draft.facts)));
$('downloadOne').addEventListener('click', () => download([choices(activeChannel)], text => { $('detailStatus').textContent = text; }));
$('restart').addEventListener('click', () => {
  $('newDraft').returnValue = '';
  $('newDraft').showModal();
});
$('newDraft').addEventListener('close', async () => {
  if ($('newDraft').returnValue !== 'new') return;
  persist(emptyDraft());
  activeChannel = null;
  lastChannel = null;
  canvas.fit();
  $('note').value = '';
  await showPhoto();
  show('intake');
});

setBusy(true);
void refreshStatus();
try {
  db = await openDraftStore();
  const restored = await loadDraft(db);
  if (restored) {
    draft = restored;
    lastSavedToken = restored.saveToken ?? null;
    $('saved').textContent = '已恢复本机草稿';
  }
  $('note').value = draft.note;
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
