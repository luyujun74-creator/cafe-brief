// 豆包 Seedream 在线生图：经 Cloudflare 云接口（Worker）调用。
// 线上（github.io）直接请求 Worker 绝对地址；本地预览走同源代理 /api/cloud，避免来源限制。
export const WORKER = 'https://cafe-brief.cafe-brief-web.workers.dev';
export const CLOUD_NOTE = '在线 AI 生图经 Cloudflare 云接口，需在非中国大陆网络下使用';
export const CLOUD_DOWN = '在线生图不可用（需非中国大陆网络）· 本地功能照常';
export const STATUS_TIMEOUT = 4500;
export const GENERATE_TIMEOUT = 170_000;
const TOKEN_KEY = 'cafe-brief:cloud-token';

export const sceneStyles = [
  { id: 'morning', label: '清晨窗边', style: '清晨窗边自然光' },
  { id: 'bar', label: '咖啡馆吧台', style: '咖啡馆木质吧台' },
  { id: 'autumn', label: '秋日户外', style: '秋日户外暖阳' },
  { id: 'festive', label: '节日氛围', style: '节日暖色灯光氛围' },
  { id: 'studio', label: '纯色影棚', style: '纯色影棚' },
];

export function cloudBase(location = globalThis.location) {
  const host = location?.hostname || '';
  return /github\.io$/i.test(host) ? WORKER : `${location?.origin || ''}/api/cloud`;
}

export const absolute = (path, base = cloudBase()) => /^https?:/i.test(path) ? path : `${base}${path.replace(/^\/api/, '')}`;

const messages = {
  QUOTA_EXCEEDED: '今天的 3 次免费在线生图已用完。可输入解锁密码继续，或先用本地场景。',
  PUBLIC_BUDGET_EXCEEDED: '今日公共生图额度已用完，请明天再试；本地场景照常可用。',
  RATE_LIMIT: '操作太频繁了，请一分钟后再试。',
  GENERATION_BUSY: '上一张图还在生成，请稍等完成后再试。',
  MODEL_FAILED: '豆包这次没有生成成功，本次不计次数。可以换个场景再试。',
  INPUT_INVALID: '商品名或价格不符合要求（价格需大于 0），请在「信息核对」里改好再试。',
  SERVER_CONFIG: '在线生图服务暂未配置，先用本地场景。',
  UNLOCK_INVALID: '密码不对。',
  UNLOCK_LIMIT: '错误次数太多，请一小时后再试。',
  ORIGIN_DENIED: '当前网址未获在线生图授权，先用本地场景。',
  IMAGE_INVALID: '生成的图片链接已失效，请重新生成。',
  IMAGE_UNAVAILABLE: '图片暂时取不回来，请稍后重试。',
};

export function cloudMessage(code, fallback = '') {
  if (code === 'NETWORK') return `连不上在线生图服务（${CLOUD_NOTE}）。本地场景照常可用。`;
  if (code === 'TIMEOUT') return '豆包超过 170 秒没有返回，已停止等待，本次一般不计次数。可稍后再试或先用本地场景。';
  if (code === 'ABORTED') return '已取消生成。';
  return messages[code] || fallback || '在线生图失败，先用本地场景。';
}

export class CloudError extends Error {
  constructor(code, message) {
    super(cloudMessage(code, message));
    this.code = code;
  }
}

// Worker 可能先发空格心跳再发 JSON，且错误也可能以 200 状态放在正文里。
export function parseCloudBody(text, status = 200) {
  let data;
  try { data = JSON.parse(String(text).trim()); } catch { throw new CloudError(status >= 500 ? 'MODEL_FAILED' : 'NETWORK'); }
  if (data && data.code && data.error && !data.image_url && !data.scene_url) throw new CloudError(data.code, data.error);
  if (status >= 400) throw new CloudError(data?.code || 'MODEL_FAILED', data?.error);
  return data;
}

export const savedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = token => { try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch {} };

function headers(json) {
  const out = {};
  if (json) out['content-type'] = 'application/json';
  const token = savedToken();
  if (token) out.authorization = `Bearer ${token}`;
  return out;
}

async function call(path, { method = 'GET', body, timeout, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('TIMEOUT'), timeout);
  const relay = () => controller.abort('ABORTED');
  signal?.addEventListener('abort', relay, { once: true });
  try {
    const response = await fetch(absolute(path), {
      method, headers: headers(!!body), body: body && JSON.stringify(body), signal: controller.signal, cache: 'no-store', credentials: 'omit',
    });
    return parseCloudBody(await response.text(), response.status);
  } catch (error) {
    if (error instanceof CloudError) throw error;
    if (controller.signal.aborted) throw new CloudError(controller.signal.reason === 'ABORTED' ? 'ABORTED' : 'TIMEOUT');
    throw new CloudError('NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }
}

// 返回 { ok, configured, remaining, unlimited } 或 { ok:false }；绝不抛出，绝不超过 4.5 秒。
export async function cloudStatus(timeout = STATUS_TIMEOUT) {
  try {
    const data = await call('/api/status', { timeout });
    if (savedToken() && !data.unlimited) saveToken('');
    return { ok: !!data.configured, configured: !!data.configured, remaining: data.remaining, unlimited: !!data.unlimited };
  } catch (error) {
    return { ok: false, code: error.code };
  }
}

export async function unlockCloud(password) {
  const data = await call('/api/unlock', { method: 'POST', body: { password }, timeout: 15_000 });
  if (!data.token) throw new CloudError('UNLOCK_INVALID');
  saveToken(data.token);
  return { unlimited: true, remaining: null };
}

const requestId = () => `cb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;

// facts 为本应用格式：{ name, price（分）}；branding：{ brand, selling, offer }。
export function cloudPayload(facts, branding = {}, image, style) {
  const cents = Number(facts.price);
  const price = Number.isInteger(cents) && cents > 0 ? (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100)) : '';
  return {
    product: String(facts.name || '').trim().slice(0, 40),
    shop: String(branding.brand || '').trim().slice(0, 40) || undefined,
    price,
    offer: String(branding.offer || '').trim().slice(0, 300) || undefined,
    highlights: String(branding.selling || '').trim().slice(0, 300) || undefined,
    image,
    style: String(style || '').slice(0, 24),
    platform: 'shop',
    requestId: requestId(),
  };
}

// 生成场景图：onStage('prepare'|'generate'|'fetch'|'done')。返回 { blob, remaining, unlimited, seconds }。
export async function generateScene(facts, branding, imageDataUrl, style, { onStage = () => {}, signal } = {}) {
  const started = performance.now();
  onStage('generate');
  const data = await call('/api/generate-image', { method: 'POST', body: cloudPayload(facts, branding, imageDataUrl, style), timeout: GENERATE_TIMEOUT, signal });
  const url = data.scene_url || data.image_url;
  if (!url) throw new CloudError('MODEL_FAILED');
  onStage('fetch');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let blob;
  try {
    const response = await fetch(absolute(url), { headers: headers(false), signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok || !/^image\//.test(response.headers.get('content-type') || '')) {
      let code = 'IMAGE_UNAVAILABLE';
      try { code = JSON.parse((await response.text()).trim()).code || code; } catch {}
      throw new CloudError(code);
    }
    blob = await response.blob();
  } catch (error) {
    throw error instanceof CloudError ? error : new CloudError('IMAGE_UNAVAILABLE');
  } finally { clearTimeout(timer); }
  onStage('done');
  return { blob, remaining: data.remaining, unlimited: !!data.unlimited, seconds: Math.round((performance.now() - started) / 100) / 10, timings: data.timings_ms || null };
}
