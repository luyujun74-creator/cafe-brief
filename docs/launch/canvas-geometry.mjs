export function arrangementBounds(cards) {
  const x = Math.min(...cards.map(card => card.x));
  const y = Math.min(...cards.map(card => card.y));
  return {
    x, y,
    width: Math.max(...cards.map(card => card.x + card.width)) - x,
    height: Math.max(...cards.map(card => card.y + card.height)) - y,
  };
}

export function fitCamera(view, bounds, inset) {
  const scale = Math.min(1.15, (view.width - 2 * inset) / bounds.width, (view.height - 2 * inset) / bounds.height);
  return {
    scale,
    x: (view.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (view.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export function zoomCamera(camera, scale, anchor) {
  const ratio = scale / camera.scale;
  return { scale, x: anchor.x - (anchor.x - camera.x) * ratio, y: anchor.y - (anchor.y - camera.y) * ratio };
}

export function placeCard(origin, movement, scale) {
  const clamp = value => Math.min(2600, Math.max(-1600, value));
  return {
    x: clamp(Math.round(origin.x + movement.x / scale)),
    y: clamp(Math.round(origin.y + movement.y / scale)),
  };
}
