import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck, XCircle, Loader2, RefreshCw, Eye, RotateCcw, KeyRound } from 'lucide-react';
import api from '../services/api';
import { loadFaceApiModels, getFastFaceDetectorOptions, getFaceApi } from '../utils/faceModelLoader';

interface Props {
  tempToken: string;
  onSuccess: (user: any, token: string, refreshToken: string) => void;
  onCancel: () => void;
}

type ScanState = 'loading_models' | 'starting_camera' | 'scanning' | 'analyzing' | 'success' | 'error';

// Liveness prompts cycle to discourage photo spoofing
const LIVENESS_PROMPTS = [
  'Look straight at the camera',
  'Blink your eyes slowly',
  'Slowly turn your head left',
  'Slowly turn your head right',
  'Look straight at the camera'
];

export default function FaceVerificationModal({ tempToken, onSuccess, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Ref-based flag so the detection loop always sees the current loaded state
  const isModelLoadedRef = useRef(false);
  const isSubmittingRef = useRef(false);

  const [scanState, setScanState] = useState<ScanState>('loading_models');
  const [statusMsg, setStatusMsg] = useState('Initializing secure biometric engine...');
  const [errorMsg, setErrorMsg] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [livenessIndex, setLivenessIndex] = useState(0);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  // ─── Model loading ──────────────────────────────────────────────────────────
  useEffect(() => {
    loadModelsAndStart();
    return () => cleanup();
  }, []);

  // ─── Liveness prompt cycling ────────────────────────────────────────────────
  useEffect(() => {
    if (scanState !== 'scanning') return;
    const interval = setInterval(() => {
      setLivenessIndex((prev) => (prev + 1) % LIVENESS_PROMPTS.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [scanState]);

  const cleanup = () => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const loadModelsAndStart = async () => {
    setScanState('loading_models');
    setStatusMsg('Loading secure AI models...');
    try {
      await loadFaceApiModels((msg) => setStatusMsg(msg));
      // Set ref immediately so the detection loop can see it
      isModelLoadedRef.current = true;
      setStatusMsg('Camera starting...');
      await startCamera();
    } catch (err: any) {
      console.error('[Face-AI] Model load error in verification:', err);
      setScanState('error');
      setErrorMsg('Failed to load Face AI models. You can retry or login with password below.');
    }
  };

  const handlePasswordFallback = async () => {
    setFallbackLoading(true);
    try {
      const res = await api.post('/auth/face/password-fallback', { tempToken });
      if (res.data.token) {
        cleanup();
        onSuccess(res.data.user, res.data.token, res.data.refreshToken);
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Fallback login failed. Please return to login.');
    } finally {
      setFallbackLoading(false);
    }
  };

  const startCamera = async () => {
    setScanState('starting_camera');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400, facingMode: 'user' }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setScanState('scanning');
      setStatusMsg('Position your face inside the ring.');
    } catch {
      setScanState('error');
      setErrorMsg('Camera access was denied or unavailable. Please allow camera access and retry.');
    }
  };

  // ─── Detection loop (called via onPlay event) ───────────────────────────────
  const handleVideoPlay = useCallback(() => {
    if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);
    isSubmittingRef.current = false;
    setScanProgress(0);

    detectionIntervalRef.current = setInterval(async () => {
      // Guard: skip if models aren't loaded or already submitting
      if (!isModelLoadedRef.current || isSubmittingRef.current) return;
      if (!videoRef.current || videoRef.current.paused || videoRef.current.ended) return;

      try {
        const options = getFastFaceDetectorOptions();
        const faceapi = await getFaceApi();
        const detection = await faceapi
          .detectSingleFace(videoRef.current, options)
          .withFaceLandmarks()
          .withFaceDescriptor();

        if (!detection) {
          setStatusMsg('No face detected. Center your face in the ring.');
          setScanProgress(0);
          return;
        }

        if (detection.detection.score < 0.50) {
          setStatusMsg('Face detected. Please hold still and look straight...');
          setScanProgress(20);
          return;
        }

        // Face is clear — start animated progress then submit
        isSubmittingRef.current = true;
        if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current);

        setScanState('analyzing');
        setStatusMsg('Analyzing biometric data...');

        let prog = 0;
        const progressInterval = setInterval(() => {
          prog += 35;
          setScanProgress(Math.min(prog, 100));
          if (prog >= 100) {
            clearInterval(progressInterval);
            submitFaceEmbedding(detection.descriptor);
          }
        }, 50);
      } catch (detectionErr) {
        console.warn('[FACE] Frame detection error (transient):', detectionErr);
      }
    }, 120);
  }, []);

  const submitFaceEmbedding = async (descriptor: Float32Array) => {
    try {
      const res = await api.post('/auth/face/verify', {
        tempToken,
        embedding: Array.from(descriptor)
      });
      setScanState('success');
      setStatusMsg('Biometric verification complete!');
      setScanProgress(100);
      setTimeout(() => {
        onSuccess(res.data.user, res.data.token, res.data.refreshToken);
      }, 600);
    } catch (err: any) {
      setScanState('error');
      setErrorMsg(
        err.response?.data?.error === 'Face verification session expired. Please log in again.'
          ? 'Your session expired. Please go back and log in again.'
          : err.response?.data?.error || 'Face verification failed. Please try again.'
      );
      cleanup();
    }
  };

  const handleRetry = () => {
    cleanup();
    isSubmittingRef.current = false;
    isModelLoadedRef.current = false;
    setErrorMsg('');
    setScanProgress(0);
    setLivenessIndex(0);
    loadModelsAndStart();
  };

  // ─── Ring color by state ────────────────────────────────────────────────────
  const ringColor =
    scanState === 'error' ? 'border-rose-500' :
    scanState === 'success' ? 'border-emerald-400' :
    scanState === 'analyzing' ? 'border-amber-400' :
    'border-indigo-400';

  const outerRingColor =
    scanState === 'error' ? 'border-rose-500/30' :
    scanState === 'success' ? 'border-emerald-500/50' :
    'border-indigo-500/30';

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
      {/* Premium dark backdrop */}
      <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-xl" />

      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', damping: 26, stiffness: 220 }}
        className="relative z-10 bg-gradient-to-b from-[#12141c] to-[#0a0b0f] border border-slate-800/80 p-6 sm:p-8 rounded-[2rem] shadow-[0_25px_60px_rgba(0,0,0,0.85)] w-full max-w-sm flex flex-col items-center overflow-hidden my-auto"
      >
        {/* Top accent glow bar */}
        <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-indigo-500" />

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-[10px] text-slate-500 mb-6">
          <span className="text-emerald-500 font-semibold flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-[8px]">✓</span>
            Password
          </span>
          <span className="text-slate-700">›</span>
          <span className="text-emerald-500 font-semibold flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-[8px]">✓</span>
            Location
          </span>
          <span className="text-slate-700">›</span>
          <span className="text-indigo-400 font-bold flex items-center gap-1">
            <span className="w-4 h-4 rounded-full bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center">
              <ShieldCheck className="w-2.5 h-2.5" />
            </span>
            Face Scan
          </span>
        </div>

        {/* Header */}
        <div className="flex flex-col items-center mb-6">
          <div className="bg-emerald-500/10 p-2.5 rounded-2xl border border-emerald-500/20 mb-3">
            <ShieldCheck className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-lg font-black text-white tracking-wide uppercase">
            Biometric Scan
          </h3>
          <p className="text-xs text-slate-400 mt-1 text-center font-medium">
            Live facial verification required
          </p>
        </div>

        {/* Circular camera ring */}
        <div className="relative w-60 h-60 rounded-full mb-6 flex items-center justify-center">
          {/* Spinning outer dashed ring */}
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 7, repeat: Infinity, ease: 'linear' }}
            className={`absolute inset-[-6px] rounded-full border-2 border-dashed ${outerRingColor}`}
          />
          {/* Solid inner border */}
          <div className={`absolute inset-[-2px] rounded-full border-2 ${ringColor} transition-colors duration-500 opacity-85`} />

          {/* Camera area */}
          <div className="w-full h-full rounded-full overflow-hidden border-[4px] border-[#151821] relative bg-slate-900">
            {/* Holographic sweep line (only during scanning) */}
            <AnimatePresence>
              {(scanState === 'scanning' || scanState === 'analyzing') && (
                <motion.div
                  key="sweep"
                  animate={{ y: ['0%', '100%', '0%'] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent z-10 opacity-60"
                />
              )}
            </AnimatePresence>

            {/* Crosshair overlay */}
            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
              <div className="absolute w-[80%] h-[1px] bg-white/5" />
              <div className="absolute h-[80%] w-[1px] bg-white/5" />
              <div className="w-16 h-16 rounded-full border border-dashed border-white/5" />
            </div>

            {/* Loading overlay */}
            {(scanState === 'loading_models' || scanState === 'starting_camera') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0d0f14] z-20">
                <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                  {scanState === 'loading_models' ? 'Loading AI' : 'Starting Camera'}
                </span>
              </div>
            )}

            {/* Error overlay */}
            {scanState === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 z-20 p-4">
                <XCircle className="w-10 h-10 text-rose-500 mb-2" />
                <span className="text-xs font-bold text-rose-400 text-center uppercase tracking-wide">
                  Verification Failed
                </span>
              </div>
            )}

            {/* Success overlay */}
            {scanState === 'success' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-emerald-950/90 z-20">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15 }}
                >
                  <ShieldCheck className="w-14 h-14 text-emerald-400" />
                </motion.div>
              </div>
            )}

            {/* Live video */}
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onPlay={handleVideoPlay}
              className={`w-full h-full object-cover transition-opacity duration-500 ${
                scanState === 'scanning' || scanState === 'analyzing' ? 'opacity-90' : 'opacity-0'
              }`}
              style={{ transform: 'scaleX(-1)' }}
            />
          </div>
        </div>

        {/* Liveness prompt (shown during scanning) */}
        <AnimatePresence mode="wait">
          {scanState === 'scanning' && (
            <motion.div
              key={livenessIndex}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="flex items-center gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-4 py-2 mb-4"
            >
              <Eye className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
              <span className="text-xs text-indigo-300 font-semibold">
                {LIVENESS_PROMPTS[livenessIndex]}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status text & progress bar */}
        <div className="w-full space-y-3 mb-5">
          <div className="h-8 flex flex-col items-center justify-center text-center">
            {scanState === 'error' ? (
              <p className="text-xs font-semibold text-rose-400 bg-rose-500/10 px-4 py-1.5 rounded-full border border-rose-500/20 max-w-xs">
                {errorMsg}
              </p>
            ) : (
              <p className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                {statusMsg}
              </p>
            )}
          </div>

          {scanProgress > 0 && scanState !== 'error' && (
            <div className="w-full bg-slate-800/60 h-1.5 rounded-full overflow-hidden border border-white/5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                className={`h-full rounded-full ${
                  scanState === 'success'
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-400'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-500'
                }`}
              />
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="w-full space-y-2.5">
          {scanState === 'error' && (
            <button
              onClick={handleRetry}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-xs tracking-wide transition-all shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Retry Face Scan
            </button>
          )}

          {/* Password fallback bypass button */}
          <button
            onClick={handlePasswordFallback}
            disabled={fallbackLoading}
            className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 rounded-xl font-medium text-xs tracking-wide transition-all cursor-pointer"
          >
            {fallbackLoading ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : <KeyRound className="w-4 h-4 text-indigo-400" />}
            <span>Login with Password (Skip Face Scan)</span>
          </button>

          <button
            onClick={onCancel}
            className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors uppercase tracking-wider cursor-pointer"
          >
            ← Cancel and Return to Login
          </button>
        </div>
      </motion.div>
    </div>
  );
}
