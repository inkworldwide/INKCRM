let isLoaded = false;
let isLoading = false;
let loadPromise: Promise<boolean> | null = null;
let faceapiModule: any = null;

export async function getFaceApi() {
  if (!faceapiModule) {
    faceapiModule = await import('face-api.js');
  }
  return faceapiModule;
}

const MODEL_SOURCES = [
  '/models',
  'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights',
  'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights',
  'https://cdn.jsdelivr.net/gh/vladmandic/face-api/model'
];

/**
 * Loads face-api.js models on demand with dynamic import.
 */
export async function loadFaceApiModels(
  onProgress?: (msg: string) => void
): Promise<boolean> {
  if (isLoaded) return true;
  if (isLoading && loadPromise) return loadPromise;

  isLoading = true;
  loadPromise = (async () => {
    let lastError: any = null;
    const faceapi = await getFaceApi();

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

export function getFastFaceDetectorOptions(): any {
  if (faceapiModule?.nets?.tinyFaceDetector?.isLoaded) {
    return new faceapiModule.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  }
  if (faceapiModule?.SsdMobilenetv1Options) {
    return new faceapiModule.SsdMobilenetv1Options({ minConfidence: 0.5 });
  }
  return { inputSize: 224, scoreThreshold: 0.5 };
}

export function isFaceApiLoaded(): boolean {
  return isLoaded;
}

