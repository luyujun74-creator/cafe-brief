import { channels } from './workflow.mjs?v=202611264';

export function works(draft) {
  const base = channels(draft.facts);
  return [...base, ...(draft.variants ?? []).flatMap(item => {
    const parent = base.find(channel => channel.id === item.baseId);
    return parent ? [{ ...parent, ...item, title: parent.title + ' · 副本 ' + item.number }] : [];
  })].filter(item => !draft.removedWorks?.includes(item.id));
}

export function duplicateWork(draft, originalId, point = draft.positions?.[originalId]) {
  const original = works(draft).find(item => item.id === originalId);
  const number = (draft.nextVariant ?? 0) + 1;
  const id = 'copy-' + number;
  const variant = { id, baseId: original.baseId ?? original.id, number };
  const cloneEntry = entry => entry && structuredClone(entry);
  return [{
    ...draft, revision: draft.revision + 1, nextVariant: number,
    variants: [...(draft.variants ?? []), variant],
    edits: draft.edits[originalId] ? { ...draft.edits, [id]: cloneEntry(draft.edits[originalId]) } : draft.edits,
    copyBuffers: draft.copyBuffers?.[originalId] ? { ...draft.copyBuffers, [id]: cloneEntry(draft.copyBuffers[originalId]) } : draft.copyBuffers,
    artSettings: { ...draft.artSettings, [id]: { ...draft.artSettings?.[originalId] } },
    positions: point ? { ...draft.positions, [id]: { x: point.x + 42, y: point.y + 42 } } : draft.positions,
    layers: { ...draft.layers, [id]: 1 + Math.max(0, ...Object.values(draft.layers ?? {})) },
  }, id];
}

export function deleteWork(draft, id) {
  return { ...draft, revision: draft.revision + 1, removedWorks: [...(draft.removedWorks ?? []), id] };
}

export function restoreWork(draft) {
  return { ...draft, revision: draft.revision + 1, removedWorks: (draft.removedWorks ?? []).slice(0, -1) };
}
