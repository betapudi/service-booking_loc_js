// Provider/dashboard.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { setupSocket, getSocket } from "../shared/socket.js";
import { initMap, addMarker, centerMap, mapInstance } from "../shared/map.js";
import { loadProviderBookings, loadProviderHistory, loadProviderStats, renderActiveBookings } from "./booking.js";
import { updateProviderLocation } from "./location.js";
import { initializeProfileManager } from "../shared/profile-completion.js";

let currentUser = null;
let customerMarkers = [];
let routeLayer = null;

export async function initProviderDashboard() {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    const token = localStorage.getItem("token");

    if (!user || user.role !== "provider") {
      showToast("Unauthorized. Please login as provider.", "error");
      window.location.href = "index.html";
      return;
    }

    await initializeProfileManager();

    currentUser = user;
    document.getElementById("userName").textContent = user.name || "Provider";

    setupTabHandlers();
    setupNotificationHandlers();
    setupEventListeners();

    const socket = setupSocket(user.id, token, {
      // New incoming bookings (individual or group) for this provider
      new_booking: ({ booking }) => {
        const b = booking || {};
        if (b.provider_id !== currentUser.id) return;

        showToast(`📋 New booking #${b.id} from ${b.customer_name}`, "info");
        renderIncomingBookingNotification(b);
        refreshAllLists();
      },

      // Any booking status update relevant to this provider
      booking_status_update: async (data) => {
        await refreshAllLists();
      },

      // Completion event for bookings involving this provider
      booking_completed: async (data) => {
        await refreshAllLists();
      }
    });

    // Register and subscribe
    socket.emit("register", user.id);
    socket.emit("subscribe_provider", { provider_id: user.id });
    socket.emit("subscribe_booking", { provider_id: user.id });

    // Broadcast live location
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition((pos) => {
        socket.emit("update_location", {
          provider_id: user.id,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      });
    }

    await updateProviderLocation(user.id);
    await refreshAllLists();
    await loadProviderStats(user.id);
  } catch (error) {
    console.error("Dashboard initialization failed:", error);
    showToast("Failed to initialize dashboard", "error");
  }
}

function setupTabHandlers() {
  document.querySelectorAll(".bottom-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".bottom-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const cardId = btn.dataset.card;
      switchCard(cardId);
    });
  });
}

function switchCard(cardId) {
  document.querySelectorAll(".side-card").forEach(card => {
    if (card.id === cardId) card.classList.add("active");
    else card.classList.remove("active");
  });
}

function setupNotificationHandlers() {
  const notifyBtn = document.getElementById("notifyBtn");
  const dropdown = document.getElementById("notificationDropdown");
  const clearBtn = document.getElementById("clearNotifications");
  const countEl = document.getElementById("notificationCount");

  if (notifyBtn && dropdown) {
    notifyBtn.addEventListener("click", () => {
      dropdown.classList.toggle("active");
    });
  }

  if (clearBtn && countEl) {
    clearBtn.addEventListener("click", () => {
      document.getElementById("notificationList").innerHTML = "";
      countEl.textContent = "0";
    });
  }
}

function setupEventListeners() {
  document.addEventListener("click", async (e) => {
    const bookingId = e.target.dataset.id;
    const isGroup = e.target.dataset.group === "true";
    if (!bookingId) return;

    if (e.target.classList.contains("accept-btn")) {
      await acceptBooking(bookingId);
      emitBookingResponse(bookingId, "ACCEPTED");
      await refreshAllLists();
      removeNotificationForBooking(bookingId);
    }

    if (e.target.classList.contains("reject-btn")) {
      await rejectBooking(bookingId);
      emitBookingResponse(bookingId, "REJECTED");
      await refreshAllLists();
      removeNotificationForBooking(bookingId);
    }

    if (e.target.classList.contains("complete-btn")) {
      if (isGroup) {
        await completeGroupBooking(bookingId);
      } else {
        await markAsCompleted(bookingId);
      }
      emitBookingCompleted(bookingId);
      await refreshAllLists();
    }
  });
}

function renderIncomingBookingNotification(booking) {
  const list = document.getElementById("notificationList");
  const countEl = document.getElementById("notificationCount");
  if (!list || !countEl) return;

  const item = document.createElement("div");
  item.className = "notification-item unread";
  item.dataset.id = String(booking.id);
  item.innerHTML = `
    <strong>Booking #${booking.id}</strong><br/>
    From ${booking.customer_name} (${booking.customer_mobile})<br/>
    <button class="accept-btn" data-id="${booking.id}">✅ Accept</button>
    <button class="reject-btn" data-id="${booking.id}">❌ Reject</button>
  `;
  list.prepend(item);

  const currentCount = parseInt(countEl.textContent || "0", 10);
  countEl.textContent = String(currentCount + 1);

  if (booking.customer_latitude && booking.customer_longitude) {
    addMarker(booking.customer_latitude, booking.customer_longitude, "Customer", "🧍");
  }
  if (booking.provider_latitude && booking.provider_longitude) {
    addMarker(booking.provider_latitude, booking.provider_longitude, "You (Provider)", "🔧");
  }
  if (
    booking.customer_latitude &&
    booking.customer_longitude &&
    booking.provider_latitude &&
    booking.provider_longitude
  ) {
    const bounds = L.latLngBounds([
      [booking.customer_latitude, booking.customer_longitude],
      [booking.provider_latitude, booking.provider_longitude]
    ]);
    centerMap(bounds.getCenter().lat, bounds.getCenter().lng, 13);
  }
}

function removeNotificationForBooking(bookingId) {
  const list = document.getElementById("notificationList");
  const countEl = document.getElementById("notificationCount");
  if (!list || !countEl) return;
  const item = list.querySelector(`.notification-item[data-id="${bookingId}"]`);
  if (item) {
    item.remove();
    const currentCount = Math.max(0, parseInt(countEl.textContent || "0", 10) - 1);
    countEl.textContent = String(currentCount);
  }
}

async function refreshAllLists() {
  const res = await apiCall("/bookings/history");
  const bookings = (res.bookings || []).filter(
    b => b.provider_id === currentUser.id
  );

  // Requests tab: pending bookings
  renderBookingList(bookings);

  // Active tab
  renderActiveBookings(bookings);

  // History tab
  await loadProviderHistory(currentUser.id);

  // Notification bell: pending only
  const pending = bookings.filter(b => b.status === "PENDING");
  const list = document.getElementById("notificationList");
  const countEl = document.getElementById("notificationCount");
  if (list && countEl) {
    list.innerHTML = "";
    pending.forEach(b => renderIncomingBookingNotification(b));
    countEl.textContent = String(pending.length);
  }
}

async function updateBookingStatus(bookingId, status, isGroupCompletion = false) {
  try {
    const endpoint = isGroupCompletion
      ? `/bookings/${bookingId}/group-complete`
      : `/bookings/${bookingId}/status`;
    const res = await apiCall(endpoint, { method: "POST", body: { status } });

    showToast(`Booking ${status.toLowerCase()} successfully`, "success");
    await refreshAllLists();
    return res;
  } catch (err) {
    console.error("Status update failed:", err);
    showToast("Failed to update booking", "error");
    throw err;
  }
}

async function acceptBooking(bookingId) {
  try {
    await updateBookingStatus(bookingId, "ACCEPTED");
    customerMarkers.forEach(m => mapInstance.removeLayer(m));
    customerMarkers = [];
    clearRoute();

    const booking = await fetchBookingDetails(bookingId);
    if (booking && booking.provider_latitude && booking.provider_longitude) {
      addMarker(booking.provider_latitude, booking.provider_longitude, "You (Provider)", "🔧");
    }
  } catch (error) {
    console.error("Failed to accept booking:", error);
  }
}

async function rejectBooking(bookingId) {
  try {
    await updateBookingStatus(bookingId, "CANCELLED");
  } catch (error) {
    console.error("Failed to reject booking:", error);
  }
}

async function markAsCompleted(bookingId) {
  try {
    const booking = await fetchBookingDetails(bookingId);
    if (booking?.group_id) {
      await updateBookingStatus(bookingId, "COMPLETED", true);
    } else {
      await updateBookingStatus(bookingId, "COMPLETED");
    }
    customerMarkers.forEach(m => mapInstance.removeLayer(m));
    customerMarkers = [];
    clearRoute();
    showToast("Booking marked as completed successfully", "success");
    await refreshAllLists();
  } catch (error) {
    console.error("Failed to mark booking as completed:", error);
    showToast("Failed to complete booking", "error");
  }
}

async function completeGroupBooking(bookingId) {
  try {
    const booking = await fetchBookingDetails(bookingId);
    if (!booking?.group_id) {
      showToast("This is not a group booking", "error");
      return;
    }
    const res = await apiCall(`/bookings/${bookingId}/group-complete`, {
      method: "POST",
      body: { status: "COMPLETED" }
    });
    if (res.success) {
      showToast("Group booking completed successfully!", "success");
      customerMarkers.forEach(m => mapInstance.removeLayer(m));
      customerMarkers = [];
      clearRoute();
      await refreshAllLists();
    }
  } catch (error) {
    console.error("Failed to complete group booking:", error);
    showToast("Failed to complete group booking", "error");
  }
}

// 🔧 Socket emitters
function emitBookingResponse(bookingId, status) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("booking_response", {
    booking_id: bookingId,
    provider_id: currentUser.id,
    status
  });
}

function emitBookingCompleted(bookingId) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("booking_completed", {
    booking_id: bookingId,
    provider_id: currentUser.id
  });
}

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

  container.innerHTML =
    bookings
      .filter(b => b.status === "PENDING")
      .map(b => {
        const isGroupBooking = b.group_id || b.is_group_booking;
        return `
      <div class="booking-card ${isGroupBooking ? "group-booking" : "individual-booking"}">
        <div class="booking-header">
          <strong>Booking #${b.id}</strong>
          ${
            isGroupBooking
              ? '<span class="group-badge">👥 Group</span>'
              : '<span class="individual-badge">👤 Individual</span>'
          }
        </div>
        <div class="booking-details">
          Status: <span class="status-${b.status.toLowerCase()}">${b.status}</span><br/>
          ${isGroupBooking ? `Group ID: ${b.group_id}<br/>` : ""}
          Customer: ${b.customer_name} (${b.customer_mobile})<br/>
          ${
            isGroupBooking && b.provider_count > 1
              ? `Team: ${b.provider_count} providers<br/>`
              : ""
          }
        </div>
        <div class="booking-actions">
          <button class="accept-btn" data-id="${b.id}">✅ Accept</button>
          <button class="reject-btn" data-id="${b.id}">❌ Reject</button>
        </div>
      </div>
    `;
      })
      .join("") || `<p class="no-bookings">No incoming requests</p>`;
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

// Initialize map when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  initMap("mapdiv", 17.385, 78.4867, 13);
});

// Make functions available globally if needed
window.markAsCompleted = markAsCompleted;
window.completeGroupBooking = completeGroupBooking;
