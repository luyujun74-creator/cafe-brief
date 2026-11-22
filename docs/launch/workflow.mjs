const catalog = [
  { id: 'menu', title: '店内菜单', width: 1200, height: 900, use: '电子菜单与点单页', leads: ['新品已加入菜单。', '菜单上新，欢迎点单。'] },
  { id: 'poster', title: '柜台海报', width: 1200, height: 1800, use: '柜台展示或门店屏幕', leads: ['新品来了，欢迎到店。', '本店上新，欢迎了解。'] },
  { id: 'banner', title: '门店 Banner', width: 1600, height: 640, use: '门店首页横幅', leads: ['门店新品上架。', '看看本期新品。'] },
  { id: 'social', title: '朋友圈图文', width: 1080, height: 1080, use: '门店社交动态', leads: ['店里上新啦，欢迎来店看看！', '新品见面，欢迎来店打卡。'] },
  { id: 'delivery', title: '外卖主图', width: 1600, height: 1200, use: '外卖商品列表及详情', leads: ['外卖菜单上新。', '新品可在外卖菜单查看。'] },
];

export const fields = { name: '商品名', price: '售价', day: '上新时间', scope: '销售范围' };
export const channels = facts => catalog.filter(c => c.id !== 'delivery' || facts.scope === 'all');
export const money = price => '¥' + (price / 100).toFixed(price % 100 ? 2 : 0);
export const scopeLabel = scope => scope === 'all' ? '堂食和外卖' : '仅限堂食';
export const factLine = facts => `${facts.name} · ${money(facts.price)} · ${facts.day} · ${scopeLabel(facts.scope)}`;
const amount = '(\\d{1,4}(?:\\.\\d{1,2})?)';
const dayPattern = '(?:\\d{4}-\\d{2}-\\d{2}|(?:\\d{4}\\s*年\\s*)?\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]|[本这下]?(?:周|星期)[一二三四五六日天]|今天|明天|后天)';
const bounded = (value, size) => typeof value === 'string' && value.trim().length <= size ? value.trim().replace(/[\r\n\t]+/g, ' ') : '';
const cents = value => Math.round(Number(value) * 100);
const validPrice = price => Number.isInteger(price) && price >= 1 && price <= 999999;

export function normalizeFacts(value = {}) {
  return {
    name: bounded(value.name, 36),
    price: validPrice(value.price) ? value.price : null,
    day: bounded(value.day, 32),
    scope: ['store', 'all'].includes(value.scope) ? value.scope : '',
  };
}

const priceMentions = text => [...new Set([...text.normalize('NFKC').matchAll(
  /(?:¥\s*|(?:售价|价格|定价)\s*[:：]?\s*)(\d+(?:\.\d+)?)(?![\d.])|(?<![\d.+-])(\d+(?:\.\d+)?)\s*元/g
)].map(match => cents(match[1] ?? match[2])))];
const canonicalDay = date => date.normalize('NFKC').replace(/\s/g, '')
  .replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1年$2月$3日')
  .replace(/^(本|这)(?=周|星期)/, '').replace(/星期/g, '周').replace(/周天/g, '周日')
  .replace(/(\d)号$/, '$1日').replace(/(^|年|月)0(?=\d)/g, '$1');
const dateMentions = text => [...new Map([...text.matchAll(new RegExp(dayPattern, 'g'))]
  .map(match => [canonicalDay(match[0]), match[0]])).values()];
const scopeMentions = text => [
  /仅限堂食|仅堂食|只做堂食|不做外卖|堂食限定|关闭外卖/.test(text) ? 'store' : '',
  /堂食(?:和|及|与|、)外卖|堂食外卖(?:都可|均可)|外卖也上|开放外卖|开通外卖|可(?:以)?点外卖/.test(text) ? 'all' : '',
].filter(Boolean);

export function noteAmbiguities(note) {
  return { price: priceMentions(note).length > 1, day: dateMentions(note).length > 1, scope: scopeMentions(note).length > 1 };
}

export function ruleFacts(note) {
  const name = note.match(/(?:商品名|品名)\s*[:：]\s*([^，,。；;\n]+)/)?.[1]
    ?? note.match(new RegExp('^' + dayPattern + '(?:上新|上|推出)\\s*([^，,。；;\\n]+)(?=[，,])'))?.[1];
  const prices = priceMentions(note);
  const days = dateMentions(note);
  const scopes = scopeMentions(note);
  return normalizeFacts({
    name, price: prices.length === 1 ? prices[0] : null,
    day: days.length === 1 ? days[0] : '', scope: scopes.length === 1 ? scopes[0] : '',
  });
}

export function ruleChange(command, facts) {
  const clauses = command.normalize('NFKC').trim().replace(/[。！!]+$/, '').split(/\s*[，,、；;]\s*/);
  const values = {};
  for (const clause of clauses) {
    const price = clause.match(new RegExp('^(?:把)?(?:售价|价格)?\\s*(?:改成|改为|调至|调到|改到)\\s*(?:[¥￥]\\s*' + amount + '\\s*(?:元)?|' + amount + '\\s*元)$'));
    const day = clause.match(new RegExp('^(?:日期|上新时间)?\\s*(?:改成|改为|改到|延到|推迟到)?\\s*(' + dayPattern + ')(?:\\s*(?:再上|上新|上市|再上架|上架))?$'));
    const name = bounded(clause.match(/^(?:把)?(?:商品名|品名)\s*(?:改成|改为|换成)\s*(.+)$/)?.[1], 36);
    const scope = /^(?:销售范围\s*(?:改成|改为)\s*)?(仅限堂食|关闭外卖|不做外卖|开放外卖|开通外卖|堂食和外卖)$/.test(clause)
      ? scopeMentions(clause)[0] : '';
    if (name && values.name === undefined && !/[？?]/.test(name)) values.name = name;
    else if (scope && values.scope === undefined) values.scope = scope;
    else if (price && values.price === undefined && validPrice(cents(price[1] ?? price[2]))) values.price = cents(price[1] ?? price[2]);
    else if (day && values.day === undefined) values.day = day[1];
    else return null;
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== facts[key]));
}

export function modelChange(value, command, facts) {
  if (!value || /不要|不改|不变|不确定|待定|如果|假如|要不要|能不能|是否|[？?]/.test(command)) return {};
  const patch = {};
  const name = bounded(value.name, 36);
  if (name && command.includes(name) && /商品名|品名|改名/.test(command) && name !== facts.name) patch.name = name;
  const scopes = scopeMentions(command);
  if (scopes.length === 1 && scopes[0] === value.scope && value.scope !== facts.scope) patch.scope = value.scope;
  const suggestedDay = bounded(value.day, 32);
  const dates = dateMentions(command);
  if (suggestedDay && command.includes(suggestedDay) && dates.length <= 1) {
    const day = dates[0]?.includes(suggestedDay) ? dates[0] : suggestedDay;
    if (canonicalDay(day) !== canonicalDay(facts.day)) patch.day = day;
  }
  const amounts = priceMentions(command);
  const delta = typeof value.deltaYuan === 'number' ? cents(value.deltaYuan) : 0;
  const absolute = typeof value.priceYuan === 'number' ? cents(value.priceYuan) : 0;
  const down = /便宜|降|下调|减价|少卖/.test(command);
  const up = /涨|上调|贵|加价|提价/.test(command);
  let price;
  if (amounts.length === 1 && delta && amounts[0] === Math.abs(delta) && down !== up) {
    if ((down && delta < 0) || (up && delta > 0)) price = facts.price + delta;
  } else if (amounts.length === 1 && !delta && !down && !up && amounts[0] === absolute) {
    price = absolute;
  }
  if (validPrice(price) && price !== facts.price) patch.price = price;
  return patch;
}

export const normalizeBrand = (value = {}) => ({
  brand: bounded(value.brand, 24),
  selling: bounded(value.selling, 48),
  offer: bounded(value.offer, 48),
});

const copyClaims = /[¥￥%％\d]|[一二两三四五六七八九十百千]+\s*(?:元|块|折)|元[起整]|售价|仅售|折扣|优惠|免费|买.+送|半价|满.+减|领券|赠送|无糖|零糖|低卡|养生|功效|仅限|外卖|堂食|限量|活动|上新日|明日|后日|周末|工作日|本周|下周|本月|下月|今晚|今早|数量有限|售完|抢购|特价|秒杀/;
const ingredients = /烘焙豆|咖啡豆|牛奶|燕麦|豆乳|椰乳|奶油|奶酪|巧克力|可可|焦糖|榛果|香草|肉桂|桂花|茉莉|抹茶|红茶|绿茶|乌龙|蜂蜜|草莓|蓝莓|柠檬|西柚|果汁|糖浆/g;

export function validatedCopy(value, facts, branding) {
  const seen = new Set();
  const confirmed = [facts.name, normalizeBrand(branding).selling].join(' ').normalize('NFKC');
  const invalid = text => {
    const normalized = text.normalize('NFKC');
    return copyClaims.test(normalized) || dateMentions(normalized).length || text.includes(facts.name) ||
      (facts.scope !== 'all' && /送到家|送上门|配送|无需出门/.test(normalized)) ||
      (normalized.match(ingredients) ?? []).some(ingredient => !confirmed.includes(ingredient));
  };
  return Object.fromEntries(channels(facts).flatMap(({ id }) => {
    const entry = value?.[id];
    const legacy = typeof entry === 'string';
    const body = bounded(legacy ? entry : entry?.body, 120);
    const title = bounded(entry?.title, 36);
    const fingerprint = body.replace(/[\p{P}\s]/gu, '');
    const testimonial = id === 'social' && /(?:最近|今天|刚刚)?发现了?一家|(?:我|我们)(?:去过|打卡过|上次去|亲测)/.test(body);
    if (fingerprint.length < 8 || seen.has(fingerprint) || invalid(body) || testimonial ||
        (!legacy && (title.length < 2 || invalid(title)))) return [];
    seen.add(fingerprint);
    return [[id, legacy ? body : { title, body }]];
  }));
}

export function channelLead(draft, channel) {
  const result = draft.generated?.[channel.baseId ?? channel.id];
  return (typeof result === 'string' ? result : result?.body) ?? channel.leads[draft.choices?.[channel.baseId ?? channel.id]] ?? channel.leads[0];
}

export function artworkTitle(draft, channel) {
  return draft.edits[channel.id]?.title || draft.generated?.[channel.baseId ?? channel.id]?.title || draft.facts.name;
}

export function channelCopy(draft, channel) {
  const title = artworkTitle(draft, channel);
  const brand = normalizeBrand(draft.branding);
  return [factLine(draft.facts), brand.brand, brand.selling, brand.offer, title !== draft.facts.name ? title : '',
    draft.edits[channel.id]?.text ?? channelLead(draft, channel)].filter(Boolean).join('\n\n');
}

export function applyFacts(draft, values) {
  const facts = { ...draft.facts, ...values };
  const recordHistory = entry => ({ ...entry, history: [...entry.history, draft.facts] });
  const edits = Object.fromEntries(Object.entries(draft.edits).map(([id, edit]) => [
    id, { ...recordHistory(edit), pending: true },
  ]));
  const copyBuffers = Object.fromEntries(Object.entries(draft.copyBuffers ?? {}).map(([id, buffer]) => [id, recordHistory(buffer)]));
  const sameProduct = facts.name === draft.facts.name && facts.scope === draft.facts.scope;
  const generated = sameProduct ? draft.generated : {};
  return { ...draft, facts, generated, edits, copyBuffers, revision: draft.revision + 1 };
}

export function editCopy(draft, id, text, title = '') {
  return {
    ...draft, revision: draft.revision + 1,
    edits: { ...draft.edits, [id]: { text, title, history: [], pending: false } },
  };
}

export function staleEvidence(edit, text, current) {
  const stale = new Set();
  const amounts = priceMentions(text);
  const days = dateMentions(text).map(canonicalDay);
  const currentDay = canonicalDay(current.day);
  for (const previous of edit.history) {
    if (previous.price !== current.price && amounts.includes(previous.price)) stale.add(money(previous.price));
    if (previous.name && previous.name !== current.name && text.replaceAll(current.name, '').includes(previous.name)) stale.add(previous.name);
    if (previous.scope !== current.scope && scopeMentions(text).includes(previous.scope)) stale.add(scopeLabel(previous.scope));
    const previousDay = canonicalDay(previous.day);
    if (previousDay === currentDay) continue;
    const found = new RegExp('^' + dayPattern + '$').test(previous.day)
      ? days.includes(previousDay) : text.replaceAll(current.day, '').includes(previous.day);
    if (found) stale.add(previous.day);
  }
  if (current.scope && scopeMentions(text).some(scope => scope !== current.scope)) {
    stale.add(scopeLabel(current.scope === 'all' ? 'store' : 'all'));
  }
  return [...stale];
}
