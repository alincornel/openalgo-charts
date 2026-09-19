import { number, string, WorkspaceDocumentError } from './json';
import { parseWorkspaceCatalog, WorkspaceConflictError, type WorkspaceStorage } from './repository';

export interface IndexedDbWorkspaceStorage extends WorkspaceStorage {
  /** Release the connection. Existing transactions may finish; new calls reject. */
  close(): Promise<void>;
}

/**
 * Browser persistence with one atomic compare-and-write transaction per catalog.
 * Pass the host's indexedDB explicitly; importing this module needs no browser.
 */
export function createIndexedDbWorkspaceStorage(
  factory: IDBFactory,
  databaseName = 'openalgo-chart-workspaces',
): IndexedDbWorkspaceStorage {
  const name = string(databaseName, 'database name');
  let opening: Promise<IDBDatabase> | null = null;
  let connection: IDBDatabase | null = null;
  let closed = false;
  const closedError = () => new Error('Workspace storage is closed. Create a new adapter to reconnect.');

  function open(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(closedError());
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, 1);
      let failed = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('catalogs')) request.result.createObjectStore('catalogs');
      };
      request.onblocked = () => { failed = true; reject(new Error('Workspace database is blocked by another session. Close that session and retry.')); };
      request.onerror = () => { failed = true; reject(request.error ?? new Error('Cannot open workspace database')); };
      request.onsuccess = () => {
        const db = request.result;
        if (closed || failed) { db.close(); reject(closedError()); return; }
        connection = db;
        db.onversionchange = () => { closed = true; db.close(); connection = null; };
        db.onclose = () => { closed = true; connection = null; };
        resolve(db);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }

  return {
    async read(namespace) {
      const key = string(namespace, 'storage namespace');
      const db = await open();
      return new Promise<unknown | null>((resolve, reject) => {
        const transaction = db.transaction('catalogs', 'readonly');
        const request = transaction.objectStore('catalogs').get(key);
        let value: unknown = null;
        request.onsuccess = () => { value = request.result ?? null; };
        transaction.oncomplete = () => resolve(value);
        transaction.onabort = () => reject(transaction.error ?? new Error('Workspace read was aborted'));
      });
    },
    async write(namespace, catalog, expectedRevision, options) {
      const signal = options?.signal;
      signal?.throwIfAborted();
      const key = string(namespace, 'storage namespace');
      const expected = number(expectedRevision, 'expected revision', 0, Number.MAX_SAFE_INTEGER, true);
      const next = parseWorkspaceCatalog(catalog);
      if (next.revision !== expected + 1) throw new WorkspaceDocumentError('A write must advance the catalog revision by one');
      const db = await open();
      signal?.throwIfAborted();
      return new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('catalogs', 'readwrite');
        const store = transaction.objectStore('catalogs');
        const request = store.get(key);
        let failure: unknown;
        const cancel = () => {
          try {
            transaction.abort();
            failure = signal?.reason;
          } catch { /* A committed transaction cannot be undone by cancellation. */ }
        };
        const cleanup = () => signal?.removeEventListener('abort', cancel);
        signal?.addEventListener('abort', cancel, { once: true });
        request.onsuccess = () => {
          try {
            const previous = request.result;
            const revision = previous === undefined ? 0 : parseWorkspaceCatalog(previous).revision;
            if (revision !== expected) throw new WorkspaceConflictError();
            store.put(next, key);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };
        transaction.oncomplete = () => { cleanup(); resolve(); };
        transaction.onabort = () => { cleanup(); reject(failure ?? transaction.error ?? new Error('Workspace save was aborted')); };
      });
    },
    async close() {
      closed = true;
      if (connection) { connection.close(); connection = null; }
      // An open already in flight closes its result in onsuccess.
      if (opening) await opening.catch(() => {});
    },
  };
}
