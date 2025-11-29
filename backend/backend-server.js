// backend/backend-server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// --------------------
// Express  Server setup
// --------------------
const app = express();
const server = http.createServer(app);

// CORS setup - Allow all origins for development
app.use(
  cors({
    origin: true, // Allow all origins in development
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);
app.use(express.json());

// --------------------
// Socket.IO setup
// --------------------
const io = new Server(server, {
  cors: {
    origin: true, // Allow all origins
    credentials: true,
    methods: ['GET', 'POST']
  },
});

const clients = new Map();

// --------------------
// Utility helpers
// --------------------
function safeJoin(socket, room) {
  if (!room) return;
  socket.join(room);
  console.log(`🟢 ${socket.id} joined room: ${room}`);
}

function notifyUser(userId, event, data) {
  const socketId = clients.get(userId);
  if (socketId) {
    io.to(socketId).emit(event, data);
  }
}

// --------------------
// Single unified connection handler
// --------------------
// --------------------
// Single unified connection handler
// --------------------
io.on("connection", (socket) => {
  console.log("🟢 Socket connected:", socket.id);

  // Basic identity registration (required for user_<id> targeting)
  socket.on("register", (userId) => {
    if (!userId) return;
    clients.set(userId, socket.id);
    safeJoin(socket, `user_${userId}`);
    console.log(`✅ User ${userId} registered and joined user_${userId}`);
  });

  // Generic manual room join (fallback)
  socket.on("join", (room) => {
    safeJoin(socket, room);
  });

  // Subscribe a customer to a provider's updates explicitly
  // Payload: { customer_id, provider_id }
  socket.on("subscribe_provider", ({ customer_id, provider_id }) => {
    if (!provider_id) return;
    safeJoin(socket, `provider_${provider_id}`);
    if (customer_id) safeJoin(socket, `customer_${customer_id}`);
  });

  // Subscribe to a specific booking stream (rooms for booking, customer, provider)
  // Payload: { booking_id, customer_id, provider_id }
  socket.on("subscribe_booking", ({ booking_id, customer_id, provider_id }) => {
    if (booking_id) safeJoin(socket, `booking_${booking_id}`);
    if (customer_id) safeJoin(socket, `customer_${customer_id}`);
    if (provider_id) safeJoin(socket, `provider_${provider_id}`);
  });

  // ✅ Subscribe broker to their own user_<id> room
  // Payload: { broker_id }
  socket.on("subscribe_broker", ({ broker_id }) => {
    if (!broker_id) return;
    safeJoin(socket, `user_${broker_id}`);
    console.log(`✅ Broker ${broker_id} subscribed to user_${broker_id}`);
  });

  // Customer creates a booking: notify provider
  // Payload: booking object with provider_id (and ideally booking_id, customer_id)
  socket.on("new_booking_request", (booking) => {
    const providerId = booking?.provider_id;
    if (!providerId) return;
    io.to(`user_${providerId}`).emit("new_booking", { booking });
    console.log(`📨 Notified provider_${providerId} of new booking${booking?.id ? ` #${booking.id}` : ''}`);
  });

  // Provider accepts/rejects booking
  // Payload: { booking_id, provider_id, customer_id, status: 'accepted'|'rejected' }
  socket.on("booking_response", ({ booking_id, provider_id, customer_id, status }) => {
    if (!booking_id || !provider_id || !status) return;
    const payload = { booking_id, provider_id, status };

    // Notify booking subscribers
    io.to(`booking_${booking_id}`).emit("booking_status_update", payload);

    // Notify customer (if known)
    if (customer_id) {
      io.to(`user_${customer_id}`).emit("booking_status_update", payload);
    }

    // Also notify provider room (for multi-device consistency)
    io.to(`provider_${provider_id}`).emit("booking_status_update", payload);

    console.log(`⚙️ Booking ${booking_id} ${status} by provider ${provider_id}`);
  });

  // Provider marks booking completed
  // Payload: { booking_id, provider_id, customer_id }
  socket.on("booking_completed", ({ booking_id, provider_id, customer_id }) => {
    if (!booking_id || !provider_id) return;
    const payload = { booking_id, provider_id };

    io.to(`booking_${booking_id}`).emit("booking_completed", payload);
    if (customer_id) {
      io.to(`user_${customer_id}`).emit("booking_completed", payload);
    }
    io.to(`provider_${provider_id}`).emit("booking_completed", payload);

    console.log(`✅ Booking ${booking_id} completed by provider ${provider_id}`);
  });

  // Unified provider location updates
  // Payload: { provider_id, lat, lng, name?, booking_id? }
  socket.on("update_location", ({ provider_id, lat, lng, name, booking_id }) => {
    if (!provider_id || typeof lat !== "number" || typeof lng !== "number") return;
    const payload = { provider_id, lat, lng, name: name || null, booking_id: booking_id || null };

    // Emit to provider room subscribers (customers tracking the provider)
    io.to(`provider_${provider_id}`).emit("provider_location_update", payload);

    // If tied to a booking, emit to booking room
    if (booking_id) {
      io.to(`booking_${booking_id}`).emit("provider_location_update", payload);
    }
  });

  // Backward compatibility alias (deprecated)
  socket.on("providerLocationUpdate", (data) => {
    const providerId = data?.providerId || data?.provider_id;
    if (!providerId) return;
    const payload = {
      provider_id: providerId,
      lat: Number(data.lat),
      lng: Number(data.lng),
      name: data.name || null,
      booking_id: data.booking_id || null
    };
    io.to(`provider_${providerId}`).emit("provider_location_update", payload);
    if (payload.booking_id) {
      io.to(`booking_${payload.booking_id}`).emit("provider_location_update", payload);
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
    for (const [uid, sid] of clients.entries()) {
      if (sid === socket.id) clients.delete(uid);
    }
  });
});

app.locals.io = io;
app.locals.notifyUser = notifyUser;

// --------------------
// Health check
// --------------------
app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// --------------------
// Route registration
// --------------------
const routes = [
  { path: "/api/auth", file: "./routes/auth" },
  { path: "/api/location", file: "./routes/location" },
  { path: "/api/providers", file: "./routes/providers" },
  { path: "/api/customers", file: "./routes/customers" },
  { path: "/api/bookings", file: "./routes/bookings" },
  { path: "/api/payment", file: "./routes/payment" },
  { path: "/api/notifications", file: "./routes/notifications" },
  { path: "/api/brokers", file: "./routes/brokers" },
  { path: "/api/admin", file: "./routes/admin" },
  { path: "/api/profile", file: "./routes/profile" },
  { path: "/api/osrm-route", file: "./routes/osrm-route" }
];

routes.forEach(({ path, file }) => {
  try {
    const route = require(file);
    app.use(path, route);
    console.log(`✅ Loaded route: ${path}`);
  } catch (err) {
    console.error(`⚠️ Route loading failed: ${file}`);
    console.error('Error details:', err.message);
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error('Missing dependencies. Run: npm install');
    }
  }
});

// --------------------
// 404  Error handlers
// --------------------
app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((err, req, res, next) => {
  console.error("💥 Server error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// --------------------
// Server start
// --------------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check → http://localhost:${PORT}/api/health`);
});

module.exports = { app, server, io };
