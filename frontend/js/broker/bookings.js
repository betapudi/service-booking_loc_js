// broker/bookings.js
import { apiCall } from "../shared/api.js";

export async function loadGroupBookings() {
  const container = document.getElementById("groupBookings");
  container.innerHTML = "<p>Loading group bookings...</p>";

  try {
    const res = await apiCall("/brokers/group-bookings");
    const bookings = res.grouped_bookings;
    console.log("Group Bookings:", bookings);
    if (!bookings || bookings.length === 0) {
      container.innerHTML = "<p>No group bookings found.</p>";
      return;
    }

    container.innerHTML = bookings.length
      ? bookings.map(renderBookingGroup).join("")
      : "<p>No group bookings found.</p>";
  } catch (err) {
    console.error("Failed to load group bookings:", err);
    container.innerHTML = "<p class='error-msg'>Failed to load group bookings.</p>";
  }
}
function renderGroupBookingCard(b) {
  return `
    <div class="group-booking-card">
      <h4>📦 Booking #${b.id} — ${b.skill_required}</h4>
      <p><strong>Customer:</strong> ${b.customer_name} (${b.customer_mobile})</p>
      <p><strong>Provider:</strong> ${b.provider_name} (${b.provider_mobile})</p>
      <p><strong>Amount:</strong> ₹${b.total_amount}</p>
      <p><strong>Status:</strong> ${b.status}</p>
      <p><strong>Created:</strong> ${new Date(b.created_at).toLocaleString()}</p>
    </div>
  `;
}
function renderBookingGroup(group) {
  return `
    <div class="group-booking-card">
      <h4>📦 Request #${group.request_id} — ${group.skill_required}</h4>
      <p><strong>Customer:</strong> ${group.customer_name}</p>
      <p><strong>Providers:</strong> ${group.provider_count}</p>
      <p><strong>Description:</strong> ${group.description}</p>
      <p><strong>Date:</strong> ${new Date(group.created_at).toLocaleDateString()}</p>
      <div class="booking-list">
        ${group.bookings.map(b => `
          <div class="booking-card">
            <strong>${b.provider_name}</strong> (${b.provider_mobile}) — ₹${b.total_amount}
            <span class="status-badge ${b.status.toLowerCase()}">${b.status}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}