// API helper module
const API = {
  base: '/api',
  getToken() { return localStorage.getItem('rs_token'); },
  setToken(t) { localStorage.setItem('rs_token', t); },
  removeToken() { localStorage.removeItem('rs_token'); },
  getUser() { const u = localStorage.getItem('rs_user'); return u ? JSON.parse(u) : null; },
  setUser(u) { localStorage.setItem('rs_user', JSON.stringify(u)); },
  removeUser() { localStorage.removeItem('rs_user'); },
  isLoggedIn() { return !!this.getToken(); },

  async request(endpoint, options = {}) {
    const url = `${this.base}${endpoint}`;
    const headers = { ...options.headers };
    const token = this.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) { this.removeToken(); this.removeUser(); }
        throw new Error(data.error || 'Request failed');
      }
      return data;
    } catch (err) {
      throw err;
    }
  },

  get(endpoint) { return this.request(endpoint); },
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); },
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); },
  delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); },
  upload(endpoint, formData) { return this.request(endpoint, { method: 'POST', body: formData }); },
};
