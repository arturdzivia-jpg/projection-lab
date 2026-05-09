import type { ProjectionId } from '../projections';
import type { GridHighlight } from './convert';
import type { FitMode } from './normalize';
import type { RegionalInput } from './regionalInputs';

/**
 * IndexedDB-backed persistence so the user's regions + settings survive a page reload.
 *
 * Schema:
 *   - "settings"  ObjectStore, single record at key SETTINGS_KEY: a SerializedState JSON blob
 *                 containing every input's metadata + global render/target settings.
 *   - "images"    ObjectStore keyed by input.id, value = the original file Blob.
 *
 * Splitting the image bytes into their own store keeps the settings record small (~few KB) so
 * autosave on every keystroke stays cheap; the image blob is written once at upload time and
 * deleted when the input is removed.
 */

const DB_NAME = 'projection-lab';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';
const IMAGES_STORE = 'images';
const SETTINGS_KEY = 'main';
const SCHEMA_VERSION = 1;

export interface PersistedInput {
  id: string;
  label: string;
  filename: string;
  enabled: boolean;
  projectionId: ProjectionId;
  fit: FitMode;
  lambert: { lon: number; lat: number; scale: number };
  twinOffset: number;
}

export interface PersistedState {
  schemaVersion: number;
  inputs: PersistedInput[];
  target: {
    id: ProjectionId;
    regionLon: number;
    regionLat: number;
    regionScale: number;
    twinOffset: number;
    lonShift: number;
    latShift: number;
  };
  render: {
    gridEnabled: boolean;
    gridSpacing: number;
    gridHighlight: GridHighlight;
    coastlines: boolean;
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE);
      if (!db.objectStoreNames.contains(IMAGES_STORE)) db.createObjectStore(IMAGES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error);
  });
}

function awaitReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function toPersistedInput(input: RegionalInput): PersistedInput {
  return {
    id: input.id,
    label: input.label,
    filename: input.filename,
    enabled: input.enabled,
    projectionId: input.projectionId,
    fit: input.fit,
    lambert: { ...input.lambert },
    twinOffset: input.twinOffset,
  };
}

export async function saveSettings(state: PersistedState): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(SETTINGS_STORE, 'readwrite');
  tx.objectStore(SETTINGS_STORE).put(state, SETTINGS_KEY);
  await awaitTx(tx);
}

export async function loadSettings(): Promise<PersistedState | null> {
  const db = await openDB();
  const tx = db.transaction(SETTINGS_STORE, 'readonly');
  const result = await awaitReq(tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY) as IDBRequest<PersistedState | undefined>);
  if (!result) return null;
  if (result.schemaVersion !== SCHEMA_VERSION) {
    // Future-proof: if we ever bump the schema and don't have a migration path, drop the stale
    // record rather than blowing up on hydration.
    console.warn(`Discarding persisted state with schemaVersion=${result.schemaVersion}`);
    return null;
  }
  return result;
}

export async function saveImage(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(IMAGES_STORE, 'readwrite');
  tx.objectStore(IMAGES_STORE).put(blob, id);
  await awaitTx(tx);
}

export async function loadImage(id: string): Promise<Blob | null> {
  const db = await openDB();
  const tx = db.transaction(IMAGES_STORE, 'readonly');
  const result = await awaitReq(tx.objectStore(IMAGES_STORE).get(id) as IDBRequest<Blob | undefined>);
  return result ?? null;
}

export async function deleteImage(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(IMAGES_STORE, 'readwrite');
  tx.objectStore(IMAGES_STORE).delete(id);
  await awaitTx(tx);
}

export async function clearAllPersistence(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction([SETTINGS_STORE, IMAGES_STORE], 'readwrite');
  tx.objectStore(SETTINGS_STORE).clear();
  tx.objectStore(IMAGES_STORE).clear();
  await awaitTx(tx);
}

/** Decode an image Blob into an HTMLImageElement, mirroring what Uploader does on first load. */
export function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to decode persisted image'));
    };
    img.src = url;
  });
}

export const SCHEMA_VERSION_CONST = SCHEMA_VERSION;
