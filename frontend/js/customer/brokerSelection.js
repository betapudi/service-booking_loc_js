// customer/brokerSelection.js
import { apiCall } from "../shared/api.js";
import { showToast } from "../shared/ui.js";

export async function requestBrokerForGroupBooking() {
  const res = await apiCall("/brokers/available");
  if (!res.brokers || res.brokers.length === 0) {
    showToast("No brokers available", "info");
    return;
  }

  const broker = res.brokers[0];
  document.getElementById("preferredBroker").value = broker.id;
  document.getElementById("selectedBrokerName").textContent = `${broker.name} (${broker.mobile_number})`;
  document.getElementById("selectedBrokerInfo").classList.remove("hidden");

  showToast(`Broker ${broker.name} selected`, "success");
}
