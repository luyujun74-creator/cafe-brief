// 抠出商品：先用本机颜色算法秒出一版，再按需加载 AI 抠图模型（u2netp，约 4.6 MB + 运行库 11 MB）细化。
// 模型 15 秒没有任何下载/计算进展、或总计超过 45 秒，就保留本机结果并明确告知，不会一直停在等待态。
const vendor = new URL('../vendor/', import.meta.url);
export const STALL_MS = 15_000;
export const TOTAL_MS = 45_000;

const canvasOf = (w, h) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });
const sizeOf = image => [image.naturalWidth ?? image.width, image.naturalHeight ?? image.height];

// ———— 纯算法（可在 Node 测试）：边缘取背景色 → 从四边漫水 → 去碎块 ————
export function borderPalette(data, w, h) {
  const samples = [];
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  for (let x = 0; x < w; x += 2) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += 2) { take(0, y); take(w - 1, y); }
  // 3 个中心的简易 k-means，兼容渐变或两色背景。
  let centers = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]].map(c => [...c]);
  for (let round = 0; round < 6; round++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const s of samples) {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, k) => {
        const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      });
      const t = sums[best];
      t[0] += s[0]; t[1] += s[1]; t[2] += s[2]; t[3]++;
    }
    centers = centers.map((c, k) => sums[k][3] ? sums[k].slice(0, 3).map(v => v / sums[k][3]) : c);
  }
  let spread = 0;
  for (const s of samples) spread += Math.min(...centers.map(c => Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2])));
  return { centers, spread: spread / samples.length };
}

export function colorMask(data, w, h) {
  const { centers, spread } = borderPalette(data, w, h);
  const threshold = Math.max(22, Math.min(62, spread * 3 + 18));
  const near = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    let d = Infinity;
    for (const c of centers) d = Math.min(d, Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]));
    near[p] = d < threshold ? 1 : 0;
  }
  const background = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const seed = p => { if (near[p] && !background[p]) { background[p] = 1; queue[tail++] = p; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  // 只保留最大的前景块及其 5% 以上的伙伴，去掉零碎噪点。
  const label = new Int32Array(w * h);
  const sizes = [0];
  for (let p = 0; p < w * h; p++) {
    if (background[p] || label[p]) continue;
    const id = sizes.length;
    let count = 0;
    head = tail = 0;
    label[p] = id;
    queue[tail++] = p;
    while (head < tail) {
      const q = queue[head++];
      count++;
      const x = q % w;
      for (const n of [x > 0 ? q - 1 : -1, x < w - 1 ? q + 1 : -1, q >= w ? q - w : -1, q < w * (h - 1) ? q + w : -1]) {
        if (n >= 0 && !background[n] && !label[n]) { label[n] = id; queue[tail++] = n; }
      }
    }
    sizes.push(count);
  }
  const largest = Math.max(0, ...sizes);
  const mask = new Uint8Array(w * h);
  let kept = 0;
  for (let p = 0; p < w * h; p++) {
    if (label[p] && sizes[label[p]] >= largest * .05) { mask[p] = 255; kept++; }
  }
  const ratio = kept / (w * h);
  return { mask, ratio, spread, usable: ratio > .04 && ratio < .88 && spread < 26 };
}

// ———— 浏览器部分 ————
function maskCanvasFrom(values, w, h, fullW, fullH, feather) {
  const small = canvasOf(w, h);
  const ctx = small.getContext('2d');
  const image = ctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) {
    image.data[p * 4] = image.data[p * 4 + 1] = image.data[p * 4 + 2] = 255;
    image.data[p * 4 + 3] = values[p];
  }
  ctx.putImageData(image, 0, 0);
  const full = canvasOf(fullW, fullH);
  const fc = full.getContext('2d');
  fc.imageSmoothingQuality = 'high';
  fc.filter = `blur(${feather}px)`;
  fc.drawImage(small, 0, 0, fullW, fullH);
  return full;
}

function cropMask(fullW, fullH) {
  const mask = canvasOf(fullW, fullH);
  const ctx = mask.getContext('2d');
  const u = Math.min(fullW, fullH);
  ctx.filter = `blur(${Math.round(u * .05)}px)`;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.ellipse(fullW / 2, fullH * .52, fullW * .36, fullH * .4, 0, 0, Math.PI * 2);
  ctx.fill();
  return mask;
}

// 本机快速抠图：背景干净时颜色法；否则「智能裁切 + 柔化边缘」。
export function quickCutout(image) {
  const [fullW, fullH] = sizeOf(image);
  const scale = Math.min(1, 360 / Math.max(fullW, fullH));
  const w = Math.max(8, Math.round(fullW * scale));
  const h = Math.max(8, Math.round(fullH * scale));
  const work = canvasOf(w, h);
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const result = colorMask(ctx.getImageData(0, 0, w, h).data, w, h);
  if (result.usable) {
    return { mask: maskCanvasFrom(result.mask, w, h, fullW, fullH, Math.max(1, Math.min(fullW, fullH) * .004)), method: 'color' };
  }
  return { mask: cropMask(fullW, fullH), method: 'crop' };
}

async function fetchBytes(url, onProgress, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error('模型文件下载失败');
  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

let sessionPromise = null;
async function loadSession(progress, signal) {
  if (sessionPromise) return sessionPromise;
  const files = { wasm: [0, 11_246_032], model: [0, 4_574_861] };
  const report = () => {
    const loaded = files.wasm[0] + files.model[0];
    const total = files.wasm[1] + files.model[1];
    progress(Math.min(.99, loaded / total), `下载 AI 抠图模型 ${(loaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  };
  const attempt = (async () => {
    const [ort, wasm, model] = await Promise.all([
      import(new URL('ort/ort.wasm.min.mjs', vendor).href),
      fetchBytes(new URL('ort/ort-wasm-simd-threaded.wasm', vendor), (loaded, total) => { files.wasm = [loaded, total || files.wasm[1]]; report(); }, signal),
      fetchBytes(new URL('u2netp/u2netp.onnx', vendor), (loaded, total) => { files.model = [loaded, total || files.model[1]]; report(); }, signal),
    ]);
    progress(.99, '启动 AI 抠图模型');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = new URL('ort/', vendor).href;
    ort.env.wasm.wasmBinary = wasm.buffer;
    const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  sessionPromise = attempt;
  attempt.catch(() => { if (sessionPromise === attempt) sessionPromise = null; });
  return attempt;
}

async function runModel({ ort, session }, image) {
  const size = 320;
  const [fullW, fullH] = sizeOf(image);
  const work = canvasOf(size, size);
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const input = new Float32Array(3 * size * size);
  const mean = [.485, .456, .406];
  const std = [.229, .224, .225];
  for (let p = 0; p < size * size; p++) {
    for (let c = 0; c < 3; c++) input[c * size * size + p] = (pixels[p * 4 + c] / 255 - mean[c]) / std[c];
  }
  const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) };
  const output = (await session.run(feeds))[session.outputNames[0]].data;
  let min = Infinity;
  let max = -Infinity;
  for (const v of output) { if (v < min) min = v; if (v > max) max = v; }
  const values = new Uint8Array(size * size);
  let covered = 0;
  for (let p = 0; p < size * size; p++) {
    const v = (output[p] - min) / Math.max(1e-6, max - min);
    const a = Math.max(0, Math.min(1, (v - .12) / .7));
    values[p] = Math.round(a * 255);
    if (a > .5) covered++;
  }
  const ratio = covered / (size * size);
  if (ratio < .02 || ratio > .96) throw new Error('AI 没找到明确的商品主体');
  return maskCanvasFrom(values, size, size, fullW, fullH, Math.max(.6, Math.min(fullW, fullH) * .0015));
}

// 带停滞检测的 AI 抠图：onProgress(比例, 文字)。
export function aiCutout(image, { onProgress = () => {}, stallMs = STALL_MS, totalMs = TOTAL_MS, fail = false } = {}) {
  const controller = new AbortController();
  let stallTimer;
  let lastText = '';
  return new Promise((resolve, reject) => {
    const stop = reason => {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
      controller.abort();
      reject(new Error(reason));
    };
    const kick = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => stop(`AI 抠图 ${Math.round(stallMs / 1000)} 秒没有进展`), stallMs);
    };
    const totalTimer = setTimeout(() => stop(`AI 抠图超过 ${Math.round(totalMs / 1000)} 秒`), totalMs);
    const progress = (ratio, text) => {
      kick();
      if (text !== lastText) { lastText = text; onProgress(ratio, text); }
    };
    kick();
    (async () => {
      if (fail) throw new Error('AI 抠图模型不可用');
      const runtime = await loadSession(progress, controller.signal);
      progress(1, 'AI 正在识别商品轮廓');
      await new Promise(r => setTimeout(r, 30));
      return runModel(runtime, image);
    })().then(mask => {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
      resolve({ mask, method: 'ai' });
    }, error => {
      clearTimeout(stallTimer);
      clearTimeout(totalTimer);
      reject(error);
    });
  });
}

// 原图 × 蒙版 → 透明底商品，并按不透明区域裁掉多余空白。
export function applyMask(image, mask) {
  const [w, h] = sizeOf(image);
  const full = canvasOf(w, h);
  const ctx = full.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, w, h);
  const step = Math.max(1, Math.round(Math.max(w, h) / 400));
  const alpha = ctx.getImageData(0, 0, w, h).data;
  let [x0, y0, x1, y1] = [w, h, 0, 0];
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (alpha[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return full;
  const pad = Math.round(Math.max(w, h) * .01);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w, x1 + pad + step); y1 = Math.min(h, y1 + pad + step);
  const cropped = canvasOf(x1 - x0, y1 - y0);
  cropped.getContext('2d').drawImage(full, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
  return cropped;
}

// 画笔：擦除（destination-out）或恢复（source-over）蒙版。
export function paintMask(mask, from, to, radius, erase) {
  const ctx = mask.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineWidth = radius * 2;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(to.x, to.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function cloneCanvas(source) {
  const copy = canvasOf(source.width, source.height);
  copy.getContext('2d').drawImage(source, 0, 0);
  return copy;
}

export function canvasBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败')), type, quality));
}

export async function canvasFromBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = canvasOf(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}
