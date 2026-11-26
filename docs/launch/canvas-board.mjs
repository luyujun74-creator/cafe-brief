import { arrangementBounds, fitCamera, placeCard, zoomCamera } from './canvas-geometry.mjs?v=202611261';

const placements = {
  source: { x: 394, y: 456, width: 271, height: 235 },
  menu: { x: 0, y: 100, width: 336, height: 280 },
  poster: { x: 365, y: 0, width: 273, height: 424 },
  banner: { x: 670, y: 22, width: 432, height: 221 },
  social: { x: 715, y: 272, width: 297, height: 342 },
  delivery: { x: 18, y: 413, width: 312, height: 267 },
};

const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function mountCanvas({ viewport, world, controls, onMove, onCamera }) {
  let camera = { x: 0, y: 0, scale: 1 };
  let fitted = true;
  let minimum = .2;
  let gesture;
  let lastDrag = -Infinity;
  let revealAnimations = [];
  let cards = [];
  const position = (item, point) => {
    item.tile.style.setProperty('--x', point.x + 'px');
    item.tile.style.setProperty('--y', point.y + 'px');
    item.x = point.x;
    item.y = point.y;
  };

  function paint() {
    const { x, y, scale } = camera;
    world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    viewport.style.setProperty('--grid', Math.max(12, 28 * scale) + 'px');
    viewport.style.setProperty('--grid-x', x + 'px');
    viewport.style.setProperty('--grid-y', y + 'px');
    controls.percent.textContent = Math.round(scale * 100) + '%';
    controls.out.disabled = scale <= minimum + .001;
    controls.zoomIn.disabled = scale >= 2.4;
  }

  function fit() {
    const rect = viewport.getBoundingClientRect();
    if (!cards.length || rect.width < 80 || rect.height < 80) return;
    camera = fitCamera(rect, arrangementBounds(cards), rect.width < 600 ? 16 : 28);
    minimum = Math.min(.35, camera.scale);
    fitted = true;
    paint();
  }

  function zoom(multiplier, anchor) {
    const rect = viewport.getBoundingClientRect();
    const scale = Math.min(2.4, Math.max(minimum, camera.scale * multiplier));
    camera = zoomCamera(camera, scale, anchor ?? { x: rect.width / 2, y: rect.height / 2 });
    fitted = false;
    paint();
    onCamera(camera);
  }

  function stopReveal() {
    for (const animation of revealAnimations) animation.cancel();
    revealAnimations = [];
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return;
    stopReveal();
    lastDrag = -Infinity;
    const tile = event.target.closest('.tile');
    const item = tile && cards.find(card => card.tile === tile);
    gesture = {
      id: event.pointerId, start: { x: event.clientX, y: event.clientY }, item,
      origin: item ? { x: item.x, y: item.y } : { x: camera.x, y: camera.y },
      moved: false,
    };
  });

  viewport.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const movement = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    if (!gesture.moved) {
      if (Math.hypot(movement.x, movement.y) < 5) return;
      gesture.moved = true;
      viewport.setPointerCapture(event.pointerId);
      viewport.dataset.dragging = gesture.item ? 'card' : 'pan';
    }
    fitted = false;
    if (gesture.item) {
      position(gesture.item, placeCard(gesture.origin, movement, camera.scale));
    } else {
      camera = { ...camera, x: gesture.origin.x + movement.x, y: gesture.origin.y + movement.y };
      paint();
    }
  });

  const endGesture = event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const { item, moved } = gesture;
    if (moved) {
      lastDrag = performance.now();
      if (item) onMove(item.id, { x: item.x, y: item.y });
      else onCamera(camera);
    }
    gesture = undefined;
    delete viewport.dataset.dragging;
  };
  for (const type of ['pointerup', 'pointercancel']) viewport.addEventListener(type, endGesture);
  viewport.addEventListener('lostpointercapture', event => {
    if (event.target === viewport) endGesture(event);
  });
  viewport.addEventListener('pointerleave', event => {
    if (gesture && !gesture.moved) endGesture(event);
  });
  viewport.addEventListener('click', event => {
    if (event.detail && performance.now() - lastDrag < 350) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  viewport.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    stopReveal();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * .003), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });

  viewport.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = directions[event.key];
    const tile = event.target.closest('.tile');
    const item = tile && cards.find(card => card.tile === tile);
    if (event.target !== viewport && !item) return;
    stopReveal();
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? 60 : 20;
      fitted = false;
      if (item) {
        position(item, placeCard(item, { x: direction[0] * step, y: direction[1] * step }, 1));
        onMove(item.id, { x: item.x, y: item.y });
      } else {
        camera = { ...camera, x: camera.x - direction[0] * step, y: camera.y - direction[1] * step };
        paint();
        onCamera(camera);
      }
    } else if (event.target === viewport && ['+', '-', '0', '='].includes(event.key)) {
      event.preventDefault();
      if (event.key === '0') fit();
      else zoom(event.key === '-' ? .8 : 1.25);
    }
  });

  viewport.addEventListener('focusin', event => {
    if (!event.target.closest('.tile') || !event.target.matches(':focus-visible')) return;
    const view = viewport.getBoundingClientRect();
    const target = event.target.getBoundingClientRect();
    const x = target.left + target.width / 2;
    const y = target.top + target.height / 2;
    const dx = Math.max(view.left + 18, Math.min(view.right - 18, x)) - x;
    const dy = Math.max(view.top + 18, Math.min(view.bottom - 18, y)) - y;
    if (!dx && !dy) return;
    fitted = false;
    camera = { ...camera, x: camera.x + dx, y: camera.y + dy };
    paint();
  });

  controls.zoomIn.addEventListener('click', () => zoom(1.25));
  controls.out.addEventListener('click', () => zoom(.8));
  controls.fit.addEventListener('click', () => { fit(); onCamera(null); });
  new ResizeObserver(() => { if (fitted) fit(); }).observe(viewport);

  return {
    render(tiles, positions) {
      stopReveal();
      cards = tiles.map(tile => {
        const id = tile.dataset.channel;
        const placement = placements[tile.dataset.base ?? id];
        const item = { ...placement, id, tile };
        position(item, positions?.[id] ?? placement);
        tile.style.setProperty('--w', item.width + 'px');
        tile.style.setProperty('--h', item.height + 'px');
        return item;
      });
      world.replaceChildren(...tiles);
      if (fitted) fit();
      else paint();
    },
    reveal() {
      if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return;
      const origin = cards.find(card => card.id === 'source');
      revealAnimations = cards.filter(card => card !== origin).map((card, index) => card.tile.animate([
        { opacity: 0, translate: `${(origin.x - card.x) * .34}px ${(origin.y - card.y) * .34}px` },
        { opacity: 1, translate: '0 0' },
      ], { duration: 420, delay: 65 + index * 70, fill: 'backwards', easing: 'cubic-bezier(.22, 1, .36, 1)' }));
    },
    fit,
    fitIfAutomatic() { if (fitted) fit(); },
    positionOf(id) { return cards.find(card => card.id === id); },
    restore(value) {
      if (!value) {
        camera = { x: 0, y: 0, scale: 1 };
        fitted = true;
      } else if ([value.x, value.y, value.scale].every(Number.isFinite) && value.scale > 0) {
        camera = value;
        fitted = false;
      }
    },
  };
}
