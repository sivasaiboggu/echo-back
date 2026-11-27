export const TAKE_CAPACITY = 12;
const STORE = 'takes';
let connection;

function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open('echoback', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('The take library is busy in another tab.'));
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = null;
      };
      resolve(database);
    };
  }).catch((error) => {
    connection = null;
    throw error;
  });
  return connection;
}

async function transact(mode, run) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    let result;
    run(transaction.objectStore(STORE), (value) => { result = value; });
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error);
  });
}

export function loadTakes() {
  return transact('readonly', (store, result) => {
    const request = store.getAll();
    request.onsuccess = () => result(request.result);
  });
}

export function saveTake(take) {
  return transact('readwrite', (store, result) => {
    const count = store.count();
    count.onsuccess = () => {
      if (count.result < TAKE_CAPACITY) {
        store.add(take);
        result(true);
      } else {
        result(false);
      }
    };
  });
}

export function deleteTake(id) {
  return transact('readwrite', (store) => store.delete(id));
}
