import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Native SDK data belongs to the selected BoxAI profile, never the Pi CLI.
 * Ignore inherited PI_CODING_AGENT_DIR: launching BoxAI from a Pi shell must
 * not opt the desktop into another application's credentials or sessions.
 */
export function agentDataDir(): string {
  const root = process.env.PI_DESKTOP_DATA_DIR?.trim() ||
    join(homedir(), process.env.PI_DESKTOP_DEV === "1" ? ".boxai-desktop-dev" : ".boxai-desktop");
  return resolve(root, "agent");
}
