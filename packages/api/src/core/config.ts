export const config = {
  env: process.env['NODE_ENV'] || 'development',
  isDevelopment: process.env['NODE_ENV'] === 'development',
  isProduction: process.env['NODE_ENV'] === 'production',
  server: {
    port: parseInt(process.env['PORT'] || '3000', 10),
    // Defaults cover both the Angular dev server (ng serve :4200) and the
    // containerized client (compose maps it to :8080). Override via ALLOWED_ORIGINS.
    allowedOrigins: process.env['ALLOWED_ORIGINS']?.split(',') || [
      'http://localhost:4200',
      'http://localhost:8080',
    ],
  },
};
