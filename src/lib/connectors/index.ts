import type { SupplierConnector } from "./base";
import type { ApiConfig } from "@/types";
import { GNConnector } from "./gn";
import { NBConnector } from "./nb";
import { ElitConnector } from "./elit";
import { PCArtsConnector } from "./pcarts";

const connectorMap: Record<string, new (config: ApiConfig) => SupplierConnector> = {
  gn: GNConnector,
  nb: NBConnector,
  elit: ElitConnector,
  pcarts: PCArtsConnector,
};

export function getConnector(connectorId: string, config: ApiConfig): SupplierConnector {
  const ConnectorClass = connectorMap[connectorId.toLowerCase()];
  if (!ConnectorClass) {
    throw new Error(`Unknown connector: ${connectorId}. Available: ${Object.keys(connectorMap).join(", ")}`);
  }
  return new ConnectorClass(config);
}

export { type SupplierConnector } from "./base";
