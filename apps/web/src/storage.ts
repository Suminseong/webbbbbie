export interface SavedLife {
  text: string;
  day: number;
  penName: string;
}
export const slotIds = ["auto", "1", "2", "3"] as const;
export type SlotId = (typeof slotIds)[number];

let opening: Promise<IDBDatabase> | undefined;

function database() {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("webbbbbie", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("saves");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("다른 탭이 저장소를 사용하고 있습니다."));
  });
  return opening;
}

export async function getSlots(): Promise<Partial<Record<SlotId, SavedLife>>> {
  const db = await database();
  const store = db.transaction("saves").objectStore("saves");
  const pairs = await Promise.all(
    slotIds.map(
      (slot) =>
        new Promise<[SlotId, SavedLife | undefined]>((resolve, reject) => {
          const request = store.get(slot);
          request.onsuccess = () =>
            resolve([slot, request.result as SavedLife | undefined]);
          request.onerror = () => reject(request.error);
        }),
    ),
  );
  return Object.fromEntries(pairs.filter(([, save]) => save !== undefined));
}

export async function putSlot(slot: SlotId, save: SavedLife) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("saves", "readwrite");
    transaction.objectStore("saves").put(save, slot);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
