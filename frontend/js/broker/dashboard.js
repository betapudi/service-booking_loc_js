// Broker/dashboard.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { setupSocket } from "../shared/socket.js";
import { loadGroupRequests } from "./requests.js";
import { loadBrokerProviders } from "./providers.js";
import { loadGroupBookings } from "./bookings.js";

let currentUser = null;

export async function initBrokerDashboard() {
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  if (!user || user.role !== "broker") {
    showToast("Unauthorized. Please login as broker.", "error");
    window.location.href = "index.html";
    return;
  }

  currentUser = user;
  document.getElementById("userName").textContent = user.name || "Customer";
  // document.querySelector(".brand").textContent = `WorkConnect — Broker Dashboard`;
  setupCollapsibleHandlers();

  const socket = setupSocket(user.id, token, {
    // New group request directed to this broker
    new_group_request: ({ booking }) => {
      if (booking?.broker_id === user.id) {
        showToast(`📨 New group request from ${booking.customer_name}`, "info");
        loadGroupRequests(user.id);
      }
    },

    // Group request lifecycle updates
    group_request_accepted: (data) => {
      if (data.broker_id && data.broker_id !== user.id) return;
      showToast(`✅ Group request #${data.request_id} accepted`, "success");
      loadGroupRequests(user.id);
      loadGroupBookings(user.id);
    },

    group_request_cancelled: (data) => {
      if (data.broker_id && data.broker_id !== user.id) return;
      showToast(`❌ Group request #${data.request_id} cancelled`, "warning");
      loadGroupRequests(user.id);
      loadGroupBookings(user.id);
    },

    // Broker-owned provider lifecycle
    user_registered: (u) => {
      if (u.role === "provider" && u.registered_by_broker === user.id) {
        showToast(`✅ Provider registered: ${u.name}`, "success");
        loadBrokerProviders(user.id);
      }
    },

    user_verified: (u) => {
      if (u.role === "provider" && u.verified_by_broker === user.id) {
        showToast(`✅ Provider verified: ${u.mobile_number}`, "info");
        loadBrokerProviders(user.id);
      }
    },

    // Group bookings progress
    booking_status_update: () => loadGroupBookings(user.id),
    booking_completed: () => loadGroupBookings(user.id)
  });

  socket.emit("register", user.id);
  socket.emit("subscribe_broker", { broker_id: user.id });

  await loadGroupRequests(user.id);
  await loadBrokerProviders(user.id);
  await loadGroupBookings(user.id);
  await loadSkillOptions();
  await loadStates();
}

function setupCollapsibleHandlers() {
  document.querySelectorAll(".collapsible-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.parentElement;
      section.classList.toggle("open");
      const icon = header.querySelector(".collapsible-icon");
      icon.textContent = section.classList.contains("open") ? "▼" : "▶";
    });
  });
}

// The direct REST actions to assign/cancel group requests remain unchanged,
// but we remove emitGroupUpdate since the backend itself emits the socket events.

async function loadSkillOptions() {
  const res = await apiCall("/profile/skills");
  const skills = res.skills || [];
  const container = document.getElementById("skillCheckboxes");

  container.innerHTML = skills
    .map(
      s => `
    <label>
      <input type="checkbox" name="skill" value="${s.id}" />
      ${s.name}
    </label>
  `
    )
    .join("");
}

async function loadStates() {
  const res = await apiCall("/location/states");
  const stateSelect = document.getElementById("stateSelect");
  stateSelect.innerHTML =
    `<option value="">Select State</option>` +
    res.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
}

async function loadDistricts(stateId) {
  const res = await apiCall(`/location/districts/${stateId}`);
  const districtSelect = document.getElementById("districtSelect");
  districtSelect.innerHTML =
    `<option value="">Select District</option>` +
    res.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
}

async function loadTaluks(districtId) {
  const res = await apiCall(`/location/taluks/${districtId}`);
  const talukSelect = document.getElementById("talukSelect");
  talukSelect.innerHTML =
    `<option value="">Select Taluk</option>` +
    res.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

async function loadVillages(talukId) {
  const res = await apiCall(`/location/villages/${talukId}`);
  const villageSelect = document.getElementById("locationSelect");
  villageSelect.innerHTML =
    `<option value="">Select Village</option>` +
    res.map(v => `<option value="${v.id}">${v.name}</option>`).join("");
}

document.getElementById("stateSelect").addEventListener("change", e => {
  loadDistricts(e.target.value);
  document.getElementById("districtSelect").innerHTML = `<option value="">Select District</option>`;
  document.getElementById("talukSelect").innerHTML = `<option value="">Select Taluk</option>`;
  document.getElementById("locationSelect").innerHTML = `<option value="">Select Village</option>`;
});

document.getElementById("districtSelect").addEventListener("change", e => {
  loadTaluks(e.target.value);
  document.getElementById("talukSelect").innerHTML = `<option value="">Select Taluk</option>`;
  document.getElementById("locationSelect").innerHTML = `<option value="">Select Village</option>`;
});

document.getElementById("talukSelect").addEventListener("change", e => {
  loadVillages(e.target.value);
  document.getElementById("locationSelect").innerHTML = `<option value="">Select Village</option>`;
});

