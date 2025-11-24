// customer/dashboard.js
import { apiCall } from "../shared/api.js";
import { initMap } from "../shared/map.js";
import { showToast, switchTab } from "../shared/ui.js";
import { loadCustomerBookings, startRouteTracking } from "./booking.js";
import {
  loadSkillsForGroupBooking, loadActiveGroupRequests, setupGroupRequestForm,
  setupLocationDropdowns, loadAvailableBrokers
} from "./groupRequest.js";
import { loadUserLocation } from "./providers.js";
import { setupSocket } from "../shared/socket.js";
import { loadLocationDropdown, populateGroupLocationFromUser } from "./groupRequest.js";

export async function initCustomerDashboard() {
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  if (!user || user.role !== "customer") {
    showToast("Unauthorized. Please login as customer.", "error");
    window.location.href = "index.html";
    return;
  }

  document.getElementById("userName").textContent = user.name || "Customer";

  initMap("mapdiv", 17.385, 78.4867, 13);
  loadUserLocation();
  setupTabHandlers();

  // ✅ Socket listeners
  setupSocket(user.id, token, {
    booking_status_update: (data) => {
      const booking = data.booking || data;
      const status = booking.status;

      if (status === "ACCEPTED" || status === "IN_PROGRESS") {
        if (booking.provider_latitude && booking.customer_latitude) {
          startRouteTracking(booking);
        } else {
          showToast(`Booking #${booking.id} accepted. Location data missing for tracking.`, "warning");
        }
      } else if (["COMPLETED", "CANCELLED", "REJECTED"].includes(status)) {
        if (typeof window.stopRouteTracking === "function") {
          window.stopRouteTracking();
        }
      }

      const messages = {
        PENDING: `⌛ Booking #${booking.id} is pending acceptance`,
        ACCEPTED: `✅ Booking #${booking.id} accepted by ${booking.provider_name}. Tracking started!`,
        IN_PROGRESS: `🛠️ Booking #${booking.id} is now in progress!`,
        REJECTED: `❌ Booking #${booking.id} rejected by ${booking.provider_name}`,
        COMPLETED: `✅ Booking #${booking.id} marked as completed`,
        CANCELLED: `❌ Booking #${booking.id} was cancelled`
      };

      showToast(messages[status] || `Booking #${booking.id} updated`, "info");
      loadCustomerBookings(user.id, (b) => {
        if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
          startRouteTracking(b);
        }
      });
    },

    new_booking: () => loadCustomerBookings(user.id),

    // ✅ NEW: listen globally for broker updates on group requests
    group_request_update: (data) => {
      const { group_request_id, status } = data;
      showToast(`🔄 Group request #${group_request_id} updated by broker: ${status}`, "info");
      loadActiveGroupRequests();
    }
  });

  // Make these functions available globally
  window.loadActiveGroupRequests = loadActiveGroupRequests;
  window.loadCustomerBookings = loadCustomerBookings;

  await Promise.all([
    populateGroupLocationFromUser(),
    loadSkillsForGroupBooking(),
    setupLocationDropdowns(),
    setupLocationDropdowns(user?.location_id),
    setupGroupRequestForm(),
    loadActiveGroupRequests(),
    loadCustomerBookings(user.id, (b) => {
      if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
        startRouteTracking(b);
      }
    }),
    loadAvailableBrokers()
  ]);
}

function setupTabHandlers() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.querySelectorAll(".collapsible-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.parentElement;
      section.classList.toggle("open");
      const icon = header.querySelector(".collapsible-icon");
      icon.textContent = section.classList.contains("open") ? "▼" : "▶";
    });
  });
}
// Keep a dictionary of provider markers so we can update them efficiently
const providerMarkers = {};

export function updateProviderMarker({ provider_id, lat, lng, name, booking_id }) {
  if (!window.map) {
    console.warn("Map not initialized yet");
    return;
  }

  // If marker already exists, just move it
  if (providerMarkers[provider_id]) {
    providerMarkers[provider_id].setLatLng([lat, lng]);
  } else {
    // Create a new marker for this provider
    const marker = L.marker([lat, lng], {
      title: name || `Provider ${provider_id}`,
      icon: L.icon({
        iconUrl: "assets/icons/provider-marker.png", // replace with your icon path
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32],
      }),
    }).addTo(window.map);

    marker.bindPopup(
      `<strong>${name || "Provider"}</strong><br>ID: ${provider_id}${booking_id ? `<br>Booking #${booking_id}` : ""
      }`
    );

    providerMarkers[provider_id] = marker;
  }

  // Optionally pan/zoom to provider
  // window.map.setView([lat, lng], 15);

  console.log(`📍 Updated provider ${provider_id} marker at [${lat}, ${lng}]`);
}

// Dictionary of provider markers (shared with updateProviderMarker)

window.providerMarkers = providerMarkers;

/**
 * Remove a provider's marker from the map.
 * @param {string|number} provider_id - The provider's unique ID
 */
export function stopProviderMarker(provider_id) {
  if (!window.map) {
    console.warn("Map not initialized yet");
    return;
  }

  const marker = providerMarkers[provider_id];
  if (marker) {
    window.map.removeLayer(marker);
    delete providerMarkers[provider_id];
    console.log(`🗑️ Removed provider ${provider_id} marker from map`);
  } else {
    console.log(`ℹ️ No marker found for provider ${provider_id}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initMap("mapdiv", 17.385, 78.4867, 13);
  loadUserLocation();
});
