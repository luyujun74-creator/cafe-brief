import { channelCopy, money, scopeLabel } from './workflow.mjs';
import { makeZip } from './zip.mjs';

const getBlob = (canvas, quality) => new Promise((resolve, reject) => {
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
  menu: ['#f2eadd', '#2b433c'],
  poster: ['#f1e6d6', '#814538'],
  banner: ['#e5ecdf', '#2c493c'],
  social: ['#e8ede4', '#3a5148'],
  delivery: ['#edf1ec', '#344a40'],
};
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function photoBox(ctx, picture, x, y, w, h) {
  ctx.fillStyle = '#e4ddd1';
  ctx.fillRect(x, y, w, h);
  const scale = Math.min(w / picture.naturalWidth, h / picture.naturalHeight);
  const width = picture.naturalWidth * scale;
  const height = picture.naturalHeight * scale;
  ctx.drawImage(picture, x + (w - width) / 2, y + (h - height) / 2, width, height);
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

export function art(channel, facts, picture, preview = false) {
  const canvas = document.createElement('canvas');
  const { width: w, height: h } = channel;
  const scale = preview ? Math.min(440 / w, 430 / h) : 1;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.scale(canvas.width / w, canvas.height / h);
  const [paper, accent] = artThemes[channel.id];
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const p = Math.round(Math.min(w, h) * .063);
  const side = w / h > 1.15;
  const photoWidth = side ? Math.round(w * .49) : w - p * 2;
  const photoHeight = side ? h - p * 2 : Math.round(h * (channel.id === 'poster' ? .56 : .48));
  photoBox(ctx, picture, side ? w - p - photoWidth : p, p, photoWidth, photoHeight);

  const max = side ? w - photoWidth - p * 3 : w - p * 2;
  const unit = Math.min(w, h);
  const captionSize = Math.round(unit * .029);
  const priceSize = Math.round(unit * .066);
  const detailSize = Math.round(unit * .034);
  const contentStart = side ? p : 2 * p + photoHeight;
  const available = h - p - contentStart;
  const fixedHeight = unit * .050 + priceSize * 1.45 + detailSize * 2.7;
  let size = Math.floor(unit * .083);
  let lines;
  while (true) {
    ctx.font = `750 ${size}px ${font}`;
    lines = nameLines(ctx, facts.name, max);
    if (fixedHeight + size * (lines.length * 1.17 + .26) <= available || size <= 18) break;
    size -= 2;
  }
  const blockHeight = fixedHeight + size * (lines.length * 1.17 + .26);
  let y = contentStart + Math.max(0, (available - blockHeight) * .42);
  ctx.textBaseline = 'top';
  ctx.fillStyle = accent;
  ctx.font = `650 ${captionSize}px ${font}`;
  ctx.fillText(channel.id === 'delivery' ? '外 卖 上 新' : '本 期 上 新', p, y, max);
  ctx.fillRect(p, y - unit * .018, unit * .09, Math.max(2, unit * .005));
  y += unit * .050;
  ctx.font = `750 ${size}px ${font}`;
  for (const line of lines) {
    ctx.fillText(line, p, y, max);
    y += size * 1.17;
  }
  y += size * .26;
  ctx.font = `700 ${priceSize}px ${font}`;
  ctx.fillText(money(facts.price), p, y, max);
  y += priceSize * 1.45;
  ctx.font = `550 ${detailSize}px ${font}`;
  ctx.fillText(facts.day, p, y, max);
  ctx.fillText(scopeLabel(facts.scope), p, y + detailSize * 1.45, max);
  return canvas;
}

export async function packageAssets(draft, selected, photo) {
  const encode = value => new TextEncoder().encode(value);
  const files = [];
  for (const c of selected) {
    const jpeg = await getBlob(art(c, draft.facts, photo), .91);
    files.push(
      { name: `${c.title}/成品.jpg`, data: new Uint8Array(await jpeg.arrayBuffer()) },
      { name: `${c.title}/渠道文案.txt`, data: encode(channelCopy(draft, c) + '\r\n') },
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
  files.push({ name: '物料清单.txt', data: encode(manifest.join('\r\n') + '\r\n') });
  return makeZip(files);
}
