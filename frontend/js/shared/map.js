// map.js
export let mapInstance;

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
}

export function centerMap(lat, lng, zoom = 15) {
  if (mapInstance) {
    mapInstance.setView([lat, lng], zoom);
  }
}
