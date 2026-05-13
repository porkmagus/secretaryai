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

  const line = JSON.stringify(record);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
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
