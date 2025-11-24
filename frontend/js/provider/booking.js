//provider/booking.js

import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { renderPendingCustomerMarkers } from "./dashboard.js";

// export async function loadProviderBookings(providerId) {
//   try {
//     const res = await apiCall("/bookings/history");
//     const bookings = res.bookings || [];

//     // Filter bookings where this provider is assigned
//     const active = bookings.filter(b =>
//       b.provider_id === providerId &&
//       ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)
//     );

//     // Enhance with group information
//     const enhancedBookings = active.map(booking => {
//       // Check if this is a group booking
//       const isGroupBooking = booking.group_id !== null && booking.group_id !== undefined;
      
//       // For group bookings, find how many providers are assigned to the same group
//       let providerCount = 1;
//       if (isGroupBooking) {
//         const groupProviders = bookings.filter(b => 
//           b.group_id === booking.group_id && 
//           ["ACCEPTED", "IN_PROGRESS"].includes(b.status)
//         );
//         providerCount = groupProviders.length;
//       }

//       return {
//         ...booking,
//         is_group_booking: isGroupBooking,
//         provider_count: providerCount
//       };
//     });

//     renderBookings(enhancedBookings);

//     const pending = enhancedBookings.filter(b => b.status === "PENDING");
//     renderPendingCustomerMarkers(pending);
    
//   } catch (error) {
//     console.error("Failed to load provider bookings:", error);
//     showToast("Failed to load bookings", "error");
//   }
// }
export async function loadProviderBookings(providerId) {
  try {
    // Use provider-specific endpoint instead of general history
    const res = await apiCall("/bookings/provider-bookings");
    const bookings = res.bookings || [];

    const active = bookings.filter(b =>
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

      return {
        ...booking,
        is_group_booking: isGroupBooking,
        provider_count: providerCount
      };
    });

    renderBookings(enhancedBookings);

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

// export async function loadProviderStats(providerId) {
//   const res = await apiCall("/bookings/history");
//   const bookings = res.bookings || [];
//   const today = new Date().toDateString();

//   const todayBookings = bookings.filter(b =>
//     b.provider_id === providerId &&
//     new Date(b.created_at).toDateString() === today
//   );

//   const completedToday = todayBookings.filter(b => b.status === "COMPLETED").length;
//   const totalEarnings = bookings
//     .filter(b => b.status === "COMPLETED")
//     .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

//   document.getElementById("completedToday").textContent = completedToday;
//   document.getElementById("totalEarnings").textContent = `₹${totalEarnings}`;
//   document.getElementById("totalBookings").textContent = bookings.length;
//   document.getElementById("pendingCount").textContent = bookings.filter(b => b.status === "PENDING").length;
//   document.getElementById("todayEarnings").textContent = `₹${todayBookings
//     .filter(b => b.status === "COMPLETED")
//     .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0)}`;
// }

// ✅ Render active bookings in "Incoming Requests"

export async function loadProviderStats(providerId) {
  try {
    const res = await apiCall("/bookings/provider-bookings");
    const bookings = res.bookings || [];
    const today = new Date().toDateString();

    const todayBookings = bookings.filter(b =>
      new Date(b.created_at).toDateString() === today
    );

    const completedToday = todayBookings.filter(b => b.status === "COMPLETED").length;
    const totalEarnings = bookings
      .filter(b => b.status === "COMPLETED")
      .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

    const pendingCount = bookings.filter(b => b.status === "PENDING").length;
    const todayEarnings = todayBookings
      .filter(b => b.status === "COMPLETED")
      .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

    document.getElementById("completedToday").textContent = completedToday;
    document.getElementById("totalEarnings").textContent = `₹${totalEarnings}`;
    document.getElementById("totalBookings").textContent = bookings.length;
    document.getElementById("pendingCount").textContent = pendingCount;
    document.getElementById("todayEarnings").textContent = `₹${todayEarnings}`;
    
  } catch (error) {
    console.error("Failed to load provider stats:", error);
    // Set default values on error
    document.getElementById("completedToday").textContent = "0";
    document.getElementById("totalEarnings").textContent = "₹0";
    document.getElementById("totalBookings").textContent = "0";
    document.getElementById("pendingCount").textContent = "0";
    document.getElementById("todayEarnings").textContent = "₹0";
  }
}

function renderBookings(bookings) {
  const container = document.getElementById("requests-container");
  if (!container) return;

  container.innerHTML = bookings.length
    ? bookings.map(b => {
        let actions = "";
        const isGroupBooking = b.is_group_booking;

        if (b.status === "PENDING") {
          actions = `
            <button class="accept-btn" data-id="${b.id}">✅ Accept</button>
            <button class="reject-btn" data-id="${b.id}">❌ Reject</button>
          `;
        } else if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
          if (isGroupBooking) {
            actions = `
              <button class="accepted-btn" disabled>✅ Accepted (Group)</button>
              <button class="reject-btn" data-id="${b.id}">❌ Cancel</button>
              <button class="complete-btn" data-id="${b.id}" data-group="true">✅ Complete Group Booking</button>
            `;
          } else {
            actions = `
              <button class="accepted-btn" disabled>✅ Accepted</button>
              <button class="reject-btn" data-id="${b.id}">❌ Cancel</button>
              <button class="complete-btn" data-id="${b.id}">✅ Mark as Completed</button>
            `;
          }
        }

        return `
          <div class="booking-card ${isGroupBooking ? 'group-booking' : 'individual-booking'}">
            <div class="booking-header">
              <strong>Booking #${b.id}</strong>
              ${isGroupBooking ? '<span class="group-badge">👥 Group Booking</span>' : '<span class="individual-badge">👤 Individual</span>'}
            </div>
            <div class="booking-details">
              Status: <span class="status-${b.status.toLowerCase()}">${b.status}</span><br/>
              ${isGroupBooking ? `Group ID: ${b.group_id}<br/>` : ''}
              Customer: ${b.customer_name} (${b.customer_mobile})<br/>
              ${isGroupBooking && b.provider_count > 1 ? `Team Size: ${b.provider_count} providers<br/>` : ''}
              Amount: ₹${b.total_amount || '0.00'}<br/>
            </div>
            <div class="booking-actions">
              ${actions}
            </div>
          </div>
        `;
      }).join("")
    : `<p class="no-bookings">No active bookings</p>`;
}

// ✅ Render completed/cancelled bookings in "Booking History"
function renderHistory(bookings) {
  const container = document.getElementById("bookingHistory");
  if (!container) return;

  container.innerHTML = bookings.length
    ? bookings.map(b => {
        const isGroupBooking = b.group_id !== null && b.group_id !== undefined;
        return `
          <div class="booking-card history ${isGroupBooking ? 'group-booking' : ''}">
            <div class="booking-header">
              <strong>Booking #${b.id}</strong>
              ${isGroupBooking ? '<span class="group-badge">👥 Group</span>' : ''}
            </div>
            <div class="booking-details">
              Status: ${b.status}<br/>
              Customer: ${b.customer_name} (${b.customer_mobile})<br/>
              Amount: ₹${b.total_amount || 0}<br/>
              ${isGroupBooking ? `Group ID: ${b.group_id}<br/>` : ''}
            </div>
          </div>
        `;
      }).join("")
    : `<p>No booking history</p>`;
}