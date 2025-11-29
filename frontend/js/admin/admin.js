// frontend/js/admin/admin.js
import { loadAnalytics } from "./analytics.js";
import { loadUsers } from "./users.js";
import { showToast } from "../shared/ui.js";
import { setupSocket } from "../shared/socket.js";

document.addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem("user"));
  const token = localStorage.getItem("token");

  if (!user || user.role !== "admin") {
    showToast("Unauthorized. Please login as admin.", "error");
    window.location.href = "index.html";
    return;
  }

  document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.clear();
    window.location.href = "index.html";
  });

  document.getElementById("searchBtn").addEventListener("click", () => {
    const role = document.getElementById("filterRole").value;
    const q = document.getElementById("searchQuery").value;
    loadUsers({ role, q });
  });

  const socket = setupSocket(user.id, token, {
    user_registered: (u) => {
      showToast(`👤 New ${u.role} registered: ${u.name}`, "info");
      loadUsers({ role: u.role });
    },
    user_verified: (u) => {
      showToast(`✅ ${u.role} verified: ${u.mobile_number}`, "success");
      loadUsers({ role: u.role });
    },
    user_deleted: (u) => {
      showToast(`🗑️ ${u.role} deleted: #${u.id}`, "warning");
      loadUsers({});
    },
    booking_status_update: () => {
      showToast("📊 Booking status changed, refreshing analytics…", "info");
      loadAnalytics();
    },
    booking_completed: () => {
      showToast("✅ Booking completed, refreshing analytics…", "success");
      loadAnalytics();
    },
    booking_cancelled: () => {
      showToast("❌ Booking cancelled, refreshing analytics…", "warning");
      loadAnalytics();
    }
  });

  socket.emit("register", user.id);
  socket.emit("subscribe_booking", { admin_id: user.id });

  loadAnalytics();
  loadUsers({});
});
