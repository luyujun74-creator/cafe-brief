/* Load after browser-in-page.js. */
cbTest.imageFraming = async function (width, height) {
  const w = await this.open(width, height, 'online');
  const d = w.document, q = s => d.querySelector(s);
  const frame = () => new Promise(resolve => w.requestAnimationFrame(() => w.requestAnimationFrame(resolve)));
  const mark = d.createElement('canvas');
  const specs = [[960, 800], [800, 960], [800, 800]];
  const colors = ['#f00', '#0f0', '#00f', '#ff0'];
  const hasMarks = canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const found = [false, false, false, false];
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      if (r > 215 && g < 35 && b < 35) found[0] = true;
      if (r < 35 && g > 215 && b < 35) found[1] = true;
      if (r < 35 && g < 35 && b > 215) found[2] = true;
      if (r > 215 && g > 215 && b < 35) found[3] = true;
    }
    return found.every(Boolean);
  };
  for (const [a, b] of specs) {
    mark.width = a; mark.height = b;
    const ctx = mark.getContext('2d');
    ctx.fillStyle = '#777'; ctx.fillRect(0, 0, a, b);
    [[0, 0], [a-60, 0], [0, b-60], [a-60, b-60]].forEach(([x,y],i) => {
      ctx.fillStyle = colors[i]; ctx.fillRect(x,y,60,60);
    });
    const blob = await new Promise(r => mark.toBlob(r));
    const previous = w.__cb.S.photo;
    const files = new w.DataTransfer();
    files.items.add(new w.File([blob], 'edge-markers.png', {type:'image/png'}));
    q('#file').files = files.files;
    q('#file').dispatchEvent(new w.Event('change'));
    await this.until(() => w.__cb.S.photo !== previous);
    await frame();
    q('#viewOriginal').focus(); q('#viewOriginal').click();
    this.assert(q('#lightboxDlg').open && hasMarks(q('#lbCanvas')), width + ' 原片四边完整 ' + a + '×' + b);
    q('#lbZoomIn').click();
    this.assert(q('#lbZoomLabel').textContent === '125%', width + ' 放大');
    q('#lbZoomFit').click();
    const image = q('#lbCanvas').getBoundingClientRect(), stage = q('#lbStage').getBoundingClientRect();
    this.assert(image.left >= stage.left - 1 && image.right <= stage.right + 1 && image.top >= stage.top - 1 && image.bottom <= stage.bottom + 1, width + ' 适配窗口完整');
    q('#lightboxDlg').close();
    await this.until(() => d.activeElement === q('#viewOriginal'));
  }
  for (const [selector, value] of [['#iName','四边标记拿铁'], ['#iPrice','19.9'], ['#iOffer','周一到店优惠']]) {
    q(selector).value = value;
    q(selector).dispatchEvent(new w.Event('input'));
  }
  const fetchOriginal = w.fetch;
  const ai = mark.toDataURL();
  let posts = 0, sourceFetches = 0, releasePackage;
  w.fetch = async (u,o) => {
    if (String(u).includes('/api/package')) {
      posts++;
      return new Promise(resolve => { releasePackage = resolve; });
    }
    if (String(u).endsWith('/mock-ai-image')) {
      sourceFetches++;
      return sourceFetches === 1 ? new w.Response('', {status:502}) : fetchOriginal(ai);
    }
    return fetchOriginal(u,o);
  };
  q('#go').click();
  await this.until(() => releasePackage);
  q('#cancel').click();
  this.assert(w.__cb.S.phase === 'ready' && w.__cb.S.photo, width + ' 退出等待保留原片');
  q('#go').click();
  releasePackage(new w.Response(JSON.stringify({title:'四边标记拿铁',detail:'¥19.9',remaining:0,image_url:'/mock-ai-image'})));
  await this.until(() => !q('#lateResult').hidden);
  q('#lateResult').click();
  await this.until(() => w.__cb.S.phase === 'error');
  q('#errRetry').click();
  await this.until(() => w.__cb.S.phase === 'result');
  q('#viewAiSource').click();
  this.assert(hasMarks(q('#lbCanvas')) && q('#lbTitle').textContent === 'AI 源图', width + ' AI源图四边完整');
  q('#lbZoom200').click();
  const viewer = q('#lbStage');
  viewer.focus();
  const centered = q('#lbPan').style.transform;
  viewer.dispatchEvent(new w.KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true}));
  this.assert(q('#lbPan').style.transform !== centered, width + ' 键盘平移');
  const capturePointer = viewer.setPointerCapture;
  viewer.setPointerCapture = () => {}; // Synthetic events have no browser-owned pointer.
  try {
    const pointer = (kind, id, x, y) => viewer.dispatchEvent(new w.PointerEvent(kind, {
      pointerId:id, pointerType:'touch', clientX:x, clientY:y, bubbles:true
    }));
    q('#lbZoomFit').click();
    pointer('pointerdown', 1, 50, 60);
    pointer('pointerdown', 2, 130, 60);
    pointer('pointermove', 2, 210, 60);
    this.assert(q('#lbZoomLabel').textContent === '200%', width + ' 双指缩放');
    pointer('pointerup', 2, 210, 60);
    const beforeDrag = q('#lbPan').style.transform;
    pointer('pointermove', 1, 50, 100);
    this.assert(q('#lbPan').style.transform !== beforeDrag, width + ' 缩放后拖动');
    pointer('pointerup', 1, 50, 100);
  } finally { viewer.setPointerCapture = capturePointer; }
  q('#lightboxDlg').close();
  for (const spec of w.__cb.SHEETS) {
    q('#specTabs [data-spec="'+spec.id+'"]').click();
    await frame();
    this.assert(hasMarks(q('#stageCanvas')), width + ' 成品保留四边 ' + spec.id);
    q('#cupOk').click();
    const capture = w.URL.createObjectURL;
    let jpeg;
    w.URL.createObjectURL = function(blob) { if (blob.type === 'image/jpeg') jpeg = blob; return capture.call(this,blob); };
    try {
      q('#exportOne').click();
      await this.until(() => jpeg);
      const bitmap = await w.createImageBitmap(jpeg);
      this.assert(bitmap.width === spec.w && bitmap.height === spec.h, width + ' 下载固定尺寸 ' + spec.id);
      const output = d.createElement('canvas'); output.width = bitmap.width; output.height = bitmap.height;
      output.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
      this.assert(hasMarks(output), width + ' JPEG四边完整 ' + spec.id);
    } finally { w.URL.createObjectURL = capture; }
  }
  q('#specTabs [data-spec=banner]').click(); await frame();
  q('#fitModeBtn').click(); await frame();
  this.assert(!hasMarks(q('#stageCanvas')), width + ' 主动裁切反馈');
  q('#fitModeBtn').click(); await frame();
  this.assert(hasMarks(q('#stageCanvas')), width + ' 恢复完整构图');
  q('input[name=fid][value=raw]').click(); await frame();
  this.assert(hasMarks(q('#stageCanvas')) && !q('#viewAiSource').hidden, width + ' 一键原片回退，仍可查看AI源图');
  w.__cb.switchView('compare'); await frame();
  q('#proofs [data-view-proof=banner]').click();
  this.assert(q('#lightboxDlg').open && hasMarks(q('#lbCanvas')), width + ' 对比页直接查看成品');
  this.assert(posts === 1 && sourceFetches === 2 && w.testErrors.length === 0, width + ' 恢复仅重试取图且无脚本异常');
  return {width,height};
};

cbTest.compareFraming = async function (width, height) {
  const w = await this.open(width, height);
  const d = w.document, q = selector => d.querySelector(selector);
  const {S, SHEETS, render, switchView} = w.__cb;
  q('#trySample').click();
  await this.until(() => S.isSample && S.phase === 'ready');
  q('#go').click();
  await this.until(() => S.phase === 'result');
  for (const spec of SHEETS) {
    switchView('studio');
    q('#specTabs [data-spec="' + spec.id + '"]').click();
    switchView('compare');
    for (const id of ['#baBefore', '#baAfter']) {
      const canvas = q(id), rect = canvas.getBoundingClientRect();
      this.assert(Math.abs(rect.height - rect.width * spec.h / spec.w) < 1,
        width + ' ' + spec.id + ' ' + id + ' CSS 比例 ' + rect.width + '×' + rect.height);
      this.assert(Math.abs(canvas.height - canvas.width * spec.h / spec.w) <= .5,
        width + ' ' + spec.id + ' ' + id + ' Canvas 比例');
    }
  }

  switchView('studio');
  const source = q('#stageCanvas');
  const canvas = d.createElement('canvas');
  canvas.width = 1440;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  const fillText = ctx.fillText.bind(ctx);
  const subtitle = '拾叶咖啡门店'.repeat(5);
  let bounds;
  ctx.fillText = (value, x, y, maxWidth) => {
    if (value.includes(subtitle)) bounds = x + Math.min(ctx.measureText(value).width, maxWidth ?? Infinity);
    return maxWidth === undefined ? fillText(value, x, y) : fillText(value, x, y, maxWidth);
  };
  render(canvas, 'banner', {
    fixedSize: true, mode: 'scene', sceneImg: source, fit: 'contain',
    facts: {name: '拿铁', shop: subtitle, offer: '周末到店第二杯半价', price: '18'}
  });
  this.assert(bounds <= canvas.width * .53, width + ' Banner 活动副标题右边界 ' + bounds);

  const file = await new Promise(resolve => canvas.toBlob(resolve));
  const files = new w.DataTransfer();
  files.items.add(new w.File([file], 'banner.png', {type: 'image/png'}));
  q('#file').files = files.files;
  q('#file').dispatchEvent(new w.Event('change'));
  await this.until(() => !S.isSample && S.phase === 'ready');
  const original = S.photo;
  q('#fitModeBtn').click();
  this.assert(S.fitMode === 'cover', width + ' 原片手动选择裁切');
  q('#trySample').click();
  await this.until(() => S.isSample);
  this.assert(S.fitMode === 'contain' && q('#fitModeBtn').getAttribute('aria-pressed') === 'false',
    width + ' 替换为示例后默认完整显示');
  q('#sampleUndo').click();
  this.assert(S.photo === original && !S.isSample && S.fitMode === 'cover'
    && q('#fitModeBtn').getAttribute('aria-pressed') === 'true', width + ' 撤销恢复原片与裁切选择');
  this.assert(w.testErrors.length === 0, width + ' 对比与撤销无脚本异常');
};
