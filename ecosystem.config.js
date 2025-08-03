module.exports = {
  apps: [
    {
      name: 'miurd',
      script: 'tsx',
      args: 'src/index.ts',
      cwd: '/path/to/miurd', // 本番環境でのプロジェクトパスに変更してください
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      // graceful reload/restart
      kill_timeout: 1600
    }
  ]
};