/**
 * Structured logs: one JSON object per line on stdout, which every log platform
 * can index. Never log request bodies or query strings: they carry salaries and
 * the names people search for.
 */
export type LogFields = Record<string, unknown>;

export interface Logger {
  info(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

function write(level: 'info' | 'error', msg: string, fields: LogFields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const jsonLogger: Logger = {
  info: (msg, fields) => write('info', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};

export const silentLogger: Logger = { info: () => {}, error: () => {} };
