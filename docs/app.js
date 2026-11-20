(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  /* ---------- 规格表：engine 与 UI 共用 ---------- */
  const ROASTS = [
    { id: 1, name: '浅烘', hint: '清爽明亮' },
    { id: 2, name: '中浅烘', hint: '蜜糖温暖' },
    { id: 3, name: '中烘', hint: '饱满吸睛' },
    { id: 4, name: '中深烘', hint: '沉稳高级' },
    { id: 5, name: '深烘', hint: '夜色聚光' },
  ];
  const SCENES = [
    { id: 'seam', name: '纯色影棚' },
    { id: 'wood', name: '木吧台' },
    { id: 'stone', name: '石材台面' },
    { id: 'window', name: '窗边光' },
  ];
  const SHEETS = [
    { id: 'main', name: '美团商品主图', use: '菜品主图', w: 1600, h: 1200, type: 'jpg', max: 5, text: false, cx: .54, base: .92, hgt: .84 },
    { id: 'square', name: '方图', use: '自有小程序、其他平台', w: 1080, h: 1080, type: 'jpg', max: 5, text: false, cx: .5, base: .93, hgt: .84 },
    { id: 'banner', name: '店铺 Banner', use: '店铺海报位', w: 1440, h: 480, type: 'jpg', max: 5, text: true, cx: .78, base: 1.02, hgt: 1.0 },
    { id: 'poster', name: '竖版海报', use: '朋友圈、门店屏、小红书', w: 1080, h: 1440, type: 'jpg', max: 5, text: true, cx: .62, base: .86, hgt: .56 },
  ];
  const AI_COPY = [
    { t: '{name}', fact: true }, { t: '，' },
    { t: '奶油绵密', claim: 'c1' }, { t: '、' }, { t: '咖啡回甘', claim: 'c2' }, { t: '。' },
    { t: '{shop}', fact: true, opt: true }, { t: '{shopTail}', opt: true },
  ];
  const VIEWS = {
    studio: { title: '工作台 · 一键包装', desc: '上传 1 张商品照，一次生成 4 套外卖与门店规格图及上架文案' },
    phone: { title: '外卖手机预览', desc: '以消费者拇指浏览尺度，实时对照手机原片与包装效果' },
    compare: { title: '四图对比与导出', desc: '一屏查看 4 套导出比例，滑动对比原片并管理 AI 文案留存' },
    guide: { title: '尺寸规范与说明', desc: '四步工作流、各平台导出规格标准与服务额度管理' },
  };

  /* ---------- 状态 ---------- */
  const S = {
    roast: 4, scene: 'seam', name: '', price: '', offer: '', shop: '', high: '', photo: null, isSample: false,
    phase: 'empty', sheet: 'main', previewSheet: 'poster', remaining: null, engine: 'ready', draftRevision: 0, lateResults: [], unlocked: false, scenario: 'ok', cupOk: false, tries: 0,
    fitMode: 'contain', live: false, aiTitle: '', aiDetail: '', aiPoints: [],
    kit: {}, claims: { c1: false, c2: false }, run: 0, view: 'studio',
  };
  const SCENE_URLS = Object.fromEntries(['seam','wood','stone','window'].map(id => [id, 'assets/scene-' + id + '.webp']));
  const img = { cut: new Image(), photo: new Image(), scenes: {} };
  let assetsReady = false, priceTouched = false;
  let probePromise = null, probeSeq = 0, quotaRevision = 0, samplePromise = null, photoRevision = 0, shrinkCache = null;
  const STATUS_KEY = 'cb_status_v2';

  /* ---------- 服务配置与 API ----------
     API_BASE 留空表示同源（Cloudflare Worker 与页面同域部署）。
     仅 GitHub Pages（无后端）或超时时进入离线示例模式，绝不把示例冒充真实生成。 */
  const API_BASE = (() => { try { return (window.CB_CONFIG && window.CB_CONFIG.apiBase) || ''; } catch { return ''; } })();
  const apiUrl = path => API_BASE + path;
  const TOKEN_KEY = 'cb_unlock';
  const authHeaders = () => { try { const t = localStorage.getItem(TOKEN_KEY); return t ? { authorization: 'Bearer ' + t } : {}; } catch { return {}; } };
  const retryRequests = new Map();
  async function readGenerationStream(response, reportStage) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '', result;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop();
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.stage) reportStage(event.stage);
          if (event.result) result = event.result;
        }
        if (done) break;
      }
    } finally { reader.releaseLock(); }
    if (!result) throw new Error('Incomplete generation response');
    return result;
  }
  async function apiPost(path, body, reportStage) {
    const signature = body.requestId ? JSON.stringify({...body,requestId:null}) : null;
    const previous = retryRequests.get(path);
    if(signature && previous?.signature === signature) body = previous.body;
    if(signature) retryRequests.set(path,{signature,body});
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 270000) : 0;
    try {
      const response = await fetch(apiUrl(path + (reportStage ? '?progress=1' : '')), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body), credentials: API_BASE ? 'omit' : 'same-origin', signal: ctrl?.signal });
      const payload = reportStage && response.body && response.headers.get('content-type')?.includes('application/x-ndjson')
        ? await readGenerationStream(response, reportStage)
        : await response.json();
      if (!response.ok || payload?.code) { if (!['GENERATION_BUSY','QUOTA_REPAIR_REQUIRED'].includes(payload?.code)) retryRequests.delete(path); const e = new Error(payload?.error || '请求失败'); e.code = payload?.code || ('HTTP_' + response.status); throw e; }
      retryRequests.delete(path); return payload;
    } catch(e) { if(e.code) throw e; const err = new Error('连接中断，任务可能仍在处理，请勿重复提交'); err.code = 'NETWORK'; throw err; }
    finally { if(timer) clearTimeout(timer); }
  }
  async function apiStatus() {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), 4500) : 0;
    try {
      const response = await fetch(apiUrl('/api/status'), {
        headers: authHeaders(),
        credentials: API_BASE ? 'omit' : 'same-origin',
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!response.ok) throw new Error('status');
      return await response.json();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  let pendingFile = null;
  /* 上传前缩到长边 1280，省流量也减轻服务端负担 */
  function shrinkPhoto(pic) {
    if (shrinkCache?.revision === photoRevision && shrinkCache.pic === pic) return shrinkCache.data;
    const w = pic.naturalWidth || pic.width, h = pic.naturalHeight || pic.height, k = Math.min(1, 1280 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(pic, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', .84); shrinkCache = {revision:photoRevision,pic,data}; return data;
  }
  /* 生成图经服务端取回成同源 blob，导出时画布不会被跨域污染 */
  async function loadScene(imageUrl) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let url, timer;
    try {
      return await Promise.race([(async () => {
        const res = await fetch(apiUrl(imageUrl), { headers: authHeaders(), credentials: API_BASE ? 'omit' : 'same-origin', signal:ctrl?.signal });
        if (!res.ok) throw new Error('IMAGE');
        const im = new Image(); url = URL.createObjectURL(await res.blob());
        im.src = url; await im.decode(); return im;
      })(), new Promise((_,reject) => { timer = setTimeout(() => {ctrl?.abort();reject(new Error('IMAGE_TIMEOUT'));},30000); })]);
    } finally { clearTimeout(timer); if(url) URL.revokeObjectURL(url); }
  }
  // A successful generation owns its URL; image recovery never calls a generation API.
  let imageRecovery = null, generationTask = null, photoSelection = null;
  function generationControls(busy) {
    for (const id of ['#go', '#again']) {
      const el = $(id);
      if (!el) continue;
      el.disabled = busy;
      if (busy) el.setAttribute('aria-busy', 'true');
      else el.removeAttribute('aria-busy');
    }
  }
  function cancelPhotoSelection() {
    if (photoSelection) photoSelection.cleanup();
    photoSelection = null;
  }
  function beginGeneration(kind = 'package') {
    // Check ownership before invalidating the run of a pending paid request.
    if (generationTask) return null;
    cancelPhotoSelection();
    S.run++; imageRecovery = null;
    const task = { kind, sheet:S.sheet, run: S.run, facts: {...currentFacts(),photo:S.photo,isSample:S.isSample,high:S.high,scene:S.scene,roast:S.roast} };
    generationTask = task; generationControls(true);
    return task;
  }
  function finishGeneration(task) {
    if (generationTask !== task) return;
    generationTask = null; generationControls(false);
  }
  function cancelImageFlow() {
    S.run++; imageRecovery = null;
    S.cupOk = false; $('#cupOk').checked = false;
    if ($('#compareConfirm')) $('#compareConfirm').checked = false;
    const retry = $('#errRetry');
    if (retry) {
      retry.removeAttribute('aria-busy');
      const sp = $('#errRetry span');
      if (sp) sp.textContent = '重新包装';
    }
  }
  function invalidateImageRequest() {
    cancelImageFlow();
    S.draftRevision++;
  }
  function invalidateCopy() {
    if (S.aiTitle || S.aiDetail) S.copyStale = true;
    if (S.editedCopy != null) S.editedCopyStale = true;
    if (S.copyUndo != null) S.copyUndoStale = true;
    S.claims = { c1: false, c2: false };
  }
  function updateFact(key, value) {
    if (key === 'price') priceTouched = true;
    if (S[key] === value) { updateGo(); return; }
    const changed = S[key].trim() !== value.trim();
    S[key] = value;
    if (changed) {
      invalidateImageRequest();
      invalidateCopy();
    }
    syncAllInputs();
    $('#briefErr').textContent = '';
    updateGo();
    updateExportUi();
    redrawAll();
  }
  function acceptQuota(result) {
    quotaRevision++;
    if (typeof result.remaining === 'number') S.remaining = result.remaining;
    S.unlocked = !!result.unlimited;
    try {sessionStorage.setItem(STATUS_KEY,JSON.stringify({at:Date.now(),st:{remaining:S.remaining,unlimited:S.unlocked,configured:S.live}}));}catch{}
    updateServiceUi(S.live ? (!S.unlocked && S.remaining <= 0 ? 'locked' : 'online') : 'demo');
  }
  function saveLateResult(result, task) {
    acceptQuota(result);
    if (task.discardPhotoResult) return;
    S.lateResults.push({result, facts:task.facts, kind:task.kind, sheet:task.sheet, createdAt:Date.now()});
    toast('上一稿已完成，可查看');
    const btn = $('#lateResult'); if(btn) btn.hidden = false;
  }
  async function recoverImage(job) {
    if (job !== imageRecovery || job.run !== S.run || job.loading) return;
    job.loading = true;
    if (job.kind === 'package') setGenerationStage('download');
    $('#errRetry').setAttribute('aria-busy', 'true');
    try {
      const sceneImg = await loadScene(job.result.image_url);
      if (job !== imageRecovery || job.run !== S.run) return;
      if (job.kind === 'package') {
        S.aiTitle = job.result.title || ''; S.aiDetail = job.result.detail || '';
        S.aiPoints = Array.isArray(job.result.selling_points) ? job.result.selling_points : [];
        S.copyStale = false;
        SHEETS.forEach(sd => {
          const k = S.kit[sd.id]; k.status = 'done'; k.mode = 'scene'; k.sceneImg = sceneImg;
          addVersion(k);
        });
        S.sheet = 'main';
      } else {
        const k = job.kit;
        k.sceneImg = sceneImg; k.mode = 'scene';
        addVersion(k);
      }
      S.cupOk = false; $('#cupOk').checked = false;
      if(generationTask?.startedAt) $('#genTimer').textContent='已完成 · '+Math.round((Date.now()-generationTask.startedAt)/1000)+' 秒';
      imageRecovery = null;
      $('#errRetry span').textContent = '重新包装';
      setPhase('result'); updateResult(); toast('图片已加载，本次生成已计入次数');
    } catch {
      if (job !== imageRecovery || job.run !== S.run) return;
      $('#errTitle').textContent = '图片已生成，但加载失败';
      $('#errBody').textContent = '本次生成已计入次数。可以重新加载同一张图片，不会重新生成或再次扣次数。';
      $('#errRetry span').textContent = '重新加载图片（不扣次数）';
      setPhase('error');
    } finally {
      job.loading = false;
      if (job.run === S.run) {
        $('#errRetry').removeAttribute('aria-busy');
      }
    }
  }
  const sceneName = id => (SCENES.find(s => s.id === id) || SCENES[0]).name;
  function buildPayload() {
    const fallbackImg = (typeof CB_ASSETS !== 'undefined' && CB_ASSETS.photo) || '';
    return { shop: S.shop.trim(), product: S.name.trim(), price: S.price.trim(), currency: 'CNY', offer: S.offer.trim(), requestId: (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'cb-' + Date.now() + '-' + Math.random().toString(36).slice(2)), highlights: (S.high || '').trim(), platform: 'meituan', style: sceneName(S.scene), image: S.isSample && fallbackImg ? fallbackImg : shrinkPhoto(S.photo) };
  }

  /* ---------- 绘制 ---------- */
  let tokenCache;
  const tokens = () => {
    if(tokenCache) return tokenCache;
    const c = getComputedStyle(root);
    const g = n => c.getPropertyValue(n).trim();
    return tokenCache = {
      wall: g('--plate-wall') || '#5E3013',
      floor: g('--plate-floor') || '#3B1C09',
      ink: g('--plate-ink') || '#FFF5E6',
      bg: g('--bg-app') || '#F3F5F8',
    };
  };
  function rng(seed) { let s = seed * 9301 + 49297; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

  function plate(ctx, w, h, t, scene, seed, horizon = .62) {
    const photo = img.scenes[scene];
    if (photo?.complete && photo.naturalWidth > 0) {
      const scale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
      const sw = w / scale, sh = h / scale;
      // Wide banners keep the lower tabletop rather than cropping its centre away.
      const cropY = (photo.naturalHeight - sh) * (w / h > 2 ? .88 : .55);
      ctx.save();
      ctx.drawImage(photo, (photo.naturalWidth - sw) / 2, cropY, sw, sh, 0, 0, w, h);
      const roast = Math.max(1, Math.min(5, Number(S.roast) || 3));
      ctx.fillStyle = `rgba(72,36,16,${.015 + (roast - 1) * .045})`;
      ctx.fillRect(0, 0, w, h);
      const light = ctx.createLinearGradient(0, 0, w, h);
      light.addColorStop(0, `rgba(255,235,202,${.13 - (roast - 1) * .02})`);
      light.addColorStop(1, 'transparent');
      ctx.fillStyle = light; ctx.fillRect(0, 0, w, h);
      const vignette = ctx.createRadialGradient(w*.5,h*.5,Math.min(w,h)*.2,w*.5,h*.5,Math.hypot(w,h)*.55);
      vignette.addColorStop(0,'transparent'); vignette.addColorStop(1,'rgba(24,16,10,.13)');
      ctx.fillStyle = vignette; ctx.fillRect(0,0,w,h);
      ctx.restore();
      return;
    }
    ctx.fillStyle = t.wall; ctx.fillRect(0, 0, w, h);
    const r = rng(seed + 3);
    if (scene === 'seam') {
      const g = ctx.createLinearGradient(0, h * (horizon - .22), 0, h);
      g.addColorStop(0, t.wall); g.addColorStop(.42, t.wall); g.addColorStop(1, t.floor);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    } else {
      const y = h * horizon;
      ctx.fillStyle = t.floor; ctx.fillRect(0, y, w, h - y);
      if (scene === 'wood') {
        ctx.save();
        const woodLight = ctx.createLinearGradient(0, y, w, h);
        woodLight.addColorStop(0, 'rgba(255,211,149,.3)'); woodLight.addColorStop(1, 'rgba(80,38,13,.15)');
        ctx.fillStyle = woodLight; ctx.fillRect(0, y, w, h-y);
        ctx.fillStyle = 'rgba(64,32,14,.24)'; ctx.fillRect(0, y, w, Math.max(2,h*.006));
        ctx.globalAlpha = .23; ctx.strokeStyle = '#502B18'; const n = 18;
        for (let i = 0; i < n; i++) {
          const yy = y + (h - y) * (i / n) ** 1.6;
          ctx.lineWidth = Math.max(1, h * .002 * (1 + r() * 2));
          ctx.beginPath(); ctx.moveTo(0, yy);
          ctx.bezierCurveTo(w * .3, yy + r() * 8 - 4, w * .7, yy + r() * 8 - 4, w, yy + r() * 6 - 3);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (scene === 'stone') {
        ctx.save();
        ctx.fillStyle = 'rgba(207,224,238,.38)'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(41,57,72,.25)'; ctx.fillRect(0, y, w, Math.max(2,h*.005));
        const gleam = ctx.createLinearGradient(0, h, w, 0);
        gleam.addColorStop(0, 'transparent'); gleam.addColorStop(.48, 'rgba(255,255,255,.28)'); gleam.addColorStop(1, 'transparent');
        ctx.fillStyle = gleam; ctx.fillRect(0,y,w,h-y);
        const n = Math.round(w * h / 1900);
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = .12 + r() * .2; ctx.fillStyle = r() > .5 ? '#fff' : '#000';
          const s = (2 + r() * 4) * w / 1000;
          ctx.fillRect(r() * w, y + r() * (h - y), s, s);
        }
        ctx.restore();
      }
      if (scene === 'window') {
        ctx.save(); ctx.fillStyle = '#000'; ctx.globalAlpha = .08; ctx.fillRect(0, y - 1, w, h * .004 + 1); ctx.restore();
      }
    }
    if (scene === 'window') {
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = .32; ctx.filter = `blur(${w * .003}px)`; ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const x = w * (.12 + i * .17 + (seed % 3) * .02);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * .11, 0); ctx.lineTo(x + w * .48, h); ctx.lineTo(x + w * .3, h); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    const lg = ctx.createRadialGradient(w * .38, h * .22, 0, w * .38, h * .22, Math.max(w, h) * .8);
    lg.addColorStop(0, 'rgba(255,240,215,.15)'); lg.addColorStop(1, 'rgba(0,0,0,.12)');
    ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
  }

  let silhouette = null;
  function getSilhouette() {
    if (silhouette) return silhouette;
    const c = document.createElement('canvas'); c.width = img.cut.naturalWidth; c.height = img.cut.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(img.cut, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
    return silhouette = c;
  }

  function drawCup(ctx, w, h, sp, seed) {
    if (!img.cut.complete || !img.cut.naturalWidth) return;
    const H = h * sp.hgt, W = H * img.cut.naturalWidth / img.cut.naturalHeight;
    const jitter = ((seed % 5) - 2) * .012;
    const cx = w * (sp.cx + jitter), by = h * sp.base, x = cx - W / 2, y = by - H;
    ctx.save(); ctx.globalAlpha = .34; ctx.filter = `blur(${H * .022}px)`;
    ctx.translate(cx, by - H * .02); ctx.transform(1, 0, -1.18, -.26, 0, 0);
    ctx.drawImage(getSilhouette(), -W / 2, -H, W, H); ctx.restore();
    ctx.save(); ctx.filter = `blur(${H * .02}px)`; ctx.globalAlpha = .55; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx + W * .02, by - H * .018, W * .29, H * .022, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.drawImage(img.cut, x, y, W, H);
  }

  const DISPLAY_FONT = '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei", sans-serif';
  function fitFont(ctx, text, maxW, start, min, weight = '700') {
    for (let size = start; ; size = Math.max(min, size - 2)) {
      ctx.font = `${weight} ${size}px ${DISPLAY_FONT}`;
      if (ctx.measureText(text).width <= maxW) return { size, ok: true };
      if (size <= min) return { size: min, ok: false };
    }
  }
  function drawTitle(ctx, text, { x, y, width, size, min, maxLines, height, spread = false }) {
    const fit = fitFont(ctx, text, width, size, min);
    if (fit.ok && !spread) {
      ctx.font = `700 ${fit.size}px ${DISPLAY_FONT}`;
      ctx.fillText(text, x, y, width);
      return;
    }
    const characters = Array.from(text);
    let lines;
    for (let font = size; font >= min; font = Math.max(min, font - 2)) {
      ctx.font = `700 ${font}px ${DISPLAY_FONT}`;
      lines = [''];
      for (const character of characters) {
        const last = lines.length - 1;
        const candidate = lines[last] + character;
        if (lines[last] && ctx.measureText(candidate).width > width) lines.push(character);
        else lines[last] = candidate;
      }
      if ((lines.length <= maxLines && font * (1 + (lines.length - 1) * 1.12) <= height) || font === min) {
        // Even unusually wide glyphs stay inside the text box.
        if (lines.length > maxLines) lines.splice(maxLines - 1, Infinity, lines.slice(maxLines - 1).join(''));
        lines.forEach((line, i) => ctx.fillText(line, x, y - (lines.length - 1 - i) * font * 1.12, width));
        return;
      }
    }
  }

  function fitOffer(ctx, text, maxWidth, start, min) {
    return fitFont(ctx, text, maxWidth, Math.round(start), Math.round(min), '500');
  }
  function textLayer(ctx, w, h, sp, f, t, layout, photographic = false, splitBanner = false) {
    const issues = [];
    if (photographic) {
      const dark = Number(S.roast) >= 3;
      const base = dark ? 'rgba(20,15,12,.74)' : 'rgba(255,252,245,.80)';
      const pad = sp.id === 'banner' ? ctx.createLinearGradient(0,0,w*.65,0) : ctx.createLinearGradient(0,0,0,h*.48);
      pad.addColorStop(0,base);pad.addColorStop(.6,base);pad.addColorStop(1,'transparent');
      ctx.fillStyle=pad;ctx.fillRect(0,0,sp.id === 'banner' ? w*.65 : w,sp.id === 'banner' ? h : h*.48);
    }
    ctx.fillStyle = t.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const name = f.name || '商品名', price = f.price ? `¥${f.price}` : '';
    if (sp.id === 'poster') {
      const m = w * .07;
      if (f.shop) {
        ctx.font = `600 ${Math.round(w * .034)}px ${DISPLAY_FONT}`;
        ctx.fillText(f.shop, m, m + w * .02, w * .86);
      }
      if (layout === 'behind') {
        drawTitle(ctx, name, { x: m, y: h * .36, width: w * .86, size: Math.max(1, Math.round(w * .22)),
          min: Math.max(1, Math.round(w * .048)), maxLines: 3, height: h * .26, spread: true });
      }
    }
    if (sp.id === 'banner') {
      const m = h * .13;
      drawTitle(ctx, name, { x: m, y: h * .46, width: w * (splitBanner ? .48 : .52),
        size: Math.max(1, Math.round(h * .27)), min: Math.max(1, Math.round(h * .048)), maxLines: 2, height: h * .4 });
      if (price) { ctx.font = `700 ${Math.round(h * .17)}px ${DISPLAY_FONT}`; ctx.fillText(price, m, h * .72, w * .48); }
      const sub = [f.shop, f.offer].filter(Boolean).join(' · ');
      if (sub) {
        const maxWidth = w * (splitBanner ? .48 : .55);
        const fit = fitOffer(ctx, sub, maxWidth, h * .085, h * .05);
        if (!fit.ok) issues.push('活动文字太长，Banner 放不下');
        ctx.font = `500 ${fit.size}px ${DISPLAY_FONT}`; if (splitBanner) ctx.fillText(sub, m, h * .88, maxWidth);
        else ctx.fillText(sub, m, h * .88);
      }
    }
    return issues;
  }
  function posterFoot(ctx, w, h, f, t, photographic = false) {
    if (photographic) {
      const pad=ctx.createLinearGradient(0,h*.77,0,h);
      pad.addColorStop(0,'transparent');pad.addColorStop(.65,Number(S.roast)>=3?'rgba(20,15,12,.74)':'rgba(255,252,245,.80)');
      ctx.fillStyle=pad;ctx.fillRect(0,h*.77,w,h*.23);
    }
    const m = w * .07, issues = [];
    ctx.fillStyle = t.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (f.price) { ctx.font = `700 ${Math.round(w * .14)}px ${DISPLAY_FONT}`; ctx.fillText(`¥${f.price}`, m, h * .93 - (f.offer ? h * .05 : 0)); }
    if (f.offer) {
      const fit = fitOffer(ctx, f.offer, w * .56, w * .044, w * .028);
      if (!fit.ok) issues.push('活动文字太长，海报放不下');
      ctx.font = `500 ${fit.size}px ${DISPLAY_FONT}`; ctx.fillText(f.offer, m, h * .935);
    }
    return issues;
  }

  /** 把一张规格画到 canvas。mode: ai 为示意场景；raw 只用原片，不重绘商品 */
  const renderCache = new WeakMap();
  function drawPosterHeader(ctx, w, h, f, t, compact = false) {
    const m = w * .07;
    ctx.fillStyle = t.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const name = f.name || '商品名';
    const issues = [];
    if (f.shop) {
      ctx.font = `600 ${Math.round(w * .034)}px ${DISPLAY_FONT}`;
      ctx.fillText(f.shop, m, compact ? h * .043 : (m + w * .02), w * .86);
    }
    drawTitle(ctx, name, { x: m, y: compact ? h * .167 : h * .25, width: w * .86,
      size: Math.max(1, Math.round(w * .11)), min: Math.max(1, Math.round(w * .038)), maxLines: 2, height: h * (compact ? .118 : .17) });
    return issues;
  }

  function render(canvas, spId, opt = {}) {
    if (!canvas) return [];
    const sp = SHEETS.find(s => s.id === spId);
    const rect = canvas.getBoundingClientRect?.();
    if (!opt.fixedSize && rect?.width > 0 && canvas.isConnected) {
      const width = Math.round(rect.width * Math.min(2, window.devicePixelRatio || 1));
      const height = Math.round(width * sp.h / sp.w);
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    }
    const fit = opt.fit || S.fitMode || 'contain';
    const key=JSON.stringify([spId,canvas.width,canvas.height,S.roast,photoRevision,S.draftRevision,fit,opt.mode,opt.seed,opt.scene,opt.facts]);
    const cached=renderCache.get(canvas);if(cached?.key===key && cached.image===opt.sceneImg)return cached.issues;
    const o = Object.assign({ mode: 'ai', seed: 1, scene: S.scene, facts: S, src: null }, opt);
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const t = tokens();
    ctx.clearRect(0, 0, w, h);
    let issues = [];
    if (o.mode === 'scene' && o.sceneImg) {
      const spic = o.sceneImg;
      const iw = spic.naturalWidth || spic.width, ih = spic.naturalHeight || spic.height;
      if (fit === 'cover') {
        cover(ctx, spic, iw, ih, 0, 0, w, h);
        if (sp.text) issues = textLayer(ctx, w, h, sp, o.facts, t, 'behind', true);
        if (sp.id === 'poster') issues = issues.concat(posterFoot(ctx, w, h, o.facts, t, true));
      } else if (sp.id === 'banner') {
        drawAmbientBackdrop(ctx, spic, iw, ih, 0, 0, w, h, Number(S.roast) >= 3 ? 'rgba(20,15,12,.76)' : 'rgba(255,252,245,.86)');
        drawFramedPhoto(ctx, spic, iw, ih, w * .56, h * .06, w * .415, h * .88, { fit: 'contain', skipAmbient: true });
        issues = textLayer(ctx, w, h, sp, o.facts, t, 'behind', false, true);
      } else if (sp.id === 'poster') {
        drawAmbientBackdrop(ctx, spic, iw, ih, 0, 0, w, h, Number(S.roast) >= 3 ? 'rgba(20,15,12,.74)' : 'rgba(255,252,245,.84)');
        drawFramedPhoto(ctx, spic, iw, ih, w * .05, h * .195, w * .90, h * .60, { fit: 'contain', skipAmbient: true });
        issues = drawPosterHeader(ctx, w, h, o.facts, t, true);
        issues = issues.concat(posterFoot(ctx, w, h, o.facts, t, false));
      } else {
        drawFramedPhoto(ctx, spic, iw, ih, 0, 0, w, h, { fit: 'contain' });
      }
      renderCache.set(canvas,{key,image:opt.sceneImg,issues}); return issues;
    }
    const useCut = o.mode === 'ai' && !o.src;
    if (useCut) {
      plate(ctx, w, h, t, o.scene, o.seed, sp.id === 'poster' ? .7 : sp.id === 'banner' ? .8 : .64);
      const photographic = !!img.scenes[o.scene]?.naturalWidth;
      if (sp.text) issues = textLayer(ctx, w, h, sp, o.facts, t, 'behind', photographic);
      drawCup(ctx, w, h, sp, o.seed);
      if (sp.id === 'poster') issues = issues.concat(posterFoot(ctx, w, h, o.facts, t, photographic));
    } else {
      const pic = o.src || img.photo;
      const pw = pic.naturalWidth || pic.width, ph = pic.naturalHeight || pic.height;
      if (!pw || !ph) { renderCache.set(canvas,{key,image:opt.sceneImg,issues}); return issues; }
      if (sp.text) {
        ctx.fillStyle = t.wall; ctx.fillRect(0, 0, w, h);
        if (sp.id === 'banner') {
          drawFramedPhoto(ctx, pic, pw, ph, w * .58, h * .05, w * .40, h * .90, { fit, skipAmbient: fit === 'contain' });
          issues = textLayer(ctx, w, h, Object.assign({}, sp), o.facts, t, 'behind');
        } else {
          drawFramedPhoto(ctx, pic, pw, ph, w * .05, h * .195, w * .90, h * .60, { fit, skipAmbient: fit === 'contain' });
          issues = drawPosterHeader(ctx, w, h, o.facts, t, true);
          issues = issues.concat(posterFoot(ctx, w, h, o.facts, t));
        }
      } else {
        drawFramedPhoto(ctx, pic, pw, ph, 0, 0, w, h, { fit });
      }
    }
    renderCache.set(canvas,{key,image:opt.sceneImg,issues}); return issues;
  }
  function cover(ctx, pic, pw, ph, x, y, w, h) {
    if (!pw || !ph) return;
    const s = Math.max(w / pw, h / ph), sw = w / s, sh = h / s;
    ctx.drawImage(pic, (pw - sw) / 2, (ph - sh) / 2, sw, sh, x, y, w, h);
  }
  function containRect(pw, ph, x, y, w, h) {
    if (!pw || !ph) return { dx: x, dy: y, dw: w, dh: h };
    const s = Math.min(w / pw, h / ph), dw = pw * s, dh = ph * s;
    return { dx: x + (w - dw) / 2, dy: y + (h - dh) / 2, dw, dh };
  }
  function drawAmbientBackdrop(ctx, pic, pw, ph, x, y, w, h, scrim) {
    if (typeof ctx.save === 'function') ctx.save();
    if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, h * .035)}px) saturate(1.06)`;
    ctx.globalAlpha = 0.78;
    cover(ctx, pic, pw, ph, x - w * .06, y - h * .06, w * 1.12, h * 1.12);
    if (typeof ctx.restore === 'function') ctx.restore();
    if (scrim) {
      const grad = ctx.createLinearGradient(0, 0, w > h * 1.5 ? w * .72 : 0, w > h * 1.5 ? 0 : h);
      grad.addColorStop(0, scrim);
      grad.addColorStop(.55, scrim);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w, h);
    }
  }
  function drawFramedPhoto(ctx, pic, pw, ph, x, y, w, h, opts = {}) {
    if (!pw || !ph) return;
    const fit = opts.fit || S.fitMode || 'contain';
    if (fit === 'cover') {
      cover(ctx, pic, pw, ph, x, y, w, h);
      return;
    }
    if (pw * h === ph * w && !opts.pad) {
      ctx.drawImage(pic, 0, 0, pw, ph, x, y, w, h);
      return;
    }
    const canSave = typeof ctx.save === 'function';
    if (canSave) {
      ctx.save();
      if (typeof ctx.beginPath === 'function' && typeof ctx.rect === 'function' && typeof ctx.clip === 'function') {
        ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      }
    }
    if (!opts.skipAmbient) {
      if (canSave) ctx.save();
      if ('filter' in ctx) ctx.filter = `blur(${Math.max(2, Math.min(w, h) * .026)}px) saturate(1.06)`;
      ctx.globalAlpha = 0.72;
      cover(ctx, pic, pw, ph, x - w * .06, y - h * .06, w * 1.12, h * 1.12);
      if (canSave) ctx.restore();
      ctx.fillStyle = opts.veil || 'rgba(255, 255, 255, 0.16)';
      ctx.fillRect(x, y, w, h);
    }
    const pad = opts.pad || 0;
    const box = containRect(pw, ph, x + pad, y + pad, Math.max(1, w - pad * 2), Math.max(1, h - pad * 2));
    if (canSave) ctx.save();
    if (!opts.noShadow) {
      ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
      ctx.shadowBlur = Math.round(Math.min(w, h) * .028);
      ctx.shadowOffsetY = Math.round(Math.min(w, h) * .006);
    }
    ctx.drawImage(pic, 0, 0, pw, ph, box.dx, box.dy, box.dw, box.dh);
    if (canSave) { ctx.restore(); ctx.restore(); }
  }

  const baseFacts = { name: '冰奶油拿铁', price: '18', offer: '', shop: '拾叶咖啡' };
  const previewFacts = () => {
    const f = currentFacts();
    return {
      name: f.name || baseFacts.name,
      price: f.price || baseFacts.price,
      offer: f.offer,
      shop: f.shop || (S.photo && !S.isSample ? '' : baseFacts.shop),
    };
  };

  /* ---------- 烘焙度（画布色调） ---------- */
  function setRoast(r, silent) {
    cancelImageFlow(); tokenCache = null; S.roast = r; root.dataset.roast = r;
    syncScene();
    $$('.dial input').forEach(i => { i.value = r; i.setAttribute('aria-valuetext', `${ROASTS[r - 1].name}，${ROASTS[r - 1].hint}`); });
    $$('.dial-now').forEach(e => e.textContent = `${ROASTS[r - 1].name} · ${ROASTS[r - 1].hint}`);
    if (!silent) redrawAll();
  }
  function mountDials() {
    $$('[data-dial]').forEach(h => {
      h.innerHTML = `<div class="dial"><label for="d-${h.dataset.dial}">画布色调（烘焙度）</label><span class="dial-now"></span>
        <div class="dial-track"><i data-r="1"></i><i data-r="2"></i><i data-r="3"></i><i data-r="4"></i><i data-r="5"></i>
        <input id="d-${h.dataset.dial}" type="range" min="1" max="5" step="1" value="${S.roast}"></div>
        <div class="dial-ends"><span>浅烘</span><span>中烘</span><span>深烘</span></div></div>`;
      $('input', h).addEventListener('input', e => setRoast(+e.target.value));
    });
  }

  /* ---------- 多页面预览渲染（按当前可见页面懒渲染） ---------- */
  function renderPhoneView() {
    if(!S.photo) return;
    const pf = S.photo ? currentFacts() : previewFacts();
    const checked = $('input[name=ph]:checked');
    const pk = checked ? checked.value === 'pack' : true;
    const kM = S.kit.main, kB = S.kit.banner;
    const useUserPhoto = !!S.photo && !S.isSample;
    const src = useUserPhoto ? S.photo : null;
    if (kM && kM.status === 'done') {
      render($('#phThumb'), 'main', { mode: pk ? ((S.live || S.isSample) ? kM.mode : 'raw') : 'raw', seed: kM.seed, scene: kM.scene, facts: pf, src, sceneImg: pk ? kM.sceneImg : null });
    } else {
      render($('#phThumb'), 'main', { mode: pk && !useUserPhoto ? 'ai' : 'raw', facts: pf, scene: S.scene, seed: 2, src });
    }
    if (kB && kB.status === 'done') {
      render($('#phBanner'), 'banner', { mode: pk ? ((S.live || S.isSample) ? kB.mode : 'raw') : 'raw', seed: kB.seed, scene: kB.scene, facts: pf, src, sceneImg: pk ? kB.sceneImg : null });
    } else {
      render($('#phBanner'), 'banner', { mode: pk && !useUserPhoto ? 'ai' : 'raw', facts: pf, scene: S.scene, seed: 2, src });
    }
    if ($('#phName')) $('#phName').textContent = pf.name;
    if ($('#phShopTitle')) $('#phShopTitle').textContent = pf.shop || '自营咖啡门店';
    if ($('#phShopSub')) $('#phShopSub').textContent = pf.shop ? `${pf.shop} · 商品预览` : '商品预览';
    if ($('#phPrice')) $('#phPrice').textContent = `¥${pf.price}`;
    const offerEl = $('#phOfferTag');
    if (offerEl) {
      offerEl.hidden = !pf.offer;
      offerEl.textContent = pf.offer || '';
    }
  }

  function renderCompareView() {
    syncAllInputs();
    updateGo();
    updateExportUi();
    if(!S.photo) return;
    const after = $('#baAfter'), before = $('#baBefore');
    const pf = S.photo ? currentFacts() : previewFacts();
    const kM = S.kit[S.sheet] || S.kit.main;
    $('#compareSelected').textContent = SHEETS.find(s => s.id === S.sheet).name;
    const useUserPhoto = !!S.photo && !S.isSample;
    const src = useUserPhoto ? S.photo : null;
    if (after && before) {
      const spec = SHEETS.find(s => s.id === S.sheet);
      $('#ba').style.setProperty('--ar', `${spec.w} / ${spec.h}`);
      if (kM && kM.status === 'done') {
        render(after, S.sheet, { mode: (S.live || S.isSample) ? kM.mode : 'raw', facts: pf, scene: kM.scene, seed: kM.seed, src, sceneImg: kM.sceneImg });
      } else {
        render(after, S.sheet, { mode: useUserPhoto ? 'raw' : 'ai', facts: pf, scene: S.scene, seed: 2, src });
      }
      render(before, S.sheet, { mode: 'raw', facts: pf, src, fit: 'contain' });
    }
    $$('#proofs canvas').forEach(c => {
      const id = c.dataset.sheet;
      const k = S.kit[id];
      if (k && k.status === 'done') {
        render(c, id, { mode: (S.live || S.isSample) ? k.mode : 'raw', facts: pf, scene: k.scene, seed: k.seed, src, sceneImg: k.sceneImg });
      } else {
        render(c, id, { mode: useUserPhoto ? 'raw' : 'ai', facts: pf, scene: S.scene, seed: 2, src });
      }
    });
    renderFacts();
  }

  function renderFacts() {
    const fp = $('#factsPoster');
    if (!fp) return;
    const pf = S.photo ? currentFacts() : previewFacts();
    const f = {
      name: pf.name,
      price: pf.price,
      offer: pf.offer,
      shop: pf.shop,
    };
    render(fp, 'poster', { mode: S.photo && !S.isSample ? 'raw' : 'ai', facts: f, scene: S.scene || 'seam', seed: 2, src: S.photo && !S.isSample ? S.photo : null });
  }

  function drawHome() {
    if (S.view === 'phone' && S.photo) renderPhoneView();
    else if (S.view === 'compare' && S.photo) renderCompareView();
  }

  function mountCompareAndPhone() {
    const proofs = $('#proofs');
    if (proofs) {
      proofs.innerHTML = SHEETS.map(s => `<li class="proof proof-${s.id}" data-jump-spec="${s.id}"><div class="crop"><canvas data-sheet="${s.id}" width="${Math.round(s.w / 3)}" height="${Math.round(s.h / 3)}" aria-label="${s.name}示意"></canvas></div><b>${s.name}</b><span>${s.w} × ${s.h} px · ${s.use}</span><button type="button" class="link proof-view" data-view-proof="${s.id}" aria-label="查看${s.name}大图">查看大图</button></li>`).join('');
      $$('[data-view-proof]', proofs).forEach(button => button.addEventListener('click', e => {
        e.stopPropagation();
        openLightbox(button.dataset.viewProof, 'product', button);
      }));
      $$('[data-jump-spec]', proofs).forEach(li => li.addEventListener('click', () => {
        const spec = li.dataset.jumpSpec;
        if (S.phase === 'result' && S.kit[spec] && S.kit[spec].status === 'done') S.sheet = spec;
        else {S.previewSheet = spec;S.sheet=spec;}
        if(S.view === 'compare') { renderCompareView(); updateResult(); $('#compareSelected').textContent = SHEETS.find(x=>x.id===spec).name; return; }
        switchView('studio');
        syncSpecTabs();
        redrawStage();
      }));
    }
    const ba = $('#ba'), r = $('.ba-range');
    if (ba && r) r.addEventListener('input', () => ba.style.setProperty('--pos', r.value + '%'));
    $$('input[name=ph]').forEach(i => i.addEventListener('change', renderPhoneView));
    for (const [id, key] of [['#fPrice', 'price'], ['#fOffer', 'offer'], ['#phInputName', 'name'],
      ['#phInputPrice', 'price'], ['#phInputShop', 'shop'], ['#phInputOffer', 'offer']]) {
      $(id)?.addEventListener('input', e => updateFact(key, e.target.value));
    }
    renderAllCopy();

    if ($('#phoneToStudio')) $('#phoneToStudio').addEventListener('click', () => switchView('studio'));
    if ($('#compareToStudio')) $('#compareToStudio').addEventListener('click', () => switchView('studio'));
    $('#aboutLink')?.addEventListener('click', () => {
      switchView('guide');
      $('#aboutProject')?.scrollIntoView?.({ block: 'start' });
    });
    if ($('#guideUnlockBtn')) $('#guideUnlockBtn').addEventListener('click', openUnlock);
    if ($('#guideRetryBtn')) $('#guideRetryBtn').addEventListener('click', () => retryProbe(true));
  }

  /* ---------- 文案：事实 / AI 描述 ---------- */
  function renderCopy(el, f) {
    if (!el) return;
    if (el.id === 'factsCopy') { el.textContent = f.name ? exportCopy(f).trimEnd() : ''; return; }
    if (el.id === 'resCopy') {
      if (document.activeElement !== el) {
        const aiCopy = !S.copyStale && [S.aiTitle, S.aiDetail].filter(Boolean).join('\n');
        el.textContent = S.editedCopy ?? (aiCopy || exportCopy(f).trimEnd());
      }
      return;
    }
    const shop = (f.shop || '').trim();
    el.innerHTML = '';
    AI_COPY.forEach(p => {
      if (p.opt && !shop) return;
      if (p.claim) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'claim' + (S.claims[p.claim] ? ' kept' : '');
        b.textContent = p.t; b.setAttribute('aria-pressed', S.claims[p.claim]);
        b.setAttribute('aria-label', `${p.t}，AI 补充的描述，${S.claims[p.claim] ? '已保留，点击取消' : '点击保留'}`);
        b.addEventListener('click', () => { S.claims[p.claim] = !S.claims[p.claim]; S.cupOk = false; updateExportUi(); });
        el.append(b);
      } else {
        const t = p.t.replace('{name}', f.name || '商品名').replace('{shop}', shop).replace('{shopTail}', shop ? '现做。' : '');
        el.append(p.fact ? Object.assign(document.createElement('strong'), { textContent: t }) : document.createTextNode(t));
      }
    });
  }
  function exportCopy(f) {
    if(S.editedCopy != null && !S.editedCopyStale) return [`商品名：${f.name}`,`店名：${f.shop}`,`售价：CNY ¥${f.price}`,f.offer?`活动：${f.offer}`:'',`商家确认文案：${S.editedCopy}`].filter(Boolean).join('\n')+'\n';
    if (S.copyStale || (S.editedCopy != null && S.editedCopyStale)) {
      const out = [`商品名称：${f.name}`, `店名：${f.shop}`, `售价：CNY ¥${f.price}`];
      if (f.offer) out.push(`活动：${f.offer}`);
      return out.join('\n') + '\n';
    }
    if (S.aiDetail) {
      const out = [`商品标题：${S.aiTitle}`, `店名：${f.shop}`, `售价：CNY ¥${f.price}`, `商品描述：${S.aiDetail}`];
      if (f.offer) out.push(`活动：${f.offer}`);
      return out.join('\n') + '\n';
    }
    const kept = []; if (S.claims.c1) kept.push('奶油绵密'); if (S.claims.c2) kept.push('咖啡回甘');
    let line = f.name + (kept.length ? '，' + kept.join('、') : '') + '。';
    if (f.shop) line += f.shop + '。';
    const lines = [`商品名：${f.name}`, `店名：${f.shop}`, `售价：CNY ¥${f.price}`, `商品描述：${line}`];
    if (f.offer) lines.push(`活动：${f.offer}`);
    return lines.join('\n') + '\n';
  }
  function renderAllCopy() {
    const stale = S.editedCopy != null ? S.editedCopyStale : S.copyStale;
    const factsCopyNote = $('#factsCopyNote');
    if (factsCopyNote) factsCopyNote.textContent = stale
      ? '商品信息已变更，旧文案已过期。当前导出仅含填写的事实。'
      : '这里显示压缩包里实际包含的文案，可回工作台编辑。';
    const claims = $('#copyClaims');
    if (claims) {
      claims.hidden = !S.isSample || S.live || !!S.aiDetail || S.editedCopy != null;
      if (!claims.hidden) renderCopy(claims, currentFacts());
    }
    renderCopy($('#factsCopy'), currentFacts());
    renderCopy($('#resCopy'), currentFacts());
    const note = $('#copyNote');
    if (!note) return;
    note.textContent = stale
      ? (S.editedCopy != null ? '手改文案已过期且仍保留。请按当前事实更新文字，或核对后重新采用。' : 'AI 文案已过期。重新包装可更新文案，当前只导出已填写的事实。')
      : (S.editedCopy != null ? '手改文案已纳入导出，请核对商品事实。' : '导出前核对商品信息。');
    const reapply = $('#copyReapply');
    if (reapply) reapply.hidden = !(S.editedCopy != null && S.editedCopyStale);
  }

  /* ---------- 工作台 ---------- */
  const currentFacts = () => ({ name: S.name.trim(), price: S.price.trim(), offer: S.offer.trim(), shop: S.shop.trim() });
  const stage = () => $('#stageCanvas');

  function syncSpecTabs() {
    const active = S.phase === 'result' ? S.sheet : S.previewSheet;
    $$('#specTabs .spec-tab').forEach(btn => {
      if (btn.classList) btn.classList.toggle('is-active', btn.dataset.spec === active);
    });
  }

  // Shared by phase changes, sample/undo/recovery and direct scene selection.
  function syncScene() {
    root.dataset.scene = S.scene;
    const badge = $('#stageScene');
    if (badge) badge.textContent = `${sceneName(S.scene)} · ${ROASTS[S.roast - 1].name}`;
    $$('input[name=scene]').forEach(i => i.checked = i.value === S.scene);
  }
  function setPhase(p) {
    S.phase = p;
    syncScene();
    const studio = $('#studio');
    if (studio && studio.dataset) studio.dataset.phase = p;
    const removePhotoBtn = $('#removePhoto'), pickPhotoBtn = $('#pickPhotoBtn');
    if (removePhotoBtn) removePhotoBtn.hidden = !S.photo;
    if (pickPhotoBtn) pickPhotoBtn.textContent = S.photo ? '更换照片' : '上传照片';
    const pb = $('#paneBrief'), pg = $('#paneGen'), pr = $('#paneResult'), pe = $('#paneError');
    if (pb) pb.hidden = !['empty', 'ready'].includes(p);
    const backToResult = $('#returnResult');
    if (backToResult) backToResult.hidden = p !== 'ready' || !Object.values(S.kit).some(k => k.status === 'done');
    if (pg) pg.hidden = p !== 'gen';
    if (pr) pr.hidden = p !== 'result';
    if (pe) pe.hidden = p !== 'error';
    const drop = $('#drop'), dropOverlay = $('#dropOverlay'), hc = $('#holdCompare'), fitBtn = $('#fitModeBtn'), zoomBtn = $('#zoomStageBtn'), liveBadge = $('#stageLiveBadge');
    if (fitBtn) fitBtn.hidden = !['ready', 'result'].includes(p);
    if (zoomBtn) zoomBtn.hidden = !['ready', 'result'].includes(p);
    syncImageActions();
    if (liveBadge) {
      if (p === 'gen') { liveBadge.hidden = false; liveBadge.dataset.kind = 'gen'; liveBadge.textContent = S.live ? '正在连接在线生成服务…' : '正在排版示例…'; }
      else if (!holdRaw) { liveBadge.hidden = true; }
    }
    if (drop) drop.hidden = p !== 'empty';
    if (dropOverlay) dropOverlay.hidden = p !== 'empty';
    if (hc) hc.hidden = p !== 'result';
    syncSpecTabs();
    updateGo(); updateQuota(); updateExportUi(); redrawStage(); drawStrip();
    if (S.view !== 'studio') redrawAll();
  }
  function updateQuota() {
    const chip = $('#quotaChip');
    if (chip) {
      if (S.engine === 'ready') chip.textContent = '额度待确认';
      else if (!S.live) chip.textContent = '演示模式 · 本地预览';
      else if (S.unlocked) chip.textContent = '已解锁 · 不限次数';
      else chip.textContent = '免费包装剩余 ' + S.remaining + ' 次';
    }
    const go = $('#go span');
    if (go) go.textContent = !S.live ? '一键生成示例效果（4 图 + 文案）' : (S.remaining > 0 || S.unlocked ? '一键包装（生成 4 图 + 文案）' : '解锁后继续包装');
    const guideText = $('#guideStatusText');
    if (guideText) {
      guideText.textContent = !S.live
        ? '当前为离线演示模式（未连上服务端，可使用示例数据预览整套排版与导出）。'
        : (S.unlocked ? '当前已解锁不限次数授权，可随时使用真实模型包装。' : `当前网络已连接服务端，还可使用真实 AI 模型免费包装 ${S.remaining} 次。`);
    }
  }
  function priceError() {
    const price = S.price.trim();
    if (!price) return '请填写售价，例如 18 或 18.5';
    if (/^-?\d+(\.\d+)?$/.test(price) && Number(price) <= 0) return '售价需大于 0';
    if (!/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/.test(price)) return '售价请填数字，最高 99999.99，最多两位小数';
    return '';
  }
  function validate() {
    if (!S.photo) return '请先上传一张商品照片，或点击“载入示例”';
    if (!S.name.trim()) return '请填写商品名';
    if (S.name.trim().length > 40) return '商品名最多 40 字';
    return priceError();
  }
  function updateGo() {
    const error = validate();
    $('#go').setAttribute('aria-disabled', String(!!error));
    const hint = priceTouched || (S.photo && S.name.trim()) ? priceError() : '';
    for (const [input, message] of [['#iPrice', '#priceErr'], ['#phInputPrice', '#phonePriceErr'], ['#fPrice', '#comparePriceErr']]) {
      $(input)?.setAttribute('aria-invalid', String(!!hint));
      const el = $(message);
      if (el && el.textContent !== hint) el.textContent = hint;
    }
  }

  function sizeCanvasFor(id) {
    const sp = SHEETS.find(s => s.id === id) || SHEETS[0], c = stage();
    if (!c) return;
    if (c.width !== sp.w || c.height !== sp.h) {
      c.width = sp.w; c.height = sp.h;
      renderCache.delete(c);
    }
    const frame = $('#stageFrame');
    if (frame && frame.style) { frame.style.setProperty('--ar', `${sp.w}/${sp.h}`); frame.style.setProperty('--ar-num', String(sp.w / sp.h)); }
  }
  let rafId = 0;
  function redrawStage() {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
    if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(drawStageNow);
    else drawStageNow();
  }
  function drawStageNow() {
    if (S.view !== 'studio') return;
    syncScene();
    const p = S.phase, note = $('#stageNote');
    const c = stage();
    if (!c) return;
    if (p === 'empty') {
      sizeCanvasFor('main');
      const x = c.getContext && c.getContext('2d');
      if (x) x.clearRect(0, 0, c.width, c.height);
      renderCache.delete(c);
      if (note) note.textContent = `已选「${sceneName(S.scene)} · ${ROASTS[S.roast - 1].name}」场景氛围 · 上传照片或试用示例即可预览`;
      return;
    }
    const id = (p === 'result') ? S.sheet : (S.previewSheet || 'poster');
    sizeCanvasFor(id);
    if (p === 'result') {
      const k = S.kit[id];
      if (!k || k.status !== 'done') {
        const x = c.getContext && c.getContext('2d');
        if (x) x.clearRect(0, 0, c.width, c.height);
        renderCache.delete(c);
        return;
      }
      const issues = render(c, id, { mode: holdRaw ? 'raw' : ((S.live || S.isSample) ? k.mode : 'raw'), seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg, fit: holdRaw ? 'contain' : S.fitMode, fixedSize: true });
      k.issues = issues; updateResult();
      if (note) note.textContent = holdRaw ? '原片对照中' : (k.mode === 'scene' ? 'AI 场景生成 · 实时排版' : (k.mode === 'ai' && S.isSample ? '示例合成 · 未调用模型' : '原片版 · 商品未重绘'));
    } else {
      render(c, id, { mode: (S.live || S.isSample) ? 'ai' : 'raw', seed: 2, scene: S.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, fixedSize: true });
      if (note) note.textContent = !S.isSample
        ? `实时预览（原片排版）：已选「${sceneName(S.scene)}」场景，点击画面可放大查看`
        : `示例合成预览：${sceneName(S.scene)} · ${ROASTS[S.roast - 1].name}，点击画面可放大查看`;
    }
  }
  let allRaf = 0;
  function redrawAll() {
    if(allRaf) return;
    allRaf=requestAnimationFrame(()=>{allRaf=0;drawHome();
    if (S.view === 'studio') { redrawStage(); drawStrip(); }
    });
  }

  function drawStrip() {
    if(S.view !== 'studio') return;
    const ul = $('#strip');
    if (!ul) return;
    if (!['gen', 'result'].includes(S.phase)) { ul.innerHTML = ''; return; }
    if (ul.children.length !== SHEETS.length) {
      ul.innerHTML = SHEETS.map(s => `<li><button type="button" data-id="${s.id}"><span class="thumb" style="--ar:${s.w}/${s.h}"><canvas width="${Math.round(s.w / 4)}" height="${Math.round(s.h / 4)}"></canvas><i class="st"></i></span><span class="lbl">${s.name}</span></button></li>`).join('');
      $$('button', ul).forEach(b => b.addEventListener('click', () => { const k = S.kit[b.dataset.id]; if (k && k.status === 'error') return retrySheet(b.dataset.id); if (k && k.status === 'done') selectSheet(b.dataset.id); }));
    }
    SHEETS.forEach(s => {
      const b = $(`button[data-id=${s.id}]`, ul), k = S.kit[s.id] || { status: 'wait' };
      if (!b) return;
      b.dataset.status = k.status; b.setAttribute('aria-current', S.phase === 'result' && S.sheet === s.id ? 'true' : 'false');
      const lab = $('.lbl', b);
      if (lab) lab.textContent = k.status === 'error' ? `${s.name}：点击重做` : k.status === 'run' ? `${s.name}：生成中` : k.status === 'wait' ? `${s.name}：排队中` : s.name;
      if (k.status === 'done') render($('canvas', b), s.id, { mode: (S.live || S.isSample) ? k.mode : 'raw', seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg });
    });
  }
  function selectSheet(id) {
    cancelImageFlow();
    S.sheet = id; S.previewSheet = id;
    syncSpecTabs(); updateResult(); redrawStage(); drawStrip();
  }

  function updateResult() {
    updateExportUi();
    const sp = SHEETS.find(s => s.id === S.sheet), k = S.kit[S.sheet]; if (!k || !sp) return;
    syncImageActions();
    $('#resTitle').textContent = sp.name;
    $('#resSpec').textContent = `${sp.w} × ${sp.h} 像素 JPG · ${sp.use}`;
    const useAiMode = S.live || S.isSample;
    const fr = $(`input[name=fid][value=${useAiMode && k.mode !== 'raw' ? 'scene' : 'raw'}]`); if (fr) fr.checked = true;
    $$('input[name=fid]').forEach(i => { i.disabled = !useAiMode; });
    $('#fidNote').textContent = !useAiMode ? '离线示例不调用模型，你的照片只能看原片版式。' : (k.mode === 'scene' || k.mode === 'ai') ? (S.live ? '背景和光线由 AI 真实生成，会尽量保持商品原样，下载前请核对。' : '示例由本地合成，未调用模型，道具不代表随单附赠。') : '使用原片排版，保留商品原样。';
    $('#confirmRow').hidden = false;
    $('#vers').innerHTML = k.versions.map((v, i) => `<button type="button" data-i="${i}" aria-pressed="${i === k.cur}" aria-label="第 ${i + 1} 版">v${i + 1}</button>`).join('');
    $$('#vers button').forEach(b => b.addEventListener('click', () => { cancelImageFlow(); k.cur = +b.dataset.i; Object.assign(k, k.versions[k.cur]); redrawStage(); drawStrip(); updateResult(); }));
    const pending = Object.values(S.kit).filter(x => x.status !== 'done').length;
    $('#exportAll span').textContent = pending ? `下载已完成的 ${SHEETS.length - pending} 张和文案` : '打包下载全部 4 张和文案';
  }
  function updateExportUi() {
    for (const id of ['#cupOk', '#compareConfirm']) {
      const box = $(id);
      if (box) box.checked = !!S.cupOk;
    }
    $('#confirmRow')?.classList?.toggle('is-checked', !!S.cupOk);
    const reason = exportBlock();
    for (const id of ['#exportHint', '#compareExportHint']) {
      const hint = $(id);
      if (!hint) continue;
      if (hint.textContent !== reason) hint.textContent = reason;
      hint.dataset.err = reason ? '1' : '';
    }
    for (const id of ['#exportAll', '#compareAll']) $(id)?.setAttribute('aria-disabled', String(!!reason));
    for (const id of ['#exportOne', '#compareOne']) {
      $(id)?.setAttribute('aria-disabled', String(!!reason || S.kit[S.sheet]?.status !== 'done'));
    }
    renderAllCopy();
  }
  function exportBlock() {
    if (S.phase === 'gen') return '正在生成，完成后可下载';
    if (!S.photo || !Object.values(S.kit).some(k=>k.status==='done')) return '请先生成商品图';
    const invalid = validate();
    if (invalid) return invalid;
    if (!S.cupOk) return '勾选上方核对确认框后即可下载';
    const { shop, offer } = currentFacts();
    if (!shop && !offer) return '';
    const metrics = document.createElement('canvas').getContext?.('2d');
    if (!metrics) return '';
    const [bannerSpec, posterSpec] = SHEETS.filter(sheet => sheet.text);
    const banner = S.kit.banner;
    if (banner?.status === 'done') {
      const split = (S.live || S.isSample) && banner.mode === 'scene' && banner.sceneImg && S.fitMode !== 'cover';
      const subtitle = [shop, offer].filter(Boolean).join(' · ');
      if (!fitOffer(metrics, subtitle, bannerSpec.w * (split ? .48 : .55), bannerSpec.h * .085, bannerSpec.h * .05).ok) {
        return '活动文字太长，Banner 放不下，请返回改短一点';
      }
    }
    if (S.kit.poster?.status === 'done' && !fitOffer(metrics, offer, posterSpec.w * .56, posterSpec.w * .044, posterSpec.w * .028).ok) {
      return '活动文字太长，海报放不下，请返回改短一点';
    }
    return '';
  }

  /* ---------- 生成流程 ---------- */
  async function generate() {
    if (generationTask) return;
    const err = validate();
    if (err) { $('#briefErr').textContent = err; return; }
    $('#briefErr').textContent = '';
    if (S.live && !S.unlocked && S.remaining <= 0) return openUnlock();
    const task = beginGeneration();
    if (!task) return;
    try {
      const run = task.run; task.startedAt = Date.now(); S.kit = {}; S.cupOk = false; $('#cupOk').checked = false; S.sheet = 'main';
      SHEETS.forEach(sd => S.kit[sd.id] = { status: 'wait', mode: S.live ? 'scene' : 'ai', seed: 2, scene: S.scene, versions: [], cur: 0, sceneImg: null });
      $('#cancel').hidden = false;
      $('#genNote').textContent = S.live ? '在线生成可能需要一两分钟。返回编辑后，本次请求仍会继续。' : '本地排版处理中，未调用在线模型。';
      if (S.live) SHEETS.forEach(sd => { S.kit[sd.id].status = 'run'; });
      setPhase('gen');
      if (S.live) setGenerationStage('submit');
      else renderSteps();
      const tick = () => {
        if (generationTask !== task || S.phase !== 'gen') return;
        const sec = Math.floor((Date.now() - task.startedAt) / 1000);
        $('#genTimer').textContent = `已用时 ${sec} 秒`;
        setTimeout(tick, 1000);
      };
      if (typeof performance !== 'undefined') tick();

      if (S.live) {
        try {
          const result = await apiPost('/api/package', buildPayload(), stage => {
            if (run === S.run) setGenerationStage(stage);
          });
          if (run !== S.run) { saveLateResult(result, task); return; }
          acceptQuota(result);
          imageRecovery = { run, result, kind: 'package' };
          await recoverImage(imageRecovery);
        } catch (e) {
          if (run !== S.run) return;
          if (e.code === 'QUOTA_EXCEEDED') { S.remaining = 0; setPhase('ready'); return openUnlock(); }
          if (e.code === 'RATE_LIMIT') return showError('ratelimit');
          if (['GENERATION_BUSY', 'PUBLIC_BUDGET_EXCEEDED', 'INPUT_INVALID', 'MODEL_FAILED', 'QUOTA_REPAIR_REQUIRED'].includes(e.code)) return showError('server', e.message);
          return showError('network');
        }
        return;
      }

      /* 离线示例模式：本地示意合成，不调用模型，界面明确标注 */
      await wait(450); if (run !== S.run) return;
      for (const sd of SHEETS) {
        const k = S.kit[sd.id]; k.status = 'run'; drawStrip(); renderSteps();
        await wait(reduced() ? 40 : 280); if (run !== S.run) return;
        finishSheet(k);
        drawStrip(); renderSteps();
        if (!reduced()) dealIn(sd.id);
      }
      S.sheet = SHEETS.find(sd => S.kit[sd.id].status === 'done').id;
      S.aiTitle = ''; S.aiDetail = ''; S.aiPoints = []; S.copyStale = false;
      setPhase('result'); toast('示例已生成（未调用在线 AI 模型）');
      updateResult();
    } finally { finishGeneration(task); }
  }

  function addVersion(k) {
    k.versions.push({ seed: k.seed, scene: k.scene, mode: k.mode, sceneImg: k.sceneImg, facts: currentFacts(), createdAt: Date.now() });
    if (k.versions.length > 5) k.versions.splice(0, k.versions.length - 5);
    k.cur = k.versions.length - 1;
  }
  function finishSheet(k) { k.status = 'done'; addVersion(k); }
  function dealIn(id) {
    const b = $(`#strip button[data-id=${id}]`); if (!b || !b.animate) return;
    b.animate([{ transform: 'translateY(-16px) scale(1.06)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function setGenerationStage(stage) {
    const labels = {
      submit: '已发起请求，正在等待在线服务确认…',
      copy: '在线服务已接收资料，正在生成文案…',
      scene: '文案已生成，正在生成商品场景…',
      settling: '场景已生成，正在确认生成记录…',
      download: '生成已完成，正在载入图片并排版…',
    };
    const steps = $('#steps');
    if (!steps || !Object.hasOwn(labels, stage)) return;
    steps.innerHTML = '<li data-status="run"><span></span></li>';
    $('#steps span').textContent = labels[stage];
    const badge = $('#stageLiveBadge');
    if (badge && S.phase === 'gen') badge.textContent = labels[stage];
  }
  function renderSteps() {
    const el = $('#steps');
    if (!el) return;
    el.innerHTML = SHEETS.map(s => {
      const k = S.kit[s.id]; const t = { wait: '排队中', run: '生成中', done: '已完成', error: '没做成' }[k.status];
      return `<li data-status="${k.status}"><span>${s.name}</span><em>${t}</em></li>`;
    }).join('');
  }
  async function retrySheet(id) {
    const k = S.kit[id]; k.status = 'run'; drawStrip(); await wait(500);
    finishSheet(k); selectSheet(id); toast(`${SHEETS.find(s => s.id === id).name}已重做，不扣次数`); updateResult();
  }
  function showError(kind, message) {
    const c = {
      server: ['这次没做成', message + '。信息和照片都还在。'],
      network: ['没连上模型', '网络中断或服务超时。信息和照片都还在，可以直接重新包装；剩余次数以右上角为准。'],
      moderation: ['这张照片没通过模型检查', '模型拒绝处理这张照片，这次没有扣次数。换一张只拍商品的照片，或回去调整文字。'],
      ratelimit: ['操作太频繁', '为了公平使用，请稍等一分钟再试。这次没有扣次数。'],
    }[kind] || ['生成失败', '这次没有扣次数，信息和照片都还在，可以重新包装。'];
    $('#errTitle').textContent = c[0]; $('#errBody').textContent = c[1]; setPhase('error');
  }
  const wait = ms => new Promise(r => setTimeout(r, reduced() ? Math.min(ms, 80) : ms));

  /* ---------- 上传与示例 ---------- */
  function takeFile(f) {
    cancelPhotoSelection();
    const msg = $('#photoMsg'); msg.dataset.kind = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { msg.dataset.kind = 'err'; msg.textContent = '这个文件不是 JPG、PNG 或 WebP，换一张试试。'; return; }
    if (f.size > 10 * 1024 * 1024) { msg.dataset.kind = 'err'; msg.textContent = '照片超过 10 MB。压缩一下或换一张。'; return; }
    invalidateImageRequest();
    msg.textContent = '正在读取照片…';
    const url = URL.createObjectURL(f), im = new Image();
    let cleaned = false;
    const selection = { cleanup() { if (!cleaned) { cleaned = true; URL.revokeObjectURL(url); } } };
    photoSelection = selection;
    im.onload = () => {
      selection.cleanup();
      if (photoSelection !== selection) return;
      photoSelection = null;
      const short = Math.min(im.naturalWidth, im.naturalHeight);
      photoRevision++; S.kit = {}; invalidateCopy(); S.photo = im; S.isSample = false; pendingFile = f;
      setFitMode('contain');
      msg.dataset.kind = short < 800 ? 'warn' : '';
      const orient = im.naturalHeight > im.naturalWidth * 1.08 ? '竖构图' : im.naturalWidth > im.naturalHeight * 1.08 ? '横构图' : '方构图';
      msg.innerHTML = short < 800 ? `<span>已选用${orient}（短边 ${short} px，导出可能偏虚）</span><button type="button" class="link" id="rePick">换一张</button>` : `<span>已选用${orient}（${im.naturalWidth}×${im.naturalHeight}）</span><button type="button" class="link" id="rePick">换一张</button>`;
      $('#rePick').addEventListener('click', () => $('#file').click());
      setPhase('ready');
    };
    im.onerror = () => {
      selection.cleanup();
      if (photoSelection !== selection) return;
      photoSelection = null;
      msg.dataset.kind = 'err'; msg.textContent = '这张照片打不开，可能已损坏。换一张试试。';
    };
    im.src = url;
  }
  function removePhoto() {
    if (!S.photo) return;
    cancelPhotoSelection();
    invalidateImageRequest();
    if (generationTask) generationTask.discardPhotoResult = true;
    photoRevision++;
    pendingFile = null;
    shrinkCache = null;
    retryRequests.clear();
    S.photo = null;
    S.isSample = false;
    S.kit = {};
    S.lateResults = [];
    S.aiTitle = '';
    S.aiDetail = '';
    S.aiPoints = [];
    S.copyStale = false;
    delete S.editedCopyStale;
    delete S.copyUndoStale;
    delete S.editedCopy;
    delete S.copyUndo;
    delete S.sampleUndo;
    $('#sampleUndo').hidden = true;
    $('#lateResult').hidden = true;
    $('#file').value = '';
    $('#briefErr').textContent = '';
    const msg = $('#photoMsg');
    msg.dataset.kind = '';
    msg.textContent = '';
    setFitMode('contain');
    setPhase('empty');
    $('#drop').focus();
    toast('已移除照片，商品信息已保留');
  }
  async function useSample(scene = S.scene) {
    const revision = photoRevision;
    try { await ensureSampleAssets(); } catch { toast('示例读取失败，可重试或上传照片'); return; }
    if (revision !== photoRevision) return;
    if(!S.isSample) S.sampleUndo={kit:S.kit,photo:S.photo,isSample:S.isSample,name:S.name,shop:S.shop,price:S.price,offer:S.offer,high:S.high,scene:S.scene,fitMode:S.fitMode,photoMsg:$('#photoMsg').innerHTML,photoKind:$('#photoMsg').dataset.kind};
    S.scene=scene;
    cancelPhotoSelection(); invalidateImageRequest(); photoRevision++;
    if($('#sampleUndo')) $('#sampleUndo').hidden=false;
    if (!S.isSample) { S.kit = {}; invalidateCopy(); }
    S.photo = img.photo; S.isSample = true; pendingFile = null;
    setFitMode('contain');
    S.name = S.name || '冰奶油拿铁'; S.price = S.price || '18'; S.shop = S.shop || '拾叶咖啡';
    syncAllInputs();
    $('#photoMsg').dataset.kind = '';
    $('#photoMsg').innerHTML = '<span>正在使用「冰奶油拿铁」示例图</span><button type="button" class="link" id="rePick">换我的照片</button>';
    $('#rePick').addEventListener('click', () => $('#file').click());
    setPhase('ready');
  }
  function syncAllInputs() {
    const inputs = {
      name: ['#iName', '#phInputName'], price: ['#iPrice', '#phInputPrice', '#fPrice'],
      shop: ['#iShop', '#phInputShop'], offer: ['#iOffer', '#phInputOffer', '#fOffer'], high: ['#iHigh'],
    };
    for (const [key, ids] of Object.entries(inputs)) for (const id of ids) {
      const input = $(id);
      if (input && input.value !== S[key]) input.value = S[key];
    }
    syncScene();
    updateBriefSummary();
  }

  /* ---------- 下载导出 ---------- */
  async function sheetBlob(id) {
    const sp = SHEETS.find(s => s.id === id), k = S.kit[id], c = document.createElement('canvas');
    c.width = sp.w; c.height = sp.h;
    render(c, id, { mode: (S.live || S.isSample) ? k.mode : 'raw', seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg });
    let q = .9, b;
    do { b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); if (!b) throw new Error('JPEG encoding failed'); q -= .08; } while (b.size > sp.max * 1048576 && q > .4);
    return b;
  }
  function safeProductFilename(name) {
    const cleaned = name.normalize('NFC')
      .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069<>:"/\\|?*]/g, '_')
      .replace(/^[.\s]+|[.\s]+$/g, '');
    if (!cleaned || /^_+$/.test(cleaned)) return '商品';
    return /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned;
  }
  const fname = (id, name = currentFacts().name) => {
    const sp = SHEETS.find(s => s.id === id);
    return `${safeProductFilename(name)}_${sp.name}_${sp.w}x${sp.h}.jpg`;
  };
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportAll() {
    const r = exportBlock(); if (r) { toast(r); return; }
    const btn = $('#exportAll');
    if (btn.getAttribute('aria-busy') === 'true') return;
    btn.setAttribute('aria-busy', 'true');
    const facts = currentFacts(), copy = exportCopy(facts);
    try {
      const images = SHEETS.filter(s => S.kit[s.id]?.status === 'done')
        .map(s => ({ name: fname(s.id, facts.name), blob: sheetBlob(s.id) }));
      const imagesReady = await Promise.all(images.map(async ({name, blob}) => ({
        name, data: new Uint8Array(await (await blob).arrayBuffer()),
      })));
      const files = [...imagesReady, { name: '上架文案.txt', data: new TextEncoder().encode(copy) }];
      const zip = makeZip(files);
      window.__lastExport = files.map(f => ({ name: f.name, size: f.data.length }));
      save(zip, `CafeBrief_${safeProductFilename(facts.name)}.zip`);
      toast(`已下载 ${files.length - 1} 张图和文案`);
    } catch { toast('打包未完成，请重试'); }
    finally { btn.removeAttribute('aria-busy'); }
  }
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = d => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = crcT[(c ^ d[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
    for (const f of files) {
      const n = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, n.length, true);
      parts.push(h.buffer, n, f.data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
      cen.push(c.buffer, n); off += 30 + n.length + f.data.length;
    }
    const size = cen.reduce((a, b) => a + b.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, e.buffer], { type: 'application/zip' });
  }

  /* ---------- 解锁 ---------- */
  function openUnlock() {
    if ($('#ulErr')) $('#ulErr').textContent = '';
    if ($('#ulPwd')) $('#ulPwd').value = '';
    const dlg = $('#unlock');
    if (dlg && dlg.showModal) dlg.showModal();
    if ($('#ulPwd') && $('#ulPwd').focus) $('#ulPwd').focus();
  }
  function mountUnlock() {
    $('#ulForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!S.live) { $('#ulErr').textContent = '解锁在连接在线服务后可用，现在可先体验本地示例。'; return; }
      const pwd = $('#ulPwd').value;
      if (!pwd) { $('#ulErr').textContent = '请输入解锁密码。'; return; }
      try {
        const result = await apiPost('/api/unlock', { password: pwd });
        try { if (result.token) localStorage.setItem(TOKEN_KEY, result.token); } catch {}
        acceptQuota({...result,unlimited:true}); try {sessionStorage.removeItem(STATUS_KEY);}catch{}
        $('#unlock').close(); updateQuota(); updateServiceUi('online'); toast('已解锁，不限次数');
      } catch (err) {
        $('#ulErr').textContent = (err && err.message) || '没有连上服务，请重试';
      }
    });
    $('#ulClose').addEventListener('click', () => $('#unlock').close());
    if ($('#topUnlockBtn')) $('#topUnlockBtn').addEventListener('click', openUnlock);
    if ($('#openUnlockSide')) $('#openUnlockSide').addEventListener('click', openUnlock);
  }

  /* ---------- 按住对比 ---------- */
  let holdRaw = false;
  function mountHold() {
    const b = $('#holdCompare');
    if (!b) return;
    const on = e => { e.preventDefault(); holdRaw = true; b.setAttribute('aria-pressed', 'true'); if ($('#stageLiveBadge')) { $('#stageLiveBadge').hidden = false; $('#stageLiveBadge').dataset.kind = 'raw'; $('#stageLiveBadge').textContent = '原片对照中'; } drawStageNow(); };
    const off = () => { if (!holdRaw) return; holdRaw = false; b.setAttribute('aria-pressed', 'false'); if ($('#stageLiveBadge') && S.phase !== 'gen') $('#stageLiveBadge').hidden = true; drawStageNow(); };
    b.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(n => b.addEventListener(n, off));
    b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') on(e); }); b.addEventListener('keyup', off);
  }

  let toastT = 0;
  function toast(t) { const el = $('#toast'); if (!el) return; el.textContent = t; el.dataset.on = '1'; clearTimeout(toastT); toastT = setTimeout(() => el.dataset.on = '', 3200); }

  /* ---------- 左侧操作栏多页面切换 ---------- */
  function switchView(v, pushHash = true) {
    if (!Object.hasOwn(VIEWS, v)) v = 'studio';
    if (pushHash && S.view !== v && typeof history !== 'undefined') history.pushState(null, '', '#' + v);
    S.view = v;
    root.dataset.view = v;
    $$('.page-view').forEach(sec => { sec.hidden = sec.dataset.page !== v; });
    $$('[data-nav]').forEach(btn => {
      const active = btn.dataset.nav === v;
      if (btn.classList) btn.classList.toggle('is-active', active);
      if (active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    if ($('#viewTitle')) $('#viewTitle').textContent = VIEWS[v].title;
    if ($('#viewDesc')) $('#viewDesc').textContent = VIEWS[v].desc;
    if (v === 'studio') {
      if (S.pendingSample) { S.pendingSample = false; useSample(); }
      else redrawStage();
    } else if (v === 'phone') {
      syncAllInputs();
      renderPhoneView();
    } else if (v === 'compare') {
      renderCompareView();
    }
  }

  function route() {
    const h = (typeof location !== 'undefined' && location.hash ? location.hash.slice(1) : '') || 'studio';
    if (h === 'main') return;
    const v = Object.hasOwn(VIEWS, h) ? h : 'studio';
    switchView(v, false);
  }

  /* ---------- 渐进信息与服务详情（仅界面状态） ---------- */
  function updateBriefSummary() {
    const count = ['#iShop', '#iOffer', '#iHigh'].filter(id => $(id)?.value.trim()).length;
    if ($('#moreBriefCount')) $('#moreBriefCount').textContent = count ? `已填 ${count} 项` : '选填';
  }
  function mountProgressiveUi() {
    const more = $('#moreBriefDetails'), trigger = $('#svcToggle'), panel = $('#svcDetails');
    if (more) {
      more.addEventListener('input', updateBriefSummary);
      more.addEventListener('focusin', e => { if (e.target.closest('.more-brief-body')) more.open = true; });
      more.addEventListener('invalid', () => { more.open = true; }, true);
      $('#quickTags')?.addEventListener('click', updateBriefSummary);
    }
    if (trigger && panel) {
      const show = open => {
        panel.hidden = !open;
        trigger.setAttribute('aria-expanded', String(open));
        trigger.setAttribute('aria-label', open ? '收起服务状态详情' : '展开服务状态详情');
      };
      trigger.addEventListener('click', () => show(panel.hidden));
      trigger.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(panel.hidden); } });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { show(false); trigger.focus(); } });
      document.addEventListener('click', e => { if (!panel.hidden && !$('#svcCard').contains(e.target)) show(false); });
    }
    updateBriefSummary();
  }

  /* ---------- 工作台绑定 ---------- */
  function mountStudio() {
    $('#scenes').innerHTML = SCENES.map(s => `<label class="chip scene-${s.id}"><i aria-hidden="true"></i><input type="radio" name="scene" value="${s.id}" ${s.id === S.scene ? 'checked' : ''}><span>${s.name}</span></label>`).join('');
    $$('input[name=scene]').forEach(i => i.addEventListener('change', () => { invalidateImageRequest(); S.scene = i.value; syncScene(); redrawStage(); redrawAll(); }));
    for (const [id, key] of [['#iName', 'name'], ['#iPrice', 'price'], ['#iShop', 'shop'], ['#iOffer', 'offer'], ['#iHigh', 'high']]) {
      $(id).addEventListener('input', e => updateFact(key, e.target.value));
    }
    for (const id of ['#iPrice', '#phInputPrice', '#fPrice']) {
      $(id)?.addEventListener('blur', () => { priceTouched = true; updateGo(); });
    }
    $('#returnResult')?.addEventListener('click', () => {
      if (Object.values(S.kit).some(k => k.status === 'done')) setPhase('result');
    });

    $$('#specTabs .spec-tab').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.spec;
      if (S.phase === 'result' && S.kit[id] && S.kit[id].status === 'done') {
        selectSheet(id);
      } else {
        S.previewSheet = id;
        syncSpecTabs();
        redrawStage();
      }
    }));

    const drop = $('#drop');
    drop.addEventListener('click', () => $('#file').click());
    $('#removePhoto')?.addEventListener('click', removePhoto);
    if ($('#pickPhotoBtn')) $('#pickPhotoBtn').addEventListener('click', () => $('#file').click());
    if ($('#dropSampleBtn')) $('#dropSampleBtn').addEventListener('click', () => useSample());
    if ($('#trySample')) $('#trySample').addEventListener('click', () => { switchView('studio'); useSample(); });

    $('#file').addEventListener('change', e => { if (e.target.files[0]) takeFile(e.target.files[0]); e.target.value = ''; });
    ['dragover', 'dragenter'].forEach(n => $('#stageFrame').addEventListener(n, e => { e.preventDefault(); $('#stageFrame').dataset.over = '1'; }));
    ['dragleave', 'drop'].forEach(n => $('#stageFrame').addEventListener(n, e => { e.preventDefault(); $('#stageFrame').dataset.over = ''; }));
    $('#stageFrame').addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) takeFile(f); });
    $('#go').addEventListener('click', () => {
      const err = validate();
      if (err) {
        if (!S.photo) $('#drop')?.focus?.();
        else if (!S.name.trim() || S.name.trim().length > 40) { $('#iName')?.focus?.(); const f = $('#iName')?.closest?.('.field'); if (f?.classList) { f.classList.remove('is-invalid'); void f.offsetWidth; f.classList.add('is-invalid'); setTimeout(() => f.classList.remove('is-invalid'), 600); } }
        else { priceTouched = true; updateGo(); $('#iPrice')?.focus?.(); const f = $('#iPrice')?.closest?.('.field'); if (f?.classList) { f.classList.remove('is-invalid'); void f.offsetWidth; f.classList.add('is-invalid'); setTimeout(() => f.classList.remove('is-invalid'), 600); } }
      }
      return generate();
    });
    $('#cancel').addEventListener('click', () => { cancelPhotoSelection(); cancelImageFlow(); setPhase('ready'); $('#briefErr').textContent=generationTask?'上一笔生成仍在处理中，完成后可查看上一稿。':'';toast('已退出等待；已提交任务仍会继续'); });
    $('#errRetry').addEventListener('click', () => { if (imageRecovery) return recoverImage(imageRecovery); S.scenario = 'ok'; return generate(); });
    $('#errBack').addEventListener('click', () => { cancelPhotoSelection(); cancelImageFlow(); setPhase('ready'); });
    $('#restart').addEventListener('click', () => { cancelPhotoSelection(); cancelImageFlow(); setPhase('ready'); });
    $('#again').addEventListener('click', async () => {
      if (!S.kit[S.sheet] || S.kit[S.sheet].status !== 'done') return;
      if(S.live && !S.unlocked && S.remaining <= 0) {openUnlock();return;}
      const task = beginGeneration('again');
      if (!task) return;
      try {
        const k = S.kit[S.sheet]; const b = $('#again');
        if (S.live) {
          const run = task.run;
          b.setAttribute('aria-busy', 'true');
          try {
            const result = await apiPost('/api/generate-image', buildPayload());
            if (run !== S.run) { saveLateResult(result, task); return; }
            acceptQuota(result);
            imageRecovery = { run, result, kind: 'again', kit: k, sheet: S.sheet };
            await recoverImage(imageRecovery);
          } catch (e) {
            if (run !== S.run) return;
            if (e.code === 'QUOTA_EXCEEDED') { S.remaining = 0; updateQuota(); openUnlock(); }
            else toast((e && e.code && e.message) || '这一版没做成，请稍后再试');
          }
          return;
        }
        b.setAttribute('aria-busy', 'true'); await wait(400);
        if (task.run !== S.run) return;
        k.seed = k.seed + 1 + Math.floor(Math.random() * 3); k.scene = SCENES[(SCENES.findIndex(sd => sd.id === k.scene) + 1) % SCENES.length].id; k.mode = 'ai';
        addVersion(k);
        S.cupOk = false; $('#cupOk').checked = false; b.removeAttribute('aria-busy');
        redrawStage(); drawStrip(); updateResult(); toast('示例第 ' + k.versions.length + ' 版（未调用模型）');
      } finally { finishGeneration(task); }
    });
    $$('input[name=fid]').forEach(i => i.addEventListener('change', () => { cancelImageFlow(); const k = S.kit[S.sheet]; const m = i.value === 'raw' ? 'raw' : (S.live ? 'scene' : 'ai'); k.mode = m; k.versions[k.cur].mode = m; redrawStage(); drawStrip(); updateResult(); }));
    $('#cupOk').addEventListener('change', e => { S.cupOk = e.target.checked; updateResult(); });
    $('#exportAll').addEventListener('click', exportAll);
    $('#exportOne').addEventListener('click', async () => {
      const reason = exportBlock();
      if (reason) return toast(reason);
      const id = S.sheet;
      if (S.kit[id]?.status !== 'done') return toast('这个规格还未生成');
      const name = fname(id);
      try { save(await sheetBlob(id), name); toast(`已下载${SHEETS.find(s => s.id === id).name}`); }
      catch { toast('图片下载未完成，请重试'); }
    });
    $('#copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(exportCopy(currentFacts()));
        const btn = $('#copyBtn'), sp = $('#copyBtn span');
        if (btn?.classList && sp) {
          btn.classList.add('is-copied'); sp.textContent = '✓ 已复制';
          setTimeout(() => { btn.classList.remove('is-copied'); sp.textContent = '复制文案'; }, 1800);
        }
        toast('文案已复制到剪贴板');
      } catch { toast('浏览器没允许复制，请手动选中'); }
    });
    $('#showPhone').addEventListener('click', () => {
      switchView('phone');
    });
    if ($('#pdClose')) $('#pdClose').addEventListener('click', () => $('#phoneDlg').close());
    $$('[data-nav]').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.nav)));
    $('#compareOne')?.addEventListener('click',()=>$('#exportOne').click());
    $('#compareAll')?.addEventListener('click',()=>$('#exportAll').click());
    $('#compareConfirm')?.addEventListener('change',e=>{$('#cupOk').checked=e.target.checked;S.cupOk=e.target.checked;updateResult();});
    $$('.sample-presets button').forEach(b=>b.addEventListener('click',()=>useSample(b.dataset.sample)));
    $('#sampleUndo')?.addEventListener('click', () => {
      if (!S.sampleUndo) return;
      const { photoMsg, photoKind, ...previous } = S.sampleUndo;
      Object.assign(S, previous);
      invalidateCopy();
      photoRevision++;
      syncAllInputs();
      invalidateImageRequest();
      setFitMode(previous.fitMode);
      const msg = $('#photoMsg');
      msg.innerHTML = photoMsg;
      msg.dataset.kind = photoKind || '';
      $('#rePick')?.addEventListener('click', () => $('#file').click());
      $('#sampleUndo').hidden = true;
      delete S.sampleUndo;
      setPhase(S.photo ? 'ready' : 'empty');
    });
    const setEditedCopy = (copy, stale = false) => {
      S.copyUndo = S.editedCopy;
      S.copyUndoStale = S.editedCopyStale;
      S.editedCopy = copy;
      S.editedCopyStale = stale;
      S.cupOk = false;
      updateExportUi();
    };
    $('#resCopy')?.addEventListener('input', e => setEditedCopy(e.target.innerText ?? e.target.textContent));
    $('#copyReset')?.addEventListener('click', () => setEditedCopy(undefined));
    $('#copyUndo')?.addEventListener('click', () => setEditedCopy(S.copyUndo, S.copyUndoStale));
    $('#copyReapply')?.addEventListener('click', () => setEditedCopy(S.editedCopy));
    $$('#quickTags button').forEach(b => b.addEventListener('click', () => {const set=new Set(S.high.split(/[，,；;]/).map(x=>x.trim()).filter(Boolean));if(set.has(b.textContent))set.delete(b.textContent);else set.add(b.textContent);updateFact('high',[...set].join('，'));b.setAttribute('aria-pressed',set.has(b.textContent));}));
    $('#lateResult')?.addEventListener('click', async () => {const last=S.lateResults.at(-1);if(!last || generationTask)return;Object.assign(S,last.facts);invalidateCopy();syncAllInputs();invalidateImageRequest();S.sheet=last.sheet||'main';if(last.kind==='package')SHEETS.forEach(sd=>S.kit[sd.id]={status:'wait',mode:'scene',seed:2,scene:S.scene,versions:[],cur:0});imageRecovery={run:S.run,result:last.result,kind:last.kind||'package',kit:S.kit[S.sheet],sheet:S.sheet};$('#lateResult').hidden=true;await recoverImage(imageRecovery);});
    if ($('#retryConnect')) $('#retryConnect').addEventListener('click', () => retryProbe(true));
  }

  /* ---------- 服务状态与非阻塞启动 ---------- */
  function updateServiceUi(state) {
    S.engine = state;
    const label = {ready:'工作台已就绪', online:'在线生成可用', demo:'本地排版可用', locked:'免费额度已用完'};
    const card = $('#svcCard'), banner = $('#svcBanner');
    if(card) card.dataset.state = state;
    if(banner) {banner.dataset.state = state; banner.textContent = label[state];}
    if($('#svcSub')) $('#svcSub').textContent = state === 'ready' ? '额度待确认' : state === 'demo' ? '未连接在线服务' : S.unlocked ? '不限次' : `剩余 ${S.remaining} 次`;
    if($('#retryConnect')) $('#retryConnect').hidden = state === 'online';
    updateQuota();
  }
  async function probeBackend(showToastOnResult = false) {
    const seq = ++probeSeq, revision = quotaRevision;
    try {
      const st = await apiStatus();
      if(typeof st.unlimited !== 'boolean' || (!st.unlimited && (!Number.isFinite(st.remaining) || st.remaining < 0))) throw Error('status');
      if(seq !== probeSeq || revision !== quotaRevision) return;
      S.live = st.configured !== false; S.unlocked = st.unlimited; S.remaining = st.remaining;
      try { sessionStorage.setItem(STATUS_KEY, JSON.stringify({st,at:Date.now()})); } catch {}
      updateServiceUi(!S.live ? 'demo' : (!S.unlocked && S.remaining <= 0 ? 'locked' : 'online'));
    } catch {
      if(seq !== probeSeq || revision !== quotaRevision) return;
      S.live = false; updateServiceUi('demo');
    } finally { if(seq === probeSeq) probePromise = null; }
  }
  function retryProbe(showToastOnResult = false) {
    probePromise = probeBackend(showToastOnResult); return probePromise;
  }
  function restoreStatus() {
    try {
      const cache = JSON.parse(sessionStorage.getItem(STATUS_KEY)), age = Date.now() - cache.at;
      if(age < 0 || age > 300000) return false;
      S.live = cache.st.configured !== false; S.unlocked = cache.st.unlimited; S.remaining = cache.st.remaining;
      updateServiceUi(age > 30000 ? 'ready' : (!S.live ? 'demo' : (!S.unlocked && S.remaining <= 0 ? 'locked' : 'online')));
      if(age > 30000 && $('#svcSub')) $('#svcSub').textContent += ' · 上次成功 ' + new Date(cache.at).toLocaleTimeString();
      return age <= 30000;
    } catch { return false; }
  }
  function ensureSampleAssets() {
    if(samplePromise) return samplePromise;
    samplePromise = Promise.all([['cut','assets/sample-cut.webp'],['photo','assets/sample-photo.webp']].map(async ([key,url]) => {
      img[key].src = url; await img[key].decode();
    }).concat(Object.entries(SCENE_URLS).map(async ([key,url]) => {
      const scene = img.scenes[key] || (img.scenes[key] = new Image());
      scene.src = url; await scene.decode();
    }))).then(() => { assetsReady = true; }).catch(e => {samplePromise = null; assetsReady = false; throw e;});
    return samplePromise;
  }


  /* ---------- 构图模式切换 & 高清大图缩放查看器 ---------- */
  function sceneSource(spec) {
    return S.phase === 'result' ? S.kit[spec]?.sceneImg : null;
  }

  function syncImageActions() {
    const ready = S.phase === 'ready' || S.phase === 'result';
    const original = $('#viewOriginal'), ai = $('#viewAiSource');
    if (original) original.hidden = !ready || !S.photo;
    if (ai) ai.hidden = !sceneSource(S.sheet);
    if ($('#zoomStageBtn')) $('#zoomStageBtn').textContent = S.phase === 'result' ? '查看成品' : '查看预览';
    $$('[data-view-proof]').forEach(button => { button.disabled = !ready; });
  }

  function setFitMode(mode) {
    S.fitMode = mode === 'cover' ? 'cover' : 'contain';
    for (const id of ['#fitModeBtn', '#lbFitBtn']) {
      $(id)?.setAttribute('aria-pressed', String(S.fitMode === 'cover'));
    }
    redrawAll();
    if ($('#lightboxDlg')?.open) renderLightbox();
  }

  const lb = { zoom: 1, tx: 0, ty: 0, spec: 'main', source: 'product', opener: null,
    dragging: false, startX: 0, startY: 0, origX: 0, origY: 0, pointers: new Map(), pinchDist: 0, pinchZoom: 1 };

  function applyLbTransform() {
    lb.zoom = Math.max(1, Math.min(4, lb.zoom));
    const pan = $('#lbPan'), stageEl = $('#lbStage'), canvas = $('#lbCanvas');
    const maxX = Math.max(0, (canvas.offsetWidth * lb.zoom - stageEl.clientWidth) / 2);
    const maxY = Math.max(0, (canvas.offsetHeight * lb.zoom - stageEl.clientHeight) / 2);
    lb.tx = Math.max(-maxX, Math.min(maxX, lb.tx));
    lb.ty = Math.max(-maxY, Math.min(maxY, lb.ty));
    pan.style.transform = `translate(${lb.tx}px, ${lb.ty}px) scale(${lb.zoom})`;
    stageEl.dataset.zoomed = lb.zoom > 1 ? '1' : '0';
    $('#lbZoomLabel').textContent = Math.round(lb.zoom * 100) + '%';
    $('#lbZoomOut').disabled = lb.zoom === 1;
    $('#lbZoomIn').disabled = lb.zoom === 4;
  }

  function renderLightbox() {
    const c = $('#lbCanvas');
    const sp = SHEETS.find(s => s.id === lb.spec) || SHEETS[0];
    const ai = sceneSource(sp.id);
    if (lb.source === 'ai' && !ai) lb.source = 'product';
    const pic = lb.source === 'original' ? S.photo : lb.source === 'ai' ? ai : null;
    const width = pic ? pic.naturalWidth || pic.width : sp.w;
    const height = pic ? pic.naturalHeight || pic.height : sp.h;
    c.width = width; c.height = height;
    renderCache.delete(c);
    $('#lbTitle').textContent = pic ? (lb.source === 'original' ? '原片' : 'AI 源图') : sp.name;
    $('#lbSpecInfo').textContent = `${width} × ${height} px`;
    $('#lbRawToggle').setAttribute('aria-pressed', String(lb.source === 'original'));
    $('#lbAiSource').hidden = !ai;
    $('#lbAiSource').setAttribute('aria-pressed', String(lb.source === 'ai'));
    $('#lbFitBtn').hidden = !!pic;
    const k = S.phase === 'result' && S.kit[sp.id]?.status === 'done' ? S.kit[sp.id] : null;
    $('#lbDownload').hidden = !!pic || !k;
    $('#lbDownloadNote').textContent = '';
    if (pic) {
      c.getContext('2d').drawImage(pic, 0, 0);
    } else {
      render(c, sp.id, {
        mode: (S.live || S.isSample) ? k?.mode || 'ai' : 'raw',
        seed: k?.seed ?? 2,
        scene: k?.scene || S.scene,
        facts: S.view === 'compare' && !k ? previewFacts() : currentFacts(),
        src: S.isSample ? null : S.photo,
        sceneImg: k?.sceneImg,
        fixedSize: true,
      });
    }
    $$('#lbSpecs .lb-spec-tab').forEach(button => {
      const selected = !pic && button.dataset.spec === sp.id;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    fitLightboxCanvas();
  }

  function fitLightboxCanvas() {
    const stageEl = $('#lbStage'), c = $('#lbCanvas');
    const inset = 24;
    const scale = Math.min((stageEl.clientWidth - inset) / c.width, (stageEl.clientHeight - inset) / c.height);
    c.style.width = `${Math.max(1, c.width * scale)}px`;
    c.style.height = `${Math.max(1, c.height * scale)}px`;
    applyLbTransform();
  }

  function chooseLightboxSource(source, spec = lb.spec) {
    lb.source = source; lb.spec = spec;
    lb.zoom = 1; lb.tx = 0; lb.ty = 0;
    renderLightbox();
  }

  function openLightbox(spec, source = 'product', opener = document.activeElement) {
    if (!S.photo || !['ready', 'result'].includes(S.phase)) return;
    const dlg = $('#lightboxDlg');
    if (!dlg || dlg.open || typeof dlg.showModal !== 'function') return;
    const active = spec || (S.phase === 'result' || S.view === 'compare' ? S.sheet : S.previewSheet);
    lb.opener = opener;
    const host = $('#lbSpecs');
    if (!host.children.length) {
      host.innerHTML = SHEETS.map(s => `<button type="button" class="lb-spec-tab" data-spec="${s.id}">${s.name}</button>`).join('');
      $$('.lb-spec-tab', host).forEach(button => button.addEventListener('click', () => chooseLightboxSource('product', button.dataset.spec)));
    }
    dlg.showModal();
    chooseLightboxSource(source, active || 'main');
  }

  function mountFitAndLightbox() {
    const changeFit = () => {
      S.cupOk = false;
      setFitMode(S.fitMode === 'contain' ? 'cover' : 'contain');
      if (S.phase === 'result') updateResult();
      toast(S.fitMode === 'contain' ? '已保留照片四边' : '已铺满图框，照片边缘可能被裁切');
    };
    $('#fitModeBtn')?.addEventListener('click', changeFit);
    $('#lbFitBtn')?.addEventListener('click', changeFit);
    $('#stageCanvas')?.addEventListener('click', () => openLightbox(undefined, 'product', $('#zoomStageBtn')));
    for (const [id, source] of [['#zoomStageBtn', 'product'], ['#compareZoomBtn', 'product'], ['#viewOriginal', 'original'], ['#viewAiSource', 'ai']]) {
      $(id)?.addEventListener('click', e => openLightbox(undefined, source, e.currentTarget));
    }

    const dlg = $('#lightboxDlg'), stageEl = $('#lbStage');
    if (!dlg || !stageEl) return;
    $('#lbClose')?.addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    $('#lbRawToggle')?.addEventListener('click', () => chooseLightboxSource(lb.source === 'original' ? 'product' : 'original'));
    $('#lbAiSource')?.addEventListener('click', () => chooseLightboxSource(lb.source === 'ai' ? 'product' : 'ai'));
    dlg.addEventListener('close', () => {
      lb.pointers.clear(); lb.pinchDist = 0; lb.dragging = false;
      stageEl.dataset.dragging = '0';
      if (lb.opener?.isConnected) lb.opener.focus({ preventScroll: true });
    });
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (dlg.open) fitLightboxCanvas(); }).observe(stageEl);
    }
    $('#lbZoomIn')?.addEventListener('click', () => { lb.zoom = Math.min(4, lb.zoom * 1.25); applyLbTransform(); });
    $('#lbZoomOut')?.addEventListener('click', () => { lb.zoom = Math.max(0.5, lb.zoom / 1.25); applyLbTransform(); });
    $('#lbZoomFit')?.addEventListener('click', () => { lb.zoom = 1; lb.tx = 0; lb.ty = 0; applyLbTransform(); });
    $('#lbZoom200')?.addEventListener('click', () => { lb.zoom = 2; lb.tx = 0; lb.ty = 0; applyLbTransform(); });
    $('#lbDownload')?.addEventListener('click', async () => {
      if (lb.source !== 'product' || S.phase !== 'result' || S.kit[lb.spec]?.status !== 'done') return;
      const err = exportBlock();
      if (err) {
        $('#lbDownloadNote').textContent = err.startsWith('勾选') ? '关闭大图后，勾选页面上的核对确认框即可下载。' : err;
        return;
      }
      const spec = lb.spec, name = fname(spec);
      save(await sheetBlob(spec), name);
      $('#lbDownloadNote').textContent = '已开始下载';
    });
    stageEl.addEventListener('wheel', e => {
      e.preventDefault();
      if (!e.deltaY) return;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      lb.zoom = Math.max(0.5, Math.min(4, lb.zoom * factor));
      applyLbTransform();
    }, { passive: false });
    stageEl.addEventListener('dblclick', () => {
      if (lb.zoom > 1.05) { lb.zoom = 1; lb.tx = 0; lb.ty = 0; }
      else { lb.zoom = 2; }
      applyLbTransform();
    });
    stageEl.addEventListener('pointerdown', e => {
      if (e.button !== 0 || lb.pointers.size >= 2) return;
      lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stageEl.setPointerCapture?.(e.pointerId);
      if (lb.pointers.size === 2) {
        const [a, b] = [...lb.pointers.values()];
        lb.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        lb.pinchZoom = lb.zoom;
        lb.dragging = false;
        stageEl.dataset.dragging = '0';
        return;
      }
      if (lb.zoom > 1.02) {
        lb.dragging = true; lb.startX = e.clientX; lb.startY = e.clientY; lb.origX = lb.tx; lb.origY = lb.ty;
        stageEl.dataset.dragging = '1';
      }
    });
    stageEl.addEventListener('pointermove', e => {
      if (!lb.pointers.has(e.pointerId)) return;
      lb.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (lb.pointers.size === 2 && lb.pinchDist > 0) {
        const [a, b] = [...lb.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        lb.zoom = lb.pinchZoom * (dist / lb.pinchDist);
        applyLbTransform();
        return;
      }
      if (!lb.dragging) return;
      lb.tx = lb.origX + (e.clientX - lb.startX);
      lb.ty = lb.origY + (e.clientY - lb.startY);
      applyLbTransform();
    });
    const endPointer = e => {
      if (!lb.pointers.delete(e.pointerId)) return;
      lb.pinchDist = 0;
      const [remaining] = lb.pointers.values();
      lb.dragging = !!remaining && lb.zoom > 1;
      stageEl.dataset.dragging = lb.dragging ? '1' : '0';
      if (lb.dragging) {
        lb.startX = remaining.x; lb.startY = remaining.y;
        lb.origX = lb.tx; lb.origY = lb.ty;
      }
    };
    stageEl.addEventListener('pointerup', endPointer);
    stageEl.addEventListener('pointercancel', endPointer);
    stageEl.addEventListener('lostpointercapture', endPointer);
    document.addEventListener?.('keydown', e => {
      if (dlg.open) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); lb.zoom *= 1.2; applyLbTransform(); }
        else if (e.key === '-') { e.preventDefault(); lb.zoom /= 1.2; applyLbTransform(); }
        else if (e.key === '0') { e.preventDefault(); lb.zoom = 1; lb.tx = 0; lb.ty = 0; applyLbTransform(); }
        else if (e.target === stageEl && e.key.startsWith('Arrow')) {
          e.preventDefault();
          if (e.key === 'ArrowLeft') lb.tx += 48;
          if (e.key === 'ArrowRight') lb.tx -= 48;
          if (e.key === 'ArrowUp') lb.ty += 48;
          if (e.key === 'ArrowDown') lb.ty -= 48;
          applyLbTransform();
        }
        return;
      }
      if (S.view === 'studio' && ['ready', 'result'].includes(S.phase) && !e.defaultPrevented && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        const cur = S.phase === 'result' ? S.sheet : S.previewSheet;
        const idx = SHEETS.findIndex(s => s.id === cur);
        const next = SHEETS[(idx + (e.key === 'ArrowRight' ? 1 : -1) + SHEETS.length) % SHEETS.length].id;
        if (S.phase === 'result' && S.kit[next]?.status === 'done') selectSheet(next);
        else { S.previewSheet = next; syncSpecTabs(); redrawStage(); }
      }
    });
  }

  function boot() {
    // 1. 瞬时挂载全套工作台界面，零阻塞等待字体、示例图片或网络接口
    mountDials();
    mountCompareAndPhone();
    mountStudio();
    mountProgressiveUi();
    mountUnlock();
    mountHold();
    mountFitAndLightbox();
    setRoast(S.roast, true);
    setPhase('empty');
    updateServiceUi('ready');
    window.addEventListener('popstate', route);
    window.addEventListener('hashchange', () => {
      if (location.hash !== '#' + S.view) route();
    });
    route();
    window.__cb = { S, setRoast, render, SHEETS, switchView, setFitMode, openLightbox };

    // 2. 后台异步解码示例图并静默检测在线额度（超时 4.5s 自动回退，永不卡死）
    if(!restoreStatus()) retryProbe(false);
    requestAnimationFrame(() => { if(typeof performance !== 'undefined') performance.mark('app-interactive'); });
  }
  boot();
})();
