const DB_NAME = 'webcast-monitor-audio';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('audio');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('无法打开本地铃声存储。'));
  });
}
export async function readSound(): Promise<Blob | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('audio', 'readonly').objectStore('audio').get('custom');
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(new Error('无法读取自定义铃声。'));
    });
  } finally { db.close(); }
}
export async function writeSound(blob: Blob): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('audio', 'readwrite');
      transaction.objectStore('audio').put(blob, 'custom');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('保存铃声失败，原设置未更改。'));
      transaction.onabort = () => reject(new Error('保存铃声被中断。'));
    });
  } finally { db.close(); }
}
