// customer/booking.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { mapInstance, addMarker, centerMap } from "../shared/map.js";
import { getSocket } from "../shared/socket.js";

let currentRouteLayer = null;
let providerMarker = null;


// export async function loadCustomerBookings(customerId) {
//   const res = await apiCall("/bookings/history");
//   const bookings = res.bookings || [];
//   const customerBookings = bookings.filter(b => b.customer_id === customerId);

//   const total = customerBookings.length;
//   const active = customerBookings.filter(b => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)).length;
//   const completed = customerBookings.filter(b => b.status === "COMPLETED").length;
//   const spent = customerBookings
//     .filter(b => b.status === "COMPLETED")
//     .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

//   document.getElementById("totalBookings").textContent = total;
//   document.getElementById("activeBookings").textContent = active;
//   document.getElementById("completedBookings").textContent = completed;
//   document.getElementById("totalSpent").textContent = `₹${spent}`;

//   renderActiveBookings(customerBookings);
//   renderBookingHistory(customerBookings);
// }

// export async function updateBookingStatus(id, status) {
//   const res = await apiCall(`/bookings/${id}/status`, {
//     method: "POST",
//     body: { status }
//   });

//   if (res.booking) {
//     showToast(`Booking #${id} marked as ${status}`, "success");
//     await loadCustomerBookings(res.booking.customer_id);
//     if (res.booking.status === "ACCEPTED") {
//       startRouteTracking(res.booking);
//     }
//   } else {
//     showToast("Failed to update booking", "error");
//   }
// }
// customer/booking.js - Add this to ensure tabs work on initial load
// export async function loadCustomerBookings(customerId) {
//   try {
//     // Get regular bookings
//     const bookingsRes = await apiCall("/bookings/history");
//     const bookings = bookingsRes.bookings || [];
//     const customerBookings = bookings.filter(b => b.customer_id === customerId);

//     // console.log("Loaded customer bookings:", customerBookings.length);
//     // console.log("Individual bookings:", customerBookings.filter(b => !b.metadata?.group_booking).length);
//     // console.log("Group bookings:", customerBookings.filter(b => b.metadata?.group_booking).length);

//     const total = customerBookings.length;
//     const active = customerBookings.filter(b => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)).length;
//     const completed = customerBookings.filter(b => b.status === "COMPLETED").length;
//     const spent = customerBookings
//       .filter(b => b.status === "COMPLETED")
//       .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

//     document.getElementById("totalBookings").textContent = total;
//     document.getElementById("activeBookings").textContent = active;
//     document.getElementById("completedBookings").textContent = completed;
//     document.getElementById("totalSpent").textContent = `₹${spent}`;

//     renderActiveBookings(customerBookings);
//     renderBookingHistory(customerBookings);

//   } catch (error) {
//     console.error("Error loading customer bookings:", error);
//     showToast("Failed to load booking history", "error");

//     // Show error in UI
//     const container = document.getElementById("bookingHistory");
//     container.innerHTML = `
//       <div class="error-message">
//         <p>❌ Failed to load booking history</p>
//         <small>${error.message}</small>
//       </div>
//     `;
//   }
// }
export async function loadCustomerBookings(customerId) {
  try {
    const res = await apiCall("/bookings/history");
    const bookings = res.bookings || [];

    // Filter out provider assignments that belong to group requests
    const customerBookings = bookings.filter(b => {
      // Exclude bookings that are provider assignments (have provider_id but customer_id doesn't match)
      const isProviderAssignment = b.provider_id && b.customer_id !== customerId;
      
      // Include only:
      // 1. Bookings where customer_id matches the current user
      // 2. AND are not provider assignments for other customers
      return b.customer_id === customerId && !isProviderAssignment;
    });

    const total = customerBookings.length;
    const active = customerBookings.filter(b => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status)).length;
    const completed = customerBookings.filter(b => b.status === "COMPLETED").length;
    const spent = customerBookings
      .filter(b => b.status === "COMPLETED")
      .reduce((sum, b) => sum + (parseFloat(b.total_amount) || 0), 0);

    document.getElementById("totalBookings").textContent = total;
    document.getElementById("activeBookings").textContent = active;
    document.getElementById("completedBookings").textContent = completed;
    document.getElementById("totalSpent").textContent = `₹${spent}`;

    renderActiveBookings(customerBookings);
    renderBookingHistory(customerBookings);

  } catch (error) {
    console.error("Error loading customer bookings:", error);
    showToast("Failed to load booking history", "error");

    const container = document.getElementById("bookingHistory");
    container.innerHTML = `
      <div class="error-message">
        <p>❌ Failed to load booking history</p>
        <small>${error.message}</small>
      </div>
    `;
  }
}
// export async function updateBookingStatus(id, status) {
//   const res = await apiCall(`/bookings/${id}/status`, {
//     method: "POST",
//     body: { status }
//   });

//   if (!status) {
//     return res.status(400).json({ error: "Missing status" });
//   }
//   if (res.booking) {
//     showToast(`Booking #${id} marked as ${status}`, "success");

//     // ✅ Always use logged-in customer ID for refresh
//     const user = JSON.parse(localStorage.getItem("user") || "{}");
//     const customerId = user?.id || res.booking.customer_id;

//     if (customerId) {
//       await loadCustomerBookings(customerId);
//     } else {
//       console.warn("⚠️ No valid customer ID found for refresh");
//     }

//     if (res.booking.status === "ACCEPTED") {
//       startRouteTracking(res.booking);
//     }
//   } else {
//     showToast("Failed to update booking", "error");
//   }
// }
// customer/booking.js - Enhanced updateBookingStatus for group bookings
export async function updateBookingStatus(id, status) {
  try {
    const res = await apiCall(`/bookings/${id}/status`, {
      method: "POST",
      body: { status }
    });

    if (res.booking) {
      showToast(`Booking #${id} marked as ${status}`, "success");

      // FIX: If this is a group booking, update ALL related bookings and group request
      if (res.booking.group_request_id) {
        await updateEntireGroupRequest(res.booking.group_request_id, status);
      }

      // Refresh both bookings and group requests
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id) {
        await loadCustomerBookings(user.id);
        if (typeof window.loadActiveGroupRequests === 'function') {
          await window.loadActiveGroupRequests();
        }
      }

      if (res.booking.status === "ACCEPTED") {
        startRouteTracking(res.booking);
      }
    } else {
      showToast("Failed to update booking", "error");
    }
  } catch (error) {
    console.error("Error updating booking status:", error);
    // ... error handling
  }
}

// Update entire group request and all related bookings
async function updateEntireGroupRequest(groupRequestId, status) {
  try {
    await apiCall(`/group-requests/${groupRequestId}/status`, {
      method: "POST",
      body: { status }
    });
  } catch (error) {
    console.error("Failed to update group request:", error);
  }
}

function renderActiveBookings(bookings) {
  const container = document.getElementById("bookingRequests");
  container.innerHTML = bookings
    .filter(b => ["PENDING", "ACCEPTED", "IN_PROGRESS"].includes(b.status))
    .map(b => {
      const canCancel = ["PENDING", "ACCEPTED"].includes(b.status);
      const canComplete = b.status === "ACCEPTED";

      return `
        <div class="booking-card ${b.status.toLowerCase()}">
          ${b.status === "ACCEPTED" ? `<button id="track-Btn" class="track-btn btn-primary" data-id="${b.id}">📍 Track</button>` : ""}
          <strong>Booking #${b.id}</strong><br/>
          Status: ${b.status}<br/>
          Provider: ${b.provider_name || "N/A"}<br/>
          Skills: ${b.metadata?.provider_skills?.join(", ") || "N/A"}<br/>
          Amount: ₹${b.total_amount || 0}<br/>
          ${canCancel ? `<button class="cancel-btn" data-id="${b.id}">❌ Cancel</button>` : ""}
          ${canComplete ? `<button class="complete-btn" data-id="${b.id}">✅ Mark as Completed</button>` : ""}
        </div>
      `;
    }).join("") || `<p>No active bookings</p>`;
}

// function renderBookingHistory(bookings) {
//   const container = document.getElementById("bookingHistory");
//   container.innerHTML = bookings
//     .filter(b => ["COMPLETED", "CANCELLED", "REJECTED"].includes(b.status))
//     .map(b => `
//       <div class="booking-card history">
//         <strong>Booking #${b.id}</strong><br/>
//         Status: ${b.status}<br/>
//         Provider: ${b.provider_name || "N/A"}<br/>
//         Skills: ${b.metadata?.provider_skills?.join(", ") || "N/A"}<br/>
//         Amount: ₹${b.total_amount || 0}
//       </div>
//     `).join("") || `<p>No booking history</p>`;
// }

// customer/booking.js - Updated renderBookingHistory function
// customer/booking.js - Completely rewritten renderBookingHistory with tabs
// customer/booking.js - Enhanced booking history rendering
function renderBookingHistory(bookings) {
  const container = document.getElementById("bookingHistory");
  
  // Separate individual and group bookings
  const individualBookings = bookings.filter(b =>
    ["COMPLETED", "CANCELLED", "REJECTED"].includes(b.status) &&
    !b.group_request_id // Individual bookings don't have group_request_id
  );

  const groupBookings = bookings.filter(b =>
    ["COMPLETED", "CANCELLED", "REJECTED"].includes(b.status) &&
    b.group_request_id // Group bookings have group_request_id
  );

  container.innerHTML = `
    <div class="tab-content active" id="individual-tab">
      <div class="history-section">
        <h4 class="section-header">📋 Individual Bookings</h4>
        <div class="history-cards">
          ${renderIndividualBookings(individualBookings)}
        </div>
      </div>
    </div>
    
    <div class="tab-content" id="group-tab">
      <div class="history-section">
        <h4 class="section-header">👥 Group Bookings</h4>
        <div class="history-cards">
          ${renderGroupBookingsWithContext(groupBookings)}
        </div>
      </div>
    </div>
  `;

  setupHistoryTabs();
}

// Enhanced group booking rendering with group context
function renderGroupBookingsWithContext(groupBookings) {
  if (groupBookings.length === 0) {
    return `<div class="no-history">No group booking history</div>`;
  }

  // Group by group_request_id
  const groupedBookings = {};
  groupBookings.forEach(b => {
    const groupId = b.group_request_id;
    
    if (!groupedBookings[groupId]) {
      groupedBookings[groupId] = {
        group_request_id: groupId,
        bookings: [],
        total_amount: 0,
        status: b.status,
        created_at: b.created_at,
        skill_required: b.metadata?.skill_required || "Multiple Skills",
        provider_count: b.metadata?.provider_count || 1,
        description: b.metadata?.description || "Group Service"
      };
    }
    
    groupedBookings[groupId].bookings.push(b);
    groupedBookings[groupId].total_amount += parseFloat(b.total_amount) || 0;
  });

  return Object.values(groupedBookings).map(group => {
    return `
      <div class="booking-card history group">
        <div class="booking-header">
          <strong>Group Request #${group.group_request_id}</strong>
          <span class="status-badge ${group.status.toLowerCase()}">${group.status}</span>
        </div>
        <div class="booking-details">
          <p><strong>Service:</strong> ${group.skill_required}</p>
          <p><strong>Providers:</strong> ${group.bookings.length} of ${group.provider_count}</p>
          <p><strong>Description:</strong> ${group.description}</p>
          <p><strong>Total Amount:</strong> ₹${(group.total_amount || 0).toLocaleString()}</p>
          <p><strong>Completed:</strong> ${new Date(group.created_at).toLocaleDateString()}</p>
          <div class="provider-list">
            <strong>Assigned Providers:</strong>
            ${group.bookings.map(b => `
              <span class="provider-tag">${b.provider_name || 'Unknown'}</span>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join("");
}
// customer/booking.js - Keep your existing renderIndividualBookings but make it consistent
function renderIndividualBookings(bookings) {
  if (bookings.length === 0) {
    return `<div class="no-history">No individual booking history</div>`;
  }

  return bookings.map(b => `
    <div class="booking-card history individual">
      <div class="booking-header">
        <strong>Booking #${b.id}</strong>
        <span class="status-badge ${(b.status || '').toLowerCase()}">${b.status || 'UNKNOWN'}</span>
      </div>
      <div class="booking-details">
        <p><strong>Provider:</strong> ${b.provider_name || "N/A"}</p>
        <p><strong>Skills:</strong> ${b.metadata?.provider_skills?.join(", ") || "N/A"}</p>
        <p><strong>Amount:</strong> ₹${b.total_amount || 0}</p>
        <p><strong>Date:</strong> ${new Date(b.created_at).toLocaleDateString()}</p>
      </div>
    </div>
  `).join("");
}

// function renderGroupBookings(bookings) {
//   if (bookings.length === 0) {
//     return `<div class="no-history">No group booking history</div>`;
//   }

//   // Group by original_request_id to show consolidated group requests
//   const groupedBookings = {};
//   bookings.forEach(b => {
//     const groupId = b.metadata?.original_request_id || `group_${b.id}`;
//     if (!groupedBookings[groupId]) {
//       groupedBookings[groupId] = {
//         id: groupId,
//         bookings: [],
//         provider_count: b.metadata?.provider_count || 1,
//         skill_required: b.metadata?.skill_required || "Multiple Skills",
//         description: b.metadata?.description || "Group Service",
//         total_amount: 0,
//         created_at: b.created_at,
//         status: b.status
//       };
//     }
//     groupedBookings[groupId].bookings.push(b);
//     groupedBookings[groupId].total_amount += parseFloat(b.total_amount) || 0;
//   });

//   return Object.values(groupedBookings).map(group => {
//     const displayId = typeof group.id === 'string' ? group.id.replace('group_', '') : group.id;

//     return `
//     <div class="booking-card history group">
//       <div class="booking-header">
//         <strong>Group Request #${displayId}</strong>
//         <span class="status-badge ${group.status.toLowerCase()}">${group.status}</span>
//       </div>
//       <div class="booking-details">
//         <p><strong>Service:</strong> ${group.skill_required}</p>
//         <p><strong>Providers:</strong> ${group.bookings.length} of ${group.provider_count}</p>
//         <p><strong>Description:</strong> ${group.description}</p>
//         <p><strong>Total Amount:</strong> ₹${group.total_amount.toLocaleString()}</p>
//         <p><strong>Completed:</strong> ${new Date(group.created_at).toLocaleDateString()}</p>
//         <div class="provider-list">
//           <strong>Assigned Providers:</strong>
//           ${group.bookings.map(b => `
//             <span class="provider-tag">${b.provider_name || 'Unknown'}</span>
//           `).join('')}
//         </div>
//       </div>
//     </div>
//   `;
//   }).join("");
// }
// customer/booking.js - More robust renderGroupBookings
function renderGroupBookings(bookings) {
  if (bookings.length === 0) {
    return `<div class="no-history">No group booking history</div>`;
  }

  console.log("Processing group bookings:", bookings);

  // Group by original_request_id to show consolidated group requests
  const groupedBookings = {};

  bookings.forEach(b => {
    try {
      // Safely extract group ID
      let groupId;
      if (b.metadata && b.metadata.original_request_id) {
        groupId = b.metadata.original_request_id;
      } else if (b.metadata && b.metadata.group_booking) {
        groupId = `group_${b.id}`;
      } else {
        // Skip if it's not actually a group booking
        return;
      }

      if (!groupedBookings[groupId]) {
        groupedBookings[groupId] = {
          id: groupId,
          bookings: [],
          provider_count: (b.metadata && b.metadata.provider_count) || 1,
          skill_required: (b.metadata && b.metadata.skill_required) || "Multiple Skills",
          description: (b.metadata && b.metadata.description) || "Group Service",
          total_amount: 0,
          created_at: b.created_at,
          status: b.status
        };
      }

      groupedBookings[groupId].bookings.push(b);
      groupedBookings[groupId].total_amount += parseFloat(b.total_amount) || 0;
      console.log(groupedBookings[groupId]);

    } catch (error) {
      console.error("Error processing booking:", b, error);
    }
  });

  const groupEntries = Object.values(groupedBookings);

  if (groupEntries.length === 0) {
    return `<div class="no-history">No group booking history</div>`;
  }

  return groupEntries.map(group => {
    // Safely handle group ID display
    let displayId;
    if (typeof group.id === 'string' && group.id.startsWith('group_')) {
      displayId = group.id.replace('group_', '');
    } else {
      displayId = group.id;
    }

    // Safely handle provider names
    const providerTags = group.bookings.map(b => {
      const providerName = b.provider_name || 'Unknown Provider';
      return `<span class="provider-tag">${providerName}</span>`;
    }).join('');

    return `
      <div class="booking-card history group">
        <div class="booking-header">
          <strong>Group Request #${displayId}</strong>
          <span class="status-badge ${(group.status || '').toLowerCase()}">${group.status || 'UNKNOWN'}</span>
        </div>
        <div class="booking-details">
          <p><strong>Service:</strong> ${group.skill_required}</p>
          <p><strong>Providers:</strong> ${group.bookings.length} of ${group.provider_count}</p>
          <p><strong>Description:</strong> ${group.description}</p>
          <p><strong>Total Amount:</strong> ₹${(group.total_amount || 0).toLocaleString()}</p>
          <p><strong>Completed:</strong> ${new Date(group.created_at).toLocaleDateString()}</p>
          ${providerTags ? `
            <div class="provider-list">
              <strong>Assigned Providers:</strong>
              ${providerTags}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join("");
}

window.stopRouteTracking = function () {
  const socket = getSocket();
  if (currentRouteLayer && mapInstance) {
    mapInstance.removeLayer(currentRouteLayer);
    currentRouteLayer = null;
  }
  if (providerMarker && mapInstance) {
    mapInstance.removeLayer(providerMarker);
    providerMarker = null;
  }
  socket?.off("provider_location_update");
  document.getElementById("routeInfo").innerHTML = "";
  showToast("Route tracking stopped.", "info");
};

export async function startRouteTracking(booking) {
  // Stop any existing tracking first
  window.stopRouteTracking?.();

  const socket = getSocket();
  const providerId = booking.provider_id;
  const isDev = location.hostname === "localhost";

  // --- Global references (for cleanup) ---
  window.providerMarker = null;
  window.currentRouteLayer = null;
  window.routeInterval = null;

  let providerCoords = {
    lat: booking.provider_latitude,
    lng: booking.provider_longitude
  };
  const customerCoords = {
    lat: booking.customer_latitude,
    lng: booking.customer_longitude
  };

  const latDiff = Math.abs(providerCoords.lat - customerCoords.lat);
  const lngDiff = Math.abs(providerCoords.lng - customerCoords.lng);

  if (isDev && latDiff < 0.001 && lngDiff < 0.001) {
    providerCoords.lat += 0.09;
    providerCoords.lng += 0.09;
    showToast("🧪 Dev offset applied to provider location", "info");
  }

  try {
    const res = await apiCall(
      `/osrm-route?start_lat=${providerCoords.lat}&start_lon=${providerCoords.lng}&end_lat=${customerCoords.lat}&end_lon=${customerCoords.lng}`
    );

    const data = res;

    if (!data.geojson || !data.geojson.geometry?.coordinates?.length) {
      showToast("Could not find a valid OSRM route.", "warning");
      return;
    }

    // --- Draw route ---
    window.currentRouteLayer = L.geoJSON(data.geojson, {
      style: { color: "#007bff", weight: 5, opacity: 0.7 }
    }).addTo(mapInstance);

    // ✅ Safe map centering
    if (mapInstance && window.currentRouteLayer && window.currentRouteLayer.getBounds) {
      try {
        mapInstance.fitBounds(window.currentRouteLayer.getBounds(), { padding: [50, 50] });
      } catch (e) {
        console.warn("fitBounds failed, retrying after delay:", e);
        setTimeout(() => {
          if (mapInstance && window.currentRouteLayer?.getBounds) {
            mapInstance.fitBounds(window.currentRouteLayer.getBounds(), { padding: [50, 50] });
          }
        }, 500);
      }
    } else {
      console.warn("Map or route layer not ready for fitBounds");
    }

    const distance = (data.geojson?.properties?.distance / 1000).toFixed(1);
    const duration = Math.round(data.geojson?.properties?.duration / 60);

    document.getElementById("routeInfo").innerHTML = `
      <p>🚗 <strong>Route:</strong> ${distance} km, ${duration} mins estimated.</p>
      <p>Tracking Provider: <strong>${booking.provider_name}</strong></p>
      <button id="stopTrackingBtn" class="btn btn-sm btn-secondary">Stop Tracking</button>
    `;

    // --- Add destination marker ---
    addMarker(customerCoords.lat, customerCoords.lng, "Your Location (Destination)", "🏠");

    // --- Add provider marker ---
    const icon = L.divIcon({
      html: '<div class="map-icon" style="background-color: green; border-radius: 50%; color: white; width: 30px; height: 30px; line-height: 30px; text-align: center;">🛵</div>',
      className: "custom-map-icon",
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    window.providerMarker = L.marker([providerCoords.lat, providerCoords.lng], { icon })
      .addTo(mapInstance)
      .bindPopup(`Provider: ${booking.provider_name}`)
      .openPopup();

    const coords = data.geojson.geometry.coordinates;

    // --- Define stopRouteTracking (cleanup everything) ---
    window.stopRouteTracking = () => {
      if (window.routeInterval) {
        clearInterval(window.routeInterval);
        window.routeInterval = null;
      }

      socket.off("provider_location_update");

      if (window.providerMarker) {
        mapInstance.removeLayer(window.providerMarker);
        window.providerMarker = null;
      }

      if (window.currentRouteLayer) {
        mapInstance.removeLayer(window.currentRouteLayer);
        window.currentRouteLayer = null;
      }

      // const btn = document.getElementById("stopTrackingBtn");
      // if (btn) {
      //   btn.disabled = true;
      //   btn.textContent = "Tracking Stopped";
      //   btn.classList.remove("btn-secondary");
      //   btn.classList.add("btn-danger");
      // }

      // Optional: Clear info panel after short delay
      setTimeout(() => {
        const info = document.getElementById("routeInfo");
        if (info) info.innerHTML = "";
      }, 2000);

      showToast("🛑 Tracking stopped and reset.", "warning");
    };

    // --- Socket listener for real-time updates ---
    socket.off("provider_location_update");
    socket.on("provider_location_update", data => {
      if (data.provider_id === providerId && window.providerMarker) {
        window.providerMarker.setLatLng([data.lat, data.lng]);
      }
    });

    // --- Simulated movement (Dev mode only) ---
    if (isDev) {
      console.log(`🧪 Simulating route with ${coords.length} points...`);
      let step = 0;

      // Ensure provider marker is ready
      if (!window.providerMarker) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      window.routeInterval = setInterval(() => {
        if (!window.providerMarker || !mapInstance) {
          console.warn("Marker or map missing, stopping simulation.");
          window.stopRouteTracking();
          return;
        }

        if (step >= coords.length) {
          // --- Reached destination ---
          clearInterval(window.routeInterval);
          window.routeInterval = null;

          const [lng, lat] = coords[coords.length - 1];
          L.marker([lat, lng], {
            icon: L.divIcon({
              html: '<div style="background: gold; border-radius: 50%; width: 24px; height: 24px; line-height: 24px; text-align: center;">🏁</div>',
              className: "arrival-marker",
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })
          })
            .addTo(mapInstance)
            .bindPopup("Provider has arrived")
            .openPopup();

          // Update button to completed
          const btn = document.getElementById("stopTrackingBtn");
          if (btn) {
            btn.disabled = true;
            btn.textContent = "Tracking Complete";
            btn.classList.remove("btn-secondary");
            btn.classList.add("btn-success");
          }

          showToast("✅ Provider reached destination", "success");
          // ✅ Auto-stop and UI reset when tracking completes
          window.stopRouteTracking?.();

          const stopBtn = document.getElementById("stopTrackingBtn");
          if (stopBtn) {
            stopBtn.disabled = true;
            stopBtn.textContent = "Tracking Complete";
            stopBtn.classList.remove("btn-secondary");
            stopBtn.classList.add("btn-success");
          }

          // ✅ Also disable the main Track button if visible
          const trackBtn = document.getElementById("track-Btn");
          console.log("Disabling track button:", trackBtn);
          if (trackBtn) {
            trackBtn.disabled = true;
            trackBtn.textContent = "Tracking Complete";
            trackBtn.classList.remove("btn-primary");
            trackBtn.classList.add("btn-success");
          }

          showToast("✅ Provider reached destination", "success");

          // --- Full cleanup after short delay ---
          setTimeout(() => window.stopRouteTracking?.(), 2000);
          return;
        }

        const [lng, lat] = coords[step];
        if (window.providerMarker && window.providerMarker.setLatLng) {
          window.providerMarker.setLatLng([lat, lng]);
        }

        // Emit to socket for realism
        socket.emit("provider_location_update", {
          provider_id: providerId,
          lat,
          lng,
          timestamp: Date.now()
        });

        step++;
      }, 1000);
    }

    // --- Attach manual stop button ---
    document.getElementById("stopTrackingBtn").onclick = () => {
      window.stopRouteTracking?.();
    };

    showToast(`✅ Tracking started for Provider #${providerId}`, "success");
  } catch (err) {
    console.error("OSRM Route Error:", err);
    showToast("Failed to fetch OSRM route.", "error");
  }
}


async function fetchBookingById(id) {
  const res = await apiCall(`/bookings/${id}`);
  return res.booking;
}

// customer/booking.js - Complete fixed event listeners
document.addEventListener("click", async (e) => {
  const bookingId = e.target.dataset.id;
  if (!bookingId) return;

  console.log("Button clicked:", e.target.className, "Booking ID:", bookingId);

  // Handle individual booking cancellation
  if (e.target.classList.contains("cancel-btn")) {
    const confirmed = confirm("Cancel this booking?");
    if (confirmed) {
      await updateBookingStatus(bookingId, "CANCELLED");
    }
  }

  // Handle group request cancellation (different from individual bookings)
  if (e.target.classList.contains("group-cancel-btn")) {
    const confirmed = confirm("Cancel this group request?");
    if (confirmed) {
      await cancelGroupRequest(bookingId);
    }
  }

  if (e.target.classList.contains("complete-btn")) {
    const confirmed = confirm("Mark this booking as completed?");
    if (confirmed) {
      await updateBookingStatus(bookingId, "COMPLETED");
    }
  }

  if (e.target.classList.contains("track-btn")) {
    console.log("🚀 Track button clicked for booking:", bookingId);

    // Check if already tracking
    if (window.currentRouteLayer) {
      const confirmed = confirm("Already tracking a route. Stop current tracking?");
      if (confirmed) {
        window.stopRouteTracking?.();
      } else {
        return;
      }
    }

    try {
      const booking = await fetchBookingById(bookingId);
      if (booking) {
        console.log("Starting route tracking for:", booking);
        await startRouteTracking(booking);
      } else {
        showToast("Unable to fetch booking details for tracking.", "error");
      }
    } catch (error) {
      console.error("Error starting tracking:", error);
      showToast("Failed to start tracking.", "error");
    }
  }
});
export async function cancelGroupRequest(id) {
  try {
    const res = await apiCall(`/customers/group-requests/${id}/cancel`, {
      method: "POST"
    });

    if (res.success) {
      showToast("✅ Group request cancelled successfully", "success");

      // Refresh both group requests and booking history
      const user = JSON.parse(localStorage.getItem("user") || "{}");
      if (user.id) {
        await loadCustomerBookings(user.id);
        // Also refresh active group requests if the function exists
        if (typeof window.loadActiveGroupRequests === 'function') {
          window.loadActiveGroupRequests();
        }
      }
    } else {
      showToast("Failed to cancel group request", "error");
    }
  } catch (error) {
    console.error("Error cancelling group request:", error);
    showToast("❌ Failed to cancel group request", "error");
  }
}
// Add this to your booking.js file
// customer/booking.js - Updated setupHistoryTabs function
function setupHistoryTabs() {
  const tabs = document.querySelectorAll('.history-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;

      // Remove active class from all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));

      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
      const targetContent = document.getElementById(`${targetTab}-tab`);
      if (targetContent) {
        targetContent.classList.add('active');
      }

      console.log(`Switched to ${targetTab} history tab`);
    });
  });
}
// customer/booking.js - Add this function for group request cancellation
