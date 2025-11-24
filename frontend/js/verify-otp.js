// verify-otp.js
import { apiCall } from "./shared/api.js";
import { showToast } from "./shared/ui.js";

document.getElementById("verifyOtpBtn")?.addEventListener("click", async () => {
  const otp = document.getElementById("otp").value.trim();
  const mobile = localStorage.getItem("pending_mobile");

  if (!otp || otp.length !== 6) {
    showToast("Enter a valid 6-digit OTP", "warning");
    return;
  }

  const res = await apiCall("/auth/verify-otp", {
    method: "POST",
    body: { mobile_number: mobile, otp }
  });

  if (res.token && res.user) {
    localStorage.setItem("token", res.token);
    localStorage.setItem("user", JSON.stringify(res.user));
    showToast("Login successful", "success");

    switch (res.user.role) {
      case "customer":
        window.location.href = "customer-dashboard.html";
        break;
      case "provider":
        window.location.href = "provider-dashboard.html";
        break;
      case "broker":
        window.location.href = "broker-dashboard.html";
        break;
      case "admin":
        window.location.href = "admin-dashboard.html";
        break;
      default:
        showToast("Unknown role", "error");
    }
  } else {
    showToast(res.error || "OTP verification failed", "error");
  }
});

document.getElementById("resendOtpBtn")?.addEventListener("click", async () => {
  const mobile = localStorage.getItem("pending_mobile");
  if (!mobile) {
    showToast("Mobile number missing", "error");
    return;
  }

  const res = await apiCall("/auth/resendOtp", {
    method: "POST",
    body: { mobile_number: mobile }
  });

  if (res.success) {
    showToast("OTP resent successfully", "success");
  } else {
    showToast(res.error || "Failed to resend OTP", "error");
  }
});
