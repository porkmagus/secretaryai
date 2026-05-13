import "dotenv/config";
import { startHeartbeatLoop } from "./lib/heartbeat-runtime.js";
import { startTelegramPolling } from "./lib/telegram-integration.js";
import { buildServer } from "./server.js";

async function main() {
  const { app, config, infrastructure, logger } = await buildServer();
  let stopTelegramPolling: (() => void) | null = null;
  let stopHeartbeatLoop: (() => void) | null = null;

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.worker.port,
    });

    logger.info("worker.started", {
      port: config.worker.port,
      nodeEnv: config.nodeEnv,
    });

    stopTelegramPolling = startTelegramPolling({
      config,
      infrastructure,
      onError: (error) => {
        logger.error("integrations.telegram.polling_failed", {
          error: error instanceof Error ? error.message : error,
        });
      },
    });
    stopHeartbeatLoop = startHeartbeatLoop({
      config,
      infrastructure,
      onError: (error) => {
        logger.error("integrations.heartbeat.loop_failed", {
          error: error instanceof Error ? error.message : error,
        });
      },
    });
  } catch (error) {
    logger.error("worker.start_failed", {
      error,
    });

    await infrastructure.close();
    process.exit(1);
  }

  const shutdown = async () => {
    logger.info("worker.stopping");
    stopTelegramPolling?.();
    stopHeartbeatLoop?.();
    await Promise.allSettled([app.close(), infrastructure.close()]);
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
