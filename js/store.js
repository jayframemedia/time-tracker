// IndexedDB storage: database "time-tracker", object store "entries" (keyPath "id").
const DB_NAME = 'time-tracker';
const DB_VERSION = 1;
const STORE = 'entries';

let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // If another tab upgrades the schema, let go so it can proceed.
        db.onversionchange = () => { db.close(); dbPromise = undefined; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = undefined; reject(req.error); };
      req.onblocked = () => console.warn('IndexedDB open blocked by another tab');
    });
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Every entry, including running and soft-deleted ones. */
export const getAllEntries = () => run('readonly', (s) => s.getAll());

/** Insert or replace one entry. Resolves once the write is committed. */
export const putEntry = (entry) => run('readwrite', (s) => s.put(entry));

/** Ask the browser not to evict our data (no prompt in Safari; best effort). */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported — fine */ }
}
