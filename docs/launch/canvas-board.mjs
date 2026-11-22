import { arrangementBounds, fitCamera, placeCard, zoomCamera } from './canvas-geometry.mjs';

const placements = {
  menu: { x: 0, y: 100, width: 336, height: 280 },
  poster: { x: 365, y: 0, width: 273, height: 424 },
  banner: { x: 670, y: 22, width: 432, height: 221 },
  social: { x: 715, y: 272, width: 297, height: 342 },
  delivery: { x: 18, y: 413, width: 312, height: 267 },
};

const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function mountCanvas({ viewport, world, controls, onMove }) {
  let camera = { x: 0, y: 0, scale: 1 };
  let fitted = true;
  let minimum = .2;
  let activeItem;
  let gesture;
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
  }

  function raise(item) {
    if (activeItem) activeItem.tile.dataset.raised = 'false';
    activeItem = item;
    item.tile.dataset.raised = 'true';
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return;
    const handle = event.target.closest('[data-move]');
    const item = handle && cards.find(card => card.id === handle.dataset.move);
    if (!item && event.target.closest('button')) return;
    if (item) raise(item);
    gesture = {
      id: event.pointerId, start: { x: event.clientX, y: event.clientY }, item,
      origin: item ? { x: item.x, y: item.y } : { x: camera.x, y: camera.y },
      moved: false,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.dataset.dragging = item ? 'card' : 'pan';
  });

  viewport.addEventListener('pointermove', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const movement = { x: event.clientX - gesture.start.x, y: event.clientY - gesture.start.y };
    if (!gesture.moved && Math.hypot(movement.x, movement.y) < 3) return;
    gesture.moved = true;
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
    if (item && moved) onMove(item.id, { x: item.x, y: item.y });
    gesture = undefined;
    delete viewport.dataset.dragging;
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) viewport.addEventListener(type, endGesture);

  viewport.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
    zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * .003), { x: event.clientX - rect.left, y: event.clientY - rect.top });
  }, { passive: false });

  viewport.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = directions[event.key];
    const handle = event.target.closest('[data-move]');
    const item = handle && cards.find(card => card.id === handle.dataset.move);
    if (event.target !== viewport && !item) return;
    if (direction) {
      event.preventDefault();
      const step = event.shiftKey ? 60 : 20;
      fitted = false;
      if (item) {
        raise(item);
        position(item, placeCard(item, { x: direction[0] * step, y: direction[1] * step }, 1));
        onMove(item.id, { x: item.x, y: item.y });
      } else {
        camera = { ...camera, x: camera.x - direction[0] * step, y: camera.y - direction[1] * step };
        paint();
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
  controls.fit.addEventListener('click', fit);
  new ResizeObserver(() => { if (fitted) fit(); }).observe(viewport);

  return {
    render(tiles, positions) {
      activeItem = undefined;
      cards = tiles.map(tile => {
        const id = tile.dataset.channel;
        const placement = placements[id];
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
    fit,
  };
}
