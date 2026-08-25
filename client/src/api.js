import axios from 'axios';

// Production Cloudflare Worker API.
// Keep this explicit so an old/misconfigured Vercel VITE_API_URL
// cannot redirect authentication requests to the wrong backend.
const baseURL = 'https://contentmanagement-api.rubel-bhd1.workers.dev/api';

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
          'Network Error: cannot reach Cloudflare API. Please check the Worker deployment and CORS settings.'
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
          'Login API not found. Please deploy the latest Cloudflare Worker.'
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
