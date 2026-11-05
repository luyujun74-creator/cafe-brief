/* Café Brief 商品包装工作台。
   接通服务端时走真实豆包模型；服务端不可用时进入明确标注的离线示例模式，示例由 Canvas 合成，不冒充 AI 结果。 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;

  /* ---------- 规格表：engine 与 UI 共用 ---------- */
  const ROASTS = [
    { id: 1, name: '浅烘', hint: '清爽、明亮' },
    { id: 2, name: '中浅烘', hint: '蜜糖、温暖' },
    { id: 3, name: '中烘', hint: '饱满、吸睛' },
    { id: 4, name: '中深烘', hint: '沉稳、高级' },
    { id: 5, name: '深烘', hint: '夜色、聚光' },
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

  /* ---------- 状态 ---------- */
  const S = {
    roast: 4, scene: 'seam', name: '', price: '', offer: '', shop: '', photo: null, isSample: false,
    phase: 'empty', sheet: 'main', remaining: 3, unlocked: false, scenario: 'ok', cupOk: false, tries: 0,
    live: false, aiTitle: '', aiDetail: '', aiPoints: [],
    kit: {}, claims: { c1: false, c2: false }, run: 0,
  };
  const img = { cut: new Image(), photo: new Image() };

  /* ---------- 服务配置与 API ----------
     API_BASE 留空表示同源（Cloudflare Worker 与页面同域部署）。
     仅 GitHub Pages（无后端）时后端探测失败，页面进入离线示例模式，绝不把示例冒充真实生成。 */
  const API_BASE = (() => { try { return (window.CB_CONFIG && window.CB_CONFIG.apiBase) || ''; } catch { return ''; } })();
  const apiUrl = path => API_BASE + path;
  const TOKEN_KEY = 'cb_unlock';
  const authHeaders = () => { try { const t = localStorage.getItem(TOKEN_KEY); return t ? { authorization: 'Bearer ' + t } : {}; } catch { return {}; } };
  async function apiPost(path, body) {
    let response;
    try {
      response = await fetch(apiUrl(path), { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(body), credentials: API_BASE ? 'omit' : 'same-origin' });
    } catch { const e = new Error('NETWORK'); e.code = 'NETWORK'; throw e; }
    let payload = null; try { payload = await response.json(); } catch {}
    if (!response.ok) { const e = new Error((payload && payload.error) || '请求失败'); e.code = (payload && payload.code) || ('HTTP_' + response.status); throw e; }
    return payload;
  }
  async function apiStatus() {
    const response = await fetch(apiUrl('/api/status'), { headers: authHeaders(), credentials: API_BASE ? 'omit' : 'same-origin' });
    if (!response.ok) throw new Error('status');
    return response.json();
  }
  /* 读取商品图为 data URL（真实模式上传给服务端做参考图） */
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('READ'));
      reader.readAsDataURL(file);
    });
  }
  let pendingFile = null;
  /* 上传前缩到长边 1280，省流量也减轻服务端负担 */
  function shrinkPhoto(pic) {
    const w = pic.naturalWidth || pic.width, h = pic.naturalHeight || pic.height, k = Math.min(1, 1280 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(pic, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .84);
  }
  /* 生成图经服务端取回成同源 blob，导出时画布不会被跨域污染 */
  async function loadScene(imageUrl) {
    const res = await fetch(apiUrl(imageUrl), { headers: authHeaders(), credentials: API_BASE ? 'omit' : 'same-origin' });
    if (!res.ok) throw new Error('IMAGE');
    const im = new Image(); im.src = URL.createObjectURL(await res.blob()); await im.decode();
    return im;
  }
  const sceneName = id => (SCENES.find(s => s.id === id) || SCENES[0]).name;
  function buildPayload() {
    return { shop: S.shop.trim(), product: S.name.trim(), price: S.price.trim(), highlights: (S.high || '').trim(), platform: 'meituan', style: sceneName(S.scene), image: S.isSample ? CB_ASSETS.photo : shrinkPhoto(S.photo) };
  }


  /* ---------- 绘制 ---------- */
  const tokens = () => {
    const c = getComputedStyle(root);
    const g = n => c.getPropertyValue(n).trim();
    return { wall: g('--plate-wall'), floor: g('--plate-floor'), ink: g('--plate-ink'), bg: g('--bg') };
  };
  function rng(seed) { let s = seed * 9301 + 49297; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

  function plate(ctx, w, h, t, scene, seed, horizon = .62) {
    const wall = ctx.createLinearGradient(0, 0, 0, h * horizon);
    wall.addColorStop(0, t.wall); wall.addColorStop(1, t.wall);
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
        ctx.save(); ctx.globalAlpha = .1; ctx.strokeStyle = '#000'; const n = 26;
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
        ctx.save(); const n = Math.round(w * h / 2600);
        for (let i = 0; i < n; i++) {
          ctx.globalAlpha = .05 + r() * .12; ctx.fillStyle = r() > .5 ? '#fff' : '#000';
          const s = (1 + r() * 2.4) * w / 1000;
          ctx.fillRect(r() * w, y + r() * (h - y), s, s);
        }
        ctx.restore();
      }
      if (scene === 'window') {
        ctx.save(); ctx.fillStyle = '#000'; ctx.globalAlpha = .08; ctx.fillRect(0, y - 1, w, h * .004 + 1); ctx.restore();
      }
    }
    if (scene === 'window') {
      ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .75; ctx.filter = `blur(${w * .012}px)`; ctx.fillStyle = '#fff';
      for (let i = 0; i < 3; i++) {
        const x = w * (.12 + i * .17 + (seed % 3) * .02);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * .11, 0); ctx.lineTo(x + w * .48, h); ctx.lineTo(x + w * .3, h); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // 顶光
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

  function drawCup(ctx, w, h, sp, seed, canvasScale = 1) {
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

  function fitFont(ctx, text, maxW, start, min) {
    let s = start;
    do { ctx.font = `${s}px "CB Display", "PingFang SC", sans-serif`; if (ctx.measureText(text).width <= maxW) return { size: s, ok: true }; s -= 2; } while (s >= min);
    return { size: min, ok: false };
  }
  function breakName(n) {
    if (n.length <= 3) return [n];
    const a = Math.ceil(n.length / 2);
    return [n.slice(0, a), n.slice(a)];
  }

  function textLayer(ctx, w, h, sp, f, t, layout) {
    const issues = [];
    ctx.fillStyle = t.ink; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const name = f.name || '商品名', price = f.price ? `¥${f.price}` : '';
    if (sp.id === 'poster') {
      const m = w * .07;
      if (f.shop) { ctx.font = `${w * .034}px "CB Display","PingFang SC",sans-serif`; ctx.fillText(f.shop, m, m + w * .02); }
      if (layout === 'behind') {
        const lines = breakName(name);
        const r = lines.map(l => fitFont(ctx, l, w * .86, Math.round(w * .3), Math.round(w * .09)));
        if (r.some(x => !x.ok)) issues.push('商品名太长，海报放不下');
        const fs = Math.min(...r.map(x => x.size));
        ctx.font = `${fs}px "CB Display","PingFang SC",sans-serif`;
        lines.forEach((l, i) => ctx.fillText(l, m - fs * .02, h * .1 + fs * .92 + i * fs * .98));
      }
    }
    if (sp.id === 'banner') {
      const m = h * .13;
      const r = fitFont(ctx, name, w * .54, Math.round(h * .3), Math.round(h * .1));
      if (!r.ok) issues.push('商品名太长，Banner 放不下');
      ctx.font = `${r.size}px "CB Display","PingFang SC",sans-serif`;
      ctx.fillText(name, m, h * .46);
      if (price) { ctx.font = `${h * .17}px "CB Display","PingFang SC",sans-serif`; ctx.fillText(price, m, h * .72); }
      let sub = [f.shop, f.offer].filter(Boolean).join('  ');
      if (sub) {
        const fit = fitFont(ctx, sub, w * .56, Math.round(h * .085), Math.round(h * .05));
        if (!fit.ok) issues.push('活动文字太长，Banner 放不下');
        ctx.font = `${fit.size}px "PingFang SC",sans-serif`; ctx.fillText(sub, m, h * .88);
      }
    }
    return issues;
  }
  function posterFoot(ctx, w, h, f, t) {
    const m = w * .07, issues = [];
    ctx.fillStyle = t.ink; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (f.price) { ctx.font = `${w * .15}px "CB Display","PingFang SC",sans-serif`; ctx.fillText(`¥${f.price}`, m, h * .93 - (f.offer ? h * .05 : 0)); }
    if (f.offer) {
      const fit = fitFont(ctx, f.offer, w * .56, Math.round(w * .044), Math.round(w * .028));
      if (!fit.ok) issues.push('活动文字太长，海报放不下');
      ctx.font = `${fit.size}px "PingFang SC",sans-serif`; ctx.fillText(f.offer, m, h * .935);
    }
    return issues;
  }

  /** 把一张规格画到 canvas。mode: ai 为示意场景；raw 只用原片，不重绘商品 */
  function render(canvas, spId, opt = {}) {
    const sp = SHEETS.find(s => s.id === spId);
    const o = Object.assign({ mode: 'ai', seed: 1, scene: S.scene, facts: S, src: null }, opt);
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height; const t = tokens();
    ctx.clearRect(0, 0, w, h);
    let issues = [];
    if (o.mode === 'scene' && o.sceneImg) {
      const spic = o.sceneImg;
      const iw = spic.naturalWidth || spic.width, ih = spic.naturalHeight || spic.height;
      cover(ctx, spic, iw, ih, 0, 0, w, h);
      if (sp.text) issues = textLayer(ctx, w, h, sp, o.facts, t, 'behind');
      if (sp.id === 'poster') issues = issues.concat(posterFoot(ctx, w, h, o.facts, t));
      return issues;
    }
    const useCut = o.mode === 'ai' && !o.src;
    if (useCut) {
      plate(ctx, w, h, t, o.scene, o.seed, sp.id === 'poster' ? .7 : sp.id === 'banner' ? .8 : .64);
      if (sp.text) issues = textLayer(ctx, w, h, sp, o.facts, t, 'behind');
      drawCup(ctx, w, h, sp, o.seed);
      if (sp.id === 'poster') issues = issues.concat(posterFoot(ctx, w, h, o.facts, t));
    } else {
      const pic = o.src || img.photo;
      const pw = pic.naturalWidth || pic.width, ph = pic.naturalHeight || pic.height;
      if (sp.text) {
        ctx.fillStyle = t.wall; ctx.fillRect(0, 0, w, h);
        if (sp.id === 'banner') { cover(ctx, pic, pw, ph, w * .62, 0, w * .38, h); }
        else { cover(ctx, pic, pw, ph, 0, h * .3, w, h * .46); }
        issues = textLayer(ctx, w, h, Object.assign({}, sp), o.facts, t, sp.id === 'poster' ? 'top' : 'behind');
        if (sp.id === 'poster') {
          ctx.fillStyle = t.ink;
          const m = w * .07, fit = fitFont(ctx, o.facts.name || '商品名', w * .86, Math.round(w * .13), Math.round(w * .06));
          if (!fit.ok) issues.push('商品名太长，海报放不下');
          ctx.font = `${fit.size}px "CB Display","PingFang SC",sans-serif`; ctx.fillText(o.facts.name || '商品名', m, h * .25);
          issues = issues.concat(posterFoot(ctx, w, h, o.facts, t));
        }
      } else cover(ctx, pic, pw, ph, 0, 0, w, h);
    }
    return issues;
  }
  function cover(ctx, pic, pw, ph, x, y, w, h) {
    const s = Math.max(w / pw, h / ph), sw = w / s, sh = h / ph * ph / s * 1;
    ctx.drawImage(pic, (pw - sw) / 2, (ph - (h / s)) / 2, sw, h / s, x, y, w, h);
  }

  const baseFacts = { name: '冰奶油拿铁', price: '18', offer: '', shop: '拾叶咖啡' };

  /* ---------- 烘焙度 ---------- */
  function setRoast(r, silent) {
    S.roast = r; root.dataset.roast = r;
    const c = getComputedStyle(root).getPropertyValue('--bg').trim();
    $('meta[name=theme-color]').content = c;
    $$('.dial input').forEach(i => { i.value = r; i.setAttribute('aria-valuetext', `${ROASTS[r - 1].name}，${ROASTS[r - 1].hint}`); });
    $$('.dial-now').forEach(e => e.textContent = `${ROASTS[r - 1].name}：${ROASTS[r - 1].hint}`);
    if (!silent) redrawAll();
  }
  function mountDials() {
    $$('[data-dial]').forEach(h => {
      h.innerHTML = `<div class="dial"><label for="d-${h.dataset.dial}">烘焙度决定整体色调</label><span class="dial-now"></span>
        <div class="dial-track"><i data-r="1"></i><i data-r="2"></i><i data-r="3"></i><i data-r="4"></i><i data-r="5"></i>
        <input id="d-${h.dataset.dial}" type="range" min="1" max="5" step="1" value="${S.roast}"></div>
        <div class="dial-ends"><span>浅</span><span>深</span></div></div>`;
      $('input', h).addEventListener('input', e => setRoast(+e.target.value));
    });
  }

  /* ---------- 首页 ---------- */
  function drawHome() {
    const after = $('#baAfter'), before = $('#baBefore');
    if (after) {
      render(after, 'main', { facts: baseFacts, scene: 'window', seed: 2 });
      render(before, 'main', { mode: 'raw', facts: baseFacts });
      $$('#proofs canvas').forEach(c => render(c, c.dataset.sheet, { facts: baseFacts, scene: c.dataset.sheet === 'square' ? 'stone' : c.dataset.sheet === 'main' ? 'window' : 'seam', seed: 2 }));
      const pk = $('input[name=ph]:checked').value === 'pack';
      render($('#phThumb'), 'main', { mode: pk ? 'ai' : 'raw', facts: baseFacts, scene: 'window', seed: 2 });
      render($('#phBanner'), 'banner', { mode: pk ? 'ai' : 'raw', facts: baseFacts, seed: 2 });
      renderFacts();
    }
  }
  function renderFacts() {
    const f = { name: '冰奶油拿铁', price: ($('#fPrice').value || '').trim(), offer: ($('#fOffer').value || '').trim(), shop: '拾叶咖啡' };
    render($('#factsPoster'), 'poster', { facts: f, scene: 'seam', seed: 2 });
  }
  function mountHome() {
    $('#heroCup').src = img.cut.src;
    $('#proofs').innerHTML = SHEETS.map(s => `<li class="proof proof-${s.id}"><div class="crop"><canvas data-sheet="${s.id}" width="${s.w / 2}" height="${s.h / 2}" aria-label="${s.name}示意"></canvas></div><b>${s.name}</b><span>${s.w} × ${s.h} 像素，${s.use}</span></li>`).join('');
    const ba = $('#ba'), r = $('.ba-range');
    r.addEventListener('input', () => ba.style.setProperty('--pos', r.value + '%'));
    $$('input[name=ph]').forEach(i => i.addEventListener('change', drawHome));
    $('#fPrice').addEventListener('input', renderFacts); $('#fOffer').addEventListener('input', renderFacts);
    $('#trySample').addEventListener('click', () => { S.pendingSample = true; });
    renderCopy($('#factsCopy'), baseFacts);
  }
  function heroIntro() {
    if (reduced()) return;
    const seq = [1, 2, 3, 4]; let i = 0; root.dataset.roast = 1;
    root.classList.add('intro');
    const step = () => { root.dataset.roast = seq[i]; if (++i < seq.length) setTimeout(step, 340); else setTimeout(() => root.classList.remove('intro'), 400); };
    setTimeout(step, 120);
  }

  /* ---------- 文案：事实 / AI 描述 ---------- */
  function renderCopy(el, f) {
    const shop = (f.shop || '').trim();
    el.innerHTML = '';
    if (el.id === 'resCopy' && S.aiDetail) {
      el.append(Object.assign(document.createElement('strong'), { textContent: S.aiTitle }), document.createElement('br'), document.createTextNode(S.aiDetail));
      return;
    }
    AI_COPY.forEach(p => {
      if (p.opt && !shop) return;
      if (p.claim) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'claim' + (S.claims[p.claim] ? ' kept' : '');
        b.textContent = p.t; b.setAttribute('aria-pressed', S.claims[p.claim]);
        b.setAttribute('aria-label', `${p.t}，AI 补充的描述，${S.claims[p.claim] ? '已保留，点击取消' : '点击保留'}`);
        b.addEventListener('click', () => { S.claims[p.claim] = !S.claims[p.claim]; renderAllCopy(); });
        el.append(b);
      } else {
        const t = p.t.replace('{name}', f.name || '商品名').replace('{shop}', shop).replace('{shopTail}', shop ? '现做。' : '');
        el.append(p.fact ? Object.assign(document.createElement('strong'), { textContent: t }) : document.createTextNode(t));
      }
    });
  }
  function exportCopy(f) {
    if (S.aiDetail) {
      const out = [`商品标题：${S.aiTitle}`, `售价：¥${f.price}`, `商品描述：${S.aiDetail}`];
      if (f.offer) out.push(`活动：${f.offer}`);
      return out.join('\n') + '\n';
    }
    const parts = [f.name];
    const kept = []; if (S.claims.c1) kept.push('奶油绵密'); if (S.claims.c2) kept.push('咖啡回甘');
    let line = f.name + (kept.length ? '，' + kept.join('、') : '') + '。';
    if (f.shop) line += f.shop + '现做。';
    const lines = [`商品名：${f.name}`, `售价：¥${f.price}`, `商品描述：${line}`];
    if (f.offer) lines.push(`活动：${f.offer}`);
    return lines.join('\n') + '\n';
  }
  function renderAllCopy() {
    renderCopy($('#factsCopy'), baseFacts);
    renderCopy($('#resCopy'), currentFacts());
    if (S.aiDetail) { $('#copyNote').textContent = S.copyStale ? '你改了信息，这段文案还是之前的，重新包装后才会更新。' : '文案由 AI 按你填的事实写成，发布前请再读一遍。'; return; }
    const n = Object.values(S.claims).filter(v => !v).length;
    $('#copyNote').textContent = n ? `${n} 处蓝色描述没确认，导出时会去掉。点一下可保留。` : '描述都已确认，会写进导出文案。';
  }

  /* ---------- 工作台 ---------- */
  const currentFacts = () => ({ name: S.name.trim(), price: S.price.trim(), offer: S.offer.trim(), shop: S.shop.trim() });
  const stage = () => $('#stageCanvas');

  function setPhase(p) {
    S.phase = p; $('#studio').dataset.phase = p;
    $('#paneBrief').hidden = !['empty', 'ready'].includes(p);
    $('#paneGen').hidden = p !== 'gen';
    $('#paneResult').hidden = p !== 'result';
    $('#paneError').hidden = p !== 'error';
    $('#drop').hidden = p !== 'empty';
    $('#holdCompare').hidden = p !== 'result';
    updateGo(); updateQuota(); redrawStage(); drawStrip();
    if (p === 'result') window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function updateQuota() {
    const chip = $('#quotaChip');
    if (!S.live) { chip.textContent = '示例模式 · AI 服务接入中'; }
    else if (S.unlocked) { chip.textContent = '已解锁，不限次数'; }
    else { chip.textContent = '还能免费包装 ' + S.remaining + ' 次'; }
    const go = $('#go span');
    if (go) go.textContent = !S.live ? '看示例效果' : (S.remaining > 0 || S.unlocked ? '一键包装' : '解锁后继续包装');
  }
  function validate() {
    if (!S.photo) return '先传一张商品照';
    if (!S.name.trim()) return '填一下商品名';
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(S.price.trim())) return '售价填数字，例如 18 或 18.5';
    return '';
  }
  function updateGo() { const e = validate(); $('#go').setAttribute('aria-disabled', e ? 'true' : 'false'); }

  function sizeCanvasFor(id) {
    const sp = SHEETS.find(s => s.id === id), c = stage();
    const scale = Math.min(1, 1200 / Math.max(sp.w, sp.h));
    c.width = Math.round(sp.w * scale); c.height = Math.round(sp.h * scale);
    $('#stageFrame').style.setProperty('--ar', `${sp.w}/${sp.h}`);
  }
  let rafId = 0;
  function redrawStage() { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(drawStageNow); }
  function drawStageNow() {
    const p = S.phase, note = $('#stageNote');
    if (p === 'empty') { sizeCanvasFor('poster'); const c = stage(), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); note.textContent = ''; return; }
    const id = (p === 'result') ? S.sheet : 'poster';
    sizeCanvasFor(id);
    if (p === 'result') {
      const k = S.kit[id]; if (!k || k.status !== 'done') { const c = stage(), x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height); return; }
      const issues = render(stage(), id, { mode: holdRaw ? 'raw' : ((S.live || S.isSample) ? k.mode : 'raw'), seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg });
      k.issues = issues; updateResult();
      note.textContent = holdRaw ? '原片' : (k.mode === 'scene' ? 'AI 场景（真实模型生成）' : (k.mode === 'ai' && S.isSample ? '示意合成，未调用模型' : '原片版，商品未重绘'));
    } else {
      render(stage(), 'poster', { mode: (S.live || S.isSample) ? 'ai' : 'raw', seed: 2, facts: currentFacts(), src: S.isSample ? null : S.photo });
      note.textContent = '实时预览：文字和色调已是最终效果，场景在包装时生成';
    }
  }
  function redrawAll() { drawHome(); if (S.phase !== 'empty') { redrawStage(); drawStrip(); } }

  function drawStrip() {
    const ul = $('#strip');
    if (!['gen', 'result'].includes(S.phase)) { ul.innerHTML = ''; return; }
    if (ul.children.length !== SHEETS.length) {
      ul.innerHTML = SHEETS.map(s => `<li><button type="button" data-id="${s.id}"><span class="thumb" style="--ar:${s.w}/${s.h}"><canvas width="${Math.round(s.w / 4)}" height="${Math.round(s.h / 4)}"></canvas><i class="st"></i></span><span class="lbl">${s.name}</span></button></li>`).join('');
      $$('button', ul).forEach(b => b.addEventListener('click', () => { const k = S.kit[b.dataset.id]; if (k && k.status === 'error') return retrySheet(b.dataset.id); if (k && k.status === 'done') selectSheet(b.dataset.id); }));
    }
    SHEETS.forEach(s => {
      const b = $(`button[data-id=${s.id}]`, ul), k = S.kit[s.id] || { status: 'wait' };
      b.dataset.status = k.status; b.setAttribute('aria-current', S.phase === 'result' && S.sheet === s.id ? 'true' : 'false');
      const lab = $('.lbl', b);
      lab.textContent = k.status === 'error' ? `${s.name}：点击重做` : k.status === 'run' ? `${s.name}：生成中` : k.status === 'wait' ? `${s.name}：排队中` : s.name;
      if (k.status === 'done') render($('canvas', b), s.id, { mode: (S.live || S.isSample) ? k.mode : 'raw', seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg });
    });
  }
  function selectSheet(id) { S.sheet = id; updateResult(); redrawStage(); drawStrip(); }

  function updateResult() {
    const sp = SHEETS.find(s => s.id === S.sheet), k = S.kit[S.sheet]; if (!k) return;
    $('#resTitle').textContent = sp.name;
    $('#resSpec').textContent = `${sp.w} × ${sp.h} 像素 JPG，${sp.use}`;
    const useAiMode = S.live || S.isSample;
    const fr = $(`input[name=fid][value=${useAiMode && k.mode !== 'raw' ? 'scene' : 'raw'}]`); if (fr) fr.checked = true;
    $$('input[name=fid]').forEach(i => { i.disabled = !useAiMode; });
    const anyAi = useAiMode && Object.values(S.kit).some(x => x.status === 'done' && (x.mode === 'ai' || x.mode === 'scene'));
    $('#fidNote').textContent = !useAiMode ? '离线示例不调用模型，你的照片只能看原片版式。' : (k.mode === 'scene' || k.mode === 'ai') ? (S.live ? '背景和光线由 AI 真实生成，商品保持你照片里的样子。' : '示例由本地合成，未调用模型，道具不代表随单附赠。') : '只裁切和排版，商品没有被重绘。';
    $('#confirmRow').hidden = !anyAi;
    $('#vers').innerHTML = k.versions.map((v, i) => `<button type="button" data-i="${i}" aria-pressed="${i === k.cur}" aria-label="第 ${i + 1} 版">${i + 1}</button>`).join('');
    $$('#vers button').forEach(b => b.addEventListener('click', () => { k.cur = +b.dataset.i; Object.assign(k, k.versions[k.cur]); redrawStage(); drawStrip(); updateResult(); }));
    const reason = exportBlock();
    $('#exportHint').textContent = reason;
    $('#exportHint').dataset.err = reason ? '1' : '';
    $('#exportAll').setAttribute('aria-disabled', reason ? 'true' : 'false');
    $('#exportOne').setAttribute('aria-disabled', reason ? 'true' : 'false');
    const pending = Object.values(S.kit).filter(x => x.status !== 'done').length;
    $('#exportAll span').textContent = pending ? `下载已完成的 ${SHEETS.length - pending} 张和文案` : '下载全部 4 张和文案';
    renderAllCopy();
  }
  function exportBlock() {
    const anyAi = (S.live || S.isSample) && Object.values(S.kit).some(x => x.status === 'done' && (x.mode === 'ai' || x.mode === 'scene'));
    if (anyAi && !S.cupOk) return '勾选上面的确认后才能下载。';
    const iss = Object.entries(S.kit).flatMap(([id, k]) => k.issues || []);
    if (iss.length) return iss[0] + '，回去改短一点。';
    return '';
  }

  /* 生成模拟：顺序产出，每张独立成败 */
  async function generate() {
    const err = validate();
    if (err) { $('#briefErr').textContent = err; return; }
    $('#briefErr').textContent = '';
    if (S.live && !S.unlocked && S.remaining <= 0) return openUnlock();
    const run = ++S.run; S.kit = {}; S.cupOk = false; $('#cupOk').checked = false; S.sheet = 'main';
    SHEETS.forEach(sd => S.kit[sd.id] = { status: 'wait', mode: S.live ? 'scene' : 'ai', seed: 2, scene: S.scene, versions: [], cur: 0, sceneImg: null });
    S.aiDetail = ''; S.aiTitle = ''; S.copyStale = false;
    $('#cancel').hidden = S.live;
    if (S.live) SHEETS.forEach(sd => { S.kit[sd.id].status = 'run'; });
    setPhase('gen'); renderSteps();

    if (S.live) {
      let result, sceneImg;
      try { result = await apiPost('/api/package', buildPayload()); sceneImg = await loadScene(result.image_url); }
      catch (e) {
        if (run !== S.run) return;
        if (e.code === 'QUOTA_EXCEEDED') { S.remaining = 0; setPhase('ready'); return openUnlock(); }
        if (e.code === 'RATE_LIMIT') return showError('ratelimit');
        if (['GENERATION_BUSY', 'PUBLIC_BUDGET_EXCEEDED', 'INPUT_INVALID', 'MODEL_FAILED', 'QUOTA_REPAIR_REQUIRED'].includes(e.code)) return showError('server', e.message);
        return showError('network');
      }
      if (run !== S.run) return;
      S.aiTitle = result.title || ''; S.aiDetail = result.detail || '';
      if (Array.isArray(result.selling_points)) S.aiPoints = result.selling_points;
      SHEETS.forEach(sd => {
        const k = S.kit[sd.id]; k.status = 'done'; k.mode = 'scene'; k.sceneImg = sceneImg;
        k.versions.push({ seed: k.seed, scene: k.scene, mode: 'scene', sceneImg }); k.cur = 0;
      });
      S.remaining = typeof result.remaining === 'number' ? result.remaining : S.remaining;
      S.unlocked = !!result.unlimited;
      S.sheet = 'main';
      setPhase('result'); toast('这一套做好了'); updateResult(); drawStrip();
      return;
    }

    /* 离线示例模式：本地示意合成，不调用模型，界面明确标注 */
    await wait(900); if (run !== S.run) return;
    for (const sd of SHEETS) {
      const k = S.kit[sd.id]; k.status = 'run'; drawStrip(); renderSteps();
      await wait(reduced() ? 60 : 500); if (run !== S.run) return;
      finishSheet(k);
      drawStrip(); renderSteps();
      if (!reduced()) dealIn(sd.id);
    }
    S.sheet = SHEETS.find(sd => S.kit[sd.id].status === 'done').id;
    setPhase('result'); toast('示例做好了（未调用 AI 模型）');
    updateResult();
  }

  function finishSheet(k) { k.status = 'done'; k.versions.push({ seed: k.seed, scene: k.scene, mode: k.mode }); k.cur = k.versions.length - 1; }
  function dealIn(id) {
    const b = $(`#strip button[data-id=${id}]`); if (!b) return;
    b.animate([{ transform: 'translateY(-36px) scale(1.18)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
  function renderSteps() {
    $('#steps').innerHTML = SHEETS.map(s => {
      const k = S.kit[s.id]; const t = { wait: '排队中', run: '生成中', done: '已完成', error: '没做成' }[k.status];
      return `<li data-status="${k.status}"><span>${s.name}</span><em>${t}</em></li>`;
    }).join('');
  }
  async function retrySheet(id) {
    const k = S.kit[id]; k.status = 'run'; drawStrip(); await wait(700);
    finishSheet(k); selectSheet(id); toast(`${SHEETS.find(s => s.id === id).name}已重做，不扣次数`); updateResult();
  }
  function showError(kind, message) {
    const c = {
      server: ['这次没做成', message + '。信息和照片都还在。'],
      network: ['没连上模型', '网络中断或服务超时。信息和照片都还在，可以直接重新包装；已扣的次数以右上角显示为准。'],
      moderation: ['这张照片没通过模型检查', '模型拒绝处理这张照片，这次没有扣次数。换一张只拍商品的照片，或回去调整文字。'],
      ratelimit: ['操作太频繁', '为了公平使用，请稍等一分钟再试。这次没有扣次数。'],
    }[kind] || ['生成失败', '这次没有扣次数，信息和照片都还在，可以重新包装。'];
    $('#errTitle').textContent = c[0]; $('#errBody').textContent = c[1]; setPhase('error');
  }
  const wait = ms => new Promise(r => setTimeout(r, reduced() ? Math.min(ms, 120) : ms));

  /* 上传 */
  function takeFile(f) {
    const msg = $('#photoMsg'); msg.dataset.kind = '';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { msg.dataset.kind = 'err'; msg.textContent = '这个文件不是 JPG、PNG 或 WebP，换一张试试。'; return; }
    if (f.size > 10 * 1024 * 1024) { msg.dataset.kind = 'err'; msg.textContent = '照片超过 10 MB。压缩一下或换一张。'; return; }
    msg.textContent = '正在读取照片…';
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const short = Math.min(im.naturalWidth, im.naturalHeight);
      S.photo = im; S.isSample = false; pendingFile = f;
      msg.dataset.kind = short < 800 ? 'warn' : '';
      msg.innerHTML = short < 800 ? `照片短边只有 ${short} 像素，导出后可能发虚。<button type="button" class="link" id="rePick">换一张</button>` : `已选用这张照片。<button type="button" class="link" id="rePick">换一张</button>`;
      $('#rePick').addEventListener('click', () => $('#file').click());
      setPhase('ready');
    };
    im.onerror = () => { msg.dataset.kind = 'err'; msg.textContent = '这张照片打不开，可能已损坏。换一张试试。'; URL.revokeObjectURL(url); };
    im.src = url;
  }
  function useSample() {
    S.photo = img.photo; S.isSample = true; pendingFile = null; S.name = S.name || '冰奶油拿铁'; S.price = S.price || '18'; S.shop = S.shop || '拾叶咖啡';
    $('#iName').value = S.name; $('#iPrice').value = S.price; $('#iShop').value = S.shop; $('#iOffer').value = S.offer;
    $('#photoMsg').innerHTML = '正在用示例照片和虚构店铺。<button type="button" class="link" id="rePick">换成我的照片</button>';
    $('#rePick').addEventListener('click', () => $('#file').click());
    setPhase('ready');
  }

  /* 下载：真实导出，文件名和像素符合规格 */
  async function sheetBlob(id) {
    const sp = SHEETS.find(s => s.id === id), k = S.kit[id], c = document.createElement('canvas');
    c.width = sp.w; c.height = sp.h;
    render(c, id, { mode: (S.live || S.isSample) ? k.mode : 'raw', seed: k.seed, scene: k.scene, facts: currentFacts(), src: S.isSample ? null : S.photo, sceneImg: k.sceneImg });
    let q = .9, b;
    do { b = await new Promise(r => c.toBlob(r, 'image/jpeg', q)); q -= .08; } while (b.size > sp.max * 1048576 && q > .4);
    return b;
  }
  const fname = id => { const sp = SHEETS.find(s => s.id === id); return `${currentFacts().name}_${sp.name}_${sp.w}x${sp.h}.jpg`; };
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function exportAll() {
    const r = exportBlock(); if (r) { toast(r); return; }
    const btn = $('#exportAll'); btn.setAttribute('aria-busy', 'true');
    const files = [];
    for (const s of SHEETS) if (S.kit[s.id].status === 'done') files.push({ name: fname(s.id), data: new Uint8Array(await (await sheetBlob(s.id)).arrayBuffer()) });
    files.push({ name: '上架文案.txt', data: new TextEncoder().encode(exportCopy(currentFacts())) });
    const zip = makeZip(files);
    window.__lastExport = files.map(f => ({ name: f.name, size: f.data.length }));
    save(zip, `CafeBrief_${currentFacts().name}.zip`);
    btn.removeAttribute('aria-busy'); toast(`已下载 ${files.length - 1} 张图和文案`);
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

  /* 解锁 */
  function openUnlock() { $('#ulErr').textContent = ''; $('#ulPwd').value = ''; $('#unlock').showModal(); $('#ulPwd').focus(); }
  function mountUnlock() {
    $('#ulForm').addEventListener('submit', async e => {
      e.preventDefault();
      if (!S.live) { $('#ulErr').textContent = '解锁在正式服务上线后可用，现在可以先看示例流程。'; return; }
      const pwd = $('#ulPwd').value;
      if (!pwd) { $('#ulErr').textContent = '输入解锁密码。'; return; }
      try {
        const result = await apiPost('/api/unlock', { password: pwd });
        try { if (result.token) localStorage.setItem(TOKEN_KEY, result.token); } catch {}
        S.unlocked = true; S.remaining = result.remaining == null ? null : result.remaining;
        $('#unlock').close(); updateQuota(); toast('已解锁，不限次数');
      } catch (err) {
        $('#ulErr').textContent = (err && err.message) || '没有连上服务，请重试';
      }
    });
    $('#ulClose').addEventListener('click', () => $('#unlock').close());
  }

  /* 按住对比 */
  let holdRaw = false;
  function mountHold() {
    const b = $('#holdCompare');
    const on = e => { e.preventDefault(); holdRaw = true; b.setAttribute('aria-pressed', 'true'); drawStageNow(); };
    const off = () => { if (!holdRaw) return; holdRaw = false; b.setAttribute('aria-pressed', 'false'); drawStageNow(); };
    b.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel', 'blur'].forEach(n => b.addEventListener(n, off));
    b.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') on(e); }); b.addEventListener('keyup', off);
  }

  let toastT = 0;
  function toast(t) { const el = $('#toast'); el.textContent = t; el.dataset.on = '1'; clearTimeout(toastT); toastT = setTimeout(() => el.dataset.on = '', 3200); }

  function route() {
    const h = location.hash;
    const v = h === '#studio' ? 'studio' : 'home';
    const apply = () => {
      root.dataset.view = v; $$('[data-only]').forEach(e => e.hidden = e.dataset.only !== v);
      if (v === 'studio') { window.scrollTo(0, 0); if (S.pendingSample) { S.pendingSample = false; useSample(); } else setPhase(S.phase); }
      else if (h && h !== '#home' && $(h)) $(h).scrollIntoView();
      else if (!h || h === '#home') window.scrollTo(0, 0);
    };
    if (document.startViewTransition && !reduced() && root.dataset.view !== v) document.startViewTransition(apply); else apply();
  }

  /* 绑定 */
  function mountStudio() {
    $('#scenes').innerHTML = SCENES.map(s => `<label class="chip"><input type="radio" name="scene" value="${s.id}" ${s.id === S.scene ? 'checked' : ''}><span>${s.name}</span></label>`).join('');
    $$('input[name=scene]').forEach(i => i.addEventListener('change', () => { S.scene = i.value; redrawStage(); }));
    const bind = (id, key) => $(id).addEventListener('input', e => { S[key] = e.target.value; if (S.aiDetail && key !== 'offer') S.copyStale = true; $('#briefErr').textContent = ''; updateGo(); redrawStage(); if (S.phase === 'result') { S.cupOk = false; $('#cupOk').checked = false; drawStrip(); updateResult(); } });
    bind('#iName', 'name'); bind('#iPrice', 'price'); bind('#iShop', 'shop'); bind('#iOffer', 'offer'); bind('#iHigh', 'high');
    const drop = $('#drop');
    drop.addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', e => { if (e.target.files[0]) takeFile(e.target.files[0]); e.target.value = ''; });
    ['dragover', 'dragenter'].forEach(n => $('#stageFrame').addEventListener(n, e => { e.preventDefault(); $('#stageFrame').dataset.over = '1'; }));
    ['dragleave', 'drop'].forEach(n => $('#stageFrame').addEventListener(n, e => { e.preventDefault(); $('#stageFrame').dataset.over = ''; }));
    $('#stageFrame').addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) takeFile(f); });
    $('#go').addEventListener('click', generate);
    $('#cancel').addEventListener('click', () => { S.run++; setPhase('ready'); toast('已取消，没有扣次数'); });
    $('#errRetry').addEventListener('click', () => { S.scenario = 'ok'; generate(); });
    $('#errBack').addEventListener('click', () => setPhase('ready'));
    $('#restart').addEventListener('click', () => setPhase('ready'));
    $('#again').addEventListener('click', async () => {
      const k = S.kit[S.sheet]; const b = $('#again');
      if (S.live) {
        b.setAttribute('aria-busy', 'true');
        try {
          const r = await apiPost('/api/generate-image', buildPayload());
          const im = await loadScene(r.image_url);
          if (typeof r.remaining === 'number') S.remaining = r.remaining;
          updateQuota();
          k.sceneImg = im; k.mode = 'scene'; k.versions.push({ seed: k.seed, scene: k.scene, mode: 'scene', sceneImg: im }); k.cur = k.versions.length - 1;
          S.cupOk = false; $('#cupOk').checked = false;
          redrawStage(); drawStrip(); updateResult(); toast('新一版做好了，用掉 1 次');
        } catch (e) { if (e.code === 'QUOTA_EXCEEDED') { S.remaining = 0; updateQuota(); openUnlock(); } else toast((e && e.code && e.message) || '这一版没做成，请稍后再试'); }
        b.removeAttribute('aria-busy');
        return;
      }
      b.setAttribute('aria-busy', 'true'); await wait(600);
      k.seed = k.seed + 1 + Math.floor(Math.random() * 3); k.scene = SCENES[(SCENES.findIndex(sd => sd.id === k.scene) + 1) % SCENES.length].id; k.mode = 'ai';
      k.versions.push({ seed: k.seed, scene: k.scene, mode: 'ai' }); k.cur = k.versions.length - 1;
      S.cupOk = false; $('#cupOk').checked = false; b.removeAttribute('aria-busy');
      redrawStage(); drawStrip(); updateResult(); toast('示例第 ' + k.versions.length + ' 版（未调用模型）');
    });
    $$('input[name=fid]').forEach(i => i.addEventListener('change', () => { const k = S.kit[S.sheet]; const m = i.value === 'raw' ? 'raw' : (S.live ? 'scene' : 'ai'); k.mode = m; k.versions[k.cur].mode = m; redrawStage(); drawStrip(); updateResult(); }));
    $('#cupOk').addEventListener('change', e => { S.cupOk = e.target.checked; updateResult(); });
    $('#exportAll').addEventListener('click', exportAll);
    $('#exportOne').addEventListener('click', async () => { const r = exportBlock(); if (r) return toast(r); save(await sheetBlob(S.sheet), fname(S.sheet)); toast(`已下载${SHEETS.find(s => s.id === S.sheet).name}`); });
    $('#copyBtn').addEventListener('click', async () => { try { await navigator.clipboard.writeText(exportCopy(currentFacts())); toast('文案已复制'); } catch { toast('浏览器没允许复制，请手动选中'); } });
    $('#showPhone').addEventListener('click', () => {
      const f = currentFacts(), kM = S.kit.main, kB = S.kit.banner, d = $('#phoneDlg');
      if (kM && kM.status === 'done') render($('#pdThumb'), 'main', { mode: (S.live || S.isSample) ? kM.mode : 'raw', seed: kM.seed, scene: kM.scene, facts: f, src: S.isSample ? null : S.photo, sceneImg: kM.sceneImg });
      if (kB && kB.status === 'done') render($('#pdBanner'), 'banner', { mode: (S.live || S.isSample) ? kB.mode : 'raw', seed: kB.seed, scene: kB.scene, facts: f, src: S.isSample ? null : S.photo, sceneImg: kB.sceneImg });
      $('#pdName').textContent = f.name; $('#pdShop').textContent = f.shop; $('#pdPrice').textContent = `¥${f.price}`; d.showModal();
    });
    $('#pdClose').addEventListener('click', () => $('#phoneDlg').close());
  }

  /* 启动 */
  async function probeBackend() {
    const banner = $('#svcBanner');
    try {
      const st = await apiStatus();
      S.live = true; S.unlocked = st.unlimited === true;
      if (typeof st.remaining === 'number') S.remaining = st.remaining;
      banner.dataset.state = 'live';
      banner.textContent = 'AI 生成服务已接通：每位访客可免费包装 3 次。';
    } catch {
      S.live = false;
      banner.dataset.state = 'offline';
      banner.textContent = 'AI 生成服务正在接入：现在可查看完整示例流程，示例不调用模型、不代表真实生成结果。';
    }
  }
  async function boot() {
    img.cut.src = CB_ASSETS.cut; img.photo.src = CB_ASSETS.photo;
    await Promise.all([img.cut.decode(), img.photo.decode(), document.fonts.load('40px "CB Display"', '冰奶油拿铁¥18').catch(() => {})]);
    await probeBackend();
    mountDials(); mountHome(); mountStudio(); mountUnlock(); mountHold();
    setRoast(S.roast, true); setPhase('empty');
    window.addEventListener('hashchange', route); route();
    drawHome();
    if (root.dataset.view === 'home' && !new URLSearchParams(location.search).has('nointro')) heroIntro();
    window.__cb = { S, setRoast, render, SHEETS };
  }
  boot();
})();
