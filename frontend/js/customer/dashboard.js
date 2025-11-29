// customer/dashboard.js

import { initMap } from "../shared/map.js";
import { showToast, switchTab } from "../shared/ui.js";
import { loadCustomerBookings, startRouteTracking } from "./booking.js";
import {
  loadSkillsForGroupBooking,
  loadActiveGroupRequests,
  setupGroupRequestForm,
  setupLocationDropdowns,
  loadAvailableBrokers,
  populateGroupLocationFromUser
} from "./groupRequest.js";
import { loadUserLocation } from "./providers.js";
import { setupSocket } from "../shared/socket.js";

let currentUser = null;

// Keep a dictionary of provider markers so we can update them efficiently
const providerMarkers = {};
window.providerMarkers = providerMarkers;

export async function initCustomerDashboard() {
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  if (!user || user.role !== "customer") {
    showToast("Unauthorized. Please login as customer.", "error");
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  document.getElementById("userName").textContent = user.name || "Customer";

  initMap("mapdiv", 17.385, 78.4867, 13);
  loadUserLocation();
  setupTabHandlers();

  const socket = setupSocket(user.id, token, {
    // Booking lifecycle updates
    booking_status_update: (data) => {
      const bookingId = data.booking_id || data.id;
      const status = data.status || data.booking?.status;

      const messages = {
        PENDING: `⌛ Booking #${bookingId} is pending acceptance`,
        ACCEPTED: `✅ Booking #${bookingId} accepted`,
        IN_PROGRESS: `🛠️ Booking #${bookingId} is now in progress`,
        REJECTED: `❌ Booking #${bookingId} was rejected`,
        COMPLETED: `✅ Booking #${bookingId} marked as completed`,
        CANCELLED: `❌ Booking #${bookingId} was cancelled`
      };

      showToast(messages[status] || `Booking #${bookingId} updated: ${status}`, "info");

      loadCustomerBookings(user.id, (b) => {
        if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
          startRouteTracking(b);
        }
      });
    },

    booking_completed: (data) => {
      const bookingId = data.booking_id || data.id;
      showToast(`✅ Booking #${bookingId} completed`, "success");
      if (typeof window.stopRouteTracking === "function") {
        window.stopRouteTracking();
      }
      loadCustomerBookings(user.id);
    },

    // Live provider location updates while tracking
    provider_location_update: (loc) => {
      updateProviderMarker(loc);
    },

    // Group request lifecycle — Option 1: customer sees all events
    new_group_request: ({ booking }) => {
      if (booking?.customer_id === user.id) {
        showToast(`📨 Group booking #${booking.id} created`, "success");
        loadActiveGroupRequests();
        loadCustomerBookings(user.id);
      }
    },

    group_request_accepted: (data) => {
      const { request_id, broker_name, booking_count } = data;
      showToast(
        `✅ Your group request #${request_id} was accepted by ${broker_name} with ${booking_count} bookings`,
        "success"
      );
      loadActiveGroupRequests();
      loadCustomerBookings(user.id);
    },

    group_request_cancelled: (data) => {
      showToast(`❌ Your group request #${data.request_id} was cancelled`, "error");
      loadActiveGroupRequests();
    }
  });

  // Register this user and subscribe to relevant rooms
  socket.emit("register", user.id);
  socket.emit("subscribe_booking", { customer_id: user.id });
  socket.emit("subscribe_provider", { customer_id: user.id });

  // Expose for other modules if needed
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

export function updateProviderMarker({ provider_id, lat, lng, name, booking_id }) {
  if (!window.map) {
    console.warn("Map not initialized yet");
    return;
  }

  if (providerMarkers[provider_id]) {
    providerMarkers[provider_id].setLatLng([lat, lng]);
  } else {
    const marker = L.marker([lat, lng], {
      title: name || `Provider ${provider_id}`,
      icon: L.icon({
        iconUrl: "assets/icons/provider-marker.png",
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
      })
    }).addTo(window.map);

    marker.bindPopup(
      `<strong>${name || "Provider"}</strong><br>ID: ${provider_id}${
        booking_id ? `<br>Booking #${booking_id}` : ""
      }`
    );

    providerMarkers[provider_id] = marker;
  }

  console.log(`📍 Updated provider ${provider_id} marker at [${lat}, ${lng}]`);
}

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

// Initialize map when DOM is ready (safely, but main init still in initCustomerDashboard)
document.addEventListener("DOMContentLoaded", () => {
  if (!window.map) {
    initMap("mapdiv", 17.385, 78.4867, 13);
    loadUserLocation();
  }
});

