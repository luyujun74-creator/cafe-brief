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
  /仅限堂食|仅堂食|只做堂食|不做外卖|堂食限定/.test(text) ? 'store' : '',
  /堂食(?:和|及|与|、)外卖|堂食外卖(?:都可|均可)|外卖也上/.test(text) ? 'all' : '',
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
    if (price && values.price === undefined && validPrice(cents(price[1] ?? price[2]))) values.price = cents(price[1] ?? price[2]);
    else if (day && values.day === undefined) values.day = day[1];
    else return null;
  }
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => value !== facts[key]));
}

export function modelChange(value, command, facts) {
  if (!value || /不要|不改|不变|不确定|待定|如果|假如|要不要|能不能|是否|[？?]/.test(command)) return {};
  const patch = {};
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

export function channelCopy(draft, channel) {
  const lead = channel.leads[draft.choices[channel.id]] ?? channel.leads[0];
  return `${factLine(draft.facts)}\n\n${draft.edits[channel.id]?.text ?? lead}`;
}

export function applyFacts(draft, values) {
  const facts = { ...draft.facts, ...values };
  const edits = Object.fromEntries(Object.entries(draft.edits).map(([id, edit]) => [
    id, { ...edit, pending: true, history: [...edit.history, draft.facts] },
  ]));
  return { ...draft, facts, edits, revision: draft.revision + 1 };
}

export function editCopy(draft, id, text) {
  return {
    ...draft, revision: draft.revision + 1,
    edits: { ...draft.edits, [id]: { text, history: [], pending: false } },
  };
}

export function staleEvidence(edit, text, current) {
  const stale = new Set();
  const amounts = priceMentions(text);
  const days = dateMentions(text).map(canonicalDay);
  const currentDay = canonicalDay(current.day);
  for (const previous of edit.history) {
    if (previous.price !== current.price && amounts.includes(previous.price)) stale.add(money(previous.price));
    const previousDay = canonicalDay(previous.day);
    if (previousDay === currentDay) continue;
    const found = new RegExp('^' + dayPattern + '$').test(previous.day)
      ? days.includes(previousDay) : text.replaceAll(current.day, '').includes(previous.day);
    if (found) stale.add(previous.day);
  }
  return [...stale];
}
