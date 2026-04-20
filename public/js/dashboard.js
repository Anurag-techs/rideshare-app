// Dashboard module
const Dashboard = {
  async load() {
    try {
      const [driverData, bookingData, userData] = await Promise.all([
        API.get('/rides/my/driver'),
        API.get('/bookings/my'),
        API.get('/auth/me')
      ]);
      const rides = driverData.rides || [];
      const bookings = bookingData.bookings || [];
      const user = userData.user;

      // Stats
      const now = new Date();
      const upcomingRides = rides.filter(r => new Date(r.departure_time) > now && r.status === 'active').length;
      const upcomingBookings = bookings.filter(b => new Date(b.departure_time) > now && b.status !== 'cancelled').length;

      document.getElementById('statPosted').textContent = rides.length;
      document.getElementById('statBooked').textContent = bookings.length;
      document.getElementById('statUpcoming').textContent = upcomingRides + upcomingBookings;
      document.getElementById('statRating').textContent = user.avg_rating > 0 ? `${user.avg_rating} ⭐` : '-';

      // Driver rides
      const driverEl = document.getElementById('driverRides');
      if (!rides.length) {
        driverEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🚗</div><h3>No rides posted</h3><p><a href="#/create">Post your first ride!</a></p></div>';
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
                <div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px;">📅 ${dateStr} 🕐 ${timeStr}</div>
              </div>
            </div>
            <div class="ride-meta" style="margin-top:12px;">
              <span>💺 ${r.available_seats}/${r.total_seats} seats left</span>
              <span>👥 ${r.booking_count || 0} booking(s)</span>
              <span>💰 ${r.price_per_seat > 0 ? '₹'+r.price_per_seat : 'Free'}</span>
            </div>
          </div>`;
        }).join('');
      }

      // Passenger bookings
      const passEl = document.getElementById('passengerBookings');
      if (!bookings.length) {
        passEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🎫</div><h3>No bookings yet</h3><p><a href="#/find">Find a ride!</a></p></div>';
      } else {
        passEl.innerHTML = bookings.map(b => {
          const date = new Date(b.departure_time);
          const dateStr = date.toLocaleDateString('en-IN', {day:'numeric',month:'short'});
          const timeStr = date.toLocaleTimeString('en-IN', {hour:'2-digit',minute:'2-digit'});
          const canRate = b.status === 'confirmed' && new Date(b.departure_time) < now;
          const canCancel = b.status !== 'cancelled' && new Date(b.departure_time) > now;
          return `<div class="ride-card">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px;">
              <div>
                <div class="ride-route"><span class="route-dot"></span><span class="route-text">${Rides.esc(b.from_location)}</span></div>
                <div class="ride-route" style="margin-top:8px;"><span class="route-dot dest"></span><span class="route-text">${Rides.esc(b.to_location)}</span></div>
              </div>
              <span class="seats-badge ${b.status==='cancelled'?'full':''}">${b.status}</span>
            </div>
            <div class="ride-meta" style="margin-top:12px;">
              <span>📅 ${dateStr} 🕐 ${timeStr}</span>
              <span>🧑‍✈️ ${Rides.esc(b.driver_name)}</span>
              <span>💰 ${b.price_per_seat > 0 ? '₹'+b.price_per_seat : 'Free'}</span>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              ${canCancel ? `<button class="btn btn-ghost btn-sm cancel-booking-btn" data-id="${b.id}">Cancel</button>` : ''}
              ${canRate ? `<button class="btn btn-ghost btn-sm rate-btn" data-ride="${b.ride_id}" data-user="${b.driver_id}">⭐ Rate Driver</button>` : ''}
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
    } catch (err) { App.showToast(err.message, 'error'); }
  }
};

// Cars module
const Cars = {
  async load() {
    try {
      const data = await API.get('/cars');
      const list = document.getElementById('carsList');
      if (!data.cars.length) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">🚙</div><h3>No cars added yet</h3></div>';
      } else {
        list.innerHTML = data.cars.map(c => `
          <div class="car-card glass-card">
            <div class="car-card-icon">🚗</div>
            <div class="car-card-info">
              <h4>${Rides.esc(c.model)}</h4>
              <p>${c.total_seats} seats ${c.color?'• '+c.color:''} ${c.license_plate?'• '+c.license_plate:''}</p>
            </div>
            <div class="car-card-actions">
              <button class="btn btn-ghost btn-sm delete-car-btn" data-id="${c.id}">🗑️</button>
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
