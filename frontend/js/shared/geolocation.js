import { initMap, addMarker, centerMap } from "./map.js";
import { showToast } from "./ui.js";

let mapInitialized = false;

export function tryGeolocationFallback() {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported", "error");
    return;
  }

  if (!mapInitialized) {
    initMap("mapdiv", 20.5937, 78.9629, 5); // Default India
    mapInitialized = true;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      const { latitude, longitude } = position.coords;
      localStorage.setItem('lastLocation', JSON.stringify({ lat: latitude, lng: longitude }));
      centerMap(latitude, longitude, 14);
      // addMarker(latitude, longitude, "Your Location", "🛠️");
      showToast("Location detected", "success");
    },
    error => {
      console.warn("Geolocation error:", error);
      showToast("Unable to detect location", "warning");
    },
    { enableHighAccuracy: true, timeout: 5000 }
  );
}
