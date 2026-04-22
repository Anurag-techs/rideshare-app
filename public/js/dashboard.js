// Dashboard module
const Dashboard = {
  async load() {
    // â”€â”€ Step 1: Fetch fresh user data first â€” bail out if auth fails â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let user;
    try {
      const userData = await API.get('/auth/me');
      user = userData.user;
      // Sync cached user with fresh DB data
      if (user) API.setUser(user);
    } catch (authErr) {
      console.error('[Dashboard] /auth/me failed:', authErr.message);
      // If it's a 401/auth error, API.request already redirected to login.
      // For other errors (404, 500), show a helpful message.
      App.showToast('Could not load your profile. Please log in again.', 'error');
      window.location.hash = '#/login';
      return;
    }

    // â”€â”€ Step 2: Fetch remaining data (don't let one failure kill the rest) â”€â”€â”€
    let rides = [], bookings = [], payments = [];
    try {
      const [driverData, bookingData, paymentData] = await Promise.all([
        API.get('/rides/my/driver'),
        API.get('/bookings/my'),
        API.get('/payments/my').catch(() => ({ payments: [] }))
      ]);
      rides    = driverData.rides    || [];
      bookings = bookingData.bookings || [];
      payments = paymentData.payments || [];
    } catch (err) {
      console.error('[Dashboard] Failed to load dashboard data:', err.message);
      App.showToast('Some data failed to load â€” showing what we have.', 'error');
    }

    // â”€â”€ Step 3: Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const now = new Date();
    const upcomingRides    = rides.filter(r => new Date(r.departure_time) > now && r.status === 'active').length;
    const upcomingBookings = bookings.filter(b => new Date(b.departure_time) > now && b.status !== 'cancelled').length;
    const totalEarned      = payments.reduce((sum, p) => sum + (p.driver_earning || 0), 0);

    const safeSet = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    safeSet('statPosted',   rides.length);
    safeSet('statBooked',   bookings.length);
    safeSet('statUpcoming', upcomingRides + upcomingBookings);
    safeSet('statEarnings', totalEarned > 0 ? `â‚¹${totalEarned.toFixed(0)}` : 'â‚¹0');
    safeSet('statRating',   user?.avg_rating > 0 ? `${user.avg_rating} â­` : '-');

    // â”€â”€ Step 4: Driver rides â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const driverEl = document.getElementById('driverRides');
    if (driverEl) {
      if (!rides.length) {
        driverEl.innerHTML = '<div class="empty-state"><div class="empty-icon">ðŸš—</div><h3>No rides posted</h3><p><a href="#/create">Post your first ride!</a></p></div>';
      } else {
        driverEl.innerHTML = rides.map(r => {
          const date = new Date(r.departure_time);
          const dateStr = date.toLocaleDateString('en-IN', {day:'numeric',month:'short'});
          const timeStr = date.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
          const statusColors = {active:'var(--success)',completed:'var(--text-muted)',cancelled:'var(--error)'};
          return `<div class="ride-card" style="cursor:pointer;" onclick="location.hash='#/ride/${r.id}'">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px;">
              <div>
                <div class="ride-route"><span class="route-dot"></span><span class="route-text">${Rides.esc(r.from_location)}</span></div>
                <div class="ride-route" style="margin-top:8px;"><span class="route-dot dest"></span><span class="route-text">${Rides.esc(r.to_location)}</span></div>
              </div>
              <div style="text-align:right;">
                <span style="color:${statusColors[r.status]};font-weight:600;text-transform:capitalize;">${r.status}</span>
                <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">ðŸ“… ${dateStr} ðŸ• ${timeStr}</div>
              </div>
            </div>
            <div class="ride-meta" style="margin-top:12px;">
              <span>ðŸ’º ${r.available_seats}/${r.total_seats} seats left</span>
              <span>ðŸ‘¥ ${r.booking_count || 0} booking(s)</span>
              <span>ðŸ’° ${r.price_per_seat > 0 ? 'â‚¹'+r.price_per_seat : 'Free'}</span>
            </div>
          </div>`;
        }).join('');
      }
    }

    // â”€â”€ Step 5: Passenger bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const passEl = document.getElementById('passengerBookings');
    if (passEl) {
      if (!bookings.length) {
        passEl.innerHTML = '<div class="empty-state"><div class="empty-icon">ðŸŽ«</div><h3>No bookings yet</h3><p><a href="#/find">Find a ride!</a></p></div>';
      } else {
        passEl.innerHTML = bookings.map(b => {
          const date = new Date(b.departure_time);
          const dateStr = date.toLocaleDateString('en-IN', {day:'numeric',month:'short'});
          const timeStr = date.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
          const canRate   = b.status === 'confirmed' && new Date(b.departure_time) < now;
          const canCancel = b.status !== 'cancelled' && new Date(b.departure_time) > now;
          return `<div class="ride-card">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px;">
              <div>
                <div class="ride-route"><span class="route-dot"></span><span class="route-text">${Rides.esc(b.from_location)}</span></div>
                <div class="ride-route" style="margin-top:8px;"><span class="route-dot dest"></span><span class="route-text">${Rides.esc(b.to_location)}</span></div>
              </div>
              <span class="seats-badge ${b.status==='cancelled'?'full':''} ">${b.status}</span>
            </div>
            <div class="ride-meta" style="margin-top:12px;">
              <span>ðŸ“… ${dateStr} ðŸ• ${timeStr}</span>
              <span>ðŸ§‘â€âœˆï¸ ${Rides.esc(b.driver_name)}</span>
              <span>ðŸ’° ${b.price_per_seat > 0 ? 'â‚¹'+b.price_per_seat : 'Free'}</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              ${canCancel ? `<button class="btn btn-ghost btn-sm cancel-booking-btn" data-id="${b.id}">Cancel</button>` : ''}
              ${canRate   ? `<button class="btn btn-ghost btn-sm rate-btn" data-ride="${b.ride_id}" data-user="${b.driver_id}">â­ Rate Driver</button>` : ''}
            </div>
          </div>`;
        }).join('');

        passEl.querySelectorAll('.cancel-booking-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Cancel this booking?')) return;
            try {
              await API.put(`/bookings/${btn.dataset.id}/cancel`);
              App.showToast('Booking cancelled', 'info');
              this.load();
            } catch (err) { App.showToast(err.message, 'error'); }
          });
        });

        passEl.querySelectorAll('.rate-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('ratingRideId').value = btn.dataset.ride;
            document.getElementById('ratingUserId').value = btn.dataset.user;
            document.getElementById('ratingModal').classList.remove('hidden');
          });
        });
      }
    }

    // â”€â”€ Step 6: Payments tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const paymentsEl = document.getElementById('paymentsList');
    if (paymentsEl) {
      if (!payments.length) {
        paymentsEl.innerHTML = '<div class="empty-state"><div class="empty-icon">ðŸ’³</div><h3>No payments yet</h3><p>Book a paid ride to see payments here.</p></div>';
      } else {
        paymentsEl.innerHTML = payments.map(p => {
          const date        = new Date(p.created_at);
          const dateStr     = date.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
          const statusColor = p.status === 'paid' ? 'var(--success)' : p.status === 'failed' ? 'var(--error)' : 'var(--warning)';
          return `<div class="ride-card">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px;">
              <div>
                <div class="ride-route"><span class="route-dot"></span><span class="route-text">${Rides.esc(p.from_location)}</span></div>
                <div class="ride-route" style="margin-top:8px;"><span class="route-dot dest"></span><span class="route-text">${Rides.esc(p.to_location)}</span></div>
              </div>
              <span style="color:${statusColor};font-weight:600;text-transform:capitalize;">${p.status}</span>
            </div>
            <div class="ride-meta" style="margin-top:12px;">
              <span>ðŸ“… ${dateStr}</span>
              <span>ðŸ’° Total: â‚¹${p.amount}</span>
              <span style="color:var(--warning);">ðŸ¦ Fee: â‚¹${p.commission_amount||0}</span>
              <span>ðŸ’º ${p.seats_booked} seat(s)</span>
            </div>
            ${p.razorpay_payment_id ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">ID: ${p.razorpay_payment_id}</div>` : ''}
          </div>`;
        }).join('');
      }
    }
    // ── Step 7: Wallet + Earnings tab ────────────────────────────────────────
    await this.loadEarnings();
    this._initWalletEvents();
  },

  // ── Earnings + Wallet helpers ──────────────────────────────────────────────
  async loadEarnings() {
    try {
      const [summary, balData, wdData, chartData] = await Promise.all([
        API.get('/earnings/summary').catch(() => ({ summary: {} })),
        API.get('/wallet/balance').catch(() => ({ balance: 0 })),
        API.get('/wallet/withdrawals').catch(() => ({ withdrawals: [] })),
        API.get('/earnings/chart').catch(() => ({ chart: [] })),
      ]);

      const s = summary.summary || {};

      // ── Earnings summary cards ────────────────────────────────────────────
      const se = id => { const el = document.getElementById(id); if (el) return el; return { textContent: '' }; };
      se('earnTotalEarned').textContent    = `₹${(s.total_earned       || 0).toFixed(2)}`;
      se('earnWalletBal').textContent      = `₹${(balData.balance      || 0).toFixed(2)}`;
      se('earnWithdrawn').textContent      = `₹${(s.total_withdrawn    || 0).toFixed(2)}`;
      se('earnPending').textContent        = `₹${(s.pending_withdrawal || 0).toFixed(2)}`;
      se('earnRidesDriven').textContent    = s.rides_driven    || 0;
      se('earnPaidBookings').textContent   = s.paid_bookings   || 0;

      // ── Balance display (wallet tab) ──────────────────────────────────────
      const balEl = document.getElementById('walletBalanceDisplay');
      if (balEl) balEl.textContent = `₹${(balData.balance || 0).toFixed(2)}`;

      // ── Weekly chart ──────────────────────────────────────────────────────
      const chartEl = document.getElementById('earningsChart');
      if (chartEl) {
        const chart = chartData.chart || [];
        const max   = Math.max(...chart.map(c => c.earned), 1);
        chartEl.innerHTML = chart.length ? `
          <div style="display:flex;align-items:flex-end;gap:6px;height:80px;padding-top:4px;">
            ${chart.map(c => {
              const pct = Math.round((c.earned / max) * 100);
              return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                <div style="font-size:0.62rem;color:var(--text-muted);">₹${c.earned.toFixed(0)}</div>
                <div style="width:100%;background:var(--primary);border-radius:4px 4px 0 0;height:${Math.max(pct, 2)}%;opacity:0.85;transition:height .3s;"></div>
                <div style="font-size:0.6rem;color:var(--text-muted);">W${c.week.split('-')[1]}</div>
              </div>`;
            }).join('')}
          </div>` : '<div style="color:var(--text-muted);font-size:0.85rem;">No earnings data yet.</div>';
      }

      // ── Withdrawals list ──────────────────────────────────────────────────
      const listEl = document.getElementById('withdrawalsList');
      if (listEl) {
        const wds = wdData.withdrawals || [];
        if (!wds.length) {
          listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">💸</div><h3>No withdrawals yet</h3><p>Submit your first withdrawal request when you have earnings.</p></div>';
        } else {
          const statusColor = { pending: 'var(--warning)', paid: 'var(--success)', rejected: 'var(--error)' };
          listEl.innerHTML = wds.map(w => {
            const date = new Date(w.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
            return `<div class="ride-card">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <div>
                  <div style="font-weight:700;font-size:1.05rem;">₹${w.amount.toFixed(2)}</div>
                  ${w.upi_id ? `<div style="font-size:0.8rem;color:var(--text-muted);">UPI: ${Rides.esc(w.upi_id)}</div>` : ''}
                  ${w.payment_method ? `<div style="font-size:0.78rem;color:var(--text-muted);">via ${w.payment_method} ${w.payment_ref ? '• ' + w.payment_ref : ''}</div>` : ''}
                  <div style="font-size:0.78rem;color:var(--text-muted);">📅 ${date}</div>
                </div>
                <span class="seats-badge" style="color:${statusColor[w.status] || 'var(--text-secondary)'};">${w.status.toUpperCase()}</span>
              </div>
              ${w.note ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-top:6px;">📝 ${Rides.esc(w.note)}</div>` : ''}
            </div>`;
          }).join('');
        }
      }
    } catch (err) {
      console.error('[Dashboard] Earnings load error:', err.message);
    }
  },

  _initWalletEvents() {
    const openBtn   = document.getElementById('openWithdrawBtn');
    const form      = document.getElementById('withdrawForm');
    const cancelBtn = document.getElementById('cancelWithdrawBtn');
    const submitBtn = document.getElementById('submitWithdrawBtn');

    openBtn?.addEventListener('click', () => {
      form?.classList.remove('hidden');
      document.getElementById('withdrawAmount')?.focus();
    });

    cancelBtn?.addEventListener('click', () => {
      form?.classList.add('hidden');
      document.getElementById('withdrawAmount').value = '';
      document.getElementById('withdrawUpi').value    = '';
    });

    submitBtn?.addEventListener('click', async () => {
      const amount = parseFloat(document.getElementById('withdrawAmount').value);
      const upiId  = document.getElementById('withdrawUpi').value.trim();

      if (!amount || isNaN(amount) || amount < 10) {
        App.showToast('Enter a valid amount (minimum ₹10).', 'error');
        return;
      }

      Auth.setLoading(submitBtn, true);
      try {
        const res = await API.post('/wallet/withdraw', { amount, upi_id: upiId });
        App.showToast(res.message || '✅ Withdrawal request submitted!', 'success');
        form?.classList.add('hidden');
        document.getElementById('withdrawAmount').value = '';
        document.getElementById('withdrawUpi').value    = '';
        await this.loadWallet(); // refresh balance + history
      } catch (err) {
        App.showToast('❌ ' + err.message, 'error');
      } finally {
        Auth.setLoading(submitBtn, false);
      }
    });
  },
};

// Cars module
const Cars = {
  async load() {
    try {
      const data = await API.get('/cars');
      const list = document.getElementById('carsList');
      if (!data.cars.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">ðŸš™</div><h3>No cars added yet</h3></div>';
      } else {
        list.innerHTML = data.cars.map(c => `
          <div class="car-card glass-card">
            <div class="car-card-icon">ðŸš—</div>
            <div class="car-card-info">
              <h4>${Rides.esc(c.model)}</h4>
              <p>${c.total_seats} seats ${c.color?'â€¢ '+c.color:''} ${c.license_plate?'â€¢ '+c.license_plate:''}</p>
            </div>
            <div class="car-card-actions">
              <button class="btn btn-ghost btn-sm delete-car-btn" data-id="${c.id}">ðŸ—‘ï¸</button>
            </div>
          </div>
        `).join('');
        list.querySelectorAll('.delete-car-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!confirm('Remove this car?')) return;
            try { await API.delete(`/cars/${btn.dataset.id}`); App.showToast('Car removed', 'info'); this.load(); }
            catch (err) { App.showToast(err.message, 'error'); }
          });
        });
      }
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  init() {
    document.getElementById('addCarForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await API.post('/cars', {
          model: document.getElementById('carModel').value,
          total_seats: parseInt(document.getElementById('carSeats').value),
          license_plate: document.getElementById('carPlate').value,
          color: document.getElementById('carColor').value,
        });
        App.showToast('Car added!', 'success');
        document.getElementById('addCarForm').reset();
        this.load();
      } catch (err) { App.showToast(err.message, 'error'); }
    });
  }
};
