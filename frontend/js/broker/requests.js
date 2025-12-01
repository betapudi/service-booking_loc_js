// broker/requests.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { plotRequestWithProviders } from "../shared/map.js";

export async function loadGroupRequests() {
  const res = await apiCall("/brokers/group-requests");
  const requests = res.requests || [];
  console.log("Group Requests:", requests);
  const container = document.getElementById("customerRequests");

  if (!container) return;

  container.innerHTML = requests.length
    ? requests.map(renderRequestCard).join("")
    : `<div class="empty-state"><p>No Customer Requests</p></div>`;
}

// function renderRequestCard(r) {
//   return `
//     <div class="request-card">
//       <h4>📨 Request #${r.id} — ${r.skill_name}</h4>
//       <p><strong>Customer:</strong> ${r.customer_name} (${r.customer_mobile})</p>
//       <p><strong>Providers Needed:</strong> ${r.provider_count}</p>
//       <p><strong>Location:</strong> ${r.location_details}</p>
//       <p><strong>Budget:</strong> ${r.budget_range || "N/A"}</p>
//       <p><strong>Status:</strong> ${r.request_status}</p>
//       <button class="assign-btn"
//         data-id="${r.id}"
//         data-providers='${JSON.stringify(r.matching_providers)}'>
//         Assign Providers
//       </button>
//     </div>
//   `;
// }
import { addMarker, centerMap } from "../shared/map.js";

function renderRequestCard(r) {
  return `
    <div class="request-card">
      <h4>📨 Request #${r.id} — ${r.skill_name}</h4>
      <p><strong>Customer:</strong> ${r.customer_name} (${r.customer_mobile})</p>
      <p><strong>Providers Needed:</strong> ${r.provider_count}</p>
      <p><strong>Location:</strong> ${r.location_details}</p>
      <p><strong>Budget:</strong> ${r.budget_range || "N/A"}</p>
      <p><strong>Status:</strong> ${r.request_status}</p>
      <button class="map-btn"
        data-lat="${r.customer_lat}"
        data-lng="${r.customer_lng}"
        data-name="${r.customer_name}">
        📍 View Customer on Map
      </button>
      <button class="plot-combined-btn"
      data-customer='${JSON.stringify({ id: r.customer_id, name: r.customer_name, lat: r.customer_lat, lng: r.customer_lng })}'
      data-providers='${JSON.stringify(r.matching_providers)}'>
      📍 Plot Customer + Providers
      </button>
      <button class="assign-btn"
        data-id="${r.id}"
        data-providers='${JSON.stringify(r.matching_providers)}'>
        Assign Providers
      </button>
    </div>
  `;
}

document.addEventListener("click", e => {
  if (e.target.classList.contains("map-btn")) {
    const { lat, lng, name } = e.target.dataset;
    addMarker(parseFloat(lat), parseFloat(lng), `Customer: ${name}`, "👤");
    centerMap(parseFloat(lat), parseFloat(lng));
  }
  if (e.target.classList.contains("plot-combined-btn")) {
    const customer = JSON.parse(e.target.dataset.customer);
    const providers = JSON.parse(e.target.dataset.providers);
    plotRequestWithProviders(customer, providers);
  }
});

export function openProviderModal(requestId, providers) {
  document.getElementById("modalRequestId").textContent = requestId;
  const list = document.getElementById("providerList");

  if (!Array.isArray(providers) || providers.length === 0) {
    list.innerHTML = "<p>No matching providers found.</p>";
  } else {
    list.innerHTML = providers.map(p => `
      <label class="provider-card">
        <input type="checkbox" value="${p.id}" />
        <strong>${p.name}</strong> (${p.mobile_number})<br/>
        Skills: ${Array.isArray(p.skills) ? p.skills.join(", ") : "N/A"}
      </label>
    `).join("");
  }

  document.getElementById("providerModal").classList.remove("hidden");
}


export function closeProviderModal() {
  document.getElementById("providerModal").classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const confirmBtn = document.getElementById("confirmProviderBtn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      const requestId = document.getElementById("modalRequestId").textContent;
      const totalAmount = parseInt(document.getElementById("totalAmountInput").value);
      const selected = Array.from(document.querySelectorAll("#providerList input:checked"))
        .map(i => parseInt(i.value));

      if (selected.length === 0 || !totalAmount) {
        showToast("❌ Select providers and enter amount", "error");
        return;
      }

      await acceptGroupRequest(requestId, selected, totalAmount);
      closeProviderModal();
    });
  }
});
export async function acceptGroupRequest(requestId, selected, totalAmount) {
  try {
    const res = await apiCall(`/brokers/customer-requests/${requestId}/accept`, {
      method: "POST",
      body: {
        provider_ids: selected,
        total_amount: totalAmount
      }
    });

    showToast("✅ Group request accepted and bookings created.", "success");
    console.log("Created bookings:", res.bookings);
    await loadGroupRequests(); // refresh list
  } catch (err) {
    console.error("Failed to accept group request:", err);
    showToast("❌ Failed to accept request.", "error");
  }
}

document.addEventListener("click", e => {
  if (e.target.classList.contains("assign-btn")) {
    const requestId = e.target.dataset.id;
    const providers = JSON.parse(e.target.dataset.providers);
    openProviderModal(requestId, providers);
  }

  if (e.target.id === "cancelProviderBtn") {
    closeProviderModal();
  }
});

// Optional: expose modal functions globally if needed by inline HTML
window.openProviderModal = openProviderModal;
window.closeProviderModal = closeProviderModal;
