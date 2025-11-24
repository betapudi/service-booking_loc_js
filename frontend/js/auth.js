// auth.js
import { apiCall } from "./shared/api.js";
import { showToast } from "./shared/ui.js";

document.getElementById("sendOtpBtn")?.addEventListener("click", async () => {
  const mobile = document.getElementById("mobile").value.trim();
  const role = document.getElementById("role").value;

  if (!mobile || mobile.length !== 10) {
    showToast("Enter a valid 10-digit mobile number", "warning");
    return;
  }

  const res = await apiCall("/auth/sendOtp", {
    method: "POST",
    body: { mobile_number: mobile, role }
  });

  if (res.success) {
    localStorage.setItem("pending_mobile", mobile);
    localStorage.setItem("pending_role", role);
    showToast("OTP sent successfully", "success");
    window.location.href = "verify-otp.html";
  } else {
    showToast(res.error || "Failed to send OTP", "error");
  }
});
