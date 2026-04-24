// Main App — Router & Initialization
const App = {
  init() {
    Auth.init();
    Rides.init();
    Cars.init();
    this.initRouter();
    this.initNav();
    this.initThemeToggle();
    this.initRatingModal();
    this.updateNav();
    this.animateStats();
    if (window.lucide) {
      lucide.createIcons();
    }
    // Growth: load notification bell if logged in
    if (API.isLoggedIn()) Growth.loadNotifBell();
    // Growth: load real platform stats on landing
    Growth.loadPlatformStats();
    // Growth: start live activity ticker
    Growth.loadActivityFeed();
  },

  // --- SPA Router ---
  initRouter() {
    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  route() {
    const hash = window.location.hash || '#/';
    const parts = hash.replace('#/', '').split('/');
    const page = parts[0] || 'home';
    const param = parts[1] || null;

    // Auth guards
    const authPages = ['create', 'dashboard', 'profile', 'cars'];
    if (authPages.includes(page)) {
      const token = localStorage.getItem("token");
      if (!token) {
        this.showToast('Please log in first', 'error');
        window.location.hash = '#/login';
        return;
      }
    }
    // Redirect if logged in
    if (['login', 'signup'].includes(page) && API.isLoggedIn()) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Hide all pages, show target
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    let targetId = `page-${page}`;
    if (page === 'ride') targetId = 'page-ride-detail';

    const target = document.getElementById(targetId);
    if (target) {
      target.classList.add('active');
    } else {
      document.getElementById('page-home').classList.add('active');
    }

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');

    // Close mobile nav
    document.getElementById('navLinks')?.classList.remove('open');

    // Page-specific init
    switch (page) {
      case 'find':
        Rides.loadAllRides();
        Growth.track('page_view', { page: 'find' });
        break;
      case 'home':
        this.animateStats();
        Growth.loadPlatformStats();
        break;
      case 'create':    Rides.initCreateMap(); break;
      case 'dashboard': Dashboard.load(); break;
      case 'profile':   Auth.loadProfile(); break;
      case 'cars':      Cars.load(); break;
      case 'ride':      if (param) Rides.loadDetail(param); break;
      default:          this.animateStats(); Growth.loadPlatformStats(); break;
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (window.lucide) {
      setTimeout(() => lucide.createIcons(), 50);
    }
  },

  // --- Navigation ---
  initNav() {
    const toggle = document.getElementById('navToggle');
    const links = document.getElementById('navLinks');
    
    toggle?.addEventListener('click', () => {
      const isOpen = links?.classList.toggle('open');
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', () => {
        links?.classList.remove('open');
        document.body.style.overflow = '';
      });
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.user-menu')) {
        document.getElementById('userDropdown')?.classList.remove('show');
      }
      // Close notification panel on outside click
      if (!e.target.closest('#notifPanel') && !e.target.closest('button[aria-label="Notifications"]')) {
        document.getElementById('notifPanel')?.classList.add('hidden');
      }
    });
    document.getElementById('userAvatar')?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('userDropdown')?.classList.toggle('show');
    });
  },

  initThemeToggle() {
    const toggle = document.getElementById("themeToggle");
    if (!toggle) return;

    const updateThemeIcon = () => {
      const current = document.documentElement.getAttribute("data-theme");
      toggle.textContent = current === "dark" ? "☀️" : "🌙";
    };
    updateThemeIcon();

    toggle.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";

      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("theme", newTheme);

      updateThemeIcon();
    });
  },

  updateNav() {
    const isAuth = API.isLoggedIn();
    document.querySelectorAll('.auth-only').forEach(el => el.style.display = isAuth ? '' : 'none');
    document.querySelectorAll('.guest-only').forEach(el => el.style.display = isAuth ? 'none' : '');

    if (isAuth) {
      const user = API.getUser();
      if (user) {
        const avatar = document.getElementById('userAvatar');
        const initial = document.getElementById('userInitial');
        if (user.profile_photo) {
          avatar.innerHTML = `<img src="${user.profile_photo}" alt="${user.name}">`;
        } else if (initial) {
          initial.textContent = user.name?.charAt(0).toUpperCase() || 'U';
        }
      }
    }
  },

  // --- Toast ---
  showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    // Supported types: success, error, info, warning
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  },

  // --- Rating Modal ---
  initRatingModal() {
    const modal = document.getElementById('ratingModal');
    const stars = document.querySelectorAll('#starRating .star');
    let selectedRating = 0;

    stars.forEach(star => {
      star.addEventListener('click', () => {
        selectedRating = parseInt(star.dataset.value);
        stars.forEach(s => {
          s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating);
        });
      });
      star.addEventListener('mouseenter', () => {
        const val = parseInt(star.dataset.value);
        stars.forEach(s => {
          s.classList.toggle('active', parseInt(s.dataset.value) <= val);
        });
      });
    });

    document.getElementById('starRating')?.addEventListener('mouseleave', () => {
      stars.forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.value) <= selectedRating);
      });
    });

    document.getElementById('closeRatingModal')?.addEventListener('click', () => modal?.classList.add('hidden'));
    modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

    document.getElementById('submitRating')?.addEventListener('click', async () => {
      if (!selectedRating) { this.showToast('Please select a rating', 'error'); return; }
      try {
        await API.post('/ratings', {
          ride_id: parseInt(document.getElementById('ratingRideId').value),
          to_user_id: parseInt(document.getElementById('ratingUserId').value),
          rating: selectedRating,
          comment: document.getElementById('ratingComment').value,
        });
        this.showToast('Rating submitted!', 'success');
        modal.classList.add('hidden');
        selectedRating = 0;
        stars.forEach(s => s.classList.remove('active'));
        document.getElementById('ratingComment').value = '';
        Dashboard.load();
      } catch (err) { this.showToast(err.message, 'error'); }
    });
  },

  // --- Animated Counters ---
  animateStats() {
    document.querySelectorAll('.stat-number[data-count]').forEach(el => {
      const target = parseInt(el.dataset.count);
      let current = 0;
      const step = Math.ceil(target / 60);
      const timer = setInterval(() => {
        current += step;
        if (current >= target) { current = target; clearInterval(timer); }
        el.textContent = current.toLocaleString();
      }, 30);
    });
  },

  // --- Dashboard Tabs ---
  initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        document.getElementById('driverTab').classList.toggle('hidden',   tab !== 'driver');
        document.getElementById('passengerTab').classList.toggle('hidden', tab !== 'passenger');
        const paymentsTabEl = document.getElementById('paymentsTab');
        if (paymentsTabEl) paymentsTabEl.classList.toggle('hidden', tab !== 'payments');
      });
    });
  }
};

// Boot
document.addEventListener('DOMContentLoaded', () => {
  App.init();
  Chat.init();
  App.initTabs();
});


// ── Chat Logic ──────────────────────────────────────────────────────────────
const Chat = {
  chatInterval: null,
  
  async open(bookingId) {
    document.getElementById('chatBookingId').value = bookingId;
    document.getElementById('chatModal').classList.remove('hidden');
    document.getElementById('chatMessages').innerHTML = '<div style="text-align:center;">Loading...</div>';
    await this.loadMessages();
    
    if (this.chatInterval) clearInterval(this.chatInterval);
    this.chatInterval = setInterval(() => this.loadMessages(), 5000);
  },
  
  close() {
    document.getElementById('chatModal').classList.add('hidden');
    if (this.chatInterval) clearInterval(this.chatInterval);
  },
  
  async loadMessages() {
    try {
      const bookingId = document.getElementById('chatBookingId').value;
      if (!bookingId) return;
      const data = await API.get('/messages/' + bookingId);
      const user = API.getUser();
      
      const container = document.getElementById('chatMessages');
      if (data.messages.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);margin-top:20px;">No messages yet. Start coordinating!</div>';
        return;
      }
      
      container.innerHTML = data.messages.map(m => {
        const isMe = m.sender_id && m.sender_id._id === user.id;
        const senderName = m.sender_id ? m.sender_id.name.split(' ')[0] : 'User';
        return `<div style="display:flex; justify-content:${isMe ? 'flex-end' : 'flex-start'};">
          <div style="background:${isMe ? '#dcf8c6' : '#ffffff'}; color:#000; padding:8px 12px; border-radius:12px; max-width:85%; font-size:0.9rem; box-shadow:0 1px 2px rgba(0,0,0,0.1);">
            ${!isMe ? `<div style="font-weight:700; font-size:0.75rem; color:var(--primary); margin-bottom:2px;">${Rides.esc(senderName)}</div>` : ''}
            <div>${Rides.esc(m.message)}</div>
          </div>
        </div>`;
      }).join('');
      
      // Auto scroll to bottom only if not manually scrolled up
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
        container.scrollTop = container.scrollHeight;
      }
    } catch (err) {}
  },
  
  async send() {
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    
    const bookingId = document.getElementById('chatBookingId').value;
    input.value = '';
    
    try {
      await API.post('/messages/' + bookingId, { message: msg });
      await this.loadMessages();
      const container = document.getElementById('chatMessages');
      container.scrollTop = container.scrollHeight;
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },
  
  init() {
    document.getElementById('closeChatModal')?.addEventListener('click', () => this.close());
    document.getElementById('sendChatBtn')?.addEventListener('click', () => this.send());
    document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.send();
    });
  }
};

window.Chat = Chat;
