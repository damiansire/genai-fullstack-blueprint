import { Injectable } from '@angular/core';

export interface ChatHistoryEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

/**
 * Local-First & Offline Mode Service
 * Native IndexedDB Wrapper without using dexie or other dependencies.
 */
@Injectable({
  providedIn: 'root'
})
export class LocalDbService {
  private readonly DB_NAME = 'GenAIDb';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'chatHistory';

  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.initPromise = this.initDb();
  }

  private initDb(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Feature detection
      if (!window.indexedDB) {
        console.warn('Native IndexedDB not supported. Offline mode disabled.');
        resolve();
        return;
      }

      const request = window.indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = (event) => {
        console.error('IndexedDB error:', event);
        reject('Error opening IndexedDB');
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });
  }

  public async saveMessage(entry: ChatHistoryEntry): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.put(entry);

      request.onsuccess = () => resolve();
      request.onerror = () => reject('Failed to save message to IndexedDB');
    });
  }

  public async getHistory(): Promise<ChatHistoryEntry[]> {
    await this.initPromise;
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject('Failed to load history from IndexedDB');
    });
  }

  public async clearHistory(): Promise<void> {
    await this.initPromise;
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject('Failed to clear history');
    });
  }
}
