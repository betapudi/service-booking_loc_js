// provider/provider.js
import { initProviderDashboard } from "./dashboard.js";
import { setupLogoutButton } from "../shared/logout.js";
import { tryGeolocationFallback } from "../shared/geolocation.js";
import { initializeProfileManager } from "../shared/profile-completion.js";

// Initialize everything once DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Initialize profile manager first
    await initializeProfileManager();
    // Get user + token
    const user = JSON.parse(localStorage.getItem("user"));
    const token = localStorage.getItem("token");

    if (!user || user.role !== "provider") {
      showToast("Unauthorized. Please login as provider.", "error");
      window.location.href = "index.html";
      return;
    }

    // Setup socket listeners
    setupSocket(user.id, token, {
      new_booking: (booking) => {
        showToast(`📨 New booking #${booking.id} from ${booking.customer_name}`, "info");
        // Refresh bookings list
        loadProviderBookings(user.id);
      },
      booking_status_update: (data) => {
        showToast(`⚙️ Booking #${data.booking_id} status updated: ${data.status}`, "info");
        loadProviderBookings(user.id);
        loadProviderHistory(user.id);
      },
      booking_completed: (data) => {
        showToast(`✅ Booking #${data.booking_id} completed`, "success");
        loadProviderBookings(user.id);
        loadProviderHistory(user.id);
      }
    });

    // Then initialize dashboard
    initProviderDashboard();
    setupLogoutButton();
    tryGeolocationFallback();
  } catch (error) {
    console.error("Initialization failed:", error);
  }
});
/* ============================================================
   SIDE CARD SLIDE-UP LOGIC + OVERLAY CLICK-TO-CLOSE
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const bottomBtns = document.querySelectorAll(".bottom-btn");
  const sideCards = document.querySelectorAll(".side-card");
  const overlay = document.getElementById("overlay");

  let activeCard = null;

  function closeAllCards() {
    sideCards.forEach(card => {
      card.classList.remove("active");
      card.classList.add("closing");
      setTimeout(() => card.classList.remove("closing"), 300);
    });
    bottomBtns.forEach(btn => btn.classList.remove("active"));
    overlay.classList.remove("active");
    activeCard = null;
  }

  bottomBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const cardId = btn.getAttribute("data-card");
      const targetCard = document.getElementById(cardId);

      if (activeCard === targetCard) {
        closeAllCards();
        return;
      }

      closeAllCards();

      setTimeout(() => {
        targetCard.classList.add("active");
        btn.classList.add("active");
        overlay.classList.add("active");
        activeCard = targetCard;
      }, 350);
    });
  });

  overlay.addEventListener("click", () => {
    closeAllCards();
  });

  // Optional: Close card if Escape key pressed
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeAllCards();
  });
});
// 🔧 Utility functions to emit provider actions
export function respondToBooking(bookingId, status, customerId) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("booking_response", {
    booking_id: bookingId,
    provider_id: JSON.parse(localStorage.getItem("user")).id,
    customer_id: customerId,
    status
  });
}

export function sendLocationUpdate(lat, lng, bookingId) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("update_location", {
    provider_id: JSON.parse(localStorage.getItem("user")).id,
    lat,
    lng,
    booking_id: bookingId
  });
}

export function completeBooking(bookingId, customerId) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("booking_completed", {
    booking_id: bookingId,
    provider_id: JSON.parse(localStorage.getItem("user")).id,
    customer_id: customerId
  });
}