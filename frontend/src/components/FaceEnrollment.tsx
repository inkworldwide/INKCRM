import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import * as faceapi from 'face-api.js';
import { Camera, ShieldCheck, Trash2, Loader2, XCircle, CheckCircle } from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import { loadFaceApiModels } from '../utils/faceModelLoader';

export default function FaceEnrollment({ mode = 'settings', onSuccess, onCancel }: { mode?: 'settings' | 'signup', onSuccess?: (embedding: number[]) => void, onCancel?: () => void }) {
  const { showConfirm, showAlertModal } = useToastStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [enrollmentComplete, setEnrollmentComplete] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // Track descriptors and interval using refs to avoid render-stage state update warnings
  const descriptorsRef = useRef<Float32Array[]>([]);
  const detectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const initModels = async () => {
    setError('');
    setIsModelLoading(true);
    try {
      await loadFaceApiModels((msg) => setStatus(msg));
      setIsModelLoaded(true);
      setStatus('');
    } catch (e: any) {
      console.error('[Face-AI] Model initialization error:', e);
      setError('Failed to load Face AI models from local and CDN sources.');
    } finally {
      setIsModelLoading(false);
    }
  };

  useEffect(() => {
    initModels();

    const checkEnrollmentStatus = async () => {
      try {
        const res = await api.get('/auth/face/status');
        setEnrollmentComplete(res.data.enabled);
      } catch (e) {
        console.error('Failed to fetch biometric enrollment status', e);
      }
    };

    if (mode === 'settings' && localStorage.getItem('token')) {
      checkEnrollmentStatus();
    }
    
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setError('');
    setStatus('Initializing camera...');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser.');
      }
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Camera request timed out. Do you have a webcam connected?')), 8000))
      ]) as MediaStream;
      
      setIsCameraActive(true);
      
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setStatus('Please look directly at the camera. Processing...');
          descriptorsRef.current = [];
          setProgress(0);
        } else {
          setIsCameraActive(false);
          setError('Camera display element failed to load.');
          setStatus('');
        }
      }, 100);
    } catch (err: any) {
      console.error('Camera Error:', err);
      setError(err.message || 'Camera access denied or unavailable.');
      setStatus('');
    }
  };

  const stopCamera = () => {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      setIsCameraActive(false);
    }
  };

  const handleVideoPlay = () => {
    if (enrollmentComplete) return;

    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
    }

    detectionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !isModelLoaded || enrollmentComplete) return;
      
      const detections = await faceapi.detectAllFaces(videoRef.current)
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 1) {
        const detection = detections[0];
        
        // Strict quality enforcement
        if (detection.detection.score < 0.85) {
          setStatus('Face detected but unclear. Please improve lighting and look straight.');
          return;
        }

        // Collect descriptors over a few frames to average out noise
        descriptorsRef.current.push(detection.descriptor);
        const count = descriptorsRef.current.length;
        const newProgress = Math.min((count / 4) * 100, 100);
        setProgress(newProgress);
        
        if (count === 4) {
          if (detectionIntervalRef.current) {
            clearInterval(detectionIntervalRef.current);
            detectionIntervalRef.current = null;
          }
          finishEnrollment(descriptorsRef.current);
        }
      } else if (detections.length > 1) {
        setStatus('Multiple faces detected! Only one face is allowed.');
        descriptorsRef.current = [];
        setProgress(0);
      } else {
        setStatus('No face detected. Center your face.');
      }
    }, 100);
  };

  const finishEnrollment = async (collectedDescriptors: Float32Array[]) => {
    setStatus('Finalizing mathematical facial mapping...');
    stopCamera();

    // Average the 4 descriptors for a more robust embedding
    const averagedDescriptor = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
      let sum = 0;
      for (let j = 0; j < collectedDescriptors.length; j++) {
        sum += collectedDescriptors[j][i];
      }
      averagedDescriptor[i] = sum / collectedDescriptors.length;
    }

    if (mode === 'signup') {
      setStatus('Facial mapping generated successfully.');
      if (onSuccess) onSuccess(Array.from(averagedDescriptor));
      return;
    }

    // Original settings mode api call
    try {
      await api.post('/auth/face/enroll', {
        embedding: Array.from(averagedDescriptor)
      });
      setEnrollmentComplete(true);
      setStatus('Face Authentication Successfully Enrolled!');
      if (onSuccess) onSuccess(Array.from(averagedDescriptor));
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to enroll face.');
      setStatus('');
    }
  };

  const disableFaceLogin = async () => {
    showConfirm({
      title: 'Delete Biometrics',
      message: 'Are you sure you want to delete your biometric data?',
      onConfirm: async () => {
        try {
          await api.post('/auth/face/disable');
          setEnrollmentComplete(false);
          setStatus('Biometric data securely deleted.');
          showAlertModal({
            title: 'Deleted Successfully',
            message: 'Your facial biometric data has been completely and securely deleted.',
            type: 'success'
          });
        } catch (err) {
          setError('Failed to disable face recognition.');
        }
      }
    });
  };

  return (
    <div className="bg-white dark:bg-slate-900 border-t-[3px] border-t-indigo-600 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4 text-left">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            {mode === 'signup' ? 'Mandatory Face Enrollment' : 'Biometric Security'}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {mode === 'signup' 
              ? 'To complete your registration, you must configure Face Recognition. Passwords alone cannot grant access. Raw photos are never saved.' 
              : 'Enable Face Recognition for a faster, premium login experience. We store mathematical representations of your face, securely encrypted with AES-256. Raw photos are never saved.'
            }
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-slate-50 dark:bg-slate-900/50">
        
        {/* State 1: Enrolled */}
        {enrollmentComplete && (
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto shadow-inner shadow-emerald-200">
              <CheckCircle className="w-10 h-10 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 dark:text-white">Face Login is Active</h3>
            <button 
              onClick={disableFaceLogin}
              className="px-4 py-2 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100 transition-colors font-medium text-sm flex items-center gap-2 mx-auto"
            >
              <Trash2 className="w-4 h-4" /> Delete Biometric Data
            </button>
          </div>
        )}

        {/* State 2: Camera Active & Scanning */}
        {!enrollmentComplete && isCameraActive && (
          <div className="text-center flex flex-col items-center">
            <div className="relative w-72 h-72 rounded-full mb-6 overflow-hidden border-4 border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
              <video 
                ref={videoRef}
                autoPlay 
                muted 
                playsInline
                onPlay={handleVideoPlay}
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            </div>
            
            <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-4 animate-pulse">
              {status}
            </p>
            
            <div className="w-64 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>

            <button 
              onClick={() => {
                stopCamera();
                if (onCancel) onCancel();
              }}
              className="mt-6 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            >
              Cancel Scan
            </button>
          </div>
        )}

        {/* State 3: Not Enrolled, Idle */}
        {!enrollmentComplete && !isCameraActive && (
          <div className="text-center flex flex-col items-center w-full">
            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-500/10 rounded-full flex items-center justify-center mx-auto mb-5">
              <Camera className="w-9 h-9 text-indigo-500" />
            </div>
            
            {error ? (
              <div className="mb-4 space-y-2">
                <p className="text-rose-600 font-medium text-xs bg-rose-50 px-4 py-2 rounded-xl border border-rose-100 max-w-sm">{error}</p>
                <button
                  onClick={initModels}
                  disabled={isModelLoading}
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-bold underline cursor-pointer"
                >
                  {isModelLoading ? 'Retrying model load...' : '🔄 Retry Loading AI Models'}
                </button>
              </div>
            ) : status ? (
              <p className="text-indigo-600 font-medium text-xs mb-4 animate-pulse">{status}</p>
            ) : null}

            <div className="w-full max-w-xs space-y-3">
              <button 
                onClick={startCamera}
                disabled={!isModelLoaded || isModelLoading}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-lg shadow-indigo-200 transition-all font-semibold flex items-center justify-center gap-2 mx-auto disabled:opacity-50 w-full cursor-pointer"
              >
                {isModelLoading || !isModelLoaded ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                {isModelLoaded ? 'Start Camera & Scan Face' : isModelLoading ? 'Loading AI Models...' : 'AI Models Not Ready'}
              </button>

              {/* Onboarding / Signup mode: Allow skip if models or camera cannot load */}
              {mode === 'signup' && (
                <button
                  type="button"
                  onClick={() => {
                    if (onSuccess) onSuccess([]);
                  }}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Skip Face Setup for Now</span>
                  <span className="text-[10px] text-slate-400 font-normal">(Login with Password)</span>
                </button>
              )}
            </div>

            {onCancel && (
              <button 
                onClick={onCancel}
                className="mt-4 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-medium"
              >
                ← Back
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
