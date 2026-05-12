const DB = (() => {
  let _db = null;

  async function open() {
    if (_db) return _db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.DB.NAME, CONFIG.DB.VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains('surveys')) {
          const s = db.createObjectStore('surveys', { keyPath: 'id' });
          s.createIndex('status', 'status');
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('observations')) {
          const s = db.createObjectStore('observations', { keyPath: 'id' });
          s.createIndex('surveyId', 'surveyId');
          s.createIndex('clusterId', 'clusterId');
          s.createIndex('gbifKey', 'gbifKey');
          s.createIndex('category', 'category');
          s.createIndex('isRare', 'isRare');
        }
        if (!db.objectStoreNames.contains('stands')) {
          const s = db.createObjectStore('stands', { keyPath: 'id' });
          s.createIndex('surveyId', 'surveyId');
          s.createIndex('primaryGbifKey', 'primaryGbifKey');
        }
        if (!db.objectStoreNames.contains('speciesCache')) {
          const s = db.createObjectStore('speciesCache', { keyPath: 'gbifKey' });
          s.createIndex('lastUsed', 'lastUsed');
          s.createIndex('useCount', 'useCount');
        }
        if (!db.objectStoreNames.contains('tileRegions')) {
          const s = db.createObjectStore('tileRegions', { keyPath: 'id' });
          s.createIndex('tileSource', 'tileSource');
        }
        if (!db.objectStoreNames.contains('exportSettings')) {
          const s = db.createObjectStore('exportSettings', { keyPath: 'id' });
          s.createIndex('surveyId', 'surveyId');
        }
        if (!db.objectStoreNames.contains('tileBitmaps')) {
          db.createObjectStore('tileBitmaps');
        }
        if (!db.objectStoreNames.contains('appSettings')) {
          db.createObjectStore('appSettings');
        }
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllByIndex(store, index, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).index(index).getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function putRaw(store, key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(value, key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getRaw(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function del(store, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function clear(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function count(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllKeys(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return { open, get, getAll, getAllByIndex, put, putRaw, getRaw, delete: del, clear, count, getAllKeys };
})();
