let connection;
export function openStorage() {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('canvnail', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
  return connection;
}
export async function readDocument() {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects', 'readonly').objectStore('projects').get('current');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
export async function writeDocument(document) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite');
    transaction.objectStore('projects').put(document, 'current');
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('No se ha guardado el proyecto.'));
    transaction.onerror = () => reject(transaction.error);
  });
}
