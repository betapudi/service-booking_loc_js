// backend/helpers/auth.js
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

function signToken(payload) {
  // Align with .env key and default
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
  // return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // ✅ Correct validation
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: "authentication required" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ success: false, error: "authentication required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // req.user = {
    //   id: decoded.id || decoded.userId || decoded._id,
    //   role: decoded.role,
    //   email: decoded.email
    // };
    // Enforce a consistent payload contract
    req.user = {
      id: decoded.id,
      role: decoded.role,
      email: decoded.email || null,
      name: decoded.name || null
    };
    next();
  } catch (err) {
    console.error("JWT verification failed:", err);
    return res.status(401).json({ success: false, error: "invalid or expired token" });
  }
}


function permit(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { signToken, authMiddleware, permit };
