// users.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";

export async function loadUsers({ role = "", q = "" }) {
  const res = await apiCall(`/admin/users?role=${role}&q=${encodeURIComponent(q)}`);
  const users = res.users || [];
  const container = document.getElementById("userList");

  container.innerHTML = users.length
    ? users.map(u => `
        <div class="user-card">
          <div><strong>${u.name || "Unnamed"}</strong> (${u.role})</div>
          <div>📞 ${u.mobile_number}</div>
          <div>Status: ${u.is_verified ? "✅ Verified" : "❌ Unverified"}</div>
          <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">🗑️ Delete</button>
        </div>
      `).join("")
    : `<p>No users found</p>`;
}

window.deleteUser = async function (userId) {
  if (!confirm("Are you sure you want to delete this user?")) return;
  const res = await apiCall(`/admin/user/${userId}`, { method: "DELETE" });
  if (res.ok) {
    showToast("User deleted", "success");
    document.getElementById("searchBtn").click();
  } else {
    showToast(res.error || "Failed to delete user", "error");
  }
};
