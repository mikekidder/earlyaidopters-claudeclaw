module.exports = {
  apps: [
    {
      name: 'claudeclaw',
      script: 'dist/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 10,
      error_file: 'store/pm2-error.log',
      out_file: 'store/pm2-out.log',
      merge_logs: true,
      watch: false,
    },
    // Uncomment to add agents later:
    // {
    //   name: 'claudeclaw-comms',
    //   script: 'dist/index.js',
    //   args: '--agent comms',
    //   cwd: __dirname,
    //   env: { NODE_ENV: 'production' },
    //   autorestart: true,
    //   restart_delay: 5000,
    //   error_file: 'store/pm2-comms-error.log',
    //   out_file: 'store/pm2-comms-out.log',
    //   merge_logs: true,
    // },
  ],
};
