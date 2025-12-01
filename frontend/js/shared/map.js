// shared/map.js
export let mapInstance;
let markers = [];

export function initMap(containerId = "mapdiv", lat = 17.385, lon = 78.4867, zoom = 13) {
  if (mapInstance) return mapInstance;

  const container = document.getElementById(containerId);
  if (!container) {
    console.warn(`Map container #${containerId} not found`);
    return;
  }

  mapInstance = L.map(containerId).setView([lat, lon], zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "© OpenStreetMap contributors"
  }).addTo(mapInstance);

  return mapInstance;
}

export function addMarker(lat, lon, popupText = "Location", iconHtml = "📍") {
  if (!mapInstance) return;

  const icon = L.divIcon({
    html: `<div class="map-icon">${iconHtml}</div>`,
    className: "custom-map-icon",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });

  const marker = L.marker([lat, lon], { icon }).addTo(mapInstance);
  marker.bindPopup(popupText);
  markers.push(marker);
  return marker;
}

export function clearMarkers() {
  if (!mapInstance) return;
  markers.forEach(m => mapInstance.removeLayer(m));
  markers = [];
}

export function centerMap(lat, lng, zoom = 15) {
  if (mapInstance) {
    mapInstance.setView([lat, lng], zoom);
  }
}
/**
 * Plot customer + all matching providers together
 */
export function plotRequestWithProviders(customer, providers = []) {
  if (!mapInstance) initMap();
  clearMarkers();

  // Plot customer
  if (customer.lat && customer.lng) {
    addMarker(customer.lat, customer.lng, `Customer: ${customer.name}`, "👤");
  }

  // Plot providers
  providers.forEach(p => {
    if (p.latitude && p.longitude) {
      // jitter up to ~±0.005 degrees (~±500m)
      const jitter = () => (Math.random() - 0.5) * 0.05;
      const lat = p.latitude + jitter();
      const lon = p.longitude + jitter();
      addMarker(lat, lon, `Provider: ${p.name}`, "🛠️");
    }
  });

  // Fit map bounds to all markers
  if (markers.length > 0) {
    const group = L.featureGroup(markers);
    mapInstance.fitBounds(group.getBounds().pad(0.2));
  }
}