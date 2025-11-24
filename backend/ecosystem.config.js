module.exports = {
  apps: [{
    name: 'frontend-server',
    script: './frontend-server.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'development',
      FRONTEND_PORT: 3000,
      BACKEND_URL: 'http://localhost:4000'
    },
    env_production: {
      NODE_ENV: 'production',
      FRONTEND_PORT: 3000,
      BACKEND_URL: 'https://your-api-domain.com'
    }
  }]
};