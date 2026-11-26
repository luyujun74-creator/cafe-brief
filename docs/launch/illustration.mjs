// 没有商品照时的示意插画：纯本地绘制，不依赖网络，保证「直接使用文字示例」和示例照片超时时都能出首稿。
import { getBlob } from './media.mjs?v=202611265';

const palettes = {
  fresh: { wall: '#e6f2ec', table: '#cfe3d8', drink: ['#f4f7e8', '#b9d77a', '#7fae4a'], glass: '#ffffffb0' },
  warm: { wall: '#f4e6d6', table: '#e2c9ab', drink: ['#f6e7d4', '#c58b5a', '#7a4a2a'], glass: '#ffffffa0' },
  lively: { wall: '#fde8e4', table: '#f6cfc6', drink: ['#fff3ea', '#f59b7a', '#e2593f'], glass: '#ffffffb0' },
  premium: { wall: '#e6e8ee', table: '#c9ced9', drink: ['#efe8dc', '#a77d55', '#4e3424'], glass: '#ffffff90' },
};

export const illustrationTone = text => /热|暖|可可|冬/.test(text) ? 'warm'
  : /草莓|西柚|莓|桃|活泼/.test(text) ? 'lively' : /手冲|高级|质感/.test(text) ? 'premium' : 'fresh';

export function drawIllustration(tone = 'fresh', { hot = false } = {}) {
  const size = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { alpha: false });
  const p = palettes[tone] ?? palettes.fresh;
  const wall = ctx.createLinearGradient(0, 0, 0, size);
  wall.addColorStop(0, '#ffffff');
  wall.addColorStop(1, p.wall);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = p.table;
  ctx.fillRect(0, size * .74, size, size * .26);
  ctx.fillStyle = '#00000014';
  ctx.beginPath();
  ctx.ellipse(size / 2, size * .82, 250, 42, 0, 0, Math.PI * 2);
  ctx.fill();

  const top = size * .3;
  const bottom = size * .8;
  const left = size / 2 - 190;
  const right = size / 2 + 190;
  const inset = 42;
  const cup = new Path2D();
  cup.moveTo(left, top);
  cup.lineTo(right, top);
  cup.lineTo(right - inset, bottom);
  cup.quadraticCurveTo(size / 2, bottom + 26, left + inset, bottom);
  cup.closePath();
  ctx.save();
  ctx.clip(cup);
  const layers = [[top + 60, p.drink[0]], [top + 190, p.drink[1]], [top + 330, p.drink[2]]];
  for (const [y, color] of layers) {
    ctx.fillStyle = color;
    ctx.fillRect(0, y, size, bottom - y + 40);
  }
  if (!hot) {
    ctx.fillStyle = '#ffffff66';
    for (const [x, y, s, r] of [[-70, 150, 92, .2], [52, 120, 86, -.3], [-10, 230, 80, .5]]) {
      ctx.save();
      ctx.translate(size / 2 + x, top + y);
      ctx.rotate(r);
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
  }
  ctx.fillStyle = '#ffffff40';
  ctx.fillRect(left + 40, top, 34, bottom - top);
  ctx.restore();
  ctx.strokeStyle = p.glass;
  ctx.lineWidth = 10;
  ctx.stroke(cup);
  if (hot) {
    ctx.strokeStyle = '#ffffffcc';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    for (const x of [-60, 0, 60]) {
      ctx.beginPath();
      ctx.moveTo(size / 2 + x, top - 30);
      ctx.bezierCurveTo(size / 2 + x - 30, top - 90, size / 2 + x + 30, top - 130, size / 2 + x, top - 190);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = '#3d5a4c';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(size / 2 + 60, top + 120);
    ctx.lineTo(size / 2 + 150, top - 150);
    ctx.stroke();
  }
  return canvas;
}

export async function illustrationFile(text = '') {
  const tone = illustrationTone(text);
  const blob = await getBlob(drawIllustration(tone, { hot: /热|暖|冬/.test(text) && !/冰|冷/.test(text) }), .88);
  return new File([blob], '示意插画.jpg', { type: 'image/jpeg' });
}
