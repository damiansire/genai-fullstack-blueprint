export const config = {
  env: process.env['NODE_ENV'] || 'development',
  isDevelopment: process.env['NODE_ENV'] === 'development',
  isProduction: process.env['NODE_ENV'] === 'production',
  server: {
    port: parseInt(process.env['PORT'] || '3000', 10),
    allowedOrigins: process.env['ALLOWED_ORIGINS']?.split(',') || ['http://localhost:4200'],
  }
};
