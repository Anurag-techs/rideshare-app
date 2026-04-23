/**
 * public/js/growth.js — WhatsApp Sharing, Onboarding, Analytics, Driver Tools
 *
 * Globally available via window.Growth
 */
const Growth = (() => {
  const APP_URL = window.location.origin;

  // ── Analytics event tracking ──────────────────────────────────────────────
  function track(event, meta = {}) {
    try {
      const user = API.getUser?.();
      apiFetch('/api/analytics/event', {
        method: 'POST',
        body: JSON.stringify({ event, user_id: user?.id || null, meta }),
      }).catch(() => {});
    } catch (_) {}
  }

  // ── WhatsApp deep-link helpers ────────────────────────────────────────────
  function whatsapp(text) {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  function shareRide(ride) {
    const price = ride.price_per_seat > 0 ? `₹${ride.price_per_seat}/seat` : 'FREE';
    const date  = new Date(ride.departure_time).toLocaleString('en-IN', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
    const text =
      `🚗 *Ride Available on RideShare!*\n\n` +
      `📍 From: ${ride.from_location}\n` +
      `📍 To:   ${ride.to_location}\n` +
      `🕐 When: ${date}\n` +
      `💰 Price: ${price}\n` +
      `💺 Seats: ${ride.available_seats} left\n\n` +
      `Book now 👇\n${APP_URL}/#/ride/${ride.id}\n\n` +
      `_RideShare — Smarter Carpooling in India_ 🌿`;
    whatsapp(text);
  }

  // ── Driver pitch copy ─────────────────────────────────────────────────────
  function copyDriverPitch() {
    const text =
      `🚗 *Earn Extra Income with RideShare!*\n\n` +
      `If you drive to work or travel frequently, you can *earn ₹500–₹2000/day* by offering seats in your car.\n\n` +
      `✅ Free to list rides\n` +
      `✅ Payments via UPI — instant to wallet\n` +
      `✅ You set your own price\n` +
      `✅ Withdraw anytime\n\n` +
      `Join now → ${APP_URL}/#/signup\n\n` +
      `_RideShare — Drive. Earn. Repeat._ 💰`;
    navigator.clipboard.writeText(text)
      .then(() => App.showToast('✅ Pitch message copied! Paste on WhatsApp.', 'success'))
      .catch(() => App.showToast('Could not copy — try again.', 'error'));
  }

  // ── Earnings estimator ────────────────────────────────────────────────────
  function estimateEarnings(distanceKm = 30, seatsOffered = 2, daysPerWeek = 5) {
    const pricePerKm    = 2.5;   // avg ₹2.5/km
    const commissionPct = 0.12;
    const perTrip       = distanceKm * pricePerKm * seatsOffered;
    const netPerTrip    = perTrip * (1 - commissionPct);
    const perDay        = netPerTrip * 2; // round trip
    const perMonth      = perDay * daysPerWeek * 4.3;
    return {
      per_trip:  Math.round(perTrip),
      per_day:   Math.round(perDay),
      per_month: Math.round(perMonth),
    };
  }

  // ── Onboarding modal ──────────────────────────────────────────────────────
  function showOnboarding(user) {
    if (localStorage.getItem('onboarding_done')) return;
    const modal = document.getElementById('onboardingModal');
    if (!modal) return;
    modal.classList.remove('hidden');

    document.getElementById('onboardingCloseBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      localStorage.setItem('onboarding_done', '1');
    });
  }

  // ── Notification bell ─────────────────────────────────────────────────────
  async function loadNotifBell() {
    const badge = document.getElementById('notifBadge');
    if (!badge || !API.getToken?.()) return;
    try {
      const data = await API.get('/growth/notifications');
      const count = data.unread || 0;
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = count > 0 ? 'flex' : 'none';
    } catch (_) {}
  }

  async function showNotifPanel() {
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    panel.classList.toggle('hidden');
    try {
      const data = await API.get('/growth/notifications');
      const notifs = data.notifications || [];
      const list   = document.getElementById('notifList');
      if (!list) return;
      if (!notifs.length) {
        list.innerHTML = '<div class="text-muted" style="padding:16px;font-size:0.85rem;">No notifications yet.</div>';
        return;
      }
      const typeIcon = { success: '✅', warning: '⚠️', error: '❌', info: 'ℹ️' };
      list.innerHTML = notifs.map(n => `
        <div style="padding:12px 16px;border-bottom:1px solid var(--border-color);${n.is_read ? 'opacity:0.6' : ''}">
          <div style="font-weight:600;font-size:0.85rem;">${typeIcon[n.type] || 'ℹ️'} ${n.title}</div>
          <div class="text-secondary" style="font-size:0.78rem;margin-top:2px;">${n.message}</div>
          <div class="text-muted" style="font-size:0.7rem;margin-top:4px;">${new Date(n.created_at).toLocaleString('en-IN')}</div>
        </div>`).join('');
      // Mark all read
      API.post('/growth/notifications/read', {}).catch(() => {});
      document.getElementById('notifBadge').style.display = 'none';
    } catch (_) {}
  }

  // ── Public platform stats (live counters) ─────────────────────────────────
  async function loadPlatformStats() {
    try {
      const data = await apiFetch('/api/analytics/platform-stats').then(r => r.json());
      const set  = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      if (data.success) {
        set('liveTotalUsers',    data.total_users.toLocaleString('en-IN'));
        set('liveTotalRides',    data.total_rides.toLocaleString('en-IN'));
        set('liveTotalBookings', data.total_bookings.toLocaleString('en-IN'));
        set('liveDriverEarnings','₹' + (data.total_driver_earnings || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
      }
    } catch (_) {}
  }

  // ── Real-time Activity Feed ───────────────────────────────────────────────
  async function loadActivityFeed() {
    try {
      const data = await apiFetch('/api/analytics/feed').then(r => r.json());
      if (data.success && data.feed && data.feed.length > 0) {
        let i = 0;
        setInterval(() => {
          // Only show on home/search pages to not annoy user during checkout
          const hash = window.location.hash;
          if (hash !== '' && hash !== '#/' && hash !== '#/find') return;
          
          const item = data.feed[i % data.feed.length];
          const name = item.passenger_name.split(' ')[0];
          const from = item.from_location.split(',')[0];
          const to   = item.to_location.split(',')[0];
          
          if (window.App && App.showToast) {
            App.showToast(`✨ ${name} just booked a ride: ${from} → ${to}`, 'info', 4000);
          }
          i++;
        }, 15000); // show one every 15s
      }
    } catch (_) {}
  }

  return { track, shareRide, copyDriverPitch, estimateEarnings,
           showOnboarding, loadNotifBell, showNotifPanel, loadPlatformStats, loadActivityFeed };
})();
