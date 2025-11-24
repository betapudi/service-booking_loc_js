// admin.js
import { loadAnalytics } from "./analytics.js";
import { loadUsers } from "./users.js";
import { showToast } from "../shared/ui.js";

document.addEventListener("DOMContentLoaded", () => {
  const user = JSON.parse(localStorage.getItem("user"));
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

  loadAnalytics();
  loadUsers({});
});
