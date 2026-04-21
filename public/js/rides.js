// rides.js — Razorpay + AI chat + Smart sort
const Rides = {
  mapInstance: null,
  fromMarker: null,
  toMarker: null,
  clickMode: 'from',
  _currentRides: [],
  _currentSort: 'balanced',

  init() {
    document.getElementById('searchForm')?.addEventListener('submit', e => { e.preventDefault(); this.search(); });
    document.getElementById('createRideForm')?.addEventListener('submit', e => { e.preventDefault(); this.create(); });
    this.initPaymentModal();
    this.initAIChat();
    this.initSortPills();
    this.initCommissionPreview();
  },

  // ── Commission Preview on Offer Ride ──────────────────────────────────────
  initCommissionPreview() {
    const priceInput = document.getElementById('ridePrice');
    const seatsInput = document.getElementById('rideSeats');
    if (!priceInput) return;
    const update = () => {
      const price = parseFloat(priceInput.value) || 0;
      const preview = document.getElementById('commissionPreview');
      if (price <= 0) { preview.style.display = 'none'; return; }
      const comm  = parseFloat((price * 0.10).toFixed(2));
      const earn  = parseFloat((price - comm).toFixed(2));
      document.getElementById('cpTotal').textContent = `₹${price}`;
      document.getElementById('cpComm').textContent  = `₹${comm}`;
      document.getElementById('cpEarn').textContent  = `₹${earn}`;
      preview.style.display = 'block';
    };
    priceInput.addEventListener('input', update);
    seatsInput?.addEventListener('input', update);
  },

  // ── Smart Sort Pills ──────────────────────────────────────────────────────
  initSortPills() {
    document.querySelectorAll('.sort-pill').forEach(btn => {
      btn.addEventListener('click', async () => {
        document.querySelectorAll('.sort-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentSort = btn.dataset.sort;
        if (this._currentRides.length > 0) await this.applySortAndRender(this._currentRides);
      });
    });
  },

  async applySortAndRender(rides) {
    if (!rides.length) { this.renderRides([]); return; }
    try {
      const data = await API.post('/ai/sort', { rides, preference: this._currentSort });
      this.renderRides(data.rides);
    } catch { this.renderRides(rides); }
  },

  // ── AI Chat ───────────────────────────────────────────────────────────────
  initAIChat() {
    const sendBtn = document.getElementById('aiChatSend');
    const input   = document.getElementById('aiChatInput');
    if (!sendBtn) return;
    sendBtn.addEventListener('click', () => this.sendAIMessage());
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') this.sendAIMessage(); });
  },

  async sendAIMessage() {
    const input = document.getElementById('aiChatInput');
    const msg   = input?.value?.trim();
    if (!msg) return;
    input.value = '';
    this.appendAIMsg(msg, 'user');
    const typing = this.appendAIMsg('...', 'bot');
    try {
      const res = await API.post('/ai/chat', { message: msg });
      typing.remove();
      this.appendAIMsg(res.reply || 'Here are your results!', 'bot');
      // Apply filters
      const f = res.filters || {};
      if (f.from) document.getElementById('searchFrom').value = f.from;
      if (f.to)   document.getElementById('searchTo').value   = f.to;
      if (f.date) document.getElementById('searchDate').value = f.date;
      if (f.max_price) document.getElementById('searchMaxPrice').value = f.max_price;
      if (f.sort) document.getElementById('searchSort').value = f.sort;
      await this.search();
    } catch (err) {
      typing.remove();
      this.appendAIMsg('Sorry, could not process that. Try searching manually.', 'bot');
    }
  },

  appendAIMsg(text, type) {
    const box = document.getElementById('aiMessages');
    if (!box) return { remove: () => {} };
    const div = document.createElement('div');
    div.className = `ai-msg ai-msg-${type}`;
    div.innerHTML = type === 'bot'
      ? `<span class="ai-msg-avatar">🤖</span><div class="ai-msg-bubble">${this.esc(text)}</div>`
      : `<div class="ai-msg-bubble ai-msg-user-bubble">${this.esc(text)}</div>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  },

  // ── Create Ride Map ───────────────────────────────────────────────────────
  initCreateMap() {
    this.fromMarker = null; this.toMarker = null; this.clickMode = 'from';
    const step = document.getElementById('mapStep');
    if (step) step.textContent = '📍 Click on the map to set your pickup location';
    setTimeout(() => {
      this.mapInstance = Maps.create('createRideMap', { center: [20.5937, 78.9629], zoom: 5 });
      if (!this.mapInstance) return;
      this.mapInstance.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        const name = await Maps.reverseGeocode(lat, lng);
        if (this.clickMode === 'from') {
          if (this.fromMarker) this.mapInstance.removeLayer(this.fromMarker);
          this.fromMarker = Maps.addMarker(this.mapInstance, lat, lng, '📍 Pickup: ' + name, 'blue');
          document.getElementById('rideFrom').value    = name;
          document.getElementById('rideFromLat').value = lat;
          document.getElementById('rideFromLng').value = lng;
          this.clickMode = 'to';
          if (step) step.textContent = '📍 Now click on the map to set your destination';
        } else {
          if (this.toMarker) this.mapInstance.removeLayer(this.toMarker);
          this.toMarker = Maps.addMarker(this.mapInstance, lat, lng, '🏁 Destination: ' + name, 'cyan');
          document.getElementById('rideTo').value    = name;
          document.getElementById('rideToLat').value = lat;
          document.getElementById('rideToLng').value = lng;
          this.clickMode = 'from';
          if (step) step.textContent = '✅ Route set! Click again to change pickup';
          const fromLat = parseFloat(document.getElementById('rideFromLat').value);
          const fromLng = parseFloat(document.getElementById('rideFromLng').value);
          if (fromLat && fromLng) Maps.drawRoute(this.mapInstance, [fromLat, fromLng], [lat, lng]);
        }
      });
    }, 300);
    const dt = document.getElementById('rideDate');
    if (dt) {
      const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dt.min = now.toISOString().slice(0, 16);
      const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9,0,0,0);
      d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
      dt.value = d.toISOString().slice(0, 16);
    }
  },

  async create() {
    const btn = document.querySelector('#createRideForm button[type="submit"]');
    try {
      Auth.setLoading(btn, true);
      const body = {
        from_location:  document.getElementById('rideFrom').value,
        to_location:    document.getElementById('rideTo').value,
        from_lat:       parseFloat(document.getElementById('rideFromLat').value) || null,
        from_lng:       parseFloat(document.getElementById('rideFromLng').value) || null,
        to_lat:         parseFloat(document.getElementById('rideToLat').value)   || null,
        to_lng:         parseFloat(document.getElementById('rideToLng').value)   || null,
        departure_time: document.getElementById('rideDate').value,
        total_seats:    parseInt(document.getElementById('rideSeats').value),
        available_seats:parseInt(document.getElementById('rideSeats').value),
        price_per_seat: parseFloat(document.getElementById('ridePrice').value) || 0,
        car_name:       document.getElementById('rideCar').value,
        notes:          document.getElementById('rideNotes').value,
      };
      await API.post('/rides', body);
      App.showToast('Ride posted successfully!', 'success');
      document.getElementById('createRideForm').reset();
      document.getElementById('commissionPreview').style.display = 'none';
      window.location.hash = '#/dashboard';
    } catch (err) { App.showToast(err.message, 'error'); }
    finally { Auth.setLoading(btn, false); }
  },

  async search() {
    const from     = document.getElementById('searchFrom').value;
    const to       = document.getElementById('searchTo').value;
    const date     = document.getElementById('searchDate').value;
    const sort     = document.getElementById('searchSort').value;
    const maxPrice = document.getElementById('searchMaxPrice').value;

    let qs = `?sort=${sort}`;
    if (from)     qs += `&from=${encodeURIComponent(from)}`;
    if (to)       qs += `&to=${encodeURIComponent(to)}`;
    if (date)     qs += `&date=${date}`;
    if (maxPrice) qs += `&max_price=${maxPrice}`;

    try {
      const data = await API.get(`/rides/search${qs}`);
      this._currentRides = data.rides || [];
      await this.applySortAndRender(this._currentRides);
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  renderRides(rides) {
    const grid = document.getElementById('ridesGrid');
    if (!rides || !rides.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🚫</div><h3>No rides found</h3><p>Try different search criteria or check back later</p></div>`;
      return;
    }
    grid.innerHTML = rides.map(r => this.rideCardHTML(r)).join('');
    grid.querySelectorAll('.ride-card').forEach(card => {
      card.addEventListener('click', () => { window.location.hash = `#/ride/${card.dataset.id}`; });
    });
  },

  rideCardHTML(r) {
    const date     = new Date(r.departure_time);
    const dateStr  = date.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    const timeStr  = date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    const priceStr = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
    const priceClass  = r.price_per_seat > 0 ? '' : 'free';
    const seatsClass  = r.available_seats <= 1 ? 'low' : '';
    const driverInit  = r.driver_name?.charAt(0).toUpperCase() || 'D';
    const ratingStr   = r.driver_rating > 0 ? `⭐ ${r.driver_rating}` : '';
    const aiScore     = r._aiScore !== undefined ? `<span class="ai-score-badge">AI ${r._aiScore}%</span>` : '';

    return `
      <div class="ride-card" data-id="${r.id}">
        <div class="ride-route"><span class="route-dot"></span><span class="route-text">${this.esc(r.from_location)}</span></div>
        <div class="ride-route"><span class="route-dot dest"></span><span class="route-text">${this.esc(r.to_location)}</span></div>
        <div class="ride-meta">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
          <span class="seats-badge ${seatsClass}">💺 ${r.available_seats} seat${r.available_seats!==1?'s':''}</span>
          ${(r.car_name||r.car_model)?`<span>🚗 ${this.esc(r.car_name||r.car_model)}</span>`:''}
          ${aiScore}
        </div>
        <div class="ride-bottom">
          <span class="ride-price ${priceClass}">${priceStr}</span>
          <div class="ride-driver">
            <div class="ride-driver-avatar">${r.driver_photo?`<img src="${r.driver_photo}" alt="">`:driverInit}</div>
            <div class="ride-driver-info">
              <div class="name">${this.esc(r.driver_name)}</div>
              <div class="rating">${ratingStr}</div>
            </div>
          </div>
        </div>
      </div>`;
  },

  async loadDetail(id) {
    const container = document.getElementById('rideDetailContent');
    try {
      const data   = await API.get(`/rides/${id}`);
      const r      = data.ride;
      const bookings = data.bookings || [];
      const date   = new Date(r.departure_time);
      const dateStr= date.toLocaleDateString('en-IN',{ weekday:'long', day:'numeric', month:'long', year:'numeric' });
      const timeStr= date.toLocaleTimeString('en-IN',{ hour:'2-digit', minute:'2-digit' });
      const priceStr = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
      const isOwner       = API.getUser()?.id === r.driver_id;
      const isLoggedIn    = API.isLoggedIn();
      const alreadyBooked = bookings.some(b => b.passenger_id === API.getUser()?.id && b.status !== 'cancelled');

      container.innerHTML = `
        <div class="ride-detail">
          <div class="ride-detail-header glass-card">
            <div class="ride-detail-route">
              <div class="route-point"><div class="label">From</div><div class="value">📍 ${this.esc(r.from_location)}</div></div>
              <div class="route-arrow">→</div>
              <div class="route-point"><div class="label">To</div><div class="value">🏁 ${this.esc(r.to_location)}</div></div>
            </div>
            <div class="ride-detail-info">
              <div class="info-item"><div class="info-icon">📅</div><div class="info-label">Date</div><div class="info-value">${dateStr}</div></div>
              <div class="info-item"><div class="info-icon">🕐</div><div class="info-label">Time</div><div class="info-value">${timeStr}</div></div>
              <div class="info-item"><div class="info-icon">💺</div><div class="info-label">Seats Left</div><div class="info-value">${r.available_seats} / ${r.total_seats}</div></div>
              <div class="info-item"><div class="info-icon">💰</div><div class="info-label">Price/Seat</div><div class="info-value">${priceStr}</div></div>
              ${(r.car_name||r.car_model)?`<div class="info-item"><div class="info-icon">🚗</div><div class="info-label">Car</div><div class="info-value">${this.esc(r.car_name||r.car_model)}</div></div>`:''}
            </div>
            ${r.notes?`<div style="padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:8px;margin:16px 0;color:var(--text-secondary);font-size:0.9rem;">📝 ${this.esc(r.notes)}</div>`:''}
            ${(r.from_lat&&r.to_lat)?'<div id="detailMap" class="ride-detail-map"></div>':''}
            <div style="display:flex;align-items:center;gap:12px;padding:16px 0;border-top:1px solid var(--glass-border);margin-top:16px;">
              <div class="ride-driver-avatar" style="width:48px;height:48px;font-size:1.2rem;">${r.driver_photo?`<img src="${r.driver_photo}" alt="">`:r.driver_name?.charAt(0).toUpperCase()}</div>
              <div>
                <div style="font-weight:600;">${this.esc(r.driver_name)}</div>
                <div style="font-size:0.85rem;color:var(--text-secondary);">${r.driver_rating>0?`⭐ ${r.driver_rating} (${r.driver_total_ratings} reviews)`:'New driver'}</div>
                ${r.driver_phone?`<div style="font-size:0.85rem;color:var(--text-muted);">📞 ${r.driver_phone}</div>`:''}
              </div>
            </div>
            <div class="ride-detail-actions">
              ${!isOwner&&isLoggedIn&&!alreadyBooked&&r.available_seats>0&&r.status==='active'?`<button class="btn btn-primary btn-lg" id="bookRideBtn" data-ride="${r.id}">🎫 Book This Ride</button>`:''}
              ${alreadyBooked?'<span class="seats-badge" style="font-size:1rem;padding:10px 20px;">✅ Already Booked</span>':''}
              ${!isLoggedIn?'<a href="#/login" class="btn btn-primary btn-lg">Log in to Book</a>':''}
              ${isOwner?`<button class="btn btn-danger" id="cancelRideBtn" data-ride="${r.id}">Cancel Ride</button>`:''}
            </div>
          </div>
          ${isOwner&&bookings.length>0?`
            <div class="glass-card" style="margin-top:24px;">
              <h3 style="margin-bottom:16px;">Passengers (${bookings.length})</h3>
              ${bookings.map(b=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--glass-border);">
                <span>${this.esc(b.passenger_name)} (${b.seats_booked} seat${b.seats_booked>1?'s':''})</span>
                <span class="seats-badge">${b.payment_status||b.status}</span>
              </div>`).join('')}
            </div>`:''}
        </div>`;

      document.getElementById('bookRideBtn')?.addEventListener('click', () => this.bookRide(r.id));
      document.getElementById('cancelRideBtn')?.addEventListener('click', () => this.cancelRide(r.id));

      if (r.from_lat && r.to_lat) {
        setTimeout(() => {
          const midLat = (r.from_lat + r.to_lat) / 2;
          const midLng = (r.from_lng + r.to_lng) / 2;
          const map = Maps.create('detailMap', { center: [midLat, midLng], zoom: 8 });
          if (map) {
            Maps.addMarker(map, r.from_lat, r.from_lng, '📍 '+r.from_location, 'blue');
            Maps.addMarker(map, r.to_lat, r.to_lng, '🏁 '+r.to_location, 'cyan');
            Maps.drawRoute(map, [r.from_lat, r.from_lng], [r.to_lat, r.to_lng]);
          }
        }, 400);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><h3>Ride not found</h3></div>`;
    }
  },

  // ── Open payment modal ────────────────────────────────────────────────────
  async bookRide(rideId) {
    try {
      const data = await API.get(`/rides/${rideId}`);
      const r    = data.ride;

      document.getElementById('payFrom').textContent        = r.from_location;
      document.getElementById('payTo').textContent          = r.to_location;
      document.getElementById('payRideId').value            = r.id;
      document.getElementById('payMaxSeats').value          = r.available_seats;
      document.getElementById('payPriceValue').value        = r.price_per_seat;
      document.getElementById('seatCount').textContent      = '1';
      document.getElementById('payPricePerSeat').textContent = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
      this._updatePayTotal();

      const isFree = r.price_per_seat <= 0;
      document.getElementById('freeRideNotice').classList.toggle('hidden', !isFree);
      document.getElementById('upiSection').classList.toggle('hidden', isFree);
      document.getElementById('confirmPaymentBtn').querySelector('.btn-text').textContent
        = isFree ? '🎫 Confirm Free Booking' : '💳 Pay with UPI / Card';

      document.getElementById('paymentModal').classList.remove('hidden');
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  _updatePayTotal() {
    const seats = parseInt(document.getElementById('seatCount').textContent) || 1;
    const price = parseFloat(document.getElementById('payPriceValue').value)  || 0;
    const total = seats * price;
    const comm  = parseFloat((total * 0.10).toFixed(2));
    document.getElementById('payCommission').textContent = total > 0 ? `₹${comm}` : '₹0';
    document.getElementById('payTotal').textContent      = total > 0 ? `₹${total}` : 'Free';
  },

  // ─────────────────────────────────────────────────────────────────────────
  // _processPayment()
  //
  // CORRECT FLOW:
  //   1. Validate → 2. Create Razorpay order (backend)
  //   3. Open Razorpay checkout popup
  //   4. User pays → Razorpay calls handler()
  //   5. handler() sends all 3 IDs to /payments/verify (backend)
  //   6. Backend verifies HMAC signature → creates booking atomically
  //   7. ONLY on success → show toast + reload ride
  //
  // Booking is NEVER created before step 6.
  // ─────────────────────────────────────────────────────────────────────────
  async _processPayment() {
    const btn    = document.getElementById('confirmPaymentBtn');
    const rideId = parseInt(document.getElementById('payRideId').value);
    const seats  = parseInt(document.getElementById('seatCount').textContent) || 1;
    const price  = parseFloat(document.getElementById('payPriceValue').value) || 0;
    const isFree = price <= 0;

    // Prevent double-clicks — disable button immediately
    btn.disabled = true;
    Auth.setLoading(btn, true);

    // Keep a stable reference to `this` for use inside Razorpay callbacks
    const _self = this;

    try {
      // ── FREE RIDE ─────────────────────────────────────────────────────────
      if (isFree) {
        console.log('BOOKING AFTER PAYMENT: Free ride (no payment required)');
        await API.post('/payments/book-free', { ride_id: rideId, seats });
        document.getElementById('paymentModal').classList.add('hidden');
        App.showToast('🎉 Free ride booked successfully!', 'success');
        _self.loadDetail(rideId);
        return;
      }

      // ── STEP 1: Create Razorpay order on the backend ──────────────────────
      // Backend validates ride, checks availability, returns order_id
      // NO booking is created yet at this point.
      const order = await API.post('/payments/create-order', { ride_id: rideId, seats });

      // ── MOCK MODE (no real Razorpay keys) ─────────────────────────────────
      if (order.mock) {
        // In mock mode, skip Razorpay popup and call verify directly
        // Backend verify creates the booking atomically
        console.log('BOOKING AFTER PAYMENT: Mock mode payment verification');
        await API.post('/payments/verify', {
          ride_id:             rideId,
          seats,
          razorpay_order_id:   order.order_id,
          razorpay_payment_id: 'mock_pay_' + Date.now(),
          razorpay_signature:  'mock_sig',
        });
        document.getElementById('paymentModal').classList.add('hidden');
        App.showToast('✅ Mock payment — Ride booked!', 'success');
        _self.loadDetail(rideId);
        return;
      }

      // ── STEP 2: Open Razorpay Standard Checkout ───────────────────────────
      // Release button ONLY so Razorpay modal can be dismissed/interacted with.
      // We re-disable it inside the handler before making verify call.
      Auth.setLoading(btn, false);
      btn.disabled = false;

      const user = API.getUser();

      await new Promise((resolve, reject) => {
        const rzpOptions = {
          key:         order.key_id,
          amount:      order.amount,        // in paise — e.g. 50000 for ₹500
          currency:    order.currency || 'INR',
          order_id:    order.order_id,
          name:        'RideShare',
          description: `${order.ride_from || ''} → ${order.ride_to || ''}`,
          prefill: {
            name:  user?.name  || '',
            email: user?.email || '',
          },
          theme: { color: '#6366f1' },

          // ── STEP 3: Payment success handler ──────────────────────────────
          // Razorpay calls this ONLY after the user's bank confirms payment.
          // response contains: razorpay_payment_id, razorpay_order_id, razorpay_signature
          handler: async function (response) {
            // Re-disable button immediately to prevent duplicate verify calls
            btn.disabled = true;
            Auth.setLoading(btn, true);

            try {
              // ── STEP 4: Verify signature + CREATE BOOKING on backend ──────
              // Backend:
              //   a) Recomputes HMAC-SHA256(order_id|payment_id, KEY_SECRET)
              //   b) Compares with razorpay_signature — rejects if mismatch
              //   c) Only if valid → INSERT booking + INSERT payment (atomic transaction)
              //   d) Deducts available seats
              console.log('BOOKING AFTER PAYMENT: Real Razorpay payment verified, creating booking');
              await API.post('/payments/verify', {
                ride_id:             rideId,
                seats,
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
              });

              // ── STEP 5: Booking confirmed — update UI ─────────────────────
              document.getElementById('paymentModal').classList.add('hidden');
              App.showToast('💳 Payment verified — Ride booked! 🎉', 'success');
              _self.loadDetail(rideId);
              resolve();

            } catch (verifyErr) {
              // Signature mismatch or server error — booking was NOT created
              App.showToast(
                '❌ Payment verification failed: ' + (verifyErr.message || 'Please contact support.'),
                'error'
              );
              reject(verifyErr);
            } finally {
              Auth.setLoading(btn, false);
              btn.disabled = false;
            }
          },

          // ── Payment failure event (card declined, network issue, etc.) ────
          // Note: Razorpay also calls handler with a failed response in some flows.
          // This catches explicit payment.failed events.

          modal: {
            // User closed the Razorpay popup without paying
            ondismiss: () => {
              Auth.setLoading(btn, false);
              btn.disabled = false;
              App.showToast('Payment cancelled. No booking was made.', 'info');
              resolve(); // resolve (not reject) so the outer try/catch doesn't fire an extra toast
            }
          }
        };

        const rzpInstance = new Razorpay(rzpOptions);

        // Handle explicit payment failure event (card declined, etc.)
        rzpInstance.on('payment.failed', (failedResponse) => {
          Auth.setLoading(btn, false);
          btn.disabled = false;
          const reason = failedResponse?.error?.description || 'Payment failed. Please try again.';
          App.showToast('❌ ' + reason, 'error');
          resolve(); // resolve so Promise doesn't hang
        });

        rzpInstance.open();
      });

    } catch (err) {
      // Catch errors from create-order or unexpected failures
      App.showToast(err.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      // Always restore button state as a safety net
      Auth.setLoading(btn, false);
      btn.disabled = false;
    }
  },

  // ── Payment modal events ─────────────────────────────────────────────────
  initPaymentModal() {
    document.getElementById('closePaymentModal')?.addEventListener('click', () => {
      document.getElementById('paymentModal').classList.add('hidden');
    });
    document.getElementById('seatPlus')?.addEventListener('click', () => {
      const el  = document.getElementById('seatCount');
      const max = parseInt(document.getElementById('payMaxSeats').value) || 1;
      let val   = parseInt(el.textContent) || 1;
      if (val < max) { el.textContent = val + 1; this._updatePayTotal(); }
    });
    document.getElementById('seatMinus')?.addEventListener('click', () => {
      const el  = document.getElementById('seatCount');
      let val   = parseInt(el.textContent) || 1;
      if (val > 1) { el.textContent = val - 1; this._updatePayTotal(); }
    });
    document.getElementById('confirmPaymentBtn')?.addEventListener('click', () => this._processPayment());
    document.getElementById('paymentModal')?.addEventListener('click', e => {
      if (e.target.id === 'paymentModal') document.getElementById('paymentModal').classList.add('hidden');
    });
  },

  async cancelRide(rideId) {
    if (!confirm('Cancel this ride? All bookings will be cancelled.')) return;
    try {
      await API.delete(`/rides/${rideId}`);
      App.showToast('Ride cancelled', 'info');
      window.location.hash = '#/dashboard';
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  async loadAllRides() {
    try {
      const data = await API.get('/rides/search?sort=time_asc');
      this._currentRides = data.rides || [];
      await this.applySortAndRender(this._currentRides);
    } catch { }
  },

  async loadAISuggestions() {
    if (!API.isLoggedIn()) return;
    try {
      const data   = document.getElementById('aiSuggestSection');
      const grid   = document.getElementById('aiSuggestGrid');
      const res    = await API.get('/ai/suggest');
      if (res.rides && res.rides.length > 0) {
        grid.innerHTML = res.rides.map(r => this.rideCardHTML(r)).join('');
        grid.querySelectorAll('.ride-card').forEach(card => {
          card.addEventListener('click', () => { window.location.hash = `#/ride/${card.dataset.id}`; });
        });
        data?.classList.remove('hidden');
      }
    } catch { }
  },

  esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
};
