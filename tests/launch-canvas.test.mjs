import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera, zoomCamera, arrangementBounds, placeCard } from '../docs/launch/canvas-geometry.mjs';

test('概览包含用户移动过的物料并居中', () => {
  const bounds = arrangementBounds([
    { x: -200, y: 25, width: 100, height: 160 },
    { x: 300, y: 125, width: 220, height: 140 },
  ]);
  assert.deepEqual(bounds, { x: -200, y: 25, width: 720, height: 240 });
  const { x, y, scale } = fitCamera({ width: 400, height: 300 }, bounds, 20);
  assert.equal(-200 * scale + x, 20);
  assert.equal(520 * scale + x, 380);
  assert.equal((25 + 120) * scale + y, 150);
});

test('缩放保持指针下的画布点，拖动距离与缩放等比换算', () => {
  const camera = zoomCamera({ x: 50, y: 30, scale: .5 }, 1, { x: 150, y: 110 });
  assert.deepEqual(camera, { x: -50, y: -50, scale: 1 });
  assert.deepEqual(placeCard({ x: 100, y: 200 }, { x: 15, y: -25 }, .5), { x: 130, y: 150 });
});
