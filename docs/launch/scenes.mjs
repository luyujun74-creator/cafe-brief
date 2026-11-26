// 换背景：6 个本地场景全部用 Canvas 现画，不下载任何图片；以及把抠好的商品合成到背景上。
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const vertical = (ctx, y0, y1, stops) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach(([at, color]) => g.addColorStop(at, color));
  return g;
};
function blurred(ctx, px, draw) {
  ctx.save();
  ctx.filter = `blur(${Math.max(0, px)}px)`;
  draw();
  ctx.restore();
}
function edge(ctx, w, y, color, alpha = .55) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillRect(0, y - Math.max(1, w * .002), w, Math.max(2, w * .004));
  ctx.restore();
}

export const scenes = [
  {
    id: 'wood', label: '木吧台', floor: .64, tone: '#6b4a33',
    draw(ctx, w, h) {
      const r = seeded(11), floor = h * this.floor, u = Math.min(w, h);
      ctx.fillStyle = vertical(ctx, 0, floor, [[0, '#2f221b'], [1, '#5c4030']]);
      ctx.fillRect(0, 0, w, floor);
      blurred(ctx, u * .02, () => {
        for (let i = 0; i < 14; i++) {
          ctx.globalAlpha = .12 + r() * .25;
          ctx.fillStyle = r() > .4 ? '#ffc777' : '#ffe2b0';
          ctx.beginPath();
          ctx.arc(r() * w, r() * floor * .8, u * (.02 + r() * .05), 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = vertical(ctx, floor, h, [[0, '#9a6840'], [.35, '#7d5233'], [1, '#4d3220']]);
      ctx.fillRect(0, floor, w, h - floor);
      ctx.lineWidth = Math.max(1, u * .0025);
      for (let i = 0; i < 28; i++) {
        const y = floor + (h - floor) * r();
        ctx.strokeStyle = `rgba(${r() > .5 ? '40,24,12' : '214,160,110'},${.07 + r() * .1})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * .3, y + (r() - .5) * u * .03, w * .7, y + (r() - .5) * u * .03, w, y + (r() - .5) * u * .02);
        ctx.stroke();
      }
      edge(ctx, w, floor, '#e1a86e');
    },
  },
  {
    id: 'window', label: '窗边晨光', floor: .68, tone: '#e6d6c2',
    draw(ctx, w, h) {
      const floor = h * this.floor, u = Math.min(w, h);
      ctx.fillStyle = vertical(ctx, 0, floor, [[0, '#f3ebe0'], [1, '#e2d3bf']]);
      ctx.fillRect(0, 0, w, floor);
      blurred(ctx, u * .025, () => {
        ctx.fillStyle = 'rgba(255, 250, 236, .75)';
        for (const [x, width] of [[.08, .2], [.33, .2]]) {
          ctx.beginPath();
          ctx.moveTo(w * x, 0);
          ctx.lineTo(w * (x + width), 0);
          ctx.lineTo(w * (x + width + .32), floor);
          ctx.lineTo(w * (x + .32), floor);
          ctx.fill();
        }
      });
      ctx.fillStyle = vertical(ctx, floor, h, [[0, '#dcc3a1'], [1, '#b8946c']]);
      ctx.fillRect(0, floor, w, h - floor);
      blurred(ctx, u * .03, () => {
        ctx.fillStyle = 'rgba(255, 246, 225, .55)';
        ctx.beginPath();
        ctx.ellipse(w * .62, floor + (h - floor) * .45, w * .34, (h - floor) * .32, -.12, 0, Math.PI * 2);
        ctx.fill();
      });
      edge(ctx, w, floor, '#fff3dc', .7);
    },
  },
  {
    id: 'marble', label: '大理石台面', floor: .62, tone: '#d9dcdf',
    draw(ctx, w, h) {
      const r = seeded(23), floor = h * this.floor, u = Math.min(w, h);
      ctx.fillStyle = vertical(ctx, 0, floor, [[0, '#d5d9dd'], [1, '#c4c9ce']]);
      ctx.fillRect(0, 0, w, floor);
      ctx.fillStyle = vertical(ctx, floor, h, [[0, '#f5f4f2'], [1, '#e1dfdb']]);
      ctx.fillRect(0, floor, w, h - floor);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, floor, w, h - floor);
      ctx.clip();
      for (let i = 0; i < 9; i++) {
        ctx.strokeStyle = `rgba(120, 126, 134, ${.12 + r() * .22})`;
        ctx.lineWidth = Math.max(1, u * (.0015 + r() * .004));
        const y = floor + (h - floor) * r();
        ctx.beginPath();
        ctx.moveTo(-w * .1, y);
        ctx.bezierCurveTo(w * r(), y + (r() - .5) * u * .3, w * r(), y + (r() - .5) * u * .3, w * 1.1, y + (r() - .5) * u * .2);
        ctx.stroke();
      }
      ctx.restore();
      edge(ctx, w, floor, '#ffffff', .8);
    },
  },
  {
    id: 'plants', label: '绿植角落', floor: .7, tone: '#b9c6ad',
    draw(ctx, w, h) {
      const r = seeded(37), floor = h * this.floor, u = Math.min(w, h);
      ctx.fillStyle = vertical(ctx, 0, floor, [[0, '#d3dccb'], [1, '#b4c2a8']]);
      ctx.fillRect(0, 0, w, floor);
      const leaf = (x, y, size, angle, color) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(0, 0, size * .28, size, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      blurred(ctx, u * .012, () => {
        for (const [cx, dir] of [[w * .06, 1], [w * .95, -1]]) {
          for (let i = 0; i < 16; i++) {
            const size = u * (.06 + r() * .08);
            leaf(cx + dir * r() * w * .2, floor * (.15 + r() * .8), size, dir * (.3 + r() * 1.1) - .4,
              ['#4c6a43', '#5f7f52', '#3d5737', '#78985f'][Math.floor(r() * 4)]);
          }
        }
      });
      ctx.fillStyle = vertical(ctx, floor, h, [[0, '#8a6847'], [1, '#5a412c']]);
      ctx.fillRect(0, floor, w, h - floor);
      edge(ctx, w, floor, '#c9a27a');
    },
  },
  {
    id: 'terrace', label: '街角露台', floor: .68, tone: '#d9a877',
    draw(ctx, w, h) {
      const r = seeded(51), floor = h * this.floor, u = Math.min(w, h);
      ctx.fillStyle = vertical(ctx, 0, floor, [[0, '#f6dcb6'], [1, '#d6a173']]);
      ctx.fillRect(0, 0, w, floor);
      blurred(ctx, u * .03, () => {
        for (let i = 0; i < 7; i++) {
          ctx.fillStyle = ['#b07f5b', '#8f6a53', '#c99a73', '#7b5f4f'][i % 4];
          const bw = w * (.12 + r() * .16);
          const bh = floor * (.35 + r() * .55);
          ctx.fillRect(r() * w - bw / 2, floor - bh, bw, bh);
        }
      });
      blurred(ctx, u * .006, () => {
        ctx.fillStyle = '#fff1c9';
        for (let i = 0; i < 18; i++) {
          const x = (i + .5) / 18 * w;
          const y = floor * (.16 + Math.sin(i / 17 * Math.PI) * .1);
          ctx.globalAlpha = .7;
          ctx.beginPath();
          ctx.arc(x, y, u * .009, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = vertical(ctx, floor, h, [[0, '#ece6dc'], [1, '#c9c0b2']]);
      ctx.fillRect(0, floor, w, h - floor);
      ctx.strokeStyle = 'rgba(120, 104, 88, .18)';
      ctx.lineWidth = Math.max(1, u * .002);
      for (let i = 1; i < 4; i++) {
        const y = floor + (h - floor) * (i / 4) ** 1.3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      edge(ctx, w, floor, '#ffffff', .6);
    },
  },
  {
    id: 'studio', label: '纯色影棚', floor: .74, tone: '#eadccb',
    draw(ctx, w, h) {
      const g = ctx.createRadialGradient(w * .5, h * .42, 0, w * .5, h * .5, Math.hypot(w, h) * .62);
      g.addColorStop(0, '#f8f1e7');
      g.addColorStop(1, '#dccab4');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = vertical(ctx, h * .62, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(120, 92, 64, .16)']]);
      ctx.fillRect(0, h * .62, w, h * .38);
    },
  },
];
export const sceneById = id => scenes.find(scene => scene.id === id);
export const sceneLabel = bg => bg?.kind === 'preset' ? sceneById(bg.id)?.label ?? '本地场景' : bg?.kind === 'ai' ? '豆包 AI 场景' : bg?.kind === 'upload' ? '自选背景图' : '';

// 商品默认站在台面上：底边落在台面略靠前的位置。
export function defaultPlacement(bg) {
  const floor = bg?.kind === 'preset' ? sceneById(bg.id)?.floor ?? .7 : .7;
  return { x: .5, y: Math.min(.95, floor + (1 - floor) * .55), scale: .62 };
}

function cover(ctx, image, w, h) {
  const iw = image.naturalWidth ?? image.width;
  const ih = image.naturalHeight ?? image.height;
  const s = Math.max(w / iw, h / ih);
  ctx.drawImage(image, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
}

export function drawBackground(ctx, w, h, bg, image) {
  if (bg?.kind === 'preset') sceneById(bg.id)?.draw(ctx, w, h);
  else if (image) cover(ctx, image, w, h);
  else {
    ctx.fillStyle = '#eadccb';
    ctx.fillRect(0, 0, w, h);
  }
}

export function productRect(w, h, product, { x, y, scale }) {
  const pw0 = product.width;
  const ph0 = product.height;
  let ph = h * scale;
  let pw = ph * pw0 / ph0;
  if (pw > w * .94) {
    pw = w * .94;
    ph = pw * ph0 / pw0;
  }
  return { left: x * w - pw / 2, top: y * h - ph, width: pw, height: ph };
}

// 合成：背景 → 接触阴影 → 调过亮度/色温的商品。所有比例相对画面宽高，任何尺寸都能重画。
export function composeScene(ctx, w, h, state, assets) {
  drawBackground(ctx, w, h, state.bg, assets.background);
  if (!state.overlay || !assets.product) return;
  const rect = productRect(w, h, assets.product, state);
  if (state.shadow !== false) {
    const cx = rect.left + rect.width / 2;
    const base = rect.top + rect.height;
    ctx.save();
    const soft = ctx.createRadialGradient(cx, base, 0, cx, base, rect.width * .62);
    soft.addColorStop(0, 'rgba(20, 12, 6, .38)');
    soft.addColorStop(1, 'rgba(20, 12, 6, 0)');
    ctx.fillStyle = soft;
    ctx.translate(cx, base);
    ctx.scale(1, .16);
    ctx.translate(-cx, -base);
    ctx.beginPath();
    ctx.arc(cx, base, rect.width * .62, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.filter = `blur(${Math.max(1, rect.height * .012)}px)`;
    ctx.fillStyle = 'rgba(20, 12, 6, .42)';
    ctx.beginPath();
    ctx.ellipse(cx, base - rect.height * .004, rect.width * .4, Math.max(2, rect.height * .022), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const layer = document.createElement('canvas');
  layer.width = Math.max(1, Math.round(rect.width));
  layer.height = Math.max(1, Math.round(rect.height));
  const lc = layer.getContext('2d');
  const brightness = 1 + (state.brightness ?? 0) / 100;
  lc.filter = `brightness(${brightness.toFixed(2)})`;
  lc.drawImage(assets.product, 0, 0, layer.width, layer.height);
  lc.filter = 'none';
  const warmth = state.warmth ?? 0;
  if (warmth) {
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = warmth > 0 ? `rgba(255, 150, 50, ${Math.abs(warmth) / 260})` : `rgba(70, 140, 255, ${Math.abs(warmth) / 260})`;
    lc.fillRect(0, 0, layer.width, layer.height);
  }
  ctx.drawImage(layer, rect.left, rect.top, rect.width, rect.height);
}

// 供版式绘制使用的「场景图」：按每个渠道照片框的宽高比现场合成，竖版、横版都不会裁掉商品。
export function scenePicture(state, assets) {
  const cache = new Map();
  return {
    isScene: true,
    naturalWidth: 1200,
    naturalHeight: 1200,
    render(w, h) {
      const cw = Math.max(16, Math.min(1800, Math.round(w)));
      const ch = Math.max(16, Math.min(1800, Math.round(h)));
      const key = cw + 'x' + ch;
      if (!cache.has(key)) {
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        composeScene(canvas.getContext('2d'), cw, ch, state, assets);
        if (cache.size > 24) cache.clear();
        cache.set(key, canvas);
      }
      return cache.get(key);
    },
  };
}
