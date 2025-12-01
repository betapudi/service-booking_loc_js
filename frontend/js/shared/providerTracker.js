// shared/providerTracker.js
import { addMarker } from "./map.js";

export function trackProviders(socket) {
  socket.on("provider_location_update", data => {
    const { provider_id, lat, lng, name } = data;
    addMarker(lat, lng, `Provider: ${name}`, "🛠️");
  });
}
