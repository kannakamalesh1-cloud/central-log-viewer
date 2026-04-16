module.exports = {
  apps: [
    {
      name: 'pulselog',
      script: 'server.js',
      cwd: '/home/kamalesh/central-log-viewer',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
    },
  ],
};
