import { apiCall } from "../shared/api.js";
import { showToast, switchTab } from "../shared/ui.js";
import { setupSocket } from "../shared/socket.js";
import { initMap, addMarker, centerMap, mapInstance } from "../shared/map.js";
import { loadProviderBookings, loadProviderHistory, loadProviderStats } from "./booking.js";
import { updateProviderLocation } from "./location.js";
import { initializeProfileManager } from "../shared/profile-completion.js";

let currentUser = null;

export async function initProviderDashboard() {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    const token = localStorage.getItem("token");

    if (!user || user.role !== "provider") {
      showToast("Unauthorized. Please login as provider.", "error");
      window.location.href = "index.html";
      return;
    }
    // Wait for profile manager to complete initialization
    await initializeProfileManager();

    currentUser = user;
    document.getElementById("userName").textContent = user.name || "Provider";

    setupTabHandlers();

    setupSocket(user.id, token, {
      new_booking: (data) => {
        const booking = data.booking;
        showToast(`📋 New booking #${booking.id} from ${booking.customer_name}`, "info");
        renderIncomingBookingNotification(booking);
      },
      booking_status: () => {
        loadProviderBookings(user.id);
        loadProviderHistory(user.id);
      }
    });

    await updateProviderLocation(user.id);
    await loadProviderBookings(user.id);
    await loadProviderHistory(user.id);
    await loadProviderStats(user.id);

  } catch (error) {
    console.error("Dashboard initialization failed:", error);
    showToast("Failed to initialize dashboard", "error");
  }
}

function setupTabHandlers() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
}

function renderIncomingBookingNotification(booking) {
  const list = document.getElementById("notificationList");
  if (!list) return;

  const item = document.createElement("div");
  item.className = "notification-item";
  item.innerHTML = `
    <strong>Booking #${booking.id}</strong><br/>
    From ${booking.customer_name} (${booking.customer_mobile})<br/>
    <button class="accept-btn" data-id="${booking.id}">✅ Accept</button>
    <button class="reject-btn" data-id="${booking.id}">❌ Reject</button>
  `;
  list.prepend(item);

  if (booking.customer_latitude && booking.customer_longitude) {
    addMarker(booking.customer_latitude, booking.customer_longitude, "Customer", "🧍");
  }

  if (booking.provider_latitude && booking.provider_longitude) {
    addMarker(booking.provider_latitude, booking.provider_longitude, "You (Provider)", "🔧");
  }

  if (booking.customer_latitude && booking.customer_longitude && booking.provider_latitude && booking.provider_longitude) {
    const bounds = L.latLngBounds([
      [booking.customer_latitude, booking.customer_longitude],
      [booking.provider_latitude, booking.provider_longitude]
    ]);
    centerMap(bounds.getCenter().lat, bounds.getCenter().lng, 13);
  }
}

async function updateBookingStatus(bookingId, status) {
  // try {
  //   const res = await apiCall(`/bookings/${bookingId}/status`, {
  //     method: "POST",
  //     body: { status }
  //   });
  try {
    const endpoint = isGroupCompletion ? `/bookings/${bookingId}/group-complete` : `/bookings/${bookingId}/status`;

    const res = await apiCall(endpoint, {
      method: "POST",
      body: { status }
    });
    showToast(`Booking ${status.toLowerCase()} successfully`, "success");

    await loadProviderBookings(currentUser.id);
    await loadProviderHistory(currentUser.id);
    if (res.status === "ACCEPTED") {
      drawAssignedRoute(res.provider_location, res.customer_location);
    }
  } catch (err) {
    console.error("Status update failed:", err);
    showToast("Failed to update booking", "error");
  }
}

async function acceptBooking(bookingId) {
  await updateBookingStatus(bookingId, "ACCEPTED");

  customerMarkers.forEach(m => mapInstance.removeLayer(m));
  customerMarkers = [];

  clearRoute();

  const booking = await fetchBookingDetails(bookingId);
  // if (booking) {
  //   drawRouteFromProviderToCustomer(
  //     booking.provider_latitude,
  //     booking.provider_longitude,
  //     booking.customer_latitude,
  //     booking.customer_longitude
  //   );

  addMarker(booking.provider_latitude, booking.provider_longitude, "You (Provider)", "🔧");
  // }
}

async function rejectBooking(bookingId) {
  await updateBookingStatus(bookingId, "CANCELLED");
}

// async function markAsCompleted(bookingId) {
//   await updateBookingStatus(bookingId, "COMPLETED");
//   customerMarkers.forEach(m => mapInstance.removeLayer(m));
//   customerMarkers = [];
// }
async function markAsCompleted(bookingId) {
  try {
    // For group bookings, we need to complete all provider assignments
    const booking = await fetchBookingDetails(bookingId);

    if (booking.group_id) {
      // This is a group booking - complete all provider assignments
      await updateBookingStatus(bookingId, "COMPLETED", true);
    } else {
      // Regular booking
      await updateBookingStatus(bookingId, "COMPLETED");
    }

    customerMarkers.forEach(m => mapInstance.removeLayer(m));
    customerMarkers = [];

    showToast("Booking marked as completed successfully", "success");

    // Refresh the bookings and history
    await loadProviderBookings(currentUser.id);
    await loadProviderHistory(currentUser.id);

  } catch (error) {
    console.error("Failed to mark booking as completed:", error);
    showToast("Failed to complete booking", "error");
  }
}

window.markAsCompleted = markAsCompleted;

let customerMarkers = [];
let routeLayer;

export function renderPendingCustomerMarkers(bookings) {
  if (!mapInstance) return;

  customerMarkers.forEach(m => mapInstance.removeLayer(m));
  customerMarkers = [];

  bookings.forEach(b => {
    if (b.customer_latitude && b.customer_longitude) {
      const marker = L.marker([b.customer_latitude, b.customer_longitude], {
        icon: L.divIcon({
          html: `<div class="map-icon">🧍</div>`,
          className: "custom-map-icon",
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapInstance).bindPopup(`Booking #${b.id}<br/>${b.customer_name}`);

      customerMarkers.push(marker);
    }
  });
}

export function renderBookingList(bookings) {
  const container = document.getElementById("requests-container");
  if (!container) return;

  container.innerHTML = bookings.map(b => {
    let actions = "";

    if (b.status === "PENDING") {
      actions = `
        <button class="accept-btn" data-id="${b.id}">✅ Accept</button>
        <button class="reject-btn" data-id="${b.id}">❌ Reject</button>
      `;
    } else if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
      actions = `
        <button class="accepted-btn" disabled>✅ Accepted</button>
        <button class="reject-btn" data-id="${b.id}">❌ Cancel</button>
        <button class="complete-btn" data-id="${b.id}">✅ Mark as Completed</button>
      `;
    }

    return `
      <div class="booking-card">
        <strong>Booking #${b.id}</strong><br/>
        Status: ${b.status}<br/>
        Customer: ${b.customer_name} (${b.customer_mobile})<br/>
        ${actions}
      </div>
    `;
  }).join("");
}

async function fetchBookingDetails(bookingId) {
  try {
    const res = await apiCall(`/bookings/${bookingId}`);
    return res.booking;
  } catch (err) {
    console.error("Failed to fetch booking details:", err);
    return null;
  }
}

function clearRoute() {
  if (routeLayer) {
    mapInstance.removeLayer(routeLayer);
    routeLayer = null;
  }
}

async function drawAssignedRoute(providerCoords, customerCoords) {
  const from = `${providerCoords.lng},${providerCoords.lat}`;
  const to = `${customerCoords.lng},${customerCoords.lat}`;

  const res = await fetch(`/api/route?from=${from}&to=${to}`);
  const data = await res.json();

  L.geoJSON(data.routes[0].geometry, {
    style: { color: 'green', weight: 4 }
  }).addTo(map);
}


document.addEventListener("DOMContentLoaded", () => {
  initMap("mapdiv", 17.385, 78.4867, 13);
});

document.addEventListener("click", (e) => {
  const bookingId = e.target.dataset.id;
  const isGroup = e.target.dataset.group === "true";
  
  if (!bookingId) return;

  if (e.target.classList.contains("accept-btn")) {
    acceptBooking(bookingId);
  }

  if (e.target.classList.contains("reject-btn")) {
    rejectBooking(bookingId);
  }

  if (e.target.classList.contains("complete-btn")) {
    if (isGroup) {
      completeGroupBooking(bookingId);
    } else {
      markAsCompleted(bookingId);
    }
  }
});

// Profile completion modal handling
function setupProfileModal(userId) {
  const modal = document.getElementById('profileCompletionModal');
  const completeBtn = document.getElementById('completeProfileBtn');
  const skipBtn = document.getElementById('skipProfileBtn');

  completeBtn.addEventListener('click', () => {
    window.location.href = `profile-completion.html?user_id=${userId}`;
  });

  skipBtn.addEventListener('click', () => {
    modal.style.display = 'none';
    // Optionally set a flag to not show again for 24 hours
    localStorage.setItem('profile_reminder_dismissed', new Date().toISOString());
  });

  return modal;
}

// Update the checkProfileCompletion function to use modal
async function checkProfileCompletion(userId) {
  try {
    const res = await apiCall(`/providers/${userId}/profile`);
    const profile = res.profile || {};

    const requiredFields = ['name', 'mobile', 'service_category', 'skills', 'experience'];
    const isComplete = requiredFields.every(field =>
      profile[field] && profile[field].toString().trim() !== ''
    );

    if (!isComplete) {
      // Check if user recently dismissed the reminder
      const lastDismissed = localStorage.getItem('profile_reminder_dismissed');
      if (lastDismissed) {
        const dismissedTime = new Date(lastDismissed);
        const hoursSinceDismiss = (new Date() - dismissedTime) / (1000 * 60 * 60);
        if (hoursSinceDismiss < 24) {
          return true; // Allow access if dismissed recently
        }
      }

      const modal = setupProfileModal(userId);
      modal.style.display = 'flex';
      return false;
    }

    return true;
  } catch (error) {
    console.error("Profile check failed:", error);
    return true; // Allow access if API fails to avoid blocking users
  }
}