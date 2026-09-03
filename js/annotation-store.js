export function createAnnotationStore() {
  let dbPromise = null;

  function key(script, department) {
    return script && department ? script + '|' + department : '';
  }

  function open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('gaosTeleprompter', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('annotationDocs')) db.createObjectStore('annotationDocs', {keyPath:'key'});
        if (!db.objectStoreNames.contains('annotationOps')) {
          const ops = db.createObjectStore('annotationOps', {keyPath:'id', autoIncrement:true});
          ops.createIndex('byKey', 'key', {unique:false});
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB error'));
    });
    return dbPromise;
  }

  async function getDoc(cacheKey) {
    if (!cacheKey) return null;
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('annotationDocs', 'readonly');
        const req = tx.objectStore('annotationDocs').get(cacheKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return null; }
  }

  async function putDoc(script, department, revision, annotations) {
    const cacheKey = key(script, department);
    if (!cacheKey) return;
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('annotationDocs', 'readwrite');
        tx.objectStore('annotationDocs').put({
          key:cacheKey, script, department, revision:Number(revision)||0,
          annotations:Array.isArray(annotations) ? annotations : [], savedAt:Date.now()
        });
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  async function addOp(op) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('annotationOps', 'readwrite');
        const req = tx.objectStore('annotationOps').add(op);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return null; }
  }

  async function deleteOp(id) {
    if (id === null || id === undefined) return;
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('annotationOps', 'readwrite');
        tx.objectStore('annotationOps').delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {}
  }

  async function opsFor(cacheKey) {
    if (!cacheKey) return [];
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('annotationOps', 'readonly');
        const req = tx.objectStore('annotationOps').index('byKey').getAll(IDBKeyRange.only(cacheKey));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (_) { return []; }
  }

  return {key, getDoc, putDoc, addOp, deleteOp, opsFor};
}
