import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { renderPendingCustomerMarkers } from "./dashboard.js";

export async function loadProviderBookings(providerId) {
  try {
    const res = await apiCall("/bookings/history");
    const bookings = res.bookings || [];

    // Filter bookings where this provider is assigned
    const active = bookings.filter(b =>
      b.provider_id === providerId &&
      ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)
    );

    // Enhance with group information
    const enhancedBookings = active.map(booking => {
      const isGroupBooking = booking.group_id !== null && booking.group_id !== undefined;
      let providerCount = 1;
      if (isGroupBooking) {
        const groupProviders = bookings.filter(b =>
          b.group_id === booking.group_id &&
          ["ACCEPTED", "IN_PROGRESS"].includes(b.status)
        );
        providerCount = groupProviders.length;
      }
      return { ...booking, is_group_booking: isGroupBooking, provider_count: providerCount };
    });

    // Render into both tabs
    renderBookings(enhancedBookings);          // Incoming Requests
    renderActiveBookings(enhancedBookings);   // Active Bookings

    const pending = enhancedBookings.filter(b => b.status === "PENDING");
    renderPendingCustomerMarkers(pending);

  } catch (error) {
    console.error("Failed to load provider bookings:", error);
    showToast("Failed to load bookings", "error");
  }
}

export async function loadProviderHistory(providerId) {
  const res = await apiCall("/bookings/history");
  const bookings = res.bookings || [];
  const history = bookings.filter(b =>
    b.provider_id === providerId &&
    ["COMPLETED", "CANCELLED"].includes(b.status)
  );
  renderHistory(history);
}

export async function loadProviderStats(providerId) {
  const res = await apiCall("/bookings/history");
  const bookings = res.bookings || [];
  const today = new Date().toDateString();

  const todayBookings = bookings.filter(b =>
    b.provider_id === providerId &&
    new Date(b.created_at).toDateString() === today
  );

  const completedToday = todayBookings.filter(b => b.status === "COMPLETED").length;
  const totalEarnings = bookings
    .filter(b => b.status === "COMPLETED")
    .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

  document.getElementById("completedToday").textContent = completedToday;
  document.getElementById("totalEarnings").textContent = `₹${totalEarnings}`;
  document.getElementById("totalBookings").textContent = bookings.length;
  document.getElementById("pendingCount").textContent = bookings.filter(b => b.status === "PENDING").length;
  document.getElementById("todayEarnings").textContent = `₹${todayBookings
    .filter(b => b.status === "COMPLETED")
    .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0)}`;
}

// 🔹 Incoming Requests
function renderBookings(bookings) {
  const container = document.getElementById("requests-container");
  if (!container) return;

  container.innerHTML = bookings.filter(b => b.status === "PENDING").map(b => {
    return `
      <div class="booking-card ${b.is_group_booking ? 'group-booking' : 'individual-booking'}">
        <div class="booking-header">
          <strong>Booking #${b.id}</strong>
          ${b.is_group_booking ? '<span class="group-badge">👥 Group Booking</span>' : '<span class="individual-badge">👤 Individual</span>'}
        </div>
        <div class="booking-details">
          Status: <span class="status-${b.status.toLowerCase()}">${b.status}</span><br/>
          Customer: ${b.customer_name} (${b.customer_mobile})<br/>
        </div>
        <div class="booking-actions">
          <button class="accept-btn" data-id="${b.id}">✅ Accept</button>
          <button class="reject-btn" data-id="${b.id}">❌ Reject</button>
        </div>
      </div>
    `;
  }).join("") || `<p class="no-bookings">No incoming requests</p>`;
}

// 🔹 Active Bookings
export function renderActiveBookings(bookings) {
  const container = document.getElementById("active-bookings");
  if (!container) return;

  container.innerHTML = bookings.filter(b => ["ACCEPTED", "IN_PROGRESS"].includes(b.status)).map(b => {
    return `
      <div class="booking-card active">
        <strong>Booking #${b.id}</strong><br/>
        Customer: ${b.customer_name} (${b.customer_mobile})<br/>
        Status: ${b.status}<br/>
        <button class="reject-btn" data-id="${b.id}">❌ Cancel</button>        
        <button class="complete-btn" data-id="${b.id}">✅ Complete</button>
      </div>
    `;
  }).join("") || `<p class="no-bookings">No active bookings</p>`;
}

// 🔹 History
function renderHistory(bookings) {
  const container = document.getElementById("bookingHistory");
  if (!container) return;

  container.innerHTML = bookings
    .filter(b => ["COMPLETED", "CANCELLED"].includes(b.status))
    .map(b => `
      <div class="booking-card history">
        <strong>Booking #${b.id}</strong><br/>
        Status: ${b.status}<br/>
        Customer: ${b.customer_name}<br/>
        Amount: ₹${b.total_amount || 0}
      </div>
    `).join("") || `<p>No booking history</p>`;
}
