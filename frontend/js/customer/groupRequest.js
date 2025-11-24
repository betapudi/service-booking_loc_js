// customer/groupRequest.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { getSocket } from "../shared/socket.js";   // ✅ import socket

export async function loadSkillsForGroupBooking() {
  const res = await apiCall("/profile/skills");
  const skillSelect = document.getElementById("groupSkills");
  if (skillSelect && res.skills) {
    skillSelect.innerHTML = res.skills.map(s => `<option value="${s.name}">${s.name}</option>`).join("");
  }
}
export async function loadLocationDropdown() {
  const res = await apiCall("/location/states"); // or `/location/all` if you have a flat list
  const locationSelect = document.getElementById("groupLocation");
  if (locationSelect && Array.isArray(res)) {
    locationSelect.innerHTML = res.map(loc => `<option value="${loc.id}">${loc.name}</option>`).join("");
  }
}
// customer/groupRequest.js - Enhanced group request functions
export async function loadActiveGroupRequests() {
  try {
    const res = await apiCall("/customers/group-requests");
    const container = document.getElementById("activeGroupRequests");
    const requests = res.requests || [];

    const activeRequests = requests.filter(r =>
      r.status === 'pending' || r.status === 'accepted' || r.status === 'in_progress'
    );

    container.innerHTML = activeRequests.length
      ? activeRequests.map(r => `
        <div class="group-request-card" data-id="${r.id}">
          <div class="card-header">
            <h4>📌 ${r.skill_name} (${r.provider_count} providers)</h4>
            <span class="status ${r.status}">${r.status.toUpperCase()}</span>
          </div>
          <p><strong>📍 Location:</strong> ${r.location_details || 'Not specified'}</p>
          <p><strong>📝 Description:</strong> ${r.description}</p>
          <p><strong>💰 Budget:</strong> ${r.budget_range ? `₹${r.budget_range}` : 'Not specified'}</p>
          <p><strong>📅 Preferred Date:</strong> ${r.preferred_date ? new Date(r.preferred_date).toLocaleDateString() : 'Not specified'}</p>
          <p><strong>🧑‍💼 Broker:</strong> ${r.broker_name || 'Not assigned'} ${r.broker_mobile ? `(${r.broker_mobile})` : ''}</p>
          <p class="timestamp">Created on ${new Date(r.created_at).toLocaleString()}</p>
          <div class="card-actions">
            ${r.status === 'accepted' || r.status === 'in_progress' ?
          `<button class="btn btn-success group-complete-btn" data-id="${r.id}">✅ Mark Entire Group as Completed</button>` : ''}
            ${r.status === 'pending' ?
          `<button class="btn btn-danger group-cancel-btn" data-id="${r.id}">❌ Cancel Entire Group Request</button>` : ''}
          </div>
        </div>
      `).join("")
      : `<p>No active group requests</p>`;

    // Event delegation for group actions
    container.addEventListener('click', (e) => {
      const completeBtn = e.target.closest('.group-complete-btn');
      const cancelBtn = e.target.closest('.group-cancel-btn');

      if (completeBtn) {
        const id = completeBtn.getAttribute('data-id');
        markEntireGroupCompleted(id);
      }

      if (cancelBtn) {
        const id = cancelBtn.getAttribute('data-id');
        cancelEntireGroupRequest(id);
      }
    });

  } catch (error) {
    console.error('Error loading group requests:', error);
    const container = document.getElementById("activeGroupRequests");
    container.innerHTML = `<p class="error">Error loading group requests</p>`;
  }
}

// Cancel entire group request and all related bookings
export async function cancelEntireGroupRequest(groupRequestId) {
  try {
    const res = await apiCall(`/customers/group-requests/${groupRequestId}/cancel`, {
      method: "POST"
    });

    if (res.success) {
      showToast("✅ Entire group request cancelled.", "success");
      await loadActiveGroupRequests(); // refresh group requests list

      // Also refresh booking history to show cancelled bookings
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id && typeof window.loadCustomerBookings === 'function') {
        await window.loadCustomerBookings(user.id);
      }
    }
  } catch (err) {
    console.error("Error cancelling entire group request:", err);
    showToast("❌ Failed to cancel group request", "error");
  }
}

// Mark entire group as completed
async function markEntireGroupCompleted(groupRequestId) {
  try {
    const res = await apiCall(`/customers/group-requests/${groupRequestId}/complete`, {
      method: "POST"
    });

    if (res.success) {
      showToast("✅ Entire group marked as completed.", "success");
      await loadActiveGroupRequests();

      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id && typeof window.loadCustomerBookings === 'function') {
        await window.loadCustomerBookings(user.id);
      }
    }
  } catch (err) {
    console.error("Error completing group request:", err);
    showToast("❌ Failed to mark group as completed", "error");
  }
}

let formInitialized = false;

export function setupGroupRequestForm() {
  if (formInitialized) return;
  formInitialized = true;

  const form = document.getElementById("groupRequestForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const brokerId = parseInt(document.getElementById("groupBroker").value);
    const selectedSkills = Array.from(document.getElementById("groupSkills").selectedOptions).map(o => o.value);
    const providerCount = parseInt(document.getElementById("groupSize").value);
    const locationDetails = document.getElementById("groupVillage").selectedOptions[0]?.textContent;
    const selectedSkillId = await resolveSkillId(selectedSkills[0]); // assuming single skill
    const description = document.getElementById("groupNotes").value;
    const preferredDateRaw = document.getElementById("preferredDate").value;
    const preferredDate = preferredDateRaw ? preferredDateRaw : null;
    const budgetRange = document.getElementById("budgetRange").value || null;

    try {
      // 1. Create group request via API
      const groupRequestRes = await apiCall("/customers/group-requests", {
        method: "POST",
        body: {
          skill_id: selectedSkillId,
          provider_count: providerCount,
          description,
          location_details: locationDetails,
          preferred_date: preferredDate || null,
          budget_range: budgetRange || null,
          broker_id: brokerId
        }
      });

      const groupRequest = groupRequestRes.request;

      // 2. Emit socket event so broker sees it instantly
      const socket = getSocket();
      if (socket) {
        socket.emit("new_group_request", {
          id: groupRequest.id,
          skill_name: selectedSkills[0],
          provider_count: providerCount,
          description,
          location_details: locationDetails,
          preferred_date: preferredDate,
          budget_range: budgetRange,
          broker_id: brokerId,
          customer_id: JSON.parse(localStorage.getItem("user")).id,
          customer_name: JSON.parse(localStorage.getItem("user")).name,
          customer_mobile: JSON.parse(localStorage.getItem("user")).mobile_number,
          status: "PENDING"
        });
        // ✅ Listen for broker updates on this group request
        socket.on("group_request_update", (data) => {
          if (data.group_request_id === groupRequest.id) {
            showToast(`🔄 Group request #${data.group_request_id} updated by broker: ${data.status}`, "info");
            loadActiveGroupRequests();
          }
        });
      }

      showToast("✅ Group request sent successfully", "success");
      form.reset();
      document.getElementById("groupRequestModal").classList.add("hidden");
      document.getElementById("overlay").classList.remove("active");

      await loadActiveGroupRequests();

      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id) {
        await window.loadCustomerBookings(user.id);
      }

    } catch (err) {
      console.error("Group request failed:", err);
      showToast("❌ Failed to send group request.", "error");
    }
  });
}

async function resolveSkillId(skillName) {
  const res = await apiCall("/profile/skills");
  const match = res.skills.find(s => s.name === skillName);
  return match?.id || null;
}


export async function loadAvailableBrokers() {
  const res = await apiCall("/brokers/available");
  const brokerSelect = document.getElementById("groupBroker");

  // ✅ Clear existing options except the placeholder
  brokerSelect.innerHTML = `<option value="">-- Choose a broker --</option>`;

  res.brokers.forEach(b => {
    const option = document.createElement("option");
    option.value = b.id;
    option.textContent = `${b.name} (${b.mobile_number})`;
    brokerSelect.appendChild(option);
  });
}

export async function getLocationLabel(locationId) {
  if (!locationId) return "Unknown";
  const hierarchy = await apiCall(`/location/${locationId}/hierarchy`);
  const names = hierarchy.map(loc => loc.name);
  return names.join(" > ");
}
export async function populateGroupLocationFromUser() {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    if (!user || !user.location_id) {
      console.warn("User or location_id missing. Cannot populate group location.");
      return;
    }

    console.log("Populating group location for:", user.name, "Location ID:", user.location_id);

    const hierarchy = await apiCall(`/location/${user.location_id}/hierarchy`);
    if (!Array.isArray(hierarchy) || hierarchy.length === 0) {
      console.warn("Location hierarchy not found for ID:", user.location_id);
      return;
    }

    const locationLabel = hierarchy.map(loc => loc.name).join(" > ");
    const locationSelect = document.getElementById("groupVillage");

    if (!locationSelect) {
      console.warn("groupLocation select element not found in DOM.");
      return;
    }

    locationSelect.innerHTML = `<option value="${user.location_id}" selected>${locationLabel}</option>`;
  } catch (error) {
    console.error("Error populating group location:", error);
  }
}
export async function setupLocationDropdowns(preselectLocationId = null) {
  const stateSelect = document.getElementById("groupState");
  const districtSelect = document.getElementById("groupDistrict");
  const talukSelect = document.getElementById("groupTaluk");
  const villageSelect = document.getElementById("groupVillage");

  const states = await apiCall("/location/states");
  stateSelect.innerHTML = states.map(s => `<option value="${s.id}">${s.name}</option>`).join("");

  stateSelect.addEventListener("change", async () => {
    const stateId = stateSelect.value;
    const districts = await apiCall(`/location/districts/${stateId}`);
    districtSelect.innerHTML = districts.map(d => `<option value="${d.id}">${d.name}</option>`).join("");
    districtSelect.disabled = false;
    talukSelect.innerHTML = `<option value="">Select Taluk</option>`;
    talukSelect.disabled = true;
    villageSelect.innerHTML = `<option value="">Select Village</option>`;
    villageSelect.disabled = true;
  });

  districtSelect.addEventListener("change", async () => {
    const districtId = districtSelect.value;
    const taluks = await apiCall(`/location/taluks/${districtId}`);
    talukSelect.innerHTML = taluks.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
    talukSelect.disabled = false;
    villageSelect.innerHTML = `<option value="">Select Village</option>`;
    villageSelect.disabled = true;
  });

  talukSelect.addEventListener("change", async () => {
    const talukId = talukSelect.value;
    const villages = await apiCall(`/location/villages/${talukId}`);
    villageSelect.innerHTML = villages.map(v => `<option value="${v.id}">${v.name}</option>`).join("");
    villageSelect.disabled = false;
  });

  if (preselectLocationId) {
    await prefillLocationHierarchy(preselectLocationId);
  }
}
async function prefillLocationHierarchy(locationId) {
  const hierarchy = await apiCall(`/location/${locationId}/hierarchy`);
  const state = hierarchy.find(loc => loc.type === "state");
  const district = hierarchy.find(loc => loc.type === "district");
  const taluk = hierarchy.find(loc => loc.type === "taluk");
  const village = hierarchy.find(loc => loc.type === "village");

  if (state) {
    document.getElementById("groupState").value = state.id;
    document.getElementById("groupState").dispatchEvent(new Event("change"));
  }

  if (district) {
    setTimeout(async () => {
      const districts = await apiCall(`/location/districts/${state.id}`);
      document.getElementById("groupDistrict").innerHTML = districts.map(d => `<option value="${d.id}" ${d.id == district.id ? "selected" : ""}>${d.name}</option>`).join("");
      document.getElementById("groupDistrict").disabled = false;
      document.getElementById("groupDistrict").dispatchEvent(new Event("change"));
    }, 500);
  }

  if (taluk) {
    setTimeout(async () => {
      const taluks = await apiCall(`/location/taluks/${district.id}`);
      document.getElementById("groupTaluk").innerHTML = taluks.map(t => `<option value="${t.id}" ${t.id == taluk.id ? "selected" : ""}>${t.name}</option>`).join("");
      document.getElementById("groupTaluk").disabled = false;
      document.getElementById("groupTaluk").dispatchEvent(new Event("change"));
    }, 1000);
  }

  if (village) {
    setTimeout(async () => {
      const villages = await apiCall(`/location/villages/${taluk.id}`);
      document.getElementById("groupVillage").innerHTML = villages.map(v => `<option value="${v.id}" ${v.id == village.id ? "selected" : ""}>${v.name}</option>`).join("");
      document.getElementById("groupVillage").disabled = false;
    }, 1500);
  }
}
const budgetInput = document.getElementById("budgetRange");
const budgetError = document.getElementById("budgetError");

const budgetRegex = /^₹?\s*\d{3,6}\s*-\s*₹?\s*\d{3,6}$/;

budgetInput.addEventListener("input", () => {
  const value = budgetInput.value.trim();
  const isValid = budgetRegex.test(value);
  budgetError.classList.toggle("hidden", isValid);
});
function estimateCost(skill, size) {
  const baseRates = {
    Electrician: 800,
    Plumber: 700,
    Carpenter: 600,
    Painter: 500
  };

  const rate = baseRates[skill] || 500;
  const total = rate * size;

  return `Estimated cost: ₹${total.toLocaleString()} (₹${rate} per provider)`;
}
const skillSelect = document.getElementById("groupSkills");
const sizeInput = document.getElementById("groupSize");
const estimateDiv = document.createElement("div");
estimateDiv.id = "costEstimate";
estimateDiv.style.marginTop = "0.5rem";
skillSelect.parentNode.appendChild(estimateDiv);

function updateEstimate() {
  const skill = skillSelect.value;
  const size = parseInt(sizeInput.value);
  if (skill && size > 0) {
    estimateDiv.textContent = estimateCost(skill, size);
  } else {
    estimateDiv.textContent = "";
  }
}
// async function markGroupRequestCompleted(id) {
//   try {
//     const res = await apiCall(`/customers/group-requests/${id}/complete`, { method: "POST" });
//     if (res.success) {
//       showToast("✅ Booking marked as completed.", "success");
//     };

//   } catch (err) {
//     console.error("Error completing request:", err);
//     Swal.fire("Error", "Could not mark as completed", "error");
//   }
// }

// customer/groupRequest.js - Make cancelGroupRequest exportable
// export async function cancelGroupRequest(id) {
//   try {
//     const res = await apiCall(`/customers/group-requests/${id}/cancel`, {
//       method: "POST"
//     });

//     if (res.success) {
//       showToast("✅ Group request cancelled.", "success");
//       await loadActiveGroupRequests(); // refresh list

//       // Also refresh booking history to show cancelled request in history
//       const user = JSON.parse(localStorage.getItem("user") || "{}");
//       if (user.id && typeof window.loadCustomerBookings === 'function') {
//         window.loadCustomerBookings(user.id);
//       }
//     } else {
//       showToast("❌ Failed to cancel group request", "error");
//     }
//   } catch (err) {
//     console.error("Error cancelling request:", err);
//     showToast("❌ Failed to cancel group request", "error");
//   }
// }
skillSelect.addEventListener("change", updateEstimate);
sizeInput.addEventListener("input", updateEstimate);
