import axios from 'axios';

// Normal API traffic stays on the same-origin Vercel proxy.
// Post deletion is routed directly to the live Cloudflare Worker because
// the Vercel rewrite layer was returning `not found` for the delete action.
const baseURL = '/api';
const WORKER_URL = 'https://contentmanagement-api.rubel-bhd1.workers.dev';
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

  // The live Worker already supports DELETE /api/posts/:id. Bypass only
  // the problematic Vercel rewrite for the delete button; all other API
  // requests continue to use the existing same-origin proxy.
  const url = String(config.url || '');
  const deleteMatch = url.match(/^\/posts\/(\d+)\/delete$/);
  if (config.method?.toLowerCase() === 'post' && deleteMatch) {
    config.baseURL = WORKER_URL;
    config.method = 'delete';
    config.url = `/api/posts/${deleteMatch[1]}`;
    delete config.data;
    if (config.headers) delete config.headers['Content-Type'];
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
