import pino from 'pino';

let _logger: pino.Logger | null = null;

export function initLogger(level: string): pino.Logger {
  _logger = pino({
    level,
    transport: process.stdout.isTTY
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });
  return _logger;
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({ level: 'info' });
  }
  return _logger;
}
