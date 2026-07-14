export interface AppConfig {
  socks5Port: number;
  apiPort: number;
  apiHost: string;
  apiKey: string;
  dbPath: string;
  defaultSubnet: string | null;
  defaultSubnetGateway: string | null;
  bcryptRounds: number;
  logLevel: string;
}

function envInt(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`${key} must be an integer, got: ${v}`);
  return n;
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required');
  }

  return {
    socks5Port: envInt('SOCKS5_PORT', 1080),
    apiPort: envInt('API_PORT', 3000),
    apiHost: process.env.API_HOST || '0.0.0.0',
    apiKey,
    dbPath: process.env.DB_PATH || '/data/proxy.db',
    defaultSubnet: process.env.DEFAULT_SUBNET || null,
    defaultSubnetGateway: process.env.DEFAULT_SUBNET_GATEWAY || null,
    bcryptRounds: envInt('BCRYPT_ROUNDS', 10),
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}
