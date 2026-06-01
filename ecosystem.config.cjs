/**
 * PM2 ornek yapilandirma
 *
 * Normal baslat:        pm2 start ecosystem.config.cjs
 * Restart son mesaj:    pm2 restart wbot --update-env  (env_restart kullanir)
 * veya .env icinde STARTUP_MODE=reply_last + pm2 restart wbot --update-env
 */

module.exports = {
  apps: [
    {
      name: 'wbot',
      script: 'bot.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: 'production',
        STARTUP_MODE: 'idle',
      },
      env_restart: {
        STARTUP_MODE: 'reply_last',
      },
      env_sync: {
        STARTUP_MODE: 'sync',
      },
    },
  ],
};
