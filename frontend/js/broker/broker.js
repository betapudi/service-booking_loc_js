// Broker/broker.js
import { initBrokerDashboard } from "./dashboard.js";
import { setupLogoutButton } from "../shared/logout.js";
import { tryGeolocationFallback } from "../shared/geolocation.js";
import { apiCall } from "../shared/api.js";
import { initMap } from "../shared/map.js";

document.addEventListener("DOMContentLoaded", () => {
  initBrokerDashboard();
  setupLogoutButton();
  tryGeolocationFallback();
  setupTabSwitching();
  setupModals();
  //   loadGroupBookingHistory();
  loadBrokerStats();
});

function setupTabSwitching() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(tab => tab.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`${btn.dataset.tab}-tab`).classList.add("active");
    });
  });
}

function setupModals() {
  document.getElementById("openRegisterModalBtn").addEventListener("click", () => {
    document.getElementById("registerProviderModal").classList.remove("hidden");
  });

  document.getElementById("cancelRegisterBtn").addEventListener("click", () => {
    document.getElementById("registerProviderModal").classList.add("hidden");
  });

  document.getElementById("registerProviderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = {
      name: form.name.value,
      mobile_number: form.mobile_number.value,
      location_id: parseInt(form.location_id.value),
      skills: Array.from(form.querySelectorAll("input[name='skill']:checked")).map(i => parseInt(i.value))
    };

    // await brokerRegisterProvider(formData);
    form.reset();
    document.getElementById("registerProviderModal").classList.add("hidden");
    // await loadBrokerProviders();
  });
}

// function loadGroupBookingHistory() {
//   apiCall("/brokers/group-bookings").then(res => {
//     const groups = res.grouped_bookings || [];

//     const html = groups.length
//       ? groups.map(renderGroupBookingCard).join("")
//       : "<p>No completed group bookings found.</p>";

//     document.getElementById("groupBookings").innerHTML = html;
//   });
// }

// function renderGroupBookingCard(group) {
//   const bookingsHtml = group.bookings.map(b => `
//     <li>
//       <strong>Provider:</strong> ${b.provider_name} (${b.provider_mobile})<br/>
//       <strong>Status:</strong> ${b.status}<br/>
//       <strong>Amount:</strong> ₹${b.total_amount}
//     </li>
//   `).join("");

//   return `
//     <div class="group-booking-card">
//       <h4>Request #${group.request_id}</h4>
//       <p><strong>Skill:</strong> ${group.skill_required}</p>
//       <p><strong>Description:</strong> ${group.description}</p>
//       <p><strong>Customer:</strong> ${group.customer_name}</p>
//       <p><strong>Created:</strong> ${new Date(group.created_at).toLocaleDateString()}</p>
//       <p><strong>Providers:</strong> ${group.provider_count}</p>
//       <ul>${bookingsHtml}</ul>
//     </div>
//   `;
// }

document.addEventListener("DOMContentLoaded", () => {
  initMap("mapdiv"); // assumes <div id="mapdiv"></div> exists in HTML
});
function loadBrokerStats() {
  apiCall("/bookings/history").then(res => {
    const bookings = res.bookings || [];
    const brokerId = window.currentUser?.id;

    const brokerBookings = bookings.filter(b => b.broker_id === brokerId);

    const active = brokerBookings.filter(b => ["ACCEPTED", "IN_PROGRESS"].includes(b.status)).length;
    const completed = brokerBookings.filter(b => b.status === "COMPLETED");
    const revenue = completed.reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);
    const commission = revenue * 0.1; // assuming 10% commission

    document.getElementById("totalProviders").textContent = `Total Providers: ${window.managedProviders?.length || 0}`;
    document.getElementById("activeBookings").textContent = `Active Bookings: ${active}`;
    document.getElementById("monthlyRevenue").textContent = `Revenue: ₹${revenue.toFixed(2)}`;
    document.getElementById("totalCommission").textContent = `Commission: ₹${commission.toFixed(2)}`;
  });
}
/* ============================================================
   SLIDE CARD TRANSITIONS + OVERLAY CLICK-TO-CLOSE
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  const bottomBtns = document.querySelectorAll(".bottom-btn");
  const sideCards = document.querySelectorAll(".side-card");
  const overlay = document.getElementById("overlay");

  let activeCard = null;

  // Close all cards smoothly
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

  // When a bottom bar button is clicked
  bottomBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const cardId = btn.getAttribute("data-card");
      const targetCard = document.getElementById(cardId);

      // If the same card is already open → close
      if (activeCard === targetCard) {
        closeAllCards();
        return;
      }

      // Close existing, then open the new one
      closeAllCards();
      setTimeout(() => {
        targetCard.classList.add("active");
        btn.classList.add("active");
        overlay.classList.add("active");
        activeCard = targetCard;
      }, 350); // wait for close animation
    });
  });

  // Click on overlay → close all cards
  overlay.addEventListener("click", () => {
    closeAllCards();
  });

  // Escape key → close all cards
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeAllCards();
  });
});
