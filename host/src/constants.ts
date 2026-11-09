/** Stable state-directory paths, so process/admin/tools agree on one source. */
import { configPath, logPath, stateDir } from './config.ts';

export const CONFIG_PATH = configPath();
export const LOG_PATH = logPath();
export const STATE_DIR = stateDir();
