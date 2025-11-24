// customer/customer.js
import io from "socket.io-client";
import { initCustomerDashboard } from "./dashboard.js";
import { setupLogoutButton } from "../shared/logout.js";
import { tryGeolocationFallback } from "../shared/geolocation.js";
import { initializeProfileManager } from "../shared/profile-completion.js";
import {
  setupGroupRequestForm,
  loadSkillsForGroupBooking,
  loadAvailableBrokers,
  setupLocationDropdowns,
  populateGroupLocationFromUser
} from "./groupRequest.js";
import { loadCustomerBookings, startRouteTracking } from "./booking.js";
import { showToast } from "../shared/ui.js";
import { apiCall } from "../shared/api.js";

// ✅ DOM Ready
document.addEventListener("DOMContentLoaded", async () => {
  await initializeProfileManager();
  initCustomerDashboard();
  setupLogoutButton();
  tryGeolocationFallback();

  setupGroupRequestForm();
  loadSkillsForGroupBooking();
  loadAvailableBrokers();
  populateGroupLocationFromUser();
  setupLocationDropdowns();
});

// ✅ Modal Controls
const overlay = document.getElementById("overlay");
const modal = document.getElementById("groupRequestModal");

document.getElementById("openGroupRequestModalBtn").addEventListener("click", () => {
  modal.classList.remove("hidden");
  overlay.classList.add("active");
});

document.getElementById("closeGroupRequestModalBtn").addEventListener("click", () => {
  modal.classList.add("hidden");
  overlay.classList.remove("active");
});

document.getElementById("cancelGroupRequestBtn").addEventListener("click", () => {
  modal.classList.add("hidden");
  overlay.classList.remove("active");
});

// // ✅ Booking Completion Handler
// customer/customer.js - Fix booking completion
// document.addEventListener("click", async (e) => {
//   if (e.target.classList.contains("complete-btn")) {
//     const bookingId = e.target.dataset.id;
//     if (!bookingId) return;

//     const confirmed = confirm("Mark this booking as completed?");
//     if (!confirmed) return;

//     try {
//       console.log(`Completing booking ${bookingId}...`);
      
//       // Use the correct endpoint path
//       await apiCall(`/customers/bookings/${bookingId}/complete`, { 
//         method: "POST" 
//       });
      
//       showToast("✅ Booking marked as completed.", "success");

//       // Refresh bookings
//       const user = JSON.parse(localStorage.getItem("user"));
//       await loadCustomerBookings(user.id, (b) => {
//         if (b.status === "ACCEPTED" || b.status === "IN_PROGRESS") {
//           startRouteTracking(b);
//         }
//       });
//     } catch (err) {
//       console.error("Failed to complete booking:", err);
//       showToast("❌ Failed to mark as completed.", "error");
//     }
//   }
// });
// ✅ Bottom Bar Navigation
const bottomBtns = document.querySelectorAll(".bottom-btn");
const sideCards = document.querySelectorAll(".side-card");

bottomBtns.forEach(btn => {
  btn.addEventListener("click", () => {
    const target = document.getElementById(btn.dataset.card);
    const isActive = target.classList.contains("active");

    sideCards.forEach(card => card.classList.remove("active"));
    bottomBtns.forEach(b => b.classList.remove("active"));

    if (!isActive) {
      target.classList.add("active");
      btn.classList.add("active");
      overlay.classList.add("active");
    } else {
      overlay.classList.remove("active");
    }
  });
});

// ✅ Dismiss cards when clicking map
document.getElementById("mapdiv").addEventListener("click", () => {
  sideCards.forEach(card => card.classList.remove("active"));
  bottomBtns.forEach(btn => btn.classList.remove("active"));
  overlay.classList.remove("active");
});

// ✅ Escape key closes cards
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    sideCards.forEach(card => card.classList.remove("active"));
    bottomBtns.forEach(btn => btn.classList.remove("active"));
    overlay.classList.remove("active");
  }
});

// ✅ Overlay click closes cards
overlay.addEventListener("click", () => {
  sideCards.forEach(card => card.classList.remove("active"));
  bottomBtns.forEach(btn => btn.classList.remove("active"));
  overlay.classList.remove("active");
});

// ✅ Notification Dropdown
const notifyBtn = document.getElementById("notifyBtn");
const notificationDropdown = document.getElementById("notificationDropdown");
const notificationList = document.getElementById("notificationList");
const clearBtn = document.getElementById("clearNotifications");
const badge = document.getElementById("notificationCount");

let notifications = [
  { id: 1, text: "Your booking with Ramesh has been confirmed.", unread: true },
  { id: 2, text: "New provider near your location: Sunil Electrician.", unread: true },
  { id: 3, text: "Payment for booking #1234 received.", unread: false },
];

function renderNotifications() {
  notificationList.innerHTML = '';
  if (notifications.length === 0) {
    notificationList.innerHTML = '<div class="notification-empty">No notifications</div>';
    badge.style.display = 'none';
    return;
  }

  notifications.forEach(n => {
    const item = document.createElement('div');
    item.className = `notification-item ${n.unread ? 'unread' : ''}`;
    item.innerHTML = `<span class="icon">🔔</span><div>${n.text}</div>`;
    item.addEventListener('click', () => markAsRead(n.id));
    notificationList.appendChild(item);
  });

  const unreadCount = notifications.filter(n => n.unread).length;
  badge.textContent = unreadCount;
  badge.style.display = unreadCount ? 'inline-block' : 'none';
}

function markAsRead(id) {
  notifications = notifications.map(n =>
    n.id === id ? { ...n, unread: false } : n
  );
  renderNotifications();
}

clearBtn.addEventListener('click', () => {
  notifications = [];
  renderNotifications();
});

notifyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  notificationDropdown.classList.toggle('active');
});

document.addEventListener('click', (e) => {
  if (!notificationDropdown.contains(e.target) && e.target !== notifyBtn) {
    notificationDropdown.classList.remove('active');
  }
});

renderNotifications();
