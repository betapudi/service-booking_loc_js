// shared/socket.js
let socket;

export function setupSocket(userId, token, handlers = {}) {
  socket = io("http://localhost:4000", { auth: { token } });

  // Register identity
  socket.emit("register", userId);

  // Booking events
  if (handlers.new_booking) {
    socket.on("new_booking", handlers.new_booking);
  }

  if (handlers.booking_status_update) {
    socket.on("booking_status_update", handlers.booking_status_update);
  }

  if (handlers.booking_completed) {
    socket.on("booking_completed", handlers.booking_completed);
  }

  // Provider location updates
  if (handlers.provider_location_update) {
    socket.on("provider_location_update", handlers.provider_location_update);
  }

  // Group booking events (broker/customer flows)
  if (handlers.new_group_request) {
    socket.on("new_group_request", handlers.new_group_request);
  }

  if (handlers.provider_registered) {
    socket.on("provider_registered", handlers.provider_registered);
  }

  return socket;
}

export function getSocket() {
  return socket;
}
