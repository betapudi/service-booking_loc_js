// shared/reverseGeocode.js
import { apiCall } from "./api.js";

export async function reverseGeocode(lat, lng) {
  // Replace with actual geocoding API if needed
  const res = await apiCall(`/location/reverse?lat=${lat}&lng=${lng}`);
  return res.location || "Unknown location";
}
