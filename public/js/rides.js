// Rides module — Leaflet.js integration
const Rides = {
  mapInstance: null,
  fromMarker: null,
  toMarker: null,
  clickMode: 'from', // 'from' or 'to'

  init() {
    document.getElementById('searchForm')?.addEventListener('submit', e => { e.preventDefault(); this.search(); });
    document.getElementById('createRideForm')?.addEventListener('submit', e => { e.preventDefault(); this.create(); });
    this.initPaymentModal();
  },

  /**
   * Initialize the Create Ride page map
   */
  initCreateMap() {
    this.fromMarker = null;
    this.toMarker = null;
    this.clickMode = 'from';
    const step = document.getElementById('mapStep');
    if (step) step.textContent = '📍 Click on the map to set your pickup location';

    setTimeout(() => {
      this.mapInstance = Maps.create('createRideMap', { center: [20.5937, 78.9629], zoom: 5 });
      if (!this.mapInstance) return;

      // Handle map clicks to set pickup / destination
      this.mapInstance.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        const name = await Maps.reverseGeocode(lat, lng);

        if (this.clickMode === 'from') {
          // Remove old start marker
          if (this.fromMarker) this.mapInstance.removeLayer(this.fromMarker);
          this.fromMarker = Maps.addMarker(this.mapInstance, lat, lng, '📍 Pickup: ' + name, 'blue');

          document.getElementById('rideFrom').value = name;
          document.getElementById('rideFromLat').value = lat;
          document.getElementById('rideFromLng').value = lng;

          this.clickMode = 'to';
          if (step) step.textContent = '📍 Now click on the map to set your destination';
        } else {
          // Remove old end marker
          if (this.toMarker) this.mapInstance.removeLayer(this.toMarker);
          this.toMarker = Maps.addMarker(this.mapInstance, lat, lng, '🏁 Destination: ' + name, 'cyan');

          document.getElementById('rideTo').value = name;
          document.getElementById('rideToLat').value = lat;
          document.getElementById('rideToLng').value = lng;

          this.clickMode = 'from';
          if (step) step.textContent = '✅ Route set! Click again to change pickup';

          // Draw route line between the two points
          const fromLat = parseFloat(document.getElementById('rideFromLat').value);
          const fromLng = parseFloat(document.getElementById('rideFromLng').value);
          if (fromLat && fromLng) {
            Maps.drawRoute(this.mapInstance, [fromLat, fromLng], [lat, lng]);
          }
        }
      });
    }, 300);

    // Set min datetime to now, and default to 7 days from now at 9am
    const dt = document.getElementById('rideDate');
    if (dt) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      dt.min = now.toISOString().slice(0, 16);
      // Default to 7 days from now at 09:00
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 7);
      defaultDate.setHours(9, 0, 0, 0);
      defaultDate.setMinutes(defaultDate.getMinutes() - defaultDate.getTimezoneOffset());
      dt.value = defaultDate.toISOString().slice(0, 16);
    }
  },

  async create() {
    const btn = document.querySelector('#createRideForm button[type="submit"]');
    try {
      Auth.setLoading(btn, true);
      const body = {
        from_location: document.getElementById('rideFrom').value,
        to_location: document.getElementById('rideTo').value,
        from_lat: parseFloat(document.getElementById('rideFromLat').value) || null,
        from_lng: parseFloat(document.getElementById('rideFromLng').value) || null,
        to_lat: parseFloat(document.getElementById('rideToLat').value) || null,
        to_lng: parseFloat(document.getElementById('rideToLng').value) || null,
        departure_time: document.getElementById('rideDate').value,
        total_seats: parseInt(document.getElementById('rideSeats').value),
        available_seats: parseInt(document.getElementById('rideSeats').value),
        price_per_seat: parseFloat(document.getElementById('ridePrice').value) || 0,
        car_name: document.getElementById('rideCar').value,
        notes: document.getElementById('rideNotes').value,
      };
      await API.post('/rides', body);
      App.showToast('Ride posted successfully!', 'success');
      document.getElementById('createRideForm').reset();
      window.location.hash = '#/dashboard';
    } catch (err) { App.showToast(err.message, 'error'); }
    finally { Auth.setLoading(btn, false); }
  },

  async search() {
    const from = document.getElementById('searchFrom').value;
    const to = document.getElementById('searchTo').value;
    const date = document.getElementById('searchDate').value;
    const sort = document.getElementById('searchSort').value;
    const maxPrice = document.getElementById('searchMaxPrice').value;

    let qs = `?sort=${sort}`;
    if (from) qs += `&from=${encodeURIComponent(from)}`;
    if (to) qs += `&to=${encodeURIComponent(to)}`;
    if (date) qs += `&date=${date}`;
    if (maxPrice) qs += `&max_price=${maxPrice}`;

    try {
      const data = await API.get(`/rides/search${qs}`);
      this.renderRides(data.rides);
    } catch (err) { App.showToast(err.message, 'error'); }
  },

  renderRides(rides) {
    const grid = document.getElementById('ridesGrid');
    if (!rides.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🚫</div><h3>No rides found</h3><p>Try different search criteria or check back later</p></div>`;
      return;
    }
    grid.innerHTML = rides.map(r => this.rideCardHTML(r)).join('');
    grid.querySelectorAll('.ride-card').forEach(card => {
      card.addEventListener('click', () => { window.location.hash = `#/ride/${card.dataset.id}`; });
    });
  },

  rideCardHTML(r) {
    const date = new Date(r.departure_time);
    const dateStr = date.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    const timeStr = date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    const priceStr = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
    const priceClass = r.price_per_seat > 0 ? '' : 'free';
    const seatsClass = r.available_seats <= 1 ? 'low' : '';
    const driverInitial = r.driver_name?.charAt(0).toUpperCase() || 'D';
    const ratingStr = r.driver_rating > 0 ? `⭐ ${r.driver_rating}` : '';

    return `
      <div class="ride-card" data-id="${r.id}">
        <div class="ride-route">
          <span class="route-dot"></span>
          <span class="route-text">${this.esc(r.from_location)}</span>
        </div>
        <div class="ride-route">
          <span class="route-dot dest"></span>
          <span class="route-text">${this.esc(r.to_location)}</span>
        </div>
        <div class="ride-meta">
          <span>📅 ${dateStr}</span>
          <span>🕐 ${timeStr}</span>
          <span class="seats-badge ${seatsClass}">💺 ${r.available_seats} seat${r.available_seats!==1?'s':''}</span>
          ${(r.car_name || r.car_model) ? `<span>🚗 ${this.esc(r.car_name || r.car_model)}</span>` : ''}
        </div>
        <div class="ride-bottom">
          <span class="ride-price ${priceClass}">${priceStr}</span>
          <div class="ride-driver">
            <div class="ride-driver-avatar">${r.driver_photo ? `<img src="${r.driver_photo}" alt="">` : driverInitial}</div>
            <div class="ride-driver-info">
              <div class="name">${this.esc(r.driver_name)}</div>
              <div class="rating">${ratingStr}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  async loadDetail(id) {
    const container = document.getElementById('rideDetailContent');
    try {
      const data = await API.get(`/rides/${id}`);
      const r = data.ride;
      const bookings = data.bookings || [];
      const date = new Date(r.departure_time);
      const dateStr = date.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
      const timeStr = date.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
      const priceStr = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
      const isOwner = API.getUser()?.id === r.driver_id;
      const isLoggedIn = API.isLoggedIn();
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
              ${(r.car_name || r.car_model) ? `<div class="info-item"><div class="info-icon">🚗</div><div class="info-label">Car</div><div class="info-value">${this.esc(r.car_name || r.car_model)}</div></div>` : ''}
            </div>
            ${r.notes ? `<div style="padding:12px 16px;background:rgba(255,255,255,0.04);border-radius:8px;margin:16px 0;color:var(--text-secondary);font-size:0.9rem;">📝 ${this.esc(r.notes)}</div>` : ''}
            ${(r.from_lat && r.to_lat) ? '<div id="detailMap" class="ride-detail-map"></div>' : ''}
            <div style="display:flex;align-items:center;gap:12px;padding:16px 0;border-top:1px solid var(--glass-border);margin-top:16px;">
              <div class="ride-driver-avatar" style="width:48px;height:48px;font-size:1.2rem;">${r.driver_photo ? `<img src="${r.driver_photo}" alt="">` : r.driver_name?.charAt(0).toUpperCase()}</div>
              <div><div style="font-weight:600;">${this.esc(r.driver_name)}</div>
              <div style="font-size:0.85rem;color:var(--text-secondary);">${r.driver_rating > 0 ? `⭐ ${r.driver_rating} (${r.driver_total_ratings} reviews)` : 'New driver'}</div>
              ${r.driver_phone ? `<div style="font-size:0.85rem;color:var(--text-muted);">📞 ${r.driver_phone}</div>` : ''}</div>
            </div>
            <div class="ride-detail-actions">
              ${!isOwner && isLoggedIn && !alreadyBooked && r.available_seats > 0 && r.status === 'active' ? `<button class="btn btn-primary btn-lg" id="bookRideBtn" data-ride="${r.id}">🎫 Book This Ride</button>` : ''}
              ${alreadyBooked ? '<span class="seats-badge" style="font-size:1rem;padding:10px 20px;">✅ Already Booked</span>' : ''}
              ${!isLoggedIn ? '<a href="#/login" class="btn btn-primary btn-lg">Log in to Book</a>' : ''}
              ${isOwner ? `<button class="btn btn-danger" id="cancelRideBtn" data-ride="${r.id}">Cancel Ride</button>` : ''}
            </div>
          </div>
          ${isOwner && bookings.length > 0 ? `
            <div class="glass-card" style="margin-top:24px;">
              <h3 style="margin-bottom:16px;">Passengers (${bookings.length})</h3>
              ${bookings.map(b => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--glass-border);">
                <span>${this.esc(b.passenger_name)} (${b.seats_booked} seat${b.seats_booked>1?'s':''})</span>
                <span class="seats-badge">${b.status}</span>
              </div>`).join('')}
            </div>` : ''}
        </div>
      `;

      // Bind action buttons
      document.getElementById('bookRideBtn')?.addEventListener('click', () => this.bookRide(r.id));
      document.getElementById('cancelRideBtn')?.addEventListener('click', () => this.cancelRide(r.id));

      // Initialize map on ride detail page if coordinates exist
      if (r.from_lat && r.to_lat) {
        setTimeout(() => {
          const midLat = (r.from_lat + r.to_lat) / 2;
          const midLng = (r.from_lng + r.to_lng) / 2;
          const map = Maps.create('detailMap', { center: [midLat, midLng], zoom: 8 });
          if (map) {
            Maps.addMarker(map, r.from_lat, r.from_lng, '📍 ' + r.from_location, 'blue');
            Maps.addMarker(map, r.to_lat, r.to_lng, '🏁 ' + r.to_location, 'cyan');
            Maps.drawRoute(map, [r.from_lat, r.from_lng], [r.to_lat, r.to_lng]);
          }
        }, 400);
      }
    } catch (err) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><h3>Ride not found</h3></div>`;
    }
  },

  /**
   * Open the payment modal instead of booking directly
   */
  async bookRide(rideId) {
    try {
      const data = await API.get(`/rides/${rideId}`);
      const r = data.ride;

      // Populate modal
      document.getElementById('payFrom').textContent = r.from_location;
      document.getElementById('payTo').textContent = r.to_location;
      document.getElementById('payRideId').value = r.id;
      document.getElementById('payMaxSeats').value = r.available_seats;
      document.getElementById('payPriceValue').value = r.price_per_seat;
      document.getElementById('seatCount').textContent = '1';
      document.getElementById('payPricePerSeat').textContent = r.price_per_seat > 0 ? `₹${r.price_per_seat}` : 'Free';
      this._updatePayTotal();

      // Show/hide stripe section based on price
      const isFree = r.price_per_seat <= 0;
      document.getElementById('freeRideNotice').classList.toggle('hidden', !isFree);
      document.getElementById('stripeCardSection').classList.toggle('hidden', isFree);

      if (isFree) {
        document.getElementById('confirmPaymentBtn').querySelector('.btn-text').textContent = '🎫 Confirm Free Booking';
      } else {
        document.getElementById('confirmPaymentBtn').querySelector('.btn-text').textContent = '💳 Pay & Book';
      }

      // Initialize Stripe card element if not free
      if (!isFree) {
        this._initStripeCard();
      }

      // Show modal
      document.getElementById('paymentModal').classList.remove('hidden');
    } catch (err) {
      App.showToast(err.message, 'error');
    }
  },

  /** Update the total price in the payment modal */
  _updatePayTotal() {
    const seats = parseInt(document.getElementById('seatCount').textContent) || 1;
    const price = parseFloat(document.getElementById('payPriceValue').value) || 0;
    const total = seats * price;
    document.getElementById('payTotal').textContent = total > 0 ? `₹${total}` : 'Free';
  },

  /** Initialize Stripe Elements card input */
  _stripeInstance: null,
  _stripeCard: null,

  async _initStripeCard() {
    try {
      // Fetch publishable key
      if (!this._stripeInstance) {
        const config = await fetch('/api/config').then(r => r.json());
        if (config.stripePublishableKey && !config.stripePublishableKey.includes('YOUR_')) {
          this._stripeInstance = Stripe(config.stripePublishableKey);
        }
      }

      // Mount card element
      if (this._stripeInstance) {
        const elements = this._stripeInstance.elements();
        // Unmount old card if exists
        if (this._stripeCard) {
          this._stripeCard.destroy();
        }
        this._stripeCard = elements.create('card', {
          style: {
            base: {
              color: '#f1f5f9',
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: '15px',
              '::placeholder': { color: '#64748b' },
            },
            invalid: { color: '#ef4444' },
          },
        });
        this._stripeCard.mount('#stripeCardElement');
        this._stripeCard.on('change', (event) => {
          const errEl = document.getElementById('stripeCardErrors');
          errEl.textContent = event.error ? event.error.message : '';
        });
      }
    } catch (e) {
      console.warn('Stripe init skipped:', e);
    }
  },

  /** Handle the payment and booking */
  async _processPayment() {
    const btn = document.getElementById('confirmPaymentBtn');
    const rideId = parseInt(document.getElementById('payRideId').value);
    const seats = parseInt(document.getElementById('seatCount').textContent) || 1;
    const price = parseFloat(document.getElementById('payPriceValue').value) || 0;
    const isFree = price <= 0;

    try {
      Auth.setLoading(btn, true);
      let paymentIntentId = null;

      if (!isFree) {
        // Create payment intent on server
        const intentData = await API.post('/payments/create-intent', { ride_id: rideId, seats });

        if (intentData.free) {
          // Server says it's free
        } else if (intentData.mock) {
          // Mock mode — no real Stripe keys
          paymentIntentId = 'mock_' + Date.now();
          App.showToast('Mock payment processed (Stripe test keys not set)', 'info');
        } else if (intentData.clientSecret && this._stripeInstance && this._stripeCard) {
          // Real Stripe payment
          const { error, paymentIntent } = await this._stripeInstance.confirmCardPayment(
            intentData.clientSecret,
            { payment_method: { card: this._stripeCard } }
          );
          if (error) {
            App.showToast(error.message, 'error');
            return;
          }
          paymentIntentId = paymentIntent.id;
        } else {
          // Stripe not configured, use mock
          paymentIntentId = 'mock_' + Date.now();
        }
      }

      // Create the booking
      await API.post('/bookings', {
        ride_id: rideId,
        seats_booked: seats,
        payment_intent_id: paymentIntentId,
      });

      // If paid, confirm payment on server
      if (paymentIntentId) {
        // The booking is already created, just confirm payment record
      }

      // Close modal and show success
      document.getElementById('paymentModal').classList.add('hidden');
      App.showToast(isFree ? 'Ride booked successfully!' : 'Payment successful — Ride booked!', 'success');
      this.loadDetail(rideId);
    } catch (err) {
      App.showToast(err.message, 'error');
    } finally {
      Auth.setLoading(btn, false);
    }
  },

  /** Init payment modal event listeners (called once from Rides.init) */
  initPaymentModal() {
    // Close button
    document.getElementById('closePaymentModal')?.addEventListener('click', () => {
      document.getElementById('paymentModal').classList.add('hidden');
    });

    // Seat +/- buttons
    document.getElementById('seatPlus')?.addEventListener('click', () => {
      const el = document.getElementById('seatCount');
      const max = parseInt(document.getElementById('payMaxSeats').value) || 1;
      let val = parseInt(el.textContent) || 1;
      if (val < max) { el.textContent = val + 1; this._updatePayTotal(); }
    });
    document.getElementById('seatMinus')?.addEventListener('click', () => {
      const el = document.getElementById('seatCount');
      let val = parseInt(el.textContent) || 1;
      if (val > 1) { el.textContent = val - 1; this._updatePayTotal(); }
    });

    // Confirm button
    document.getElementById('confirmPaymentBtn')?.addEventListener('click', () => {
      this._processPayment();
    });

    // Close on overlay click
    document.getElementById('paymentModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'paymentModal') {
        document.getElementById('paymentModal').classList.add('hidden');
      }
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
      this.renderRides(data.rides);
    } catch { }
  },

  esc(str) { if (!str) return ''; const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }
};
