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

export function saveDraft(db, draft, expectedToken) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('draft', 'readwrite');
    const store = transaction.objectStore('draft');
    const read = store.get('current');
    let saved = false;
    read.onsuccess = () => {
      if ((read.result?.saveToken ?? null) !== expectedToken) return;
      store.put(draft, 'current');
      saved = true;
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(transaction.error);
  });
}
