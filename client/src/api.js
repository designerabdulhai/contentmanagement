import axios from 'axios';

// Production requests go directly to the Cloudflare Worker. This removes the
// extra Vercel serverless-proxy hop that was making the first data request
// noticeably slow. The Worker already supports CORS for browser requests.
const baseURL = import.meta.env.VITE_API_BASE_URL || 'https://contentmanagement-api.rubel-bhd1.workers.dev/api';
const TOKEN_KEY = 'content_schedule_auth_token';

const api = axios.create({
  baseURL,
  timeout: 10000,
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
    if (typeof value.message === 'string' && value.message.trim()) return value.message.trim();
    if (typeof value.error === 'string' && value.error.trim()) return value.error.trim();
    if (value.error && typeof value.error.message === 'string' && value.error.message.trim()) return value.error.message.trim();
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
