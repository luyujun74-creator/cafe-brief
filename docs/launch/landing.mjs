// 首页落点与「最近草稿」的纯逻辑，便于在 Node 中单独测试。
import { money, scopeLabel } from './workflow.mjs?v=202611263';

export const SESSION_KEY = 'cafe-brief-launch:active';
export const ARCHIVE_PREFIX = 'archive:';
export const KEEP_ARCHIVED = 5;
export const UNDO_MS = 8000;

const stageLabels = { intake: '提交素材', facts: '核对信息', review: '创作画布', workspace: '创作画布' };

// 只有同一标签页刷新（或前进后退）且会话记住的是同一份草稿时，才回到上次的位置；新打开链接一律落在首页。
export function resumeStage({ navigationType, sessionProductId, stored }) {
  if (!stored || !sessionProductId || stored.productId !== sessionProductId) return null;
  if (navigationType !== 'reload' && navigationType !== 'back_forward') return null;
  return continueStage(stored);
}

// 从首页继续编辑时进入的阶段：旧版的「当前草稿」页已并入首页，直接回画布。
export function continueStage(draft) {
  if (draft.stage === 'workspace') return 'review';
  if (draft.stage === 'intake') return draft.photo ? 'facts' : 'intake';
  return ['facts', 'review'].includes(draft.stage) ? draft.stage : 'intake';
}

export function recentDrafts(entries, activeProductId, limit = KEEP_ARCHIVED + 1) {
  return entries
    .filter(({ key, draft }) => (key === 'current' || key.startsWith(ARCHIVE_PREFIX))
      && draft?.photo && draft.productId !== activeProductId)
    .sort((a, b) => (b.draft.updatedAt ?? 0) - (a.draft.updatedAt ?? 0))
    .slice(0, limit);
}

export function prunable(archived, keep = KEEP_ARCHIVED) {
  return [...archived].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)).slice(keep);
}

export function draftSummary(draft, now = Date.now()) {
  const facts = draft.facts ?? {};
  const title = facts.name || (draft.photoName ?? '').replace(/\.[a-z0-9]+$/i, '') || '未命名草稿';
  const parts = [];
  if (Number.isFinite(facts.price)) parts.push(money(facts.price));
  if (facts.day) parts.push(facts.day);
  if (facts.scope) parts.push(scopeLabel(facts.scope));
  const meta = [stageLabels[draft.stage] ?? '提交素材'];
  if (draft.updatedAt) meta.push(when(draft.updatedAt, now));
  return { title, facts: parts.join(' · ') || '商品信息待补充', meta: meta.join(' · ') };
}

function when(time, now) {
  const date = new Date(time);
  const clock = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (new Date(now).toDateString() === date.toDateString()) return '今天 ' + clock;
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${clock}`;
}
