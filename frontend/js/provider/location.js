// Provider/location.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { initMap, addMarker, centerMap, mapInstance } from "../shared/map.js";

export async function updateProviderLocation(providerId) {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported", "error");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async position => {
      const { latitude, longitude, accuracy } = position.coords;
      console.log("Provider location:", latitude, longitude, accuracy);

      try {
        await apiCall(`/providers/${providerId}/location`, {
          method: "PUT",
          body: { latitude, longitude, accuracy }
        });

        if (!mapInstance) {
          initMap("mapdiv", latitude, longitude);
        }

        addMarker(latitude, longitude, "You (Provider)", "🛠️");
        centerMap(latitude, longitude);
        showToast("Location updated", "success");
      } catch (err) {
        console.error("Failed to update provider location:", err);
        showToast("Location update failed", "error");
      }
    },
    error => {
      showToast("Failed to get location", "error");
      console.error("Geolocation error:", error);
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

export function startProviderLocationUpdates(providerId) {
  setInterval(() => {
    updateProviderLocation(providerId);
  }, 300000); // every 5 minutes
}
