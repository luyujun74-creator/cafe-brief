import { ARCHIVE_PREFIX, KEEP_ARCHIVED, prunable } from './landing.mjs?v=202611263';

const archiveRange = () => IDBKeyRange.bound(ARCHIVE_PREFIX, ARCHIVE_PREFIX + '￿');
const done = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error);
  transaction.onerror = () => reject(transaction.error);
});

export function openDraftStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cafe-brief-launch', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('draft');
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('草稿存储正被另一个窗口占用。'));
    request.onsuccess = () => resolve(request.result);
  });
}

export function loadDraft(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction('draft').objectStore('draft').get('current');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// 写入当前草稿。若本机原有的当前草稿属于另一款商品，先把它移入「最近草稿」，避免开始新一款时丢失旧稿。
export function saveDraft(db, draft, expectedToken) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('draft', 'readwrite');
    const store = transaction.objectStore('draft');
    const read = store.get('current');
    let saved = false;
    read.onsuccess = () => {
      const previous = read.result;
      if ((previous?.saveToken ?? null) !== expectedToken) return;
      if (previous?.photo && previous.productId !== draft.productId) {
        store.put(previous, ARCHIVE_PREFIX + previous.productId);
      }
      store.delete(ARCHIVE_PREFIX + draft.productId);
      store.put(draft, 'current');
      saved = true;
      const archived = store.getAll(archiveRange());
      archived.onsuccess = () => {
        for (const old of prunable(archived.result, KEEP_ARCHIVED)) store.delete(ARCHIVE_PREFIX + old.productId);
      };
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function listDrafts(db) {
  return new Promise((resolve, reject) => {
    const entries = [];
    const request = db.transaction('draft').objectStore('draft').openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(entries);
      entries.push({ key: String(cursor.key), draft: cursor.value });
      cursor.continue();
    };
  });
}

export async function removeDraft(db, key) {
  const transaction = db.transaction('draft', 'readwrite');
  transaction.objectStore('draft').delete(key);
  await done(transaction);
}

// 撤销删除：原位置仍空则放回原处；当前草稿已被新的一款占用时，放进「最近草稿」。
export function putBackDraft(db, key, draft) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('draft', 'readwrite');
    const store = transaction.objectStore('draft');
    let target = key;
    if (key === 'current') {
      const read = store.get('current');
      read.onsuccess = () => {
        if (read.result && read.result.productId !== draft.productId) target = ARCHIVE_PREFIX + draft.productId;
        store.put(draft, target);
      };
    } else {
      store.put(draft, key);
    }
    transaction.oncomplete = () => resolve(target);
    transaction.onabort = () => reject(transaction.error);
  });
}
