import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';
const FILE_BASE_URL = import.meta.env.VITE_FILE_BASE_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request Interceptor: Attach JWT token and Tenant ID
api.interceptors.request.use(
  (config) => {
    // 1. Inject access token
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // 2. Inject tenant ID context
    const tenantId = localStorage.getItem('tenantId');
    if (tenantId && tenantId !== 'undefined' && tenantId !== 'null') {
      config.headers['x-tenant-id'] = tenantId;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor: Handle Token Expiration (MFA or 401)
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      try {
        const refreshToken = localStorage.getItem('refreshToken');
        if (refreshToken) {
          // Attempt refresh
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
          const newToken = res.data.token;

          localStorage.setItem('token', newToken);
          originalRequest.headers.Authorization = `Bearer ${newToken}`;

          return api(originalRequest);
        } else {
          // No refresh token, clear credentials and redirect to login
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          localStorage.removeItem('tenantId');
          if (window.location.pathname !== '/login') {
            window.location.href = '/login';
          }
        }
      } catch (refreshError) {
        // Refresh token failed, clear state & logout
        localStorage.removeItem('token');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('user');
        localStorage.removeItem('tenantId');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login';
        }
      }
    }

    return Promise.reject(error);
  }
);

export default api;
export { API_BASE_URL, FILE_BASE_URL };
