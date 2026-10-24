export const config = Object.freeze({
  gatewayPort: Number(process.env.GATEWAY_PORT ?? 3000),
  nilaiPort: Number(process.env.NILAI_PORT ?? 3001),
  transkripPort: Number(process.env.TRANSKRIP_PORT ?? 3002),
  jwtSecret: process.env.JWT_SECRET ?? 'unsil-zero-trust-jwt-secret-key-2026',
  gatewaySecret: process.env.GATEWAY_SECRET ?? 'pep-gateway-internal-secret-2026',
  serviceClientId: process.env.SERVICE_CLIENT_ID ?? 'service-nilai',
  serviceClientSecret: process.env.SERVICE_CLIENT_SECRET ?? 'secret-service-nilai-999',
  accessStartHour: Number(process.env.ACCESS_START_HOUR ?? 7),
  accessEndHour: Number(process.env.ACCESS_END_HOUR ?? 21),
  databasePath: process.env.DATABASE_PATH ?? new URL('./kampus.db', import.meta.url).pathname,
});

export const tokenLifetime = Object.freeze({ access: '10m', refreshMs: 86_400_000, service: '5m' });
