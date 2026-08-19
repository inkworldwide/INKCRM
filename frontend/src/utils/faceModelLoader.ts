import * as faceapi from 'face-api.js';

let isLoaded = false;
let isLoading = false;
let loadPromise: Promise<boolean> | null = null;

const MODEL_SOURCES = [
  '/models',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
  'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model'
];

/**
 * Loads face-api.js models with high-speed TinyFaceDetector + fallback.
 */
export async function loadFaceApiModels(
  onProgress?: (msg: string) => void
): Promise<boolean> {
  if (isLoaded) return true;
  if (isLoading && loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    let lastError: any = null;

    for (let i = 0; i < MODEL_SOURCES.length; i++) {
      const sourceUrl = MODEL_SOURCES[i];
      try {
        if (onProgress) onProgress(i === 0 ? 'Starting Face AI engine...' : `Connecting AI engine (source ${i + 1})...`);
        console.log(`[Face-AI] Fast-loading models from: ${sourceUrl}`);

        // Load TinyFaceDetector, Landmark, and Recognition nets in parallel
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(sourceUrl),
          faceapi.nets.faceLandmark68Net.loadFromUri(sourceUrl),
          faceapi.nets.faceRecognitionNet.loadFromUri(sourceUrl),
          faceapi.nets.ssdMobilenetv1.loadFromUri(sourceUrl).catch(() => {})
        ]);

        console.log(`[Face-AI] Successfully loaded high-speed Face AI models from: ${sourceUrl}`);
        isLoaded = true;
        isLoading = false;
        return true;
      } catch (err: any) {
        console.warn(`[Face-AI] Source failed (${sourceUrl}):`, err?.message || err);
        lastError = err;
      }
    }

    isLoading = false;
    isLoaded = false;
    loadPromise = null;
    throw lastError || new Error('All Face AI model sources failed.');
  })();

  return loadPromise;
}

export function getFastFaceDetectorOptions(): faceapi.TinyFaceDetectorOptions | faceapi.SsdMobilenetv1Options {
  if (faceapi.nets.tinyFaceDetector.isLoaded) {
    return new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  }
  return new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 });
}

export function isFaceApiLoaded(): boolean {
  return isLoaded;
}

