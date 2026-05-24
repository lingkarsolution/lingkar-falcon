import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateText } from 'ai';
import { config } from '../config.js';
import { store } from '../db/store.js';
import { blobEnabled, uploadBytes } from '../lib/blob.js';
import { getLlmModel, llmAvailable } from '../commander/llm.js';
import type { Mention, MentionMediaAsset, Sentiment } from '../types.js';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20_000;
const FRAME_COUNT = 4;

type QueueItem = { tenantId: string; mentionId: string };
type DownloadedMedia = { bytes: Buffer; contentType: string; sizeBytes: number };
type MediaAnalysis = { summary: string | null; sentiment: Sentiment; confidence: number | null; ocrText?: string | null };

const queue: QueueItem[] = [];
let processing = false;

export const mediaQueueDepth = (): number => queue.length + (processing ? 1 : 0);

export const enqueueMediaEnrichment = (tenantId: string, mentionIds: string[]): void => {
  const queuedKeys = new Set(queue.map((item) => `${item.tenantId}:${item.mentionId}`));
  for (const mentionId of mentionIds) {
    const key = `${tenantId}:${mentionId}`;
    if (!queuedKeys.has(key)) {
      queue.push({ tenantId, mentionId });
      queuedKeys.add(key);
    }
  }
  void processQueueSoon();
};

const processQueueSoon = async (): Promise<void> => {
  if (processing) return;
  processing = true;
  setImmediate(() => {
    void processQueue().finally(() => {
      processing = false;
      if (queue.length > 0) void processQueueSoon();
    });
  });
};

const processQueue = async (): Promise<void> => {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) continue;
    try {
      await processMentionMedia(item);
    } catch (error) {
      console.error('[media-enrichment] failed:', (error as Error).message);
    }
  }
};

const processMentionMedia = async ({ tenantId, mentionId }: QueueItem): Promise<void> => {
  const mention = store.get('mentions', mentionId) as Mention | undefined;
  if (!mention || mention.tenantId !== tenantId || !mention.media?.length) return;
  for (let index = 0; index < mention.media.length; index += 1) {
    const asset = mention.media[index];
    if (!asset || (asset.status !== 'queued' && asset.status !== 'failed')) continue;
    await processAsset(mention, index);
  }
};

const processAsset = async (mention: Mention, index: number): Promise<void> => {
  const asset = mention.media?.[index];
  if (!asset) return;
  if (!blobEnabled()) {
    updateMediaAsset(mention, index, { status: 'failed', error: 'DATA_STORAGE_SAS_URL is not configured; media was not downloaded to blob storage.' });
    return;
  }

  try {
    updateMediaAsset(mention, index, { status: 'stored', error: null });
    if (asset.type === 'image') await storeImageAsset(mention, index);
    else if (asset.type === 'video') await storeVideoAsset(mention, index);
    else await storeOtherAsset(mention, index);

    const storedAsset = mention.media?.[index];
    if (!storedAsset) return;
    if (!llmAvailable()) {
      updateMediaAsset(mention, index, { status: 'skipped', error: 'LLM is not configured; stored media but skipped multimodal analysis.' });
      return;
    }

    updateMediaAsset(mention, index, { status: 'analyzing' });
    const analysis = storedAsset.type === 'video'
      ? await analyzeVideoAsset(mention, storedAsset)
      : await analyzeImageAsset(mention, storedAsset);
    updateMediaAsset(mention, index, {
      status: 'completed',
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      sentimentConfidence: analysis.confidence,
      ocrText: analysis.ocrText ?? storedAsset.ocrText ?? null,
      model: config.llm.model,
      analyzedAt: new Date().toISOString(),
      error: storedAsset.error ?? null,
    });
    applyMediaAnalysisToMention(mention);
  } catch (error) {
    updateMediaAsset(mention, index, { status: 'failed', error: (error as Error).message });
  }
};

const storeImageAsset = async (mention: Mention, index: number): Promise<void> => {
  const asset = mention.media?.[index];
  if (!asset) return;
  const media = await downloadMedia(asset.sourceUrl, 'image');
  const blobName = mediaBlobName(mention, asset, 'original', extensionFor(media.contentType, asset.sourceUrl));
  const blobUrl = await uploadBytes(blobName, media.bytes, media.contentType);
  updateMediaAsset(mention, index, { blobName, blobUrl, mimeType: media.contentType, sizeBytes: media.sizeBytes });
};

const storeVideoAsset = async (mention: Mention, index: number): Promise<void> => {
  const asset = mention.media?.[index];
  if (!asset) return;
  let videoBytes: Buffer | null = null;
  let videoContentType: string | null = null;
  let warning: string | null = null;

  try {
    const media = await downloadMedia(asset.sourceUrl, 'video');
    videoBytes = media.bytes;
    videoContentType = media.contentType;
    const blobName = mediaBlobName(mention, asset, 'original', extensionFor(media.contentType, asset.sourceUrl));
    const blobUrl = await uploadBytes(blobName, media.bytes, media.contentType);
    updateMediaAsset(mention, index, { blobName, blobUrl, mimeType: media.contentType, sizeBytes: media.sizeBytes });
  } catch (error) {
    warning = `Original video was not directly downloadable; analyzing transcript and thumbnail/frames only. ${(error as Error).message}`;
  }

  const frameBlobUrls = videoBytes && videoContentType ? await sampleAndUploadFrames(mention, asset, videoBytes, videoContentType) : [];
  if (frameBlobUrls.length > 0) {
    updateMediaAsset(mention, index, { frameBlobUrls, error: warning });
    return;
  }

  if (asset.thumbnailUrl) {
    try {
      const thumbnail = await downloadMedia(asset.thumbnailUrl, 'image');
      const thumbnailBlobName = mediaBlobName(mention, asset, 'thumbnail', extensionFor(thumbnail.contentType, asset.thumbnailUrl));
      const thumbnailBlobUrl = await uploadBytes(thumbnailBlobName, thumbnail.bytes, thumbnail.contentType);
      updateMediaAsset(mention, index, { thumbnailBlobName, thumbnailBlobUrl, frameBlobUrls: [thumbnailBlobUrl].filter(Boolean) as string[], error: warning });
      return;
    } catch (error) {
      warning = warning ? `${warning} Thumbnail failed: ${(error as Error).message}` : `Thumbnail failed: ${(error as Error).message}`;
    }
  }

  if (!asset.transcript && !mention.text) throw new Error(warning ?? 'Video has no transcript, caption, downloadable frames, or thumbnail for analysis.');
  updateMediaAsset(mention, index, { error: warning });
};

const storeOtherAsset = async (mention: Mention, index: number): Promise<void> => {
  const asset = mention.media?.[index];
  if (!asset) return;
  const media = await downloadMedia(asset.sourceUrl, 'other');
  const blobName = mediaBlobName(mention, asset, 'original', extensionFor(media.contentType, asset.sourceUrl));
  const blobUrl = await uploadBytes(blobName, media.bytes, media.contentType);
  updateMediaAsset(mention, index, { blobName, blobUrl, mimeType: media.contentType, sizeBytes: media.sizeBytes });
};

const downloadMedia = async (url: string, expected: 'image' | 'video' | 'other'): Promise<DownloadedMedia> => {
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Media download HTTP ${response.status}`);
  const contentType = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  const maxBytes = expected === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (contentLength > maxBytes) throw new Error(`Media is too large (${contentLength} bytes)`);
  if (expected === 'image' && !contentType.startsWith('image/')) throw new Error(`Expected an image but received ${contentType}`);
  if (expected === 'video' && !contentType.startsWith('video/')) throw new Error(`Expected a direct video file but received ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error(`Media is too large (${bytes.byteLength} bytes)`);
  return { bytes, contentType, sizeBytes: bytes.byteLength };
};

const fetchWithTimeout = async (url: string): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'CivicFalcon/0.1 media-enrichment' },
    });
  } finally {
    clearTimeout(timer);
  }
};

const sampleAndUploadFrames = async (mention: Mention, asset: MentionMediaAsset, videoBytes: Buffer, contentType: string): Promise<string[]> => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'civicfalcon-media-'));
  const inputPath = path.join(tempDir, `input.${extensionFor(contentType, asset.sourceUrl)}`);
  const framePattern = path.join(tempDir, 'frame-%02d.jpg');
  try {
    await fs.writeFile(inputPath, videoBytes);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
      '-vf', 'fps=1/12,scale=640:-1', '-frames:v', String(FRAME_COUNT), framePattern,
    ], 35_000);
    const entries = (await fs.readdir(tempDir)).filter((entry) => entry.startsWith('frame-') && entry.endsWith('.jpg')).sort();
    const frameBlobUrls: string[] = [];
    for (const entry of entries) {
      const bytes = await fs.readFile(path.join(tempDir, entry));
      const blobName = mediaBlobName(mention, asset, entry.replace('.jpg', ''), 'jpg');
      const blobUrl = await uploadBytes(blobName, bytes, 'image/jpeg');
      if (blobUrl) frameBlobUrls.push(blobUrl);
    }
    return frameBlobUrls;
  } catch (error) {
    console.warn('[media-enrichment] ffmpeg frame extraction skipped:', (error as Error).message);
    return [];
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
};

const execFileAsync = (command: string, args: string[], timeout: number): Promise<void> => new Promise((resolve, reject) => {
  execFile(command, args, { timeout }, (error, _stdout, stderr) => {
    if (error) reject(new Error(stderr?.trim() || error.message));
    else resolve();
  });
});

const analyzeImageAsset = async (mention: Mention, asset: MentionMediaAsset): Promise<MediaAnalysis> => {
  const imageUrl = asset.blobUrl ?? asset.thumbnailBlobUrl ?? asset.sourceUrl;
  const prompt = mediaPrompt(mention, asset, 'Analyze this image evidence. Extract visible claims, objects, people, text/OCR, tone, and topic relevance.');
  return generateMediaJson(prompt, [imageUrl]);
};

const analyzeVideoAsset = async (mention: Mention, asset: MentionMediaAsset): Promise<MediaAnalysis> => {
  const frameUrls = asset.frameBlobUrls?.length ? asset.frameBlobUrls : [asset.thumbnailBlobUrl, asset.thumbnailUrl].filter(Boolean) as string[];
  const transcript = asset.transcript || mention.text || mention.title || '';
  const prompt = mediaPrompt(mention, asset, `Analyze this video evidence using only the transcript/caption and selected frames. Do not assume unseen content. Transcript/caption:\n${transcript}`);
  return generateMediaJson(prompt, frameUrls.slice(0, FRAME_COUNT));
};

const generateMediaJson = async (prompt: string, imageUrls: string[]): Promise<MediaAnalysis> => {
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
  for (const imageUrl of imageUrls) content.push({ type: 'image', image: imageUrl });
  const result = await generateText({
    model: getLlmModel(),
    messages: [{ role: 'user', content }] as any,
    temperature: 0.1,
    maxOutputTokens: 700,
  });
  return parseAnalysis(result.text);
};

const mediaPrompt = (mention: Mention, asset: MentionMediaAsset, instruction: string): string => `Return only JSON with keys summary, sentiment, confidence, ocrText. Sentiment must be one of positive, negative, neutral, mixed, unknown. Confidence is 0..1.\n\nTopic/mention context:\nPlatform: ${mention.platform}\nSource type: ${mention.sourceType}\nTitle: ${mention.title ?? 'untitled'}\nText/caption: ${mention.text}\nSource URL: ${mention.sourceUrl ?? asset.sourceUrl}\n\n${instruction}`;

const parseAnalysis = (raw: string): MediaAnalysis => {
  try {
    const cleaned = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      summary: typeof parsed.summary === 'string' ? parsed.summary : null,
      sentiment: normalizeSentiment(parsed.sentiment),
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : null,
      ocrText: typeof parsed.ocrText === 'string' ? parsed.ocrText : null,
    };
  } catch {
    return { summary: raw.slice(0, 800), sentiment: 'unknown', confidence: null };
  }
};

const normalizeSentiment = (value: unknown): Sentiment => {
  const normalized = String(value ?? '').toLowerCase();
  return ['positive', 'negative', 'neutral', 'mixed', 'unknown'].includes(normalized) ? normalized as Sentiment : 'unknown';
};

const applyMediaAnalysisToMention = (mention: Mention): void => {
  const completed = (mention.media ?? []).filter((asset) => asset.status === 'completed' && asset.summary);
  if (completed.length === 0) return;
  const latestSummary = completed.map((asset) => asset.summary).filter(Boolean).join('\n');
  const strongest = completed
    .filter((asset) => asset.sentiment && asset.sentiment !== 'unknown')
    .sort((left, right) => (right.sentimentConfidence ?? 0) - (left.sentimentConfidence ?? 0))[0];
  mention.nlp.summary = mention.nlp.summary ?? latestSummary.slice(0, 1200);
  if (strongest?.sentiment && (strongest.sentimentConfidence ?? 0) >= 0.55) {
    mention.nlp.sentiment = strongest.sentiment;
    mention.nlp.sentimentConfidence = strongest.sentimentConfidence ?? mention.nlp.sentimentConfidence;
    mention.nlp.sentimentSource = 'llm';
    mention.nlp.sentimentAnalyzedAt = new Date().toISOString();
  }
  mention.updatedAt = new Date().toISOString();
  store.put('mentions', mention.id, mention);
};

const updateMediaAsset = (mention: Mention, index: number, patch: Partial<MentionMediaAsset>): void => {
  const media = [...(mention.media ?? [])];
  const current = media[index];
  if (!current) return;
  media[index] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  mention.media = media;
  mention.updatedAt = new Date().toISOString();
  store.put('mentions', mention.id, mention);
};

const mediaBlobName = (mention: Mention, asset: MentionMediaAsset, part: string, extension: string): string => {
  const safeAssetId = (asset.id || randomUUID()).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safePart = part.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `media/${mention.tenantId}/${mention.topicId}/${mention.id}/${safeAssetId}/${safePart}.${extension}`;
};

const extensionFor = (contentType: string, sourceUrl?: string): string => {
  const byType: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v',
  };
  if (byType[contentType]) return byType[contentType];
  try {
    const pathname = new URL(sourceUrl ?? 'https://local/file.bin').pathname;
    const ext = path.extname(pathname).replace('.', '').toLowerCase();
    if (/^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    // ignore URL parse failures
  }
  return 'bin';
};
