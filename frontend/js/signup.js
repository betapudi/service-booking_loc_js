// signup.js
import { apiCall } from "./shared/api.js";
import { showToast } from "./shared/ui.js";

document.getElementById("signupBtn")?.addEventListener("click", async () => {
  const name = document.getElementById("name").value.trim();
  const mobile = document.getElementById("mobile").value.trim();
  const role = document.getElementById("role").value;

  if (!name || !mobile || mobile.length !== 10) {
    showToast("Please fill all fields correctly", "warning");
    return;
  }

  const res = await apiCall("/auth/register", {
    method: "POST",
    body: { name, mobile_number: mobile, role }
  });

  if (res.user) {
    showToast("Registration successful", "success");
    localStorage.setItem("pending_mobile", mobile);
    localStorage.setItem("pending_role", role);
    window.location.href = "verify-otp.html";
  } else {
    showToast(res.error || "Registration failed", "error");
  }
});
