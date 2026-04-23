// API helper module
const API = {
  base: '/api',
  getToken()   { return localStorage.getItem('token'); },
  setToken(t)  { localStorage.setItem('token', t); },
  removeToken(){ localStorage.removeItem('token'); },
  getUser()    { try { const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null; } catch { return null; } },
  setUser(u)   { localStorage.setItem('user', JSON.stringify(u)); },
  removeUser() { localStorage.removeItem('user'); },
  isLoggedIn() { return !!this.getToken(); },

  // Clear session and redirect to login
  _logout() {
    console.warn('[API] Session expired — clearing credentials');
    this.removeToken();
    this.removeUser();
    const hash = window.location.hash;
    if (!hash.includes('#/login') && !hash.includes('#/signup')) {
      window.location.hash = '#/login';
    }
  },

  async request(endpoint, options = {}) {
    const url = `${this.base}${endpoint}`;
    const headers = { ...options.headers };
    const token = this.getToken();

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Always declare charset=utf-8 so ₹ and other Unicode renders correctly
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
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
        // Only kill the session if the token itself is bad.
        // Don't log out on every 401 — some endpoints return 401 for other reasons.
        const isAuthEndpoint = endpoint.startsWith('/auth/');
        const isTokenError   = data?.error?.toLowerCase().includes('token') ||
                               data?.error?.toLowerCase().includes('log in') ||
                               data?.error?.toLowerCase().includes('expired') ||
                               data?.error?.toLowerCase().includes('unauthorized');

        if (isAuthEndpoint || isTokenError) {
          this._logout();
        } else {
          console.warn('[API] 401 on', endpoint, '— not clearing session (not a token error)');
        }
      }
      throw new Error(data?.error || `Request failed (${res.status})`);
    }

    return data;
  },

  get(endpoint)              { return this.request(endpoint); },
  post(endpoint, body)       { return this.request(endpoint, { method: 'POST',   body: JSON.stringify(body) }); },
  put(endpoint, body)        { return this.request(endpoint, { method: 'PUT',    body: JSON.stringify(body) }); },
  delete(endpoint)           { return this.request(endpoint, { method: 'DELETE' }); },
  upload(endpoint, formData) { return this.request(endpoint, { method: 'POST', body: formData }); },
};

window.apiFetch = async (url, options = {}) => {
  const token = localStorage.getItem('token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? 'Bearer ' + token : '',
      ...(options.headers || {})
    }
  });
};
