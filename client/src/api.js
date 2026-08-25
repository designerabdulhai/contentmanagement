import axios from 'axios';

// Same-origin Vercel API proxy. The Vercel function at /api/[...path].js
// forwards requests to the Cloudflare Worker without browser CORS issues.
const baseURL = '/api';
const TOKEN_KEY = 'content_schedule_auth_token';

const api = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);

  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

function errorMessage(data, fallback = 'Request failed') {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (data && typeof data === 'object') {
    if (typeof data.error === 'string') return data.error;
    if (data.error && typeof data.error === 'object') {
      try {
        return JSON.stringify(data.error);
      } catch {
        return 'API returned an error object';
      }
    }

    try {
      return JSON.stringify(data);
    } catch {
      return fallback;
    }
  }

  return fallback;
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (!error.response) {
      return Promise.reject(
        new Error(
          `API proxy request failed: ${error.message || 'Failed to fetch'}`
        )
      );
    }

    const message = errorMessage(
      error.response.data,
      error.message || 'Request failed'
    );

    if (
      status === 404 &&
      String(error.config?.url || '').includes('/auth/login')
    ) {
      return Promise.reject(
        new Error(
          `Login API not found. ${message}`
        )
      );
    }

    if (
      status === 401 &&
      !String(error.config?.url || '').includes('/auth/login')
    ) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(
        new CustomEvent('authExpired')
      );
    }

    return Promise.reject(
      new Error(message)
    );
  }
);

export { TOKEN_KEY, baseURL };
export default api;
