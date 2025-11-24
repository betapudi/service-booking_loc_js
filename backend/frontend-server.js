const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

const app = express();
const PORT = process.env.FRONTEND_PORT || 3000;

// Fix the path - go up one level from backend folder to project root, then into frontend
const FRONTEND_FOLDER = path.join(__dirname, '../frontend');

console.log('Frontend folder path:', FRONTEND_FOLDER);

// Serve static files from frontend folder
app.use(express.static(FRONTEND_FOLDER));
// app.use(express.static('frontend', {
//     setHeaders: (res, path) => {
//         if (path.endsWith('.js')) {
//             res.setHeader('Content-Type', 'application/javascript');
//         }
//     }
// }));

// API Proxy to backend
app.use('/api', createProxyMiddleware({
  target: 'http://localhost:4000',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/api'
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Backend service unavailable' });
  }
}));

// Socket.IO proxy
app.use('/socket.io', createProxyMiddleware({
  target: 'http://localhost:4000',
  changeOrigin: true,
  ws: true
}));

// // Handle SPA routing - serve index.html for non-file requests
// app.get('*', (req, res) => {
//     // Don't handle actual file requests
//     if (req.path.includes('.')) {
//         res.status(404).send('Not found');
//         return;
//     }
//     res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
// });

// Route handlers - serve HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_FOLDER, 'index.html'));
});

app.get('/provider-dashboard.html', (req, res) => {
  res.sendFile(path.join(FRONTEND_FOLDER, 'provider-dashboard.html'));
});

app.get('/customer-dashboard.html', (req, res) => {
  res.sendFile(path.join(FRONTEND_FOLDER, 'customer-dashboard.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'frontend',
    port: PORT,
    frontendFolder: FRONTEND_FOLDER,
    serving: ['index.html', 'provider-dashboard.html', 'customer-dashboard.html']
  });
});

// FIXED: Use proper regex pattern instead of '*' 
// Handle all other routes - serve index.html for SPA
app.get(/^\/(?!api|socket\.io|health).*$/, (req, res) => {
  res.sendFile(path.join(FRONTEND_FOLDER, 'index.html'));
});

// Alternative fix if the above doesn't work:
// app.get('*', (req, res) => {
//   res.sendFile(path.join(FRONTEND_FOLDER, 'index.html'));
// });

app.listen(PORT, () => {
  console.log(`
🚀 Frontend Server Running!
────────────────────────────────
📍 Port: ${PORT}
📍 Serving from: ${FRONTEND_FOLDER}
────────────────────────────────
📄 Pages:
   • Main: http://localhost:${PORT}/
   • Provider: http://localhost:${PORT}/provider-dashboard.html
   • Customer: http://localhost:${PORT}/customer-dashboard.html
────────────────────────────────
✅ Socket.io should now work properly!
  `);
});