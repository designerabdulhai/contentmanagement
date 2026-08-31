import axios from 'axios';

// Use the live Cloudflare Worker directly so the List page does not wait on
// the Vercel proxy before showing the existing post data.
const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';
const baseURL = `${WORKER_URL}/api`;
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

function toMessage(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object') {
    if (typeof value.error === 'string') return value.error;
    if (typeof value.message === 'string') return value.message;
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const url = String(error.config?.url || '');

    if (!error.response) {
      return Promise.reject(
        new Error(`Failed to reach API: ${error.message || 'network error'}`)
      );
    }

    const message =
      toMessage(error.response.data) ||
      error.message ||
      `Request failed (${status})`;

    if (status === 401 && !url.includes('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new CustomEvent('authExpired'));
    }

    return Promise.reject(new Error(message));
  }
);

export { TOKEN_KEY, baseURL };
export default api;
