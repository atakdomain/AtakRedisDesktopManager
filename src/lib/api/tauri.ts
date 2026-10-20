import { Channel, invoke } from "@tauri-apps/api/core";
import type { Transport } from "./index";

export const tauriTransport: Transport = {
  invoke: (cmd, args) => invoke(cmd, args),
  stream(cmd, args, channelArg, onEvent) {
    const channel = new Channel<never>();
    channel.onmessage = onEvent;
    return invoke(cmd, { ...args, [channelArg]: channel });
  },
};
