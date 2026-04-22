// API helper module
const API = {
  base: '/api',
  getToken()  { return localStorage.getItem('rs_token'); },
  setToken(t) { localStorage.setItem('rs_token', t); },
  removeToken() { localStorage.removeItem('rs_token'); },
  getUser()   { try { const u = localStorage.getItem('rs_user'); return u ? JSON.parse(u) : null; } catch { return null; } },
  setUser(u)  { localStorage.setItem('rs_user', JSON.stringify(u)); },
  removeUser() { localStorage.removeItem('rs_user'); },
  isLoggedIn() { return !!this.getToken(); },

  async request(endpoint, options = {}) {
    const url = `${this.base}${endpoint}`;
    const headers = { ...options.headers };
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      console.warn('[API] No token set — request to', endpoint, 'will be unauthenticated');
    }

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    console.debug('[API]', options.method || 'GET', endpoint);

    let res, data;
    try {
      res  = await fetch(url, { ...options, headers });
      data = await res.json();
    } catch (networkErr) {
      console.error('[API] Network / parse error on', endpoint, networkErr);
      throw new Error('Network error — could not reach the server. Is it running?');
    }

    console.debug('[API] Response', res.status, endpoint, data);

    if (!res.ok) {
      if (res.status === 401) {
        console.warn('[API] 401 on', endpoint, '— clearing credentials and redirecting to login');
        this.removeToken();
        this.removeUser();
        // Only redirect if not already on the login/signup page
        const hash = window.location.hash;
        if (!hash.includes('#/login') && !hash.includes('#/signup')) {
          window.location.hash = '#/login';
        }
      }
      throw new Error(data.error || `Request failed (${res.status})`);
    }

    return data;
  },

  get(endpoint)          { return this.request(endpoint); },
  post(endpoint, body)   { return this.request(endpoint, { method: 'POST',   body: JSON.stringify(body) }); },
  put(endpoint, body)    { return this.request(endpoint, { method: 'PUT',    body: JSON.stringify(body) }); },
  delete(endpoint)       { return this.request(endpoint, { method: 'DELETE' }); },
  upload(endpoint, formData) { return this.request(endpoint, { method: 'POST', body: formData }); },
};
