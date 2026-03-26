import { loadConfig } from "./config";
import { startDiscordAdapter } from "./discord/adapter";
import { startTaskReceiver } from "./task-receiver";
import { startWechatAdapter } from "./wechat/adapter";
import { createWorkerClient } from "./worker-client";

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const workerClient = createWorkerClient(config);

  startTaskReceiver(config);
  await startDiscordAdapter(config, workerClient);
  await startWechatAdapter(config, workerClient);
}

void bootstrap();
