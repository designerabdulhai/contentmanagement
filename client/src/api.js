import axios from 'axios';

// Use the Vercel same-origin /api proxy. Vercel forwards /api/*
// to the Cloudflare Worker, avoiding browser CORS/network issues.
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
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;

    if (!error.response) {
      return Promise.reject(
        new Error(
          'Network Error: API proxy is unavailable. Please redeploy the Vercel project.'
        )
      );
    }

    const message =
      error.response?.data?.error ||
      error.message ||
      'Request failed';

    if (
      status === 404 &&
      String(error.config?.url || '').includes('/auth/login')
    ) {
      return Promise.reject(
        new Error(
          'Login API not found. Please redeploy the latest Vercel project.'
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
