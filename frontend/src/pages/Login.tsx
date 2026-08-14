import React, { useEffect, useRef, useState } from 'react';

import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import * as Icons from 'lucide-react';
import loginLogo from '../assets/login-logo.png';
import FaceVerificationModal from '../components/FaceVerificationModal';
import FaceEnrollment from '../components/FaceEnrollment';
import LocationVerificationStep from '../components/LocationVerificationStep';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';

// ─── User Code generator ─────────────────────────────────────────────────────
const generateUserCode = () => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());
  return `PTR--${year}${month}${day}${hours}${minutes}${seconds}`;
};

// ─── Step types ──────────────────────────────────────────────────────────────
type LoginStep = 'credentials' | 'location' | 'face' | 'onboarding-location' | 'onboarding-face';
type RegStep = 'form' | 'location' | 'face';

// ─── GPS capture for registration ────────────────────────────────────────────
function useGpsCapture() {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsError, setGpsError] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);

  const capture = () => {
    setGpsLoading(true);
    setGpsError('');
    setCoords(null);

    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser. Please use a modern browser.');
      setGpsLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setGpsLoading(false);
      },
      (err) => {
        setGpsLoading(false);
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsError(
              'Location permission denied. Location access is required to complete registration. Please allow it in your browser settings and try again.'
            );
            break;
          case err.POSITION_UNAVAILABLE:
            setGpsError('Your current location could not be determined. Check your GPS / network settings.');
            break;
          case err.TIMEOUT:
            setGpsError('Location request timed out. Please try again.');
            break;
          default:
            setGpsError('Unknown location error. Please try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  return { coords, gpsError, gpsLoading, capture };
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setAuth } = useAuthStore();
  const { branding, fetchBranding } = useThemeStore();

  const [isSignUpTab, setIsSignUpTab] = useState(false);

  // ── Login: three-step state ─────────────────────────────────────────────────
  const [loginStep, setLoginStep] = useState<LoginStep>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [tempToken, setTempToken] = useState('');
  // ── Onboarding state (for admin-created users) ──────────────────────────────
  const { coords: onboardCoords, gpsError: onboardGpsError, gpsLoading: onboardGpsLoading, capture: captureOnboardGps } = useGpsCapture();
  // ── Registration: three-step state ─────────────────────────────────────────
  const [regStep, setRegStep] = useState<RegStep>('form');
  const [companyName, setCompanyName] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [userCode, setUserCode] = useState('');
  const { coords: regCoords, gpsError: regGpsError, gpsLoading: regGpsLoading, capture: captureRegGps } = useGpsCapture();

  // ── Shared state ────────────────────────────────────────────────────────────
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const activeSub = branding?.subdomain || localStorage.getItem('tenantSubdomain') || 'sales';
    fetchBranding(activeSub);

    if (isSignUpTab && !userCode) {
      setUserCode(generateUserCode());
    }
  }, [isSignUpTab, userCode]);

  useEffect(() => {
    if (location.state?.openRegister) {
      setIsSignUpTab(true);
      // clear the state so refreshes don't lock the tab
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  const activeBgStyle = { backgroundColor: 'rgb(var(--color-primary))' };
  const activeColorStyle = { color: 'rgb(var(--color-primary))' };

  // ─── LOGIN FLOW ─────────────────────────────────────────────────────────────
  /** Step 1: Validate credentials with backend and check if location/face scan is needed */
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required.');
      setLoading(false);
      return;
    }

    // Capture GPS coordinates to log current location and address
    let currentCoords: { latitude: number; longitude: number } | null = null;
    if (navigator.geolocation) {
      try {
        currentCoords = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            () => resolve(null),
            { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
          );
        });
      } catch (e) {
        // location capture timeout or prompt skipped
      }
    }

    try {
      const res = await api.post('/auth/login', {
        email: email.toLowerCase(),
        password,
        rememberMe,
        ...(currentCoords ? currentCoords : {})
      });

      if (res.data.onboardingRequired && res.data.tempToken) {
        // User created by admin — needs location + face setup
        setTempToken(res.data.tempToken);
        setLoginStep('onboarding-location');
      } else if (res.data.locationRequired) {
        // Location verification is required for this user
        setLoginStep('location');
      } else if (res.data.mfaRequired && res.data.tempToken) {
        // Direct transition to Face Scan MFA
        setTempToken(res.data.tempToken);
        setLoginStep('face');
      } else if (res.data.token) {
        // Successful password verification and no MFA/location required
        setAuth(res.data.user, res.data.token, res.data.refreshToken);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        if (res.data.user.subdomain) {
          localStorage.setItem('tenantSubdomain', res.data.user.subdomain);
        }
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };
  /** Step 2 → 3: LocationVerificationStep calls /auth/login and returns tempToken */
  const handleLocationSuccess = (token: string, finalData?: any) => {
    if (finalData?.token) {
      setAuth(finalData.user, finalData.token, finalData.refreshToken);
      localStorage.setItem('user', JSON.stringify(finalData.user));
      if (finalData.user.subdomain) {
        localStorage.setItem('tenantSubdomain', finalData.user.subdomain);
      }
      navigate('/');
    } else {
      setTempToken(token);
      setLoginStep('face');
    }
  };

  /** Step 2 → 1: Wrong password reported by location step */
  const handlePasswordError = () => {
    setLoginStep('credentials');
    setError('Invalid email or password. Please check your credentials.');
  };
  /** Step 3 → dashboard: Face verified, tokens received */
  const handleFaceSuccess = (user: any, token: string, refreshToken: string) => {
    setAuth(user, token, refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    if (user.subdomain) {
      localStorage.setItem('tenantSubdomain', user.subdomain);
    }
    navigate('/');
  };
  const resetLoginFlow = () => {
    setLoginStep('credentials');
    setEmail('');
    setPassword('');
    setTempToken('');
    setError('');
  };

  // ─── ONBOARDING FLOW (admin-created users) ─────────────────────────────────
  const handleOnboardLocationReady = () => {
    if (onboardCoords) {
      setLoginStep('onboarding-face');
    }
  };

  const executeOnboarding = async (faceEmbedding?: number[]) => {
    const lat = onboardCoords?.latitude || 0;
    const lng = onboardCoords?.longitude || 0;
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/onboarding', {
        tempToken,
        latitude: lat,
        longitude: lng,
        faceEmbedding: (faceEmbedding && faceEmbedding.length === 128) ? faceEmbedding : null,
        skipFace: !faceEmbedding || faceEmbedding.length === 0
      });
      if (res.data.token) {
        useToastStore.getState().showToast('Successfully logged in.', 'success');
        setAuth(res.data.user, res.data.token, res.data.refreshToken);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        if (res.data.user.subdomain) {
          localStorage.setItem('tenantSubdomain', res.data.user.subdomain);
        }
        navigate('/');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to complete account setup.');
      setLoginStep('credentials');
    } finally {
      setLoading(false);
    }
  };

  // ─── REGISTRATION FLOW ──────────────────────────────────────────────────────
  /** Step 1 → 2: Validate partner registration form details */
  const handleRegFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!userCode || !firstName.trim() || !lastName.trim() || !signUpEmail.trim() || !signUpPassword.trim() || !confirmPassword.trim()) {
      setError('All fields are required.');
      return;
    }

    if (signUpPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    if (signUpPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Auto-generate subdomain from the email prefix (raja@gmail.com -> raja)
    const emailPrefix = signUpEmail.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    // Guarantee uniqueness by appending timestamp if empty
    const generatedSubdomain = emailPrefix || 'partner' + Date.now().toString().slice(-4);
    
    // Auto-generate company name
    const generatedCompanyName = `${firstName} ${lastName} Workspace`;

    setSubdomain(generatedSubdomain);
    setCompanyName(generatedCompanyName);

    setRegStep('location');
  };

  /** Step 2 → 3: GPS obtained, proceed to face enrollment */
  const handleRegLocationReady = () => {
    if (regCoords) {
      setRegStep('face');
    }
  };

  /** Step 3 → API: Face enrolled, now register partner */
  const executeRegistration = async (faceEmbedding: number[] = []) => {
    setError('');
    setSuccess('');
    setLoading(true);
    setRegStep('form');

    const locationData = regCoords ? {
      latitude: regCoords.latitude,
      longitude: regCoords.longitude
    } : undefined;

    try {
      const { default: api } = await import('../services/api');
      const res = await api.post('/auth/register', {
        companyName,
        subdomain: subdomain.toLowerCase(),
        firstName,
        lastName,
        email: signUpEmail.toLowerCase(),
        password: signUpPassword,
        faceEmbedding: faceEmbedding && faceEmbedding.length === 128 ? faceEmbedding : undefined,
        registrationLocation: locationData,
        userCode
      });

      if (res.data?.pendingApproval) {
        setSuccess('Registration submitted successfully! Your account is pending Super Admin approval. You will be able to log in once an administrator approves your account.');
      } else {
        setSuccess('Account registered successfully! Please log in.');
      }
      setIsSignUpTab(false);
      setEmail(signUpEmail);
      setPassword('');
      setSignUpPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to complete registration.');
    } finally {
      setLoading(false);
    }
  };
  const resetRegFlow = () => {
    setRegStep('form');
    setError('');
  };

  // ─── SHARED TAB SWITCH ──────────────────────────────────────────────────────
  const switchTab = (toSignup: boolean) => {
    setIsSignUpTab(toSignup);
    setError('');
    setSuccess('');
    setLoginStep('credentials');
    setRegStep('form');
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen w-full flex flex-col justify-center items-center bg-[#fdfbf7] dark:bg-[#0B0F19] px-3.5 sm:px-4 py-6 sm:py-12 relative overflow-x-hidden overflow-y-auto font-sans">

      {/* Background grid & blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30" />
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[55%] rounded-full bg-indigo-200/40 blur-[130px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[55%] rounded-full bg-emerald-100/40 blur-[130px]" />
      </div>

      {/* Face Verification Overlay (step 3 of login) */}
      <AnimatePresence>
        {!isSignUpTab && loginStep === 'face' && tempToken && (
          <FaceVerificationModal
            tempToken={tempToken}
            onSuccess={handleFaceSuccess}
            onCancel={() => {
              setLoginStep('credentials');
              setTempToken('');
            }}
          />
        )}
      </AnimatePresence>

      {/* Face Enrollment Overlay (step 3 of registration) */}
      <AnimatePresence>
        {isSignUpTab && regStep === 'face' && (
          <div className="fixed inset-0 z-50 overflow-y-auto flex items-center justify-center p-4">
            <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md" />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="relative z-10 w-full max-w-lg my-auto"
            >
              <FaceEnrollment
                mode="signup"
                onSuccess={(embedding) => executeRegistration(embedding)}
                onCancel={() => executeRegistration([])}
              />
              <div className="text-center mt-3">
                <button
                  type="button"
                  onClick={() => executeRegistration([])}
                  className="text-xs text-white/80 hover:text-white underline font-semibold transition-colors"
                >
                  Skip Face Enrollment & Submit Registration →
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Card */}
      <div className="w-full max-w-md bg-white border border-slate-200/80 p-5 sm:p-8 rounded-2xl shadow-xl shadow-slate-200/50 relative z-10 text-slate-800 transition-all duration-300 my-auto">

        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <img src={loginLogo} alt="Ink Worldwide" className="h-20 w-auto object-contain" />
        </div>

        {/* Alert banners */}
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="p-3 mb-4 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-semibold text-center flex items-center gap-2 justify-center"
            >
              <Icons.AlertCircle className="w-4 h-4 flex-shrink-0 animate-pulse" />
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-3 mb-4 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 text-xs font-semibold text-center flex items-center gap-2 justify-center"
            >
              <Icons.CheckCircle className="w-4 h-4 animate-bounce" />
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Sign In flow ─────────────────────────────────────────────────── */}
        {!isSignUpTab ? (
          <>
            {/* Tab selector (only on credentials step) */}
            {loginStep === 'credentials' && (
              <div className="flex bg-slate-100/80 p-1 rounded-xl mb-6">
                <button
                  onClick={() => switchTab(false)}
                  className="flex-1 py-2 text-xs font-bold rounded-lg bg-white text-slate-800 shadow-sm"
                >
                  Sign In
                </button>
                <button
                  onClick={() => switchTab(true)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg text-slate-500 hover:text-slate-800 transition-all"
                >
                  Register
                </button>
              </div>
            )}

            {/* Step 1 — Credentials */}
            {loginStep === 'credentials' && (
              <motion.form
                key="creds"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                onSubmit={handleCredentialsSubmit}
                className="space-y-4"
              >
                {/* MFA Security banner */}
                <div className="flex items-start gap-2.5 p-3 bg-indigo-50 border border-indigo-100 rounded-xl mb-2">
                  <Icons.ShieldCheck className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-indigo-700 font-medium leading-relaxed">
                    <strong>Secure Login:</strong> Your session is protected by location verification + face recognition.
                  </p>
                </div>

                <div className="text-left">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    Email Address
                  </label>
                  <div className="relative">
                    <Icons.Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="ink@crm.com"
                    />
                  </div>
                </div>

                <div className="text-left">
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      Password
                    </label>
                  </div>
                  <div className="relative">
                    <Icons.Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center text-xs mt-2 select-none">
                  <label className="flex items-center gap-2 text-slate-400 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-slate-300 bg-slate-50 text-indigo-600 focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    Keep me signed in
                  </label>
                </div>

                {/* Login steps preview */}
                <div className="flex items-center gap-2 text-[10px] text-slate-400 py-2">
                  <span className="flex items-center gap-1 font-semibold text-indigo-600">
                    <Icons.KeyRound className="w-3 h-3" /> Credentials
                  </span>
                  <Icons.ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="flex items-center gap-1">
                    <Icons.MapPin className="w-3 h-3" /> Location
                  </span>
                  <Icons.ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="flex items-center gap-1">
                    <Icons.ScanFace className="w-3 h-3" /> Face Scan
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 mt-2 flex items-center justify-center gap-2"
                >
                  <span>Login</span>
                  <Icons.LogIn className="w-4 h-4" />
                </button>
              </motion.form>
            )}

            {/* Step 2 — Location */}
            {loginStep === 'location' && (
              <LocationVerificationStep
                email={email}
                password={password}
                rememberMe={rememberMe}
                onSuccess={handleLocationSuccess}
                onPasswordError={handlePasswordError}
                onCancel={resetLoginFlow}
              />
            )}

            {/* Step 3 — Face (rendered as overlay, handled above) */}
            {loginStep === 'face' && !tempToken && (
              <div className="text-center py-8 text-slate-400 text-sm">
                Preparing face verification...
              </div>
            )}

            {/* Onboarding Step 1 — Location Capture */}
            {loginStep === 'onboarding-location' && (
              <motion.div
                key="onboard-location"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 text-center"
              >
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <Icons.CheckCircle className="w-3.5 h-3.5" /> Credentials
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                    <Icons.MapPin className="w-3.5 h-3.5" /> Location
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="text-slate-400">Face Enroll</span>
                </div>

                <div className="flex items-start gap-2.5 p-3 bg-amber-50 border border-amber-100 rounded-xl mb-2">
                  <Icons.Info className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-amber-700 font-medium leading-relaxed text-left">
                    Your account was created by an administrator. To activate it, you need to register your <strong>GPS location</strong> and <strong>face biometric</strong>.
                  </p>
                </div>

                {!onboardCoords && !onboardGpsLoading && !onboardGpsError && (
                  <>
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPin className="w-9 h-9 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Capture Your Location</h3>
                      <p className="text-sm text-slate-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
                        Your current GPS coordinates will be saved as your registered location.
                      </p>
                    </div>
                    <button
                      onClick={captureOnboardGps}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                    >
                      <Icons.MapPin className="w-4 h-4" />
                      Allow Location Access
                    </button>
                  </>
                )}

                {onboardGpsLoading && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                      className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto"
                    >
                      <Icons.Loader2 className="w-9 h-9 text-indigo-600 animate-spin" />
                    </motion.div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Capturing Location...</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Please allow location access when your browser asks.
                      </p>
                    </div>
                  </>
                )}

                {onboardGpsError && (
                  <>
                    <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPinOff className="w-9 h-9 text-rose-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Location Access Required</h3>
                      <p className="text-sm text-rose-600 mt-1.5 max-w-xs mx-auto bg-rose-50 p-3 rounded-xl border border-rose-100 leading-relaxed">
                        {onboardGpsError}
                      </p>
                    </div>
                    <button
                      onClick={captureOnboardGps}
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                    >
                      <Icons.RefreshCw className="w-4 h-4" />
                      Try Again
                    </button>
                  </>
                )}

                {onboardCoords && !onboardGpsError && (
                  <>
                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPin className="w-9 h-9 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Location Captured!</h3>
                      <div className="mt-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-left space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-medium">Latitude</span>
                          <span className="font-mono font-bold text-slate-700">{onboardCoords.latitude.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-medium">Longitude</span>
                          <span className="font-mono font-bold text-slate-700">{onboardCoords.longitude.toFixed(6)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleOnboardLocationReady}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                    >
                      Continue to Face Enrollment
                      <Icons.ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </motion.div>
            )}

            {/* Onboarding Step 2 — Face Enrollment */}
            {loginStep === 'onboarding-face' && (
              <motion.div
                key="onboard-face"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-4">
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <Icons.CheckCircle className="w-3.5 h-3.5" /> Credentials
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <Icons.CheckCircle className="w-3.5 h-3.5" /> Location
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                    <Icons.ScanFace className="w-3.5 h-3.5" /> Face Enroll
                  </span>
                </div>
                <FaceEnrollment
                  mode="signup"
                  onSuccess={executeOnboarding}
                />
              </motion.div>
            )}
          </>
        ) : (
          // ── Register flow ──────────────────────────────────────────────────
          <>
            {/* Tab selector (only on form step) */}
            {regStep === 'form' && (
              <div className="flex bg-slate-100/80 p-1 rounded-xl mb-6">
                <button
                  onClick={() => switchTab(false)}
                  className="flex-1 py-2 text-xs font-semibold rounded-lg text-slate-500 hover:text-slate-800 transition-all"
                >
                  Sign In
                </button>
                <button
                  onClick={() => switchTab(true)}
                  className="flex-1 py-2 text-xs font-bold rounded-lg bg-white text-slate-800 shadow-sm"
                >
                  Register
                </button>
              </div>
            )}

            {/* Reg Step 1 — Form */}
            {regStep === 'form' && (
              <motion.form
                key="reg-form"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                onSubmit={handleRegFormSubmit}
                className="space-y-4"
              >
                {/* Security note */}
                <div className="flex items-start gap-2.5 p-3 bg-indigo-50 border border-indigo-100 rounded-xl mb-2">
                  <Icons.ShieldCheck className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                  <p className="text-[11px] text-indigo-700 font-medium leading-relaxed">
                    Registration requires your <strong>GPS location</strong> and <strong>face biometric</strong>. Both are mandatory for account security.
                  </p>
                </div>                {/* User Code */}
                <div className="text-left">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    User Code
                  </label>
                  <div className="relative">
                    <Icons.Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      disabled
                      value={userCode}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border border-slate-200/80 rounded-xl text-slate-500 font-mono text-sm focus:outline-none cursor-not-allowed select-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {/* First Name */}
                  <div className="text-left">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      First Name
                    </label>
                    <input
                      type="text"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="First Name"
                    />
                  </div>
                  {/* Last Name */}
                  <div className="text-left">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Last Name
                    </label>
                    <input
                      type="text"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="Last Name"
                    />
                  </div>
                </div>

                {/* User Name (Email) */}
                <div className="text-left">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                    User Name (Like : raja@gmail.com)
                  </label>
                  <div className="relative">
                    <Icons.User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      required
                      value={signUpEmail}
                      onChange={(e) => setSignUpEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                      placeholder="User Name"
                    />
                  </div>
                </div>

                {/* Password & Confirm Password */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="text-left">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Password*
                    </label>
                    <div className="relative">
                      <Icons.Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={signUpPassword}
                        onChange={(e) => setSignUpPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="Password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="text-left">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      Confirm Password*
                    </label>
                    <div className="relative">
                      <Icons.Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200/80 rounded-xl text-slate-800 placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                        placeholder="Confirm Password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        {showPassword ? <Icons.EyeOff className="w-4 h-4" /> : <Icons.Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                {/* Registration steps preview */}
                <div className="flex items-center gap-2 text-[10px] text-slate-400 py-1">
                  <span className="flex items-center gap-1 font-semibold text-indigo-600">
                    <Icons.FileText className="w-3 h-3" /> Details
                  </span>
                  <Icons.ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="flex items-center gap-1">
                    <Icons.MapPin className="w-3 h-3" /> Location
                  </span>
                  <Icons.ChevronRight className="w-3 h-3 text-slate-300" />
                  <span className="flex items-center gap-1">
                    <Icons.ScanFace className="w-3 h-3" /> Face Enroll
                  </span>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition-all shadow-lg shadow-indigo-600/20 mt-2 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <span>Continue to Location</span>
                      <Icons.ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </motion.form>
            )}

            {/* Reg Step 2 — GPS Capture */}
            {regStep === 'location' && (
              <motion.div
                key="reg-location"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6 text-center"
              >
                {/* Step indicator */}
                <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-2">
                  <span className="flex items-center gap-1 text-emerald-600 font-semibold">
                    <Icons.CheckCircle className="w-3.5 h-3.5" /> Details
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="flex items-center gap-1 text-indigo-600 font-semibold">
                    <Icons.MapPin className="w-3.5 h-3.5" /> Location
                  </span>
                  <Icons.ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                  <span className="text-slate-400">Face Enroll</span>
                </div>

                {/* State: idle / loading / captured / error */}
                {!regCoords && !regGpsLoading && !regGpsError && (
                  <>
                    <div className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPin className="w-9 h-9 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Capture Registration Location</h3>
                      <p className="text-sm text-slate-500 mt-1.5 max-w-xs mx-auto leading-relaxed">
                        Your current GPS coordinates will be saved as your registered location. You must be at this location each time you log in.
                      </p>
                    </div>
                    <button
                      onClick={captureRegGps}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                    >
                      <Icons.MapPin className="w-4 h-4" />
                      Allow Location Access
                    </button>
                  </>
                )}

                {regGpsLoading && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                      className="w-20 h-20 bg-indigo-50 rounded-full flex items-center justify-center mx-auto"
                    >
                      <Icons.Loader2 className="w-9 h-9 text-indigo-600 animate-spin" />
                    </motion.div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Capturing Location...</h3>
                      <p className="text-sm text-slate-500 mt-1">
                        Please allow location access when your browser asks.
                      </p>
                    </div>
                  </>
                )}

                {regGpsError && (
                  <>
                    <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPinOff className="w-9 h-9 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Location Access Optional</h3>
                      <p className="text-sm text-slate-600 mt-1.5 max-w-xs mx-auto bg-amber-50 p-3 rounded-xl border border-amber-100 leading-relaxed text-xs font-medium">
                        {regGpsError}
                      </p>
                      <p className="text-xs text-slate-400 mt-2">
                        You can try again or skip location to complete registration.
                      </p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={captureRegGps}
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                      >
                        <Icons.RefreshCw className="w-4 h-4" />
                        Try Location Again
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRegStep('face');
                        }}
                        className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all"
                      >
                        Skip Location & Continue →
                      </button>
                    </div>
                  </>
                )}

                {regCoords && !regGpsError && (
                  <>
                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto">
                      <Icons.MapPin className="w-9 h-9 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-800">Location Captured!</h3>
                      <div className="mt-2 bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-xs text-left space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-medium">Latitude</span>
                          <span className="font-mono font-bold text-slate-700">{regCoords.latitude.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-medium">Longitude</span>
                          <span className="font-mono font-bold text-slate-700">{regCoords.longitude.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500 font-medium">Allowed Radius</span>
                          <span className="font-bold text-emerald-700">100 meters</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={handleRegLocationReady}
                      className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20"
                    >
                      <Icons.ScanFace className="w-4 h-4" />
                      Continue to Face Enrollment
                    </button>
                  </>
                )}

                <div className="flex items-center justify-between gap-2 pt-2">
                  <button
                    onClick={resetRegFlow}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    ← Back to form
                  </button>
                  <button
                    type="button"
                    onClick={() => executeRegistration([])}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                  >
                    Submit Registration Now →
                  </button>
                </div>
              </motion.div>
            )}

            {/* Reg Step 3 — Face Enrollment handled by overlay above */}
            {regStep === 'face' && (
              <div className="text-center py-8 text-slate-400 text-sm">
                <Icons.ScanFace className="w-8 h-8 mx-auto mb-2 animate-pulse text-indigo-400" />
                Starting face enrollment...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
