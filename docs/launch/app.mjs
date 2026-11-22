import {
  applyFacts, channels, editCopy, factLine, fields, money, normalizeFacts,
  ruleChange, ruleFacts, scopeLabel, staleEvidence,
} from './workflow.mjs';
import { art, base64Photo, loadPhoto, packageAssets, shrinkPhoto } from './media.mjs';
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
let busy = false;
let saveNumber = 0;
let lastSavedToken = null;
let saveQueue = Promise.resolve();
let anotherTabSaved = false;
const stages = ['intake', 'facts', 'review'];
const choices = id => channels(draft.facts).find(channel => channel.id === id);
const pending = () => channels(draft.facts).filter(c => draft.edits[c.id]?.pending);
const allReady = () => Boolean(draft.photo && draft.revision > 0 && Object.values(draft.facts).every(Boolean));
const valueText = (id, value) => id === 'price' ? money(value) : id === 'scope' ? scopeLabel(value) : value;
const notice = message => {
  const review = draft.stage === 'review';
  $('notice').textContent = review ? '' : message;
  $('reviewNotice').textContent = review ? message : '';
};

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
  for (const id of stages) {
    $(id).hidden = id !== stage;
    if (id === stage) $('step-' + id).setAttribute('aria-current', 'step');
    else $('step-' + id).removeAttribute('aria-current');
  }
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
  $('photoPreview').hidden = !draft.photo;
  $('photoEmpty').hidden = Boolean(draft.photo);
  if (draft.photo) {
    await loadPhoto(draft.photo, $('photoPreview'));
    $('photoState').textContent = (draft.photoName ?? '商品照片') + ' · 已载入';
  } else {
    $('photoState').textContent = '支持 JPG、PNG、WebP，最大 15 MB。';
  }
}

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
const dropTarget = $('photoEmpty').parentElement;
dropTarget.addEventListener('dragover', event => event.preventDefault());
dropTarget.addEventListener('drop', event => {
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
});

function renderReview() {
  const fixtures = channels(draft.facts);
  const tiles = fixtures.map(channel => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tile';
    button.dataset.channel = channel.id;
    button.dataset.conflict = String(Boolean(draft.edits[channel.id]?.pending));
    const title = document.createElement('strong');
    title.textContent = channel.title;
    const meta = document.createElement('small');
    meta.textContent = draft.edits[channel.id]?.pending ? '待核对手改文案'
      : `${channel.width} × ${channel.height}${draft.edits[channel.id] ? ' · 商户已核对' : ''}`;
    button.append(art(channel, draft.facts, $('photoPreview'), true), title, meta);
    button.addEventListener('click', () => openChannel(channel.id));
    return button;
  });
  $('board').replaceChildren(...tiles);
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
  $('conflict').hidden = conflicts.length === 0;
  $('conflict').textContent = conflicts.length ? `待核对 ${conflicts.map(c => c.title).join('、')}的手改文案。确认后才能打包整套。` : '';
  $('approve').disabled = busy || !allReady() || conflicts.length > 0 || Boolean(draft.proposal);
  $('undo').hidden = !draft.previousFacts;
}

function renderDiff() {
  $('diff').hidden = !draft.proposal;
  if (!draft.proposal) return;
  $('diffList').replaceChildren(...Object.entries(draft.proposal.patch).map(([id, value]) => {
    const row = document.createElement('li');
    row.textContent = `${fields[id]} ${valueText(id, draft.facts[id])} → ${valueText(id, value)}`;
    return row;
  }));
  const affected = channels(draft.facts);
  const count = affected.filter(c => draft.edits[c.id]).length;
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

function openChannel(id) {
  const channel = choices(id);
  activeChannel = id;
  const edit = draft.edits[id];
  $('detailTitle').textContent = channel.title;
  $('detailFacts').textContent = factLine(draft.facts) + '（随整套物料更新）';
  $('previewSlot').replaceChildren(art(channel, draft.facts, $('photoPreview'), true));
  $('copy').value = edit?.text ?? channel.leads[draft.choices[id] ?? 0];
  const evidence = edit ? staleEvidence(edit, edit.text, draft.facts) : [];
  $('detailConflict').hidden = !edit?.pending;
  $('detailConflict').textContent = evidence.length ? `检测到原稿含旧事实 ${evidence.join('、')}。请对照当前信息改写后再核对。`
    : '商品信息已更新，请核对这份手改文案。';
  $('detailStatus').textContent = '';
  $('downloadOne').disabled = Boolean(edit?.pending || draft.proposal);
  $('detail').showModal();
}
$('closeDetail').addEventListener('click', () => $('detail').close());
$('detail').addEventListener('close', () => {
  if (activeChannel) document.querySelector(`[data-channel="${activeChannel}"]`)?.focus({ preventScroll: true });
  activeChannel = null;
});
$('editCopy').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !activeChannel) return;
  const text = $('copy').value.trim();
  const old = draft.edits[activeChannel];
  const evidence = old ? staleEvidence(old, text, draft.facts) : [];
  if (!text || evidence.length) {
    $('detailStatus').textContent = text ? `仍有旧事实 ${evidence.join('、')}，请改成当前信息。` : '请填写渠道文案。';
    $('copy').focus();
    return;
  }
  persist(editCopy(draft, activeChannel, text));
  renderReview();
  $('detail').close();
});
$('resetCopy').addEventListener('click', () => {
  if (busy || !activeChannel) return;
  const edits = { ...draft.edits };
  delete edits[activeChannel];
  persist({ ...draft, edits, revision: draft.revision + 1 });
  renderReview();
  $('detail').close();
});

async function download(selected, feedback = notice) {
  if (busy || !allReady() || draft.proposal || selected.some(c => draft.edits[c.id]?.pending)) return;
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
    $('downloadOne').disabled = false;
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
