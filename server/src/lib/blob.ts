// Azure Blob Storage helper using a container-scoped SAS URL.
// Uses fetch + REST API directly (no SDK dep). Falls back gracefully when unset.
import { config } from '../config.js';

export const blobEnabled = (): boolean => Boolean(config.blobSasUrl);

const parseSas = (): { base: string; query: string } | null => {
  if (!config.blobSasUrl) return null;
  const idx = config.blobSasUrl.indexOf('?');
  if (idx < 0) return null;
  return {
    base: config.blobSasUrl.slice(0, idx).replace(/\/$/, ''),
    query: config.blobSasUrl.slice(idx),
  };
};

const blobUrl = (name: string): string | null => {
  const p = parseSas();
  if (!p) return null;
  const encoded = name.split('/').map(encodeURIComponent).join('/');
  return `${p.base}/${encoded}${p.query}`;
};

/** Upload UTF-8 text/HTML/JSON blob. Returns a SAS-signed read URL on success. */
export const uploadText = async (
  name: string,
  content: string,
  contentType = 'text/html; charset=utf-8',
): Promise<string | null> => {
  const url = blobUrl(name);
  if (!url) return null;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2021-12-02',
      'Content-Type': contentType,
    },
    body: content,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Blob upload failed (${r.status}): ${txt.slice(0, 200)}`);
  }
  return url;
};

/** Upload a binary blob. Returns a SAS-signed read URL on success. */
export const uploadBytes = async (
  name: string,
  content: Uint8Array | ArrayBuffer | Buffer,
  contentType = 'application/octet-stream',
): Promise<string | null> => {
  const url = blobUrl(name);
  if (!url) return null;
  const body = content instanceof ArrayBuffer ? Buffer.from(content) : content;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': '2021-12-02',
      'Content-Type': contentType,
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blob upload failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return url;
};

/** Download blob as text. */
export const downloadText = async (name: string): Promise<string | null> => {
  const url = blobUrl(name);
  if (!url) return null;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Blob download failed (${r.status})`);
  return await r.text();
};
