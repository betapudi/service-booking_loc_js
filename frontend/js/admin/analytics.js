// analytics.js
import { apiCall } from "../shared/api.js";

export async function loadAnalytics() {
  const res = await apiCall("/admin/analytics/summary");
  const revenue = res.revenue || 0;
  const stats = res.bookingsCount || [];

  document.getElementById("totalRevenue").textContent = `Total Revenue: ₹${revenue}`;
  document.getElementById("bookingStats").innerHTML = stats.map(s =>
    `<div>${s.status}: ${s.count}</div>`
  ).join("");
}
