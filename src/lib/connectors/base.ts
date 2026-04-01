import type { CatalogItem, ApiConfig } from "@/types";

export interface SupplierConnector {
  fetchCatalog(): Promise<CatalogItem[]>;
  testConnection(): Promise<boolean>;
  getExchangeRate?(): Promise<number>;
}

export type ConnectorFactory = (config: ApiConfig) => SupplierConnector;
