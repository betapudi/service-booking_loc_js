// Broker/dashboard.js
import { apiCall } from "../shared/api.js";
import { showToast, switchTab } from "../shared/ui.js";
import { setupSocket } from "../shared/socket.js";
import { loadGroupRequests } from "./requests.js";
import { loadBrokerProviders } from "./providers.js";
import { loadGroupBookings } from "./bookings.js";


export async function initBrokerDashboard() {
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  if (!user || user.role !== "broker") {
    showToast("Unauthorized. Please login as broker.", "error");
    window.location.href = "index.html";
    return;
  }

  document.querySelector(".brand").textContent = `WorkConnect — Broker Dashboard`;
  setupTabHandlers();

  // ✅ Socket listeners
  setupSocket(user.id, token, {
    new_group_request: (groupRequest) => {
      showToast(`📨 New group request #${groupRequest.id} from ${groupRequest.customer_name}`, "info");
      renderIncomingGroupRequest(groupRequest);
      loadGroupRequests(user.id);
    },
    provider_registered: () => loadBrokerProviders(user.id),
    // 🔧 NEW: listen for group_request_update
    group_request_update: (data) => {
      const { group_request_id, status } = data;
      showToast(`🔄 Group request #${group_request_id} updated: ${status}`, "info");
      loadGroupRequests(user.id);
      loadGroupBookings(user.id);
    },
    booking_status_update: () => loadGroupBookings(user.id),
    booking_completed: () => loadGroupBookings(user.id)
  });

  await loadGroupRequests(user.id);
  await loadBrokerProviders(user.id);
  await loadGroupBookings(user.id);
  await loadSkillOptions();
  await loadStates();
}

function setupTabHandlers() {
  document.querySelectorAll(".collapsible-header").forEach(header => {
    header.addEventListener("click", () => {
      const section = header.parentElement;
      section.classList.toggle("open");
      const icon = header.querySelector(".collapsible-icon");
      icon.textContent = section.classList.contains("open") ? "▼" : "▶";
    });
  });
}
// ✅ Render incoming group request card
function renderIncomingGroupRequest(request) {
  const container = document.getElementById("customerRequests");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "group-request-card";
  card.innerHTML = `
    <strong>Group Request #${request.id}</strong><br/>
    Skill: ${request.skill_name}<br/>
    Providers Needed: ${request.provider_count}<br/>
    Customer: ${request.customer_name} (${request.customer_mobile})<br/>
    Status: ${request.status}<br/>
    <button class="assign-btn" data-id="${request.id}">✅ Assign Providers</button>
    <button class="cancel-btn" data-id="${request.id}">❌ Cancel Request</button>
  `;
  container.prepend(card);

  // Attach event listeners
  card.querySelector(".assign-btn").addEventListener("click", () => {
    assignProvidersToGroup(request.id);
  });
  card.querySelector(".cancel-btn").addEventListener("click", () => {
    cancelGroupRequest(request.id);
  });
}

// ✅ Broker actions
async function assignProvidersToGroup(groupRequestId) {
  try {
    const res = await apiCall(`/brokers/group-requests/${groupRequestId}/assign`, { method: "POST" });
    if (res.success) {
      showToast("✅ Providers assigned to group request", "success");
      loadGroupRequests();
      emitGroupUpdate(groupRequestId, "ASSIGNED");
    }
  } catch (err) {
    console.error("Failed to assign providers:", err);
    showToast("❌ Failed to assign providers", "error");
  }
}

async function cancelGroupRequest(groupRequestId) {
  try {
    const res = await apiCall(`/brokers/group-requests/${groupRequestId}/cancel`, { method: "POST" });
    if (res.success) {
      showToast("✅ Group request cancelled", "success");
      loadGroupRequests();
      emitGroupUpdate(groupRequestId, "CANCELLED");
    }
  } catch (err) {
    console.error("Failed to cancel group request:", err);
    showToast("❌ Failed to cancel group request", "error");
  }
}
// ✅ Emit updates back to customers
function emitGroupUpdate(groupRequestId, status) {
  const socket = getSocket();
  if (!socket) return;
  socket.emit("group_request_update", {
    group_request_id: groupRequestId,
    broker_id: JSON.parse(localStorage.getItem("user")).id,
    status
  });
}

document.getElementById("registerProviderForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = {
    name: form.name.value,
    mobile_number: form.mobile_number.value,
    location_id: parseInt(form.location_id.value),
    skills: Array.from(form.querySelectorAll("input[name='skill']:checked")).map(i => parseInt(i.value))
  };

  try {
    const res = await apiCall("/brokers/register-provider", {
      method: "POST",
      body: formData
    });

    showToast("✅ Provider registered. OTP sent.", "success");
    form.reset();
    await loadBrokerProviders();
  } catch (err) {
    console.error("Registration failed:", err);
    showToast("❌ Failed to register provider.", "error");
  }
});
async function loadSkillOptions() {
  const res = await apiCall("/profile/skills");
  const skills = res.skills || [];
  const container = document.getElementById("skillCheckboxes");

  container.innerHTML = skills.map(s => `
    <label>
      <input type="checkbox" name="skill" value="${s.id}" />
      ${s.name}
    </label>
  `).join("");
}

async function loadStates() {
  const res = await apiCall("/location/states");
  const stateSelect = document.getElementById("stateSelect");
  stateSelect.innerHTML = `<option value="">Select State</option>` +
    res.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
}

async function loadDistricts(stateId) {
  const res = await apiCall(`/location/districts/${stateId}`);
  const districtSelect = document.getElementById("districtSelect");
  districtSelect.innerHTML = `<option value="">Select District</option>` +
    res.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
}

async function loadTaluks(districtId) {
  const res = await apiCall(`/location/taluks/${districtId}`);
  const talukSelect = document.getElementById("talukSelect");
  talukSelect.innerHTML = `<option value="">Select Taluk</option>` +
    res.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
}

async function loadVillages(talukId) {
  const res = await apiCall(`/location/villages/${talukId}`);
  const villageSelect = document.getElementById("locationSelect");
  villageSelect.innerHTML = `<option value="">Select Village</option>` +
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
