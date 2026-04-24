// Auth module
const Auth = {
  init() {
    const loginForm = document.getElementById('loginForm');
    const signupForm = document.getElementById('signupForm');
    const profileForm = document.getElementById('profileForm');
    const logoutBtn = document.getElementById('logoutBtn');
    const photoInput = document.getElementById('profilePhotoInput');

    if (loginForm) loginForm.addEventListener('submit', e => { e.preventDefault(); this.login(); });
    if (signupForm) signupForm.addEventListener('submit', e => { e.preventDefault(); this.signup(); });
    if (profileForm) profileForm.addEventListener('submit', e => { e.preventDefault(); this.updateProfile(); });
    if (logoutBtn) logoutBtn.addEventListener('click', e => { e.preventDefault(); this.logout(); });
    if (photoInput) photoInput.addEventListener('change', e => this.uploadPhoto(e));
  },

  async login() {
    const btn      = document.getElementById('loginSubmit');
    const email    = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    try {
      this.setLoading(btn, true);
      const data = await API.post('/auth/login', { email, password });
      API.setToken(data.token);
      API.setUser(data.user);
      App.updateNav();
      Growth.track('login');
      Growth.loadNotifBell();
      App.showToast('Welcome back! 👋', 'success');
      window.location.hash = '#/dashboard';
    } catch (err) {
      App.showToast(err.message, 'error');
    } finally { this.setLoading(btn, false); }
  },

  async signup() {
    const btn      = document.getElementById('signupSubmit');
    const name     = document.getElementById('signupName').value;
    const email    = document.getElementById('signupEmail').value;
    const phone    = document.getElementById('signupPhone').value;
    const password = document.getElementById('signupPassword').value;
    try {
      this.setLoading(btn, true);
      const data = await API.post('/auth/signup', { name, email, phone, password });
      API.setToken(data.token);
      API.setUser(data.user);
      App.updateNav();
      Growth.track('signup', {});
      Growth.loadNotifBell();
      App.showToast('🎉 Welcome to RideShare!', 'success');
      window.location.hash = '#/dashboard';
      // Show onboarding modal after short delay
      setTimeout(() => Growth.showOnboarding(data.user), 600);
    } catch (err) {
      App.showToast(err.message, 'error');
    } finally { this.setLoading(btn, false); }
  },

  logout() {
    API.removeToken();
    API.removeUser();
    App.updateNav();
    App.showToast('Logged out', 'info');
    window.location.hash = '#/';
  },

  async loadProfile() {
    try {
      const data = await API.get('/auth/me');
      const u = data.user;
      document.getElementById('profileName').value = u.name || '';
      document.getElementById('profileEmail').value = u.email || '';
      document.getElementById('profilePhone').value = u.phone || '';
      const avatar = document.getElementById('profileAvatar');
      if (u.profile_photo) {
        avatar.innerHTML = `<img src="${u.profile_photo}" alt="Profile">`;
      } else {
        document.getElementById('profileInitial').textContent = u.name?.charAt(0).toUpperCase() || 'U';
      }
      if (u.created_at) {
        const joinDate = new Date(u.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const dateEl = document.getElementById('profileJoinDate');
        if (dateEl) dateEl.innerHTML = `Joined ${joinDate} <span style="color:var(--success);margin-left:4px;">✓ Verified</span>`;
      }
      this.loadRatings(u.id); const pointsEl = document.getElementById('profilePoints'); if (pointsEl) pointsEl.textContent = (u.loyalty_points || 0) + ' Points';
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async updateProfile() {
    try {
      const body = {
        name: document.getElementById('profileName').value,
        email: document.getElementById('profileEmail').value,
        phone: document.getElementById('profilePhone').value,
      };
      const data = await API.put('/auth/profile', body);
      API.setUser(data.user);
      App.updateNav();
      App.showToast('Profile updated!', 'success');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async uploadPhoto(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const fd = new FormData();
      fd.append('photo', file);
      const data = await API.upload('/auth/upload-photo', fd);
      const avatar = document.getElementById('profileAvatar');
      avatar.innerHTML = `<img src="${data.profile_photo}" alt="Profile">`;
      const user = API.getUser();
      user.profile_photo = data.profile_photo;
      API.setUser(user);
      App.updateNav();
      App.showToast('Photo updated!', 'success');
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async loadRatings(userId) {
    try {
      const data = await API.get(`/ratings/user/${userId}`);
      const container = document.getElementById('profileRatings');
      if (!data.ratings.length) {
        container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:20px;">No ratings yet</p>';
        return;
      }
      container.innerHTML = `
        <div style="text-align:center;margin-bottom:16px;">
          <span style="font-size:2rem;font-weight:800;color:var(--warning);">${data.avg_rating}</span>
          <span style="color:var(--text-muted);"> / 5</span>
          <p style="color:var(--text-secondary);font-size:0.85rem;">${data.total_ratings} rating(s)</p>
        </div>
        ${data.ratings.map(r => `
          <div style="padding:12px;border-bottom:1px solid var(--glass-border);">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <strong>${r.from_name}</strong>
              <span style="color:var(--warning);">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
            </div>
            ${r.comment ? `<p style="font-size:0.85rem;color:var(--text-secondary);">${r.comment}</p>` : ''}
          </div>
        `).join('')}
      `;
    } catch { }
  },

  setLoading(btn, loading) {
    if (!btn) return;
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (loading) { btn.disabled = true; if(text) text.classList.add('hidden'); if(loader) loader.classList.remove('hidden'); }
    else { btn.disabled = false; if(text) text.classList.remove('hidden'); if(loader) loader.classList.add('hidden'); }
  }
};
