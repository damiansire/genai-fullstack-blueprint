export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api',
  // Local/dev API key for the fail-closed gateway. Must match one of the
  // server's API_KEY_* entries. In production, leave empty and front the gateway
  // with a same-origin proxy that injects the key server-side.
  apiKey: 'your-secure-api-key-1',
};
