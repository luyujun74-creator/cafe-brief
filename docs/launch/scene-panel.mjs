// 换背景面板：抠出商品 → 选背景 → 拖动/缩放/调光 → 应用到全部或当前作品。
// 只在点开「换背景」时才加载；AI 精细抠图再按需加载模型。
import { scenes, sceneById, sceneLabel, defaultPlacement, composeScene, productRect } from './scenes.mjs?v=202611265';
import { quickCutout, aiCutout, applyMask, paintMask, cloneCanvas, canvasBlob, canvasFromBlob, prefetchCutoutModel, cutoutModelState } from './cutout.mjs?v=202611265';

const MAX_BG = 1600;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function shrinkBackground(blob) {
  const image = await createImageBitmap(blob);
  const scale = Math.min(1, MAX_BG / Math.max(image.width, image.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(image.width * scale), height: Math.round(image.height * scale) });
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  const out = await canvasBlob(canvas, 'image/jpeg', .88);
  return { blob: out, image: await createImageBitmap(out) };
}

function featherMask(mask, amount) {
  if (!amount) return mask;
  const soft = Object.assign(document.createElement('canvas'), { width: mask.width, height: mask.height });
  const ctx = soft.getContext('2d');
  ctx.filter = `blur(${(amount * Math.max(mask.width, mask.height) / 900).toFixed(2)}px)`;
  ctx.drawImage(mask, 0, 0);
  return soft;
}

export function mountScenePanel(app) {
  const { $ } = app;
  const stage = $('sceneStage');
  const view = $('sceneCanvas');
  view.tabIndex = 0;
  let photoRef = null;
  let mask = null;
  let method = '';
  let product = null;
  let productBlob = null;
  let bg = { kind: 'preset', id: scenes[0].id };
  let bgBlob = null;
  let bgImage = null;
  let label = scenes[0].label;
  let place = defaultPlacement(bg);
  let look = { shadow: true, brightness: 0, warmth: 0 };
  let brush = '';
  let aiToken = 0;
  let frame = 0;
  let layout = null;
  let restored = false;

  const status = text => { $('cutoutStatus').textContent = text; };
  const sceneStatus = text => { $('sceneStatus').textContent = text; };
  const state = () => ({ bg, overlay: Boolean(product), ...place, ...look });

  function rebuildProduct() {
    if (!mask) return;
    product = applyMask(app.photo(), featherMask(mask, Number($('sceneFeather').value)));
    productBlob = null;
    const preview = $('cutoutPreview');
    const ctx = preview.getContext('2d');
    ctx.clearRect(0, 0, preview.width, preview.height);
    const s = Math.min(preview.width / product.width, preview.height / product.height);
    ctx.drawImage(product, (preview.width - product.width * s) / 2, (preview.height - product.height * s) / 2, product.width * s, product.height * s);
    draw();
  }

  function quick() {
    const started = performance.now();
    const result = quickCutout(app.photo());
    mask = result.mask;
    method = result.method;
    rebuildProduct();
    const ms = Math.round(performance.now() - started);
    status(method === 'color'
      ? `已按背景颜色抠出商品（本机算法，${ms} 毫秒）。边缘不满意可用「AI 精细抠图」或下方画笔修边。`
      : `原片背景较复杂，已用「智能裁切+柔化边缘」抠出商品（${ms} 毫秒）。可试「AI 精细抠图」。`);
    $('cutoutRun').lastChild.textContent = '重新抠图';
    $('cutoutAi').hidden = false;
    $('brushTools').hidden = false;
  }

  async function runAi() {
    const token = ++aiToken;
    $('cutoutAi').disabled = true;
    $('cutoutCancel').hidden = false;
    $('cutoutProgress').hidden = false;
    const bar = $('cutoutProgress').firstElementChild;
    bar.style.width = '4%';
    const model = cutoutModelState();
    status(model.state === 'ready' ? 'AI 抠图模型已就绪，正在识别商品轮廓…'
      : model.state === 'downloading' ? `AI 抠图模型后台下载中 ${(model.loaded / 1048576).toFixed(1)} / ${(model.total / 1048576).toFixed(1)} MB，下完自动开始…`
      : '正在下载 AI 抠图模型（首次约 16 MB，之后走浏览器缓存）…');
    try {
      const result = await aiCutout(app.photo(), {
        onProgress(ratio, text) {
          if (token !== aiToken) return;
          bar.style.width = `${Math.round(clamp(ratio, .04, 1) * 100)}%`;
          status(text);
        },
        fail: new URLSearchParams(location.search).has('cutoutFail'),
      });
      if (token !== aiToken) return;
      mask = result.mask;
      method = 'ai';
      rebuildProduct();
      status('AI 精细抠图完成。可用画笔擦除或恢复局部。');
    } catch (error) {
      if (token !== aiToken) return;
      const kept = method === 'color' ? '已保留本机抠图结果' : '已回退到「智能裁切+柔化边缘」';
      status(error.phase === 'download'
        ? `AI 抠图未完成（${error.message}），${kept}。模型还在下载，可稍后再点 AI 精细抠图。`
        : `AI 抠图未完成（${error.message}），${kept}，可继续用画笔修边。`);
    } finally {
      if (token === aiToken) {
        $('cutoutAi').disabled = false;
        $('cutoutCancel').hidden = true;
        $('cutoutProgress').hidden = true;
      }
    }
  }

  function renderGrid() {
    const items = scenes.map(scene => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scene-tile';
      button.setAttribute('aria-pressed', String(bg.kind === 'preset' && bg.id === scene.id));
      const thumb = Object.assign(document.createElement('canvas'), { width: 96, height: 72 });
      scene.draw(thumb.getContext('2d'), 96, 72);
      const name = document.createElement('span');
      name.textContent = scene.label;
      button.append(thumb, name);
      button.addEventListener('click', () => {
        const fresh = bg.kind !== 'preset';
        bg = { kind: 'preset', id: scene.id };
        bgBlob = null;
        bgImage = null;
        label = scene.label;
        if (fresh || !restored) place = { ...defaultPlacement(bg), scale: place.scale };
        afterBackground(`已换成「${scene.label}」。拖动商品调整位置，然后点「应用」。`);
      });
      return button;
    });
    const upload = document.createElement('button');
    upload.type = 'button';
    upload.className = 'scene-tile scene-tile-action';
    upload.setAttribute('aria-pressed', String(bg.kind === 'upload'));
    upload.innerHTML = '<span class="scene-plus" aria-hidden="true">＋</span><span>上传我的背景图</span>';
    upload.addEventListener('click', () => $('sceneUpload').click());
    const ai = document.createElement('button');
    ai.type = 'button';
    ai.className = 'scene-tile scene-tile-action';
    ai.setAttribute('aria-pressed', String(bg.kind === 'ai'));
    ai.innerHTML = '<span class="scene-plus" aria-hidden="true">✦</span><span>AI 生成场景</span>';
    ai.addEventListener('click', () => {
      $('aiScene').scrollIntoView({ block: 'nearest', behavior: app.reducedMotion.matches ? 'auto' : 'smooth' });
      $('aiSceneGo').focus({ preventScroll: true });
    });
    $('sceneGrid').replaceChildren(...items, upload, ai);
  }

  function afterBackground(message) {
    if (!product && app.photo()?.naturalWidth) quick();
    renderGrid();
    syncSliders();
    draw();
    sceneStatus(message);
  }

  function syncSliders() {
    $('sceneScale').value = Math.round(place.scale * 100);
    $('sceneScaleOut').textContent = `${Math.round(place.scale * 100)}%`;
    $('sceneBright').value = look.brightness;
    $('sceneBrightOut').textContent = String(look.brightness);
    $('sceneWarm').value = look.warmth;
    $('sceneWarmOut').textContent = String(look.warmth);
    $('sceneShadow').checked = look.shadow;
  }

  // ———— 画布预览：移动模式拖商品/滚轮缩放；画笔模式在原片上擦除/恢复 ————
  function frameSize() {
    const work = app.focusedWork();
    const ratio = work ? work.width / work.height : 4 / 5;
    const box = stage.getBoundingClientRect();
    const maxW = Math.max(160, box.width - 32);
    const maxH = Math.max(160, box.height - 64);
    const w = Math.min(maxW, maxH * ratio);
    return { w: Math.round(w), h: Math.round(w / ratio), work };
  }

  function draw() {
    if (frame || stage.hidden) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const { w, h, work } = frameSize();
      const dpr = Math.min(2, devicePixelRatio || 1);
      view.width = Math.round(w * dpr);
      view.height = Math.round(h * dpr);
      view.style.width = w + 'px';
      view.style.height = h + 'px';
      const ctx = view.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (brush && mask) {
        const image = app.photo();
        const s = Math.min(w / image.naturalWidth, h / image.naturalHeight);
        const iw = image.naturalWidth * s;
        const ih = image.naturalHeight * s;
        layout = { mode: 'brush', left: (w - iw) / 2, top: (h - ih) / 2, s };
        ctx.fillStyle = '#e9edf3';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = .28;
        ctx.drawImage(image, layout.left, layout.top, iw, ih);
        ctx.globalAlpha = 1;
        const masked = Object.assign(document.createElement('canvas'), { width: image.naturalWidth, height: image.naturalHeight });
        const mc = masked.getContext('2d');
        mc.drawImage(image, 0, 0);
        mc.globalCompositeOperation = 'destination-in';
        mc.drawImage(mask, 0, 0);
        ctx.drawImage(masked, layout.left, layout.top, iw, ih);
        $('sceneStageHint').textContent = brush === 'erase' ? '画笔：在多余的背景上涂抹即可擦掉' : '画笔：在被误删的商品上涂抹即可恢复';
        return;
      }
      composeScene(ctx, w, h, state(), { background: bgImage, product });
      layout = { mode: 'move', w, h };
      if (product) {
        const rect = productRect(w, h, product, place);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = 'rgba(0, 82, 217, .85)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rect.left, rect.top, rect.width, rect.height);
        ctx.restore();
      }
      $('sceneStageHint').textContent = `预览比例：${work ? work.title : '通用 4:5'} · ${label} · 拖动商品移动，滚轮或「大小」缩放`;
    });
  }

  let drag = null;
  view.addEventListener('pointerdown', event => {
    if (!layout) return;
    const box = view.getBoundingClientRect();
    const p = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (layout.mode === 'brush') {
      const q = { x: (p.x - layout.left) / layout.s, y: (p.y - layout.top) / layout.s };
      const radius = Number($('brushSize').value) / layout.s / 2;
      paintMask(mask, q, q, radius, brush === 'erase');
      drag = { brush: true, last: q, radius };
    } else if (product) {
      drag = { start: p, place: { ...place } };
    }
    if (drag) view.setPointerCapture(event.pointerId);
    draw();
  });
  view.addEventListener('pointermove', event => {
    if (!drag) return;
    const box = view.getBoundingClientRect();
    const p = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (drag.brush) {
      const q = { x: (p.x - layout.left) / layout.s, y: (p.y - layout.top) / layout.s };
      paintMask(mask, drag.last, q, drag.radius, brush === 'erase');
      drag.last = q;
    } else {
      place.x = clamp(drag.place.x + (p.x - drag.start.x) / layout.w, .05, .95);
      place.y = clamp(drag.place.y + (p.y - drag.start.y) / layout.h, .15, 1.05);
    }
    draw();
  });
  const endDrag = () => {
    if (drag?.brush) rebuildProduct();
    drag = null;
  };
  view.addEventListener('pointerup', endDrag);
  view.addEventListener('pointercancel', endDrag);
  view.addEventListener('wheel', event => {
    if (!product || brush) return;
    event.preventDefault();
    place.scale = clamp(place.scale - Math.sign(event.deltaY) * .04, .2, 1.1);
    syncSliders();
    draw();
  }, { passive: false });
  view.addEventListener('keydown', event => {
    const move = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }[event.key];
    if (!move || !product || brush) return;
    event.preventDefault();
    place.x = clamp(place.x + move[0], .05, .95);
    place.y = clamp(place.y + move[1], .15, 1.05);
    draw();
  });

  // ———— 控件 ————
  $('cutoutRun').addEventListener('click', () => { aiToken++; quick(); });
  $('cutoutAi').addEventListener('click', () => void runAi());
  $('cutoutCancel').addEventListener('click', () => {
    aiToken++;
    $('cutoutAi').disabled = false;
    $('cutoutCancel').hidden = true;
    $('cutoutProgress').hidden = true;
    status(cutoutModelState().state === 'downloading'
      ? '已停止等待，保留当前抠图结果。模型还在后台下载，可稍后再点 AI 精细抠图。'
      : '已停止 AI 抠图，保留当前抠图结果。');
  });
  for (const button of $('brushTools').querySelectorAll('[data-brush]')) button.addEventListener('click', () => {
    brush = button.dataset.brush;
    for (const other of $('brushTools').querySelectorAll('[data-brush]')) other.setAttribute('aria-pressed', String(other === button));
    view.style.cursor = brush ? 'crosshair' : '';
    draw();
  });
  $('sceneFeather').addEventListener('change', rebuildProduct);
  $('sceneScale').addEventListener('input', () => { place.scale = Number($('sceneScale').value) / 100; syncSliders(); draw(); });
  $('sceneBright').addEventListener('input', () => { look.brightness = Number($('sceneBright').value); syncSliders(); draw(); });
  $('sceneWarm').addEventListener('input', () => { look.warmth = Number($('sceneWarm').value); syncSliders(); draw(); });
  $('sceneShadow').addEventListener('change', () => { look.shadow = $('sceneShadow').checked; draw(); });
  $('sceneCenter').addEventListener('click', () => { place = { ...defaultPlacement(bg), scale: place.scale }; draw(); });
  $('sceneUpload').addEventListener('change', async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 15_000_000) {
      sceneStatus('背景图需为 JPG、PNG 或 WebP，且不超过 15 MB。');
      return;
    }
    try {
      await useBackground(file, 'upload', '自选背景图');
    } catch {
      sceneStatus('这张背景图读取失败，换一张试试。');
    }
  });

  async function useBackground(blob, kind, name) {
    const shrunk = await shrinkBackground(blob);
    bg = { kind };
    bgBlob = shrunk.blob;
    bgImage = shrunk.image;
    label = name;
    place = { ...defaultPlacement(bg), scale: place.scale };
    if (!app.isOpen()) return;
    afterBackground(`已用「${name}」作背景。拖动商品调整位置，然后点「应用」。`);
  }

  async function payload(applyTo) {
    if (!productBlob) productBlob = await canvasBlob(product, 'image/png');
    return { state: state(), applyTo, product: productBlob, background: bgBlob, label: bg.kind === 'preset' ? sceneById(bg.id)?.label ?? label : label };
  }
  $('sceneApplyAll').addEventListener('click', async () => {
    if (!product) { sceneStatus('先抠出商品。'); return; }
    await app.apply(await payload('all'), `已把「${label}」应用到全部物料，可撤销。`);
    sceneStatus(`已应用到全部物料（${label}）。导出与草稿都会带上合成图。`);
  });
  $('sceneApplyOne').addEventListener('click', async () => {
    const work = app.focusedWork();
    if (!product) { sceneStatus('先抠出商品。'); return; }
    if (!work) { sceneStatus('先在画布上点选一件作品，再点「仅当前作品」。'); return; }
    const current = app.draft().scene?.applyTo;
    const list = Array.isArray(current) ? [...new Set([...current, work.id])] : [work.id];
    await app.apply(await payload(list), `已给「${work.title}」换背景，可撤销。`);
    sceneStatus(`已应用到 ${list.length} 件作品。`);
  });
  $('sceneUndo').addEventListener('click', () => void app.undo());
  $('sceneRemove').addEventListener('click', () => {
    if (!app.draft().scene) return;
    void app.apply(null, '已恢复原片背景，可撤销。');
    sceneStatus('已恢复原片背景。');
  });

  async function restore() {
    const scene = app.draft().scene;
    if (!scene || product) return;
    try {
      product = await canvasFromBlob(scene.product);
      productBlob = scene.product;
      bg = scene.state.bg;
      label = scene.label || sceneLabel(bg);
      if (scene.background) { bgBlob = scene.background; bgImage = await createImageBitmap(scene.background); }
      place = { x: scene.state.x, y: scene.state.y, scale: scene.state.scale };
      look = { shadow: scene.state.shadow !== false, brightness: scene.state.brightness ?? 0, warmth: scene.state.warmth ?? 0 };
      restored = true;
      const preview = $('cutoutPreview');
      const ctx = preview.getContext('2d');
      const s = Math.min(preview.width / product.width, preview.height / product.height);
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.drawImage(product, (preview.width - product.width * s) / 2, (preview.height - product.height * s) / 2, product.width * s, product.height * s);
      status('已载入上次的合成。要修边请点「重新抠图」。');
      $('cutoutRun').lastChild.textContent = '重新抠图';
      $('cutoutAi').hidden = false;
    } catch {
      product = null;
    }
  }

  function sync() {
    const scene = app.draft().scene;
    $('sceneUndo').disabled = !app.canUndo();
    $('sceneRemove').disabled = !scene;
    $('sceneApplyOne').disabled = !app.focusedWork();
    $('sceneApplyOne').title = app.focusedWork() ? '' : '先在画布上点选一件作品';
  }

  function reset() {
    aiToken++;
    mask = null;
    product = null;
    productBlob = null;
    method = '';
    restored = false;
    photoRef = null;
    $('brushTools').hidden = true;
    $('cutoutAi').hidden = true;
    $('cutoutRun').lastChild.textContent = '抠出商品';
    $('cutoutPreview').getContext('2d').clearRect(0, 0, 120, 120);
  }

  async function open() {
    const photo = app.photo();
    if (photoRef !== app.draft().photo) {
      reset();
      photoRef = app.draft().photo;
    }
    stage.hidden = false;
    document.body.dataset.sceneLive = 'true';
    prefetchCutoutModel();
    await restore();
    if (!product && photo.complete && photo.naturalWidth) quick();
    renderGrid();
    syncSliders();
    sync();
    draw();
  }

  function close() {
    stage.hidden = true;
    delete document.body.dataset.sceneLive;
    brush = '';
    for (const other of $('brushTools').querySelectorAll('[data-brush]')) other.setAttribute('aria-pressed', String(other.dataset.brush === ''));
    view.style.cursor = '';
  }

  new ResizeObserver(() => draw()).observe(stage);
  return { open, close, sync, reset, useBackground: async (blob, kind, name) => {
    try {
      await useBackground(blob, kind, name);
    } catch {
      sceneStatus('背景图读取失败，请重试。');
    }
  } };
}
