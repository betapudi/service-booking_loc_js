// /broker/providers.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { addMarker, centerMap } from "../shared/map.js";
export async function loadBrokerProviders() {
  const container = document.getElementById("managedProviders");
  container.innerHTML = "<p>Loading providers...</p>";

  try {
    const res = await apiCall("/brokers/providers");
    const providers = res.providers;

    if (!providers || providers.length === 0) {
      container.innerHTML = "<p>No providers registered yet.</p>";
      return;
    }

    container.innerHTML = providers.map(renderProviderCard).join("");
  } catch (err) {
    console.error("Failed to load providers:", err);
    container.innerHTML = "<p class='error-msg'>Failed to load providers.</p>";
  }
}

// function renderProviderCard(p) {
//   return `
//     <div class="provider-card">
//       <h4>👤 ${p.name} ${p.is_verified ? "✅" : "❌"}</h4>
//       <p><strong>Mobile:</strong> ${p.mobile_number}</p>
//       <p><strong>Location:</strong> ${p.location_name || "N/A"}</p>
//       <p><strong>Skills:</strong> ${p.skills.join(", ") || "None"}</p>
//       <p><strong>Total Bookings:</strong> ${p.total_bookings}</p>
//     </div>
//   `;
// }

function renderProviderCard(p) {
  return `
    <div class="provider-card">
      <h4>👤 ${p.name} ${p.is_verified ? "✅" : "❌"}</h4>
      <p><strong>Mobile:</strong> ${p.mobile_number}</p>
      <p><strong>Location:</strong> ${p.location_name || "N/A"}</p>
      <p><strong>Skills:</strong> ${p.skills.join(", ") || "None"}</p>
      <p><strong>Total Bookings:</strong> ${p.total_bookings}</p>
      <button class="map-btn"
        data-lat="${p.lat}"
        data-lng="${p.lng}"
        data-name="${p.name}">
        📍 Show Provider on Map
      </button>
    </div>
  `;
}

document.addEventListener("click", e => {
  if (e.target.classList.contains("map-btn")) {
    const { lat, lng, name } = e.target.dataset;
    addMarker(parseFloat(lat), parseFloat(lng), `Provider: ${name}`, "🛠️");
    centerMap(parseFloat(lat), parseFloat(lng));
  }
});