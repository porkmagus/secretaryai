type LogLevel = "debug" | "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

function write(level: LogLevel, service: string, event: string, payload?: LogPayload) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service,
    event,
    ...payload,
  };

  const _line = JSON.stringify(record);

  if (level === "error") {
    return;
  }
}

export function createLogger(service: string) {
  return {
    debug(event: string, payload?: LogPayload) {
      write("debug", service, event, payload);
    },
    info(event: string, payload?: LogPayload) {
      write("info", service, event, payload);
    },
    warn(event: string, payload?: LogPayload) {
      write("warn", service, event, payload);
    },
    error(event: string, payload?: LogPayload) {
      write("error", service, event, payload);
    },
  };
}
