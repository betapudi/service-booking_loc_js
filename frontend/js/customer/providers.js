// customer/providers.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";
import { addMarker, mapInstance } from "../shared/map.js";
import { loadCustomerBookings } from "./booking.js";
import { setupSocket } from "../shared/socket.js";

let userMarker;

export function loadUserLocation() {

  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  setupSocket(user?.id, token, {
    provider_location_update: data => {
      console.log("Received provider location update:", data);
    }
  });

  if (!navigator.geolocation) {
    console.warn("Geolocation not supported");
    return loadNearbyProviders(17.385, 78.4867); // fallback
  }

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      console.log("User location:", lat, lon);

      if (!isValidCoord(lat, lon)) {
        console.warn("Invalid coordinates from geolocation");
        return loadNearbyProviders(17.385, 78.4867); // fallback
      }

      updateUserLocation(lat, lon);
      await updateCustomerLocation(lat, lon);
      await loadNearbyProviders(lat, lon);
      startPeriodicLocationUpdates();
    },
    (error) => {
      console.warn("Geolocation failed:", error);
      loadNearbyProviders(17.385, 78.4867); // fallback
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 60000
    }
  );
}

function isValidCoord(lat, lon) {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    !isNaN(lat) &&
    !isNaN(lon)
  );
}

function updateUserLocation(lat, lon) {
  if (!mapInstance) return;

  if (userMarker) {
    mapInstance.removeLayer(userMarker);
  }

  const userIcon = L.divIcon({
    html: `<div style="background: #2563eb; color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.2);">📍</div>`,
    className: "user-marker",
    iconSize: [40, 40],
    iconAnchor: [20, 20]
  });

  userMarker = L.marker([lat, lon], { icon: userIcon })
    .addTo(mapInstance)
    .bindPopup("<b>You are here</b>")
    .openPopup();

  mapInstance.setView([lat, lon], 13);
}

async function updateCustomerLocation(lat, lon) {
  try {
    const user = JSON.parse(localStorage.getItem("user"));
    if (!user || user.role !== "customer") return;

    await apiCall("/customers/location", {
      method: "PUT",
      body: { latitude: lat, longitude: lon }
    });

    user.latitude = lat;
    user.longitude = lon;
    user.meta = user.meta || {};
    user.meta.location = { lat, lng: lon, updated_at: new Date() };
    localStorage.setItem("user", JSON.stringify(user));
  } catch (error) {
    console.error("Failed to update customer location:", error);
  }
}

// export async function loadNearbyProviders(lat, lon) {
//     if (!isValidCoord(lat, lon)) {
//         console.warn("Invalid lat/lon passed to loadNearbyProviders");
//         return;
//     }

//     try {
//         const response = await apiCall(`/providers/nearby?lat=${lat}&lon=${lon}&radius=15`);
//         const providers = Array.isArray(response.providers) ? response.providers : [];
//         console.log("Nearby Providers:", providers);
//         if (providers.length === 0) {
//             await loadProvidersFallback(lat, lon);
//             return;
//         }

//         renderProviders(providers);
//         addProviderMarkers(providers);
//     } catch (error) {
//         console.error("Error loading nearby providers:", error);
//         await loadProvidersFallback(lat, lon);
//     }
// }
export async function loadNearbyProviders(lat, lon) {
  if (!isValidCoord(lat, lon)) {
    console.warn("Invalid lat/lon passed to loadNearbyProviders");
    return;
  }

  try {
    const response = await apiCall(`/providers/nearby?lat=${lat}&lon=${lon}&radius=15`);
    let providers = Array.isArray(response.providers) ? response.providers : [];
    console.log("Nearby Providers (raw):", providers);

    // 🎯 DEV MODE OFFSET: Apply ~10 km separation if too close to customer
    const isDev = location.hostname === "localhost";
    if (isDev) {
      providers = providers.map((p, i) => {
        const latDiff = Math.abs(p.latitude - lat);
        const lonDiff = Math.abs(p.longitude - lon);

        if (latDiff < 0.001 && lonDiff < 0.001) {
          const offset = 0.09 + i * 0.002; // staggered offset per provider
          return {
            ...p,
            latitude: p.latitude + offset,
            longitude: p.longitude + offset
          };
        }
        return p;
      });
      console.log("🧪 Dev offset applied to providers:", providers);
    }

    if (providers.length === 0) {
      await loadProvidersFallback(lat, lon);
      return;
    }

    renderProviders(providers);
    addProviderMarkers(providers);
    if (isDev) {
      const customerCoords = { lat, lon }; // passed into loadNearbyProviders
      simulateProviderMovement(providers, customerCoords);; // DEV: Simulate movement
    }
  } catch (error) {
    console.error("Error loading nearby providers:", error);
    await loadProvidersFallback(lat, lon);
  }
}

async function loadProvidersFallback(lat, lon) {
  try {
    const response = await apiCall("/providers/search?limit=50");
    const filtered = response.providers
      .filter(p => isValidCoord(p.latitude, p.longitude))
      .map(p => ({
        ...p,
        distance_km: calculateDistance(lat, lon, p.latitude, p.longitude)
      }))
      .filter(p => p.distance_km <= 50)
      .sort((a, b) => a.distance_km - b.distance_km);

    renderProviders(filtered);
    addProviderMarkers(filtered);
  } catch (error) {
    console.error("Fallback failed:", error);
  }
}

let allProviders = [];

export function renderProviders(providers) {
  allProviders = providers; // store full list for filtering
  populateSkillFilter(providers);
  applyProviderFilters();
}

function populateSkillFilter(providers) {
  const skillSet = new Set();
  providers.forEach(p => (p.skills || []).forEach(s => skillSet.add(s)));

  const skillSelect = document.getElementById("skillFilter");
  if (skillSelect) {
    skillSelect.innerHTML = `<option value="">All Skills</option>` +
      [...skillSet].sort().map(s => `<option value="${s}">${s}</option>`).join("");
  }
}

// function applyProviderFilters() {
//   const skill = document.getElementById("skillFilter")?.value;
//   const rating = parseFloat(document.getElementById("ratingFilter")?.value || "0");

//   const filtered = allProviders.filter(p => {
//     const matchesSkill = !skill || (p.skills || []).includes(skill);
//     const matchesRating = !rating || (p.rating || 0) >= rating;
//     return matchesSkill && matchesRating;
//   });

//   const container = document.getElementById("nearbyProviders");
//   if (!container) return;

//   container.innerHTML = filtered.map(p => `
//     <div class="provider-card">
//       <div class="provider-header">
//         <span class="provider-name">${p.name}</span>
//         <span class="provider-rating">⭐ ${p.rating?.toFixed(1) || "0.0"} (${p.total_bookings || 0})</span>
//       </div>
//       <div class="provider-skills">
//         🛠️ ${p.skills?.join(", ") || "No skills listed"}
//       </div>
//       <button 
//         class="book-now-btn"
//         data-id="${p.id}"
//         data-location="${p.location_id || ''}"
//         data-name="${p.name}"
//         data-skills='${JSON.stringify(p.skills || [])}'
//       >
//         📋 Book Now
//       </button>
//     </div>
//   `).join("");

//   document.querySelectorAll(".book-now-btn").forEach(btn => {
//     btn.addEventListener("click", async () => {
//       const providerId = btn.dataset.id;
//       const locationId = btn.dataset.location;
//       const providerName = btn.dataset.name;
//       const providerSkills = JSON.parse(btn.dataset.skills || "[]");

//       await makeBookingRequest(providerId, locationId, providerName, providerSkills);
//     });
//   });
// }

// Updated applyProviderFilters function with beautiful design
function applyProviderFilters() {
  const skill = document.getElementById("skillFilter")?.value;
  const rating = parseFloat(document.getElementById("ratingFilter")?.value || "0");

  const filtered = allProviders.filter(p => {
    const matchesSkill = !skill || (p.skills || []).includes(skill);
    const matchesRating = !rating || (p.rating || 0) >= rating;
    return matchesSkill && matchesRating;
  });

  const container = document.getElementById("nearbyProviders");
  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="no-providers">
        <div class="no-providers-icon">🔧</div>
        <h3>No Providers Found</h3>
        <p>Try adjusting your filters or search in a different area</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(provider => {
    const rating = provider.rating || 0;
    const totalBookings = provider.total_bookings || 0;
    const distance = provider.distance_km ? `${provider.distance_km.toFixed(1)} km` : 'Nearby';
    const skills = provider.skills || [];

    // Generate star rating
    const fullStars = Math.floor(rating);
    const stars = '★'.repeat(fullStars) + '☆'.repeat(5 - fullStars);

    return `
      <div class="provider-card" data-provider-id="${provider.id}">
        ${provider.distance_km ? `<div class="distance-indicator">${distance}</div>` : ''}
        
        <div class="provider-header">
          <div class="provider-info">
            <h3 class="provider-name">
              ${provider.name || 'Unknown Provider'}
              ${provider.is_verified ? '<span class="provider-verified">Verified</span>' : ''}
            </h3>
            
            <div class="provider-meta">
              <span class="provider-mobile">${provider.mobile_number || 'N/A'}</span>
              
              <div class="rating-stars">
                <span class="star">${stars}</span>
                <span class="rating-value">${rating.toFixed(1)}</span>
                <span class="stat-label">(${totalBookings} bookings)</span>
              </div>
            </div>
          </div>
        </div>

        <div class="provider-stats">
          <div class="stat-item">
            <span class="stat-value">${totalBookings}</span>
            <span class="stat-label">Bookings</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${rating.toFixed(1)}</span>
            <span class="stat-label">Rating</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${skills.length}</span>
            <span class="stat-label">Skills</span>
          </div>
        </div>

        ${skills.length > 0 ? `
          <div class="provider-skills">
            <div class="skills-label">Skills & Expertise</div>
            <div class="skills-container">
              ${skills.map(skill => `
                <span class="skill-tag">${skill}</span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="provider-actions">
          <button class="btn-book" 
            data-id="${provider.id}"
            data-location="${provider.location_id || ''}"
            data-name="${provider.name}"
            data-skills='${JSON.stringify(provider.skills || [])}'
            data-distance="${provider.distance_km || 0}"
            data-rating="${provider.rating || 0}">
            <span>📅</span>
            Book Now
          </button>
          <button class="btn-view-profile" onclick="viewProviderProfile(${provider.id})">
            <span>👤</span>
            Profile
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Add event listeners to book buttons
  document.querySelectorAll(".btn-book").forEach(btn => {
    btn.addEventListener("click", async () => {
      const providerId = btn.dataset.id;
      const locationId = btn.dataset.location;
      const providerName = btn.dataset.name;
      const providerSkills = JSON.parse(btn.dataset.skills || "[]");
      const distance = parseFloat(btn.dataset.distance || "0");
      const rating = parseFloat(btn.dataset.rating || "0");

      await makeBookingRequest(providerId, locationId, providerName, providerSkills, distance, rating);
    });
  });
}

// Placeholder function for viewing provider profiles
function viewProviderProfile(providerId) {
  console.log('Viewing provider profile:', providerId);
  showToast(`Viewing profile of provider #${providerId}`, 'info');
  // Implement profile view logic here
}

// customer/providers.js - Updated makeBookingRequest function
async function makeBookingRequest(providerId, locationId, providerName, providerSkills, distance = 0, rating = 0) {
  const user = JSON.parse(localStorage.getItem("user"));
  if (!user || user.role !== "customer") {
    showToast("Please log in to book a provider", "warning");
    return;
  }

  const customerLocation = {
    lat: user.latitude || user.meta?.location?.lat || null,
    lng: user.longitude || user.meta?.location?.lng || null
  };

  // Reconstruct provider object for calculation
  const provider = {
    id: providerId,
    name: providerName,
    skills: providerSkills,
    distance_km: distance,
    rating: rating
  };

  const totalAmount = calculateBookingAmount(provider);

  const metadata = {
    provider_name: providerName,
    provider_skills: providerSkills,
    customer_location: customerLocation,
    estimated_distance_km: distance,
    provider_rating: rating
  };

  try {
    const res = await apiCall("/bookings", {
      method: "POST",
      body: {
        provider_id: providerId,
        location_id: locationId || null,
        total_amount: totalAmount,
        metadata,
        broker_id: null
      }
    });

    if (res.booking) {
      showToast(`✅ Booking #${res.booking.id} sent to ${providerName}`, "success");
      await loadCustomerBookings(user.id);
    } else {
      showToast("❌ Booking failed", "error");
    }
  } catch (err) {
    console.error("Booking error:", err);
    showToast("❌ Error sending booking request", "error");
  }
}

function addProviderMarkers(providers) {
  providers.forEach(p => {
    if (isValidCoord(p.latitude, p.longitude)) {
      addMarker(p.latitude, p.longitude, p.name, "🔧");
    }
  });
}

function calculateBookingAmount(provider) {
  let baseAmount = 200;
  let distanceMultiplier = 1;
  if (provider.distance_km && provider.distance_km > 5) {
    distanceMultiplier = 1 + (provider.distance_km - 5) * 0.1;
  }
  if (provider.rating && provider.rating > 4) {
    distanceMultiplier *= 1.2;
  }
  return Math.round(baseAmount * distanceMultiplier);
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startPeriodicLocationUpdates() {
  setInterval(() => {
    navigator.geolocation.getCurrentPosition(pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      if (isValidCoord(lat, lon)) {
        updateUserLocation(lat, lon);
        updateCustomerLocation(lat, lon);
      }
    });
  }, 300000);
}
import { getSocket } from "../shared/socket.js";

// Linear route for testing
// function simulateProviderMovement(providers) {
//   const socket = getSocket();

//   providers.forEach((provider, index) => {
//     const route = generateLinearRoute(provider.latitude, provider.longitude, 20); // 20 steps
//     let step = 0;

//     const interval = setInterval(() => {
//       if (step >= route.length) {
//         clearInterval(interval);
//         return;
//       }

//       const { lat, lng } = route[step];
//       socket.emit("provider_location_update", {
//         provider_id: provider.id,
//         lat,
//         lng,
//         timestamp: Date.now()
//       });

//       step++;
//     }, 1000 + index * 200); // staggered start
//   });
// }
async function simulateProviderMovement(providers, customerCoords) {
  const socket = getSocket();
  const isDev = location.hostname === "localhost";

  for (const provider of providers) {
    const from = `${provider.longitude},${provider.latitude}`;
    const to = `${customerCoords.lon},${customerCoords.lat}`;
    if (!customerCoords?.lat || !customerCoords?.lon) {
      console.warn("❌ Missing customer coordinates. Cannot simulate route.");
      return;
    }

    try {
      const res = await apiCall(`/osrm-route?start_lat=${provider.latitude}&start_lon=${provider.longitude}&end_lat=${customerCoords.lat}&end_lon=${customerCoords.lon}`);
      const route = res.geojson?.geometry?.coordinates || [];

      if (route.length === 0) {
        console.warn(`No route for provider ${provider.id}`);
        continue;
      }

      let step = 0;
      const interval = setInterval(() => {
        if (step >= route.length) {
          clearInterval(interval);

          return;
        }

        const [lng, lat] = route[step];
        socket.emit("provider_location_update", {
          provider_id: provider.id,
          lat,
          lng,
          timestamp: Date.now()
        });

        step++;
      }, 1000 + Math.floor(Math.random() * 500)); // slight jitter

    } catch (err) {
      console.error(`Failed to simulate route for provider ${provider.id}:`, err);
    }
  }
}

document.getElementById("skillFilter")?.addEventListener("change", applyProviderFilters);
document.getElementById("ratingFilter")?.addEventListener("change", applyProviderFilters);
