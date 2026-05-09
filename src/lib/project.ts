import type { PersistedState } from './persistence';
import { blobToImage, SCHEMA_VERSION_CONST } from './persistence';
import type { RegionalInput } from './regionalInputs';

/**
 * Project export / import — a portable single-file backup of the user's whole composed world.
 *
 * Format: a JSON file with the same `PersistedState` schema as IndexedDB plus a sibling
 * `images` map keyed by input id, where each value is a data URL of the image bytes. Embedding
 * the images via base64 keeps the export to a single file (no .zip dep, no companion-folder
 * dance) at the cost of ~33% size overhead — acceptable for a feature people use rarely.
 */

const PROJECT_SCHEMA_VERSION = 1;

interface ProjectFile {
  schemaVersion: number;
  exportedAt: string;
  settings: PersistedState;
  // input.id → data URL ("data:image/png;base64,…")
  images: Record<string, string>;
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('Failed to read blob'));
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(dataURL: string): Promise<Blob> {
  // fetch() handles "data:" URLs natively and gives us a typed Blob with the right MIME.
  const res = await fetch(dataURL);
  return await res.blob();
}

export async function exportProject(
  state: PersistedState,
  inputs: RegionalInput[]
): Promise<Blob> {
  const images: Record<string, string> = {};
  // Sequential rather than Promise.all so very large image blobs don't all hit FileReader at once
  // and balloon RAM.
  for (const i of inputs) {
    images[i.id] = await blobToDataURL(i.blob);
  }
  const project: ProjectFile = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state,
    images,
  };
  return new Blob([JSON.stringify(project)], { type: 'application/json' });
}

export async function importProject(
  file: File
): Promise<{ state: PersistedState; inputs: RegionalInput[] }> {
  const text = await file.text();
  let data: ProjectFile;
  try {
    data = JSON.parse(text) as ProjectFile;
  } catch {
    throw new Error('File is not a valid Projection Lab project (JSON parse failed).');
  }
  if (data.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project file version (${data.schemaVersion}); this build expects ${PROJECT_SCHEMA_VERSION}.`
    );
  }
  if (data.settings?.schemaVersion !== SCHEMA_VERSION_CONST) {
    throw new Error(
      `Project settings schema mismatch (got ${data.settings?.schemaVersion}, expected ${SCHEMA_VERSION_CONST}).`
    );
  }
  if (!data.images || typeof data.images !== 'object') {
    throw new Error('Project file is missing the `images` map.');
  }
  const inputs: RegionalInput[] = [];
  for (const p of data.settings.inputs) {
    const dataURL = data.images[p.id];
    if (!dataURL) continue; // image lost in transit; skip rather than crash the whole import
    try {
      const blob = await dataURLToBlob(dataURL);
      const image = await blobToImage(blob);
      inputs.push({
        id: p.id,
        label: p.label,
        filename: p.filename,
        image,
        blob,
        enabled: p.enabled,
        projectionId: p.projectionId,
        fit: p.fit,
        lambert: { ...p.lambert },
        twinOffset: p.twinOffset,
      });
    } catch {
      /* image decode failed; skip this input but keep the rest */
    }
  }
  return { state: data.settings, inputs };
}

export function projectFilename(): string {
  // Ship a date-stamped name so multiple exports don't silently overwrite each other on disk.
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `world.${stamp}.plproj.json`;
}
