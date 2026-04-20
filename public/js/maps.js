// Maps module using Leaflet + OpenStreetMap
const Maps = {
  instances: {},

  create(elementId, options = {}) {
    const el = document.getElementById(elementId);
    if (!el) return null;
    if (this.instances[elementId]) { this.instances[elementId].remove(); delete this.instances[elementId]; }

    const map = L.map(elementId, { scrollWheelZoom: true }).setView(
      options.center || [20.5937, 78.9629], options.zoom || 5
    );
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    this.instances[elementId] = map;
    setTimeout(() => map.invalidateSize(), 200);
    return map;
  },

  async reverseGeocode(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
      const data = await res.json();
      return data.display_name ? data.display_name.split(',').slice(0, 3).join(',').trim() : `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch { return `${lat.toFixed(4)}, ${lng.toFixed(4)}`; }
  },

  addMarker(map, lat, lng, label, color = 'blue') {
    const colors = { blue: '#6366f1', red: '#ef4444', green: '#10b981', cyan: '#06b6d4' };
    const c = colors[color] || color;
    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="width:24px;height:24px;background:${c};border-radius:50%;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>`,
      iconSize: [24, 24], iconAnchor: [12, 12]
    });
    return L.marker([lat, lng], { icon }).addTo(map).bindPopup(label);
  },

  drawRoute(map, from, to) {
    if (this._routeLine) { map.removeLayer(this._routeLine); }
    this._routeLine = L.polyline([from, to], { color: '#6366f1', weight: 3, opacity: 0.8, dashArray: '8, 8' }).addTo(map);
    map.fitBounds(this._routeLine.getBounds().pad(0.2));
  },

  fitMarkers(map, points) {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.2));
    }
  }
};
