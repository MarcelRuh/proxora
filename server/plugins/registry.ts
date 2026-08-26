/**
 * Extension points for later product features.
 * Implementations can register at startup without changing core services.
 */
export type PluginArea =
  | "backup"
  | "cluster"
  | "ceph"
  | "ha"
  | "replication"
  | "firewall"
  | "sdn"
  | "network"
  | "notifications"
  | "monitoring"
  | "prometheus"
  | "grafana";

export interface ManagerPlugin {
  id: string;
  area: PluginArea;
  register(): Promise<void> | void;
}

const plugins: ManagerPlugin[] = [];

export function registerPlugin(plugin: ManagerPlugin) {
  plugins.push(plugin);
}

export function listPlugins() {
  return [...plugins];
}
