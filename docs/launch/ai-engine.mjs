// 浏览器本地 AI 引擎：一句话解析、分语气文案、选区改写、商品照取色、标题溢出检测。
// 纯函数，不依赖 DOM，可在 Node 中单独测试；GitHub Pages 无后端时全部在本机完成。
import { money, noteAmbiguities, ruleFacts, scopeLabel, validatedCopy } from './workflow.mjs?v=202611263';

export const channelWords = {
  menu: /菜单|点单/,
  poster: /柜台|海报|门店屏|立牌|展架/,
  banner: /banner|横幅|首页图|头图/i,
  social: /朋友圈|社交|小红书|动态|社群/,
  delivery: /外卖主图|外卖图|美团|饿了么/,
};
export const channelNames = { menu: '店内菜单', poster: '柜台海报', banner: '门店 Banner', social: '朋友圈图文', delivery: '外卖主图' };

export const tones = {
  fresh: { label: '清爽', words: /清爽|清新|清透|夏|冰|冷萃|气泡/ },
  warm: { label: '温暖', words: /温暖|暖|冬|热|治愈|可可/ },
  lively: { label: '活泼', words: /活泼|活力|俏皮|热闹|元气|可爱/ },
  premium: { label: '质感', words: /高级|质感|精致|简约|克制|手冲/ },
};

const verbs = /帮我|帮忙|请|做|生成|设计|制作|海报|照片|图片|一张|这张|物料|一版|两版|用这|把/;
const dayWord = /^(?:\d{4}-\d{2}-\d{2}|(?:\d{4}年)?\d{1,2}月\d{1,2}[日号]|[本这下]?(?:周|星期)[一二三四五六日天]|今天|明天|后天)/;

// 从「桂花拿铁 26 元 周六上新」「冬季热可可，22 元」这类自由写法里找商品名。
function looseName(text) {
  const clean = text.normalize('NFKC').trim();
  const patterns = [
    /(?:上新|新品|推出|主推|上架)[:：]?\s*([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z ]{1,13}?)(?=[，,。；;\s]|\d|$)/u,
    /^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z]{1,13}?)(?=\s*[，,]?\s*[¥￥]?\d)/u,
  ];
  for (const pattern of patterns) {
    let value = clean.match(pattern)?.[1]?.trim();
    if (!value) continue;
    value = value.replace(dayWord, '').replace(/^(?:上新|上|推出)/, '').trim();
    if (value.length >= 2 && !verbs.test(value) && !dayWord.test(value)) return value.slice(0, 36);
  }
  return '';
}

export function parseInstruction(text = '') {
  const note = String(text).slice(0, 300);
  const facts = ruleFacts(note);
  if (!facts.name) facts.name = looseName(note);
  const ambiguous = noteAmbiguities(note);
  const requested = Object.keys(channelWords).filter(id => channelWords[id].test(note));
  if (requested.includes('delivery') && !facts.scope && !/仅限堂食|仅堂食|不做外卖/.test(note)) facts.scope = 'all';
  const tone = Object.keys(tones).find(id => tones[id].words.test(note)) ?? 'fresh';
  const recognized = [
    { id: 'name', label: '商品', value: facts.name, missing: '待补充商品名' },
    { id: 'price', label: '售价', value: facts.price == null ? '' : money(facts.price), missing: ambiguous.price ? '出现多个价格' : '待补充售价', check: true },
    { id: 'day', label: '上新', value: facts.day, missing: ambiguous.day ? '出现多个日期' : '待补充日期', check: true },
    { id: 'scope', label: '范围', value: facts.scope ? scopeLabel(facts.scope) : '', missing: '待确认销售范围' },
    { id: 'channels', label: '渠道', value: requested.length ? requested.map(id => channelNames[id]).join('、') : '全部渠道' },
    { id: 'tone', label: '语气', value: tones[tone].label },
  ];
  return { facts, channels: requested, tone, ambiguous, recognized, note };
}

export const firstQuestion = facts => !facts.name ? ['name', '这款商品叫什么？']
  : facts.price == null ? ['price', '这款卖多少钱？'] : !facts.day ? ['day', '哪天开始上新？']
  : !facts.scope ? ['scope', '只做堂食，还是堂食和外卖都上？'] : null;

const toneSets = {
  fresh: {
    menu: { title: '清爽新口味', body: '入口清透，适合配一段轻松时光。' },
    poster: { title: '来一杯清爽', body: '清透顺口，给午后添一点轻盈。' },
    banner: { title: '清爽上架', body: '清透新口味，等你来尝。' },
    social: { title: '今日份清爽', body: '清透顺口的一杯，适合和朋友慢慢聊。' },
    delivery: { title: '清爽一杯', body: '清透顺口，忙碌间隙也能轻松一下。' },
  },
  warm: {
    menu: { title: '暖心新口味', body: '温润顺口，适合慢慢喝完一整杯。' },
    poster: { title: '捧一杯温暖', body: '温润绵长，给冷天留一点暖意。' },
    banner: { title: '暖意上架', body: '温润新口味，来店里坐坐。' },
    social: { title: '冷天的暖意', body: '捧在手心的一杯，适合和朋友慢慢聊。' },
    delivery: { title: '温暖一杯', body: '温润顺口，在家也能慢下来。' },
  },
  lively: {
    menu: { title: '新口味报到', body: '味道明亮有活力，点一杯试试看！' },
    poster: { title: '元气满满', body: '明亮好喝的一杯，给日常加点能量！' },
    banner: { title: '新口味来啦', body: '元气一杯，等你来尝鲜！' },
    social: { title: '快来尝鲜', body: '新口味上桌啦，约上朋友一起来吧！' },
    delivery: { title: '元气一杯', body: '明亮好喝，随手来一杯吧！' },
  },
  premium: {
    menu: { title: '新品入列', body: '风味层次分明，值得细细品尝。' },
    poster: { title: '值得细品', body: '层次分明的风味，留给懂得慢下来的你。' },
    banner: { title: '风味新作', body: '层次分明，值得一试。' },
    social: { title: '慢慢品一杯', body: '层次分明的新风味，适合安静的午后。' },
    delivery: { title: '风味新品', body: '层次分明，在家也能细细品尝。' },
  },
};

// 分语气的整套文案。结果仍经 validatedCopy 校验，任何含价格、日期、活动或未确认配料的句子都会被丢弃。
export function toneCopy(facts, tone = 'fresh', branding) {
  return validatedCopy(toneSets[tone] ?? toneSets.fresh, facts, branding);
}

const titleLimits = { menu: 12, poster: 12, banner: 9, social: 10, delivery: 10 };
export const titleLimit = baseId => titleLimits[baseId] ?? 12;
export const titleOverflow = (title, baseId) => [...String(title ?? '')].length > titleLimit(baseId);

const claim = /[¥￥%％\d]|[一二两三四五六七八九十百千]+\s*(?:元|块|折)|售价|折扣|优惠|免费|半价|限量|特价|秒杀|今天|明天|后天|周[一二三四五六日天]|星期|本周|下周|周末|月\s*\d|外卖|堂食|送到家|配送/;
// 改写候选不得引入任何未确认的价格、日期或销售范围。
export const safeCandidate = text => Boolean(text) && !claim.test(text.normalize('NFKC'));

const pick = (list, seed, avoid) => {
  const options = list.filter(item => item && item !== avoid && safeCandidate(item));
  return options.length ? options[Math.abs(seed) % options.length] : '';
};
const trimTo = (text, limit) => [...text].slice(0, limit).join('');

function shorterTitle(text, name, limit) {
  const parts = text.split(/[\s，,。！!、·]+/).filter(Boolean);
  const short = parts.find(part => [...part].length <= limit && safeCandidate(part));
  if (short && short !== text) return short;
  if (name && [...name].length <= limit && name !== text) return name;
  return trimTo(name || text, limit);
}

// 选中一句后的两种写法：简洁直给 / 轻松亲切。mode 可为 shorter、livelier，seed 用于「换一批」。
export function rewriteCandidates({ text = '', kind = 'title', facts = {}, baseId = 'poster', mode = '', seed = 0 }) {
  const name = facts.name ?? '';
  const source = String(text).trim();
  const limit = titleLimit(baseId);
  let direct;
  let friendly;
  if (kind === 'title') {
    direct = pick([name, `新品${name}`, `${name}上新`, `${name}已上架`], seed, source);
    friendly = pick([`来杯${name}吧`, `今日份${name}`, `和${name}见个面`, `想喝${name}吗`], seed, source);
    if (mode === 'shorter') {
      direct = shorterTitle(source || name, name, Math.min(limit, 8));
      friendly = pick([`嗨，${name}`, `${name}来了`, name], seed + 1, direct) || direct;
    } else if (mode === 'livelier') {
      direct = pick([`${name}来啦！`, `${name}，冲！`], seed, source);
      friendly = pick([`快来尝尝${name}`, `今天就想喝${name}`, `一起喝${name}呀`], seed, source);
    }
    direct = direct ? trimTo(direct, 36) : '';
    friendly = friendly ? trimTo(friendly, 36) : '';
  } else {
    const directSet = ['新品上架，欢迎点单。', '新口味已上，欢迎来尝。', '门店新品，欢迎了解。', '一杯新风味，等你来试。'];
    const friendlySet = ['路过记得进来坐坐，给自己留一杯好时光。', '约上朋友来店里，慢慢喝一杯吧。', '忙了一天，来一杯犒劳自己吧。', '找个舒服的位置，慢慢享受这一杯。'];
    direct = pick(directSet, seed, source);
    friendly = pick(friendlySet, seed, source);
    if (mode === 'shorter') {
      const first = source.split(/[，,。！!]/).find(part => part.trim().length >= 4);
      direct = first && safeCandidate(first) ? first.trim() + '。' : pick(directSet, seed + 1, source);
      friendly = pick(['来坐坐吧。', '来尝一杯吧。', '等你来喝。'], seed, source);
    } else if (mode === 'livelier') {
      direct = pick(['新口味上桌啦，快来尝！', '好喝的新品来啦！'], seed, source);
      friendly = pick(['约上好朋友，一起来喝一杯吧！', '今日份快乐，从这一杯开始！'.replace('今日份', '这份'), '别犹豫，来店里尝尝看吧！'], seed, source);
    }
  }
  return [
    { id: 'direct', label: mode === 'shorter' ? '更短 · 简洁直给' : mode === 'livelier' ? '更活泼 · 直给' : '简洁直给', text: direct },
    { id: 'friendly', label: mode === 'shorter' ? '更短 · 轻松亲切' : mode === 'livelier' ? '更活泼 · 亲切' : '轻松亲切', text: friendly },
  ].filter(candidate => candidate.text && safeCandidate(candidate.text));
}

// ———— 取色配版 ————
const hex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const parse = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const mix = (rgb, target, amount) => rgb.map((v, i) => v + (target[i] - v) * amount);
const luminance = rgb => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
};
export function contrastRatio(a, b) {
  const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((m, n) => n - m);
  return (x + .05) / (y + .05);
}
function saturation([r, g, b]) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const light = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
}

function towards(color, against, target, step) {
  let value = color;
  for (let i = 0; i < 12 && contrastRatio(hex(value), against) < target; i++) value = mix(value, step, .16);
  return hex(value);
}

export const fallbackPalette = { id: 'contrast', label: '高对比', paper: '#16233a', ink: '#ffffff', accent: '#8fb6ff' };

// 从 RGBA 像素统计主色，给出「原片同色」「高对比」两套配色。无可用像素时返回 null。
export function paletteFromPixels(data) {
  const buckets = new Map();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const rgb = [data[i], data[i + 1], data[i + 2]];
    const key = rgb.map(v => v >> 4).join(',');
    const entry = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] };
    entry.count++;
    rgb.forEach((v, n) => { entry.sum[n] += v; });
    buckets.set(key, entry);
  }
  if (!buckets.size) return null;
  const colors = [...buckets.values()].map(({ count, sum }) => {
    const rgb = sum.map(v => v / count);
    const light = (Math.max(...rgb) + Math.min(...rgb)) / 510;
    return { rgb, count, score: count * (.15 + saturation(rgb)) * (light > .12 && light < .9 ? 1 : .2) };
  });
  const base = colors.sort((a, b) => b.score - a.score)[0].rgb;
  const paper = hex(mix(base, [255, 255, 255], .86));
  const ink = towards(mix(base, [0, 0, 0], .74), paper, 7, [0, 0, 0]);
  const match = { id: 'match', label: '原片同色', paper, ink, accent: towards(base, paper, 3, [0, 0, 0]) };
  const dark = hex(mix(base, [0, 0, 0], .8));
  const contrast = { id: 'contrast', label: '高对比', paper: dark, ink: '#ffffff', accent: towards(mix(base, [255, 255, 255], .4), dark, 4.5, [255, 255, 255]) };
  return { base: hex(base), match, contrast };
}
