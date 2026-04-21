// Maps module using Leaflet + OpenStreetMap (free, no API key needed)
const Maps = {
  instances: {},
  _markers: {},
  _routeLines: {},

  /**
   * Create a Leaflet map in the given element
   * @param {string} elementId - DOM element ID for the map container
   * @param {object} options - { center: [lat, lng], zoom: number }
   * @returns {L.Map|null}
   */
  create(elementId, options = {}) {
    const el = document.getElementById(elementId);
    if (!el) return null;

    // Clean up previous instance
    if (this.instances[elementId]) {
      this.instances[elementId].remove();
      delete this.instances[elementId];
    }
    this._markers[elementId] = [];
    this._routeLines[elementId] = null;

    const center = options.center || [20.5937, 78.9629]; // Default: India center
    const zoom = options.zoom || 5;

    const map = L.map(elementId, {
      scrollWheelZoom: true,
      zoomControl: true,
    }).setView(center, zoom);

    // OpenStreetMap dark-style tiles (free)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map);

    this.instances[elementId] = map;

    // Fix map rendering after container is shown
    setTimeout(() => map.invalidateSize(), 300);

    return map;
  },

  /**
   * Reverse geocode coordinates to a place name using Nominatim (free)
   */
  async reverseGeocode(lat, lng) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14`
      );
      const data = await res.json();
      if (data.display_name) {
        // Return first 3 parts of the address for a cleaner name
        return data.display_name.split(',').slice(0, 3).join(',').trim();
      }
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch {
      return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  },

  /**
   * Add a styled circular marker to the map
   */
  addMarker(map, lat, lng, label, color = 'blue') {
    const colors = {
      blue: '#6366f1',
      red: '#ef4444',
      green: '#10b981',
      cyan: '#06b6d4',
    };
    const c = colors[color] || color;
    const mapId = this._getMapId(map);

    const icon = L.divIcon({
      className: 'custom-marker',
      html: `<div style="
        width: 20px; height: 20px;
        background: ${c};
        border-radius: 50%;
        border: 3px solid #fff;
        box-shadow: 0 2px 10px rgba(0,0,0,0.5), 0 0 20px ${c}44;
      "></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
      popupAnchor: [0, -14],
    });

    const marker = L.marker([lat, lng], { icon }).addTo(map);
    marker.bindPopup(`<div style="font-weight:600;font-size:0.85rem;">${label}</div>`);

    if (mapId && this._markers[mapId]) {
      this._markers[mapId].push(marker);
    }

    return marker;
  },

  /**
   * Draw a dashed route line between two points
   */
  drawRoute(map, from, to) {
    const mapId = this._getMapId(map);

    // Remove previous route line
    if (mapId && this._routeLines[mapId]) {
      map.removeLayer(this._routeLines[mapId]);
    }

    // Create a styled polyline
    const routeLine = L.polyline([from, to], {
      color: '#6366f1',
      weight: 4,
      opacity: 0.85,
      dashArray: '10, 8',
      lineCap: 'round',
    }).addTo(map);

    // Also draw a subtle glow behind it
    L.polyline([from, to], {
      color: '#6366f1',
      weight: 10,
      opacity: 0.15,
    }).addTo(map);

    if (mapId) {
      this._routeLines[mapId] = routeLine;
    }

    // Fit the map to show the full route with padding
    map.fitBounds(routeLine.getBounds().pad(0.3));

    return routeLine;
  },

  /**
   * Fit map bounds to show all given points
   */
  fitMarkers(map, points) {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds.pad(0.3));
    }
  },

  /**
   * Clear all markers from a specific map
   */
  clearMarkers(mapId) {
    if (this._markers[mapId]) {
      this._markers[mapId].forEach(m => {
        if (this.instances[mapId]) {
          this.instances[mapId].removeLayer(m);
        }
      });
      this._markers[mapId] = [];
    }
  },

  /**
   * Get the element ID for a given map instance
   */
  _getMapId(map) {
    for (const [id, instance] of Object.entries(this.instances)) {
      if (instance === map) return id;
    }
    return null;
  },
};
