import { artworkTitle, channelCopy, money, normalizeBrand, scopeLabel } from './workflow.mjs';
import { makeZip } from './zip.mjs';

export const getBlob = (canvas, quality) => new Promise((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('图片编码失败。')), 'image/jpeg', quality);
});

export async function shrinkPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15_000_000) {
    throw new Error('请选择 15 MB 以内的 JPG、PNG 或 WebP 照片。');
  }
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('照片打不开，请重新选择。'); });
  const scale = Math.min(1, 1500 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await getBlob(canvas, .86);
  if (blob.size > 1_200_000) return getBlob(canvas, .64);
  return blob;
}

export function base64Photo(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('照片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

let previewUrl;
export async function loadPhoto(blob, target) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  target.src = previewUrl;
  await target.decode();
}

const artThemes = {
  menu: { paper: '#faf1df', ink: '#342a20', accent: '#805534', tab: '菜单上新', ratio: .47 },
  poster: { paper: '#37291f', ink: '#fff0d7', accent: '#e5bc82', tab: '柜台菜单', ratio: .56 },
  banner: { paper: '#23372e', ink: '#f8efd7', accent: '#c9dba6', tab: '门店上新', ratio: .52 },
  social: { paper: '#f2e4d2', ink: '#382923', accent: '#8b5238', tab: '本店上新', ratio: .48 },
  delivery: { paper: '#e8eddf', ink: '#28382d', accent: '#4c654a', tab: '外卖上新', ratio: .50 },
};
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function photoBox(ctx, picture, x, y, w, h, unit, full) {
  const blur = unit * .029;
  ctx.save();
  ctx.fillStyle = '#514338';
  ctx.shadowColor = '#16110e65';
  ctx.shadowBlur = unit * .023;
  ctx.shadowOffsetY = unit * .012;
  ctx.fillRect(x, y, w, h);
  ctx.shadowColor = 'transparent';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const cover = Math.max((w + blur * 4) / picture.naturalWidth, (h + blur * 4) / picture.naturalHeight);
  ctx.filter = `blur(${blur * ctx.getTransform().a}px) saturate(.76) brightness(.63)`;
  ctx.drawImage(picture, x + (w - picture.naturalWidth * cover) / 2, y + (h - picture.naturalHeight * cover) / 2,
    picture.naturalWidth * cover, picture.naturalHeight * cover);
  ctx.filter = 'none';

  const scale = (full ? Math.max : Math.min)(w / picture.naturalWidth, h / picture.naturalHeight);
  const width = picture.naturalWidth * scale;
  const height = picture.naturalHeight * scale;
  ctx.shadowColor = '#18120d80';
  ctx.shadowBlur = unit * .018;
  ctx.drawImage(picture, x + (w - width) / 2, y + (h - height) / 2, width, height);
  ctx.restore();
}

function nameLines(ctx, value, width) {
  const lines = [];
  let line = '';
  for (const ch of value) {
    if (line && ctx.measureText(line + ch).width > width) {
      lines.push(line);
      line = '';
    }
    line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

const styles = {
  editorial: { paper: '#f5ead8', ink: '#3c281b', accent: '#884829', serif: true },
  vermilion: { paper: '#891f28', ink: '#fff2df', accent: '#ffd5a3' },
  forest: { paper: '#253e35', ink: '#fff0d7', accent: '#c8df9f' },
};

export function art(channel, facts, picture, { thumbnail = false, branding, title = facts.name, settings = {}, provisional = false } = {}) {
  const canvas = document.createElement('canvas');
  const { width: w, height: h } = channel;
  const scale = thumbnail ? Math.min(440 / w, 430 / h) : 1;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', [title, facts.name === title ? '' : facts.name, facts.price == null ? '' : money(facts.price), facts.day, facts.scope ? scopeLabel(facts.scope) : ''].filter(Boolean).join(' · '));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(canvas.width / w, canvas.height / h);
  const theme = { ...artThemes[channel.baseId ?? channel.id], ...styles[settings.style] };
  const headlineFont = theme.serif ? '"Songti SC", "Noto Serif CJK SC", Georgia, serif' : font;
  const { brand, selling, offer } = normalizeBrand(branding);
  const unit = Math.min(w, h);
  const p = Math.round(unit * .059);
  const side = w / h > 1.15;
  const photoWidth = side ? Math.round(w * theme.ratio) : w - p * 2;
  const photoHeight = side ? h - p * 2 : Math.round(h * theme.ratio);
  const wash = ctx.createLinearGradient(0, 0, w, h);
  wash.addColorStop(0, theme.paper);
  wash.addColorStop(1, theme.ink);
  ctx.fillStyle = theme.paper;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = .10;
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  photoBox(ctx, picture, side ? w - p - photoWidth : p, p, photoWidth, photoHeight, unit, settings.cover);
  if (settings.scene) {
    ctx.fillStyle = settings.scene === 'amber' ? '#be6b2528' : '#738eaa2a';
    ctx.fillRect(side ? w - p - photoWidth : p, p, photoWidth, photoHeight);
  }

  const max = side ? w - photoWidth - p * 3 : w - p * 2;
  const contentStart = side ? p : 2 * p + photoHeight;
  const available = h - p - contentStart;
  const captionSize = Math.round(unit * .028);
  const priceSize = Math.round(unit * .065);
  const detailSize = Math.round(unit * .032);
  const secondary = [facts.name !== title ? facts.name : '', selling, offer].filter(Boolean);
  const fixedHeight = unit * .062 + priceSize * 1.34 + detailSize * (2.6 + secondary.length * 1.24);
  let size = Math.floor(unit * .086);
  let lines;
  while (true) {
    ctx.font = `750 ${size}px ${headlineFont}`;
    lines = nameLines(ctx, title, max);
    if (fixedHeight + size * (lines.length * 1.10 + .40) <= available || size <= 18) break;
    size -= 2;
  }
  const blockHeight = fixedHeight + size * (lines.length * 1.10 + .40);
  let y = contentStart + Math.max(0, (available - blockHeight) * .53);
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.accent;
  ctx.font = `650 ${captionSize}px ${font}`;
  ctx.fillText(brand || (provisional ? '海报首稿' : theme.tab), p, y, max);
  ctx.fillRect(p, y - unit * .015, unit * .09, Math.max(2, unit * .004));
  y += unit * .062;
  ctx.fillStyle = theme.ink;
  ctx.font = `750 ${size}px ${headlineFont}`;
  for (const line of lines) {
    ctx.fillText(line, p, y, max);
    y += size * 1.10;
  }
  y += size * .40;
  ctx.font = `550 ${detailSize}px ${font}`;
  for (const line of secondary) {
    ctx.fillText(line, p, y, max);
    y += detailSize * 1.24;
  }
  if (provisional) return canvas;
  ctx.fillStyle = theme.accent;
  ctx.font = `700 ${priceSize}px ${font}`;
  ctx.fillText(money(facts.price), p, y, max);
  y += priceSize * 1.34;
  ctx.fillStyle = theme.ink;
  ctx.font = `550 ${detailSize}px ${font}`;
  ctx.fillText(facts.day, p, y, max);
  ctx.fillText(scopeLabel(facts.scope), p, y + detailSize * 1.32, max);
  return canvas;
}

export async function packageAssets(draft, selected, photo) {
  const encode = value => new TextEncoder().encode(value.trimEnd().replace(/\r\n?|\n/g, '\n') + '\n');
  const files = [];
  for (const c of selected) {
    const jpeg = await getBlob(art(c, draft.facts, photo, { branding: draft.branding, title: artworkTitle(draft, c), settings: draft.artSettings?.[c.id] }), .91);
    files.push(
      { name: `${c.title}/成品.jpg`, data: new Uint8Array(await jpeg.arrayBuffer()) },
      { name: `${c.title}/渠道文案.txt`, data: encode(channelCopy(draft, c)) },
    );
  }
  const { facts, revision, productId } = draft;
  const manifest = [
    'Café Brief · 新品上架物料', `商品：${facts.name}`, `售价：${money(facts.price)}`, `上新：${facts.day}`,
    `范围：${scopeLabel(facts.scope)}`, `版本：v${revision}`, `草稿编号：${productId}`, '',
    ...selected.map(c => `${c.title} · ${c.width} × ${c.height} 像素 · ${c.use}${draft.edits[c.id] ? ' · 商户已核对文案' : ''}`),
    ...(facts.scope === 'store' ? ['跳过外卖主图：仅限堂食。'] : []),
    '图片使用商户商品照本地排版。', '请按实际发布平台要求核对成品。',
  ];
  files.push({ name: '物料清单.txt', data: encode(manifest.join('\n')) });
  return makeZip(files);
}
