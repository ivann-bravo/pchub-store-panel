export interface Product {
  id: number;
  woocommerceId: number | null;
  name: string;
  sku: string | null;
  eanUpc: string | null;
  category: string | null;
  brand: string | null;
  warranty: string | null;
  ivaRate: number;
  internalTaxRate: number;
  markupRegular: number;
  markupOffer: number | null;
  offerStart: string | null;
  offerEnd: string | null;
  ownPriceRegular: number | null;
  ownPriceOffer: number | null;
  ownCostUsd: number | null;
  localStock: number;
  hasSupplierStock: boolean;
  weightKg: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  imageUrl: string | null;
  slug: string | null;
  storeUrl: string | null;
  productTags: string | null;
  attributes: string | null; // JSON: {"socket":"1700","memoryType":"DDR4","gpuIntegrado":false}
  shortDescription: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: number;
  code: string;
  name: string;
  currency: "ARS" | "USD";
  taxRate: number;
  shippingSurcharge: number;
  shippingPercent: number;
  isActive: boolean;
  columnMapping: string | null;
  connectorType: "manual" | "api";
  apiConfig: string | null;
  autoSync: boolean;
  stockConfig: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierWithStats extends Supplier {
  productCount: number;
  priceCount: number;
  lastImport: string | null;
}

export interface ProductSupplierLink {
  id: number;
  productId: number;
  supplierId: number;
  supplierCode: string;
  isActive: boolean;
  createdAt: string;
}

export interface SupplierPrice {
  id: number;
  linkId: number;
  rawPrice: number;
  currency: string;
  exchangeRate: number | null;
  finalCostArs: number;
  updatedAt: string;
}

export interface ProductWithSuppliers extends Product {
  supplierLinks: (ProductSupplierLink & {
    supplier: Supplier;
    price: SupplierPrice | null;
  })[];
}

export interface SupplierCatalog {
  id: number;
  supplierId: number;
  filename: string;
  rowCount: number;
  linkedCount: number;
  importedAt: string;
  status: string;
}

export interface SupplierCatalogItem {
  id: number;
  catalogId: number;
  supplierCode: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  stockAvailable: boolean | null;
  rawData: string | null;
  linkedProductId: number | null;
  matchConfidence: number | null;
  createdAt: string;
}

export interface ExchangeRate {
  id: number;
  source: string;
  buyRate: number;
  sellRate: number;
  fetchedAt: string;
}

export interface DashboardStats {
  totalProducts: number;
  withPrice: number;
  withoutPrice: number;
  onOffer: number;
  totalSuppliers: number;
  categoriesCount: number;
  brandsCount: number;
  recentImports: (SupplierCatalog & { supplierName: string })[];
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ColumnMapping {
  code: string | null;
  description: string | null;
  price: string | null;
  stock: string | null;
}

export interface PriceHistoryEntry {
  id: number;
  linkId: number;
  rawPrice: number;
  currency: string;
  exchangeRate: number | null;
  finalCostArs: number;
  recordedAt: string;
}

export interface ApiConfig {
  baseUrl: string;
  username: string;
  password: string;
  connectorId: string;
  id?: number;
}

export interface CatalogItem {
  code: string;
  description: string;
  price: number;
  currency: string;
  stockAvailable: boolean;
  rawData?: Record<string, unknown>;
}

export interface ProductPriceHistoryEntry {
  id: number;
  productId: number;
  priceRegular: number | null;
  priceOffer: number | null;
  recordedAt: string;
}

export interface PriceAlert {
  productId: number;
  productName: string;
  source: string;
  previousPrice: number;
  currentPrice: number;
  changePercent: number;
  recordedAt: string;
}

export interface StaleStockAlert {
  id: number;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  updatedAt: string;
  monthsStale: number;
  severity: "warning" | "danger" | "critical";
}

// ─── Combo Builder ────────────────────────────────────────────────────────────

export type ComboSlotType = "auto" | "fixed" | "combo";

export interface ComboTemplate {
  id: number;
  name: string;
  sku: string;
  productId: number | null;
  isActive: boolean;
  lastTotalPrice: number | null;
  lastHasStock: boolean | null;
  lastRefreshedAt: string | null;
  notes: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ComboSlot {
  id: number;
  templateId: number;
  slotName: string;
  sortOrder: number;
  slotType: ComboSlotType;
  quantity: number;
  fixedProductId: number | null;
  fixedComboId: number | null;
  filterCategory: string | null;
  filterKeywords: string | null; // JSON: string[]
  filterAttributes: string | null; // JSON: {"memoryType":"DDR4"}
  resolvedProductId: number | null;
  resolvedProductName: string | null;
  resolvedPrice: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ComboTemplateWithSlots extends ComboTemplate {
  slots: ComboSlot[];
}

export interface SlotResolutionResult {
  slotId: number;
  slotName: string;
  slotType: ComboSlotType;
  quantity: number;
  sortOrder: number;
  resolvedProductId: number | null;
  resolvedProductName: string | null;
  resolvedProductSku: string | null;
  resolvedPrice: number | null; // client price per unit (offer price if on offer)
  regularPrice: number | null;  // price without offer (markup_regular based)
  isOnOffer: boolean;           // whether the resolved product has an active offer
  hasStock: boolean;
  error: string | null;
}

export interface ComboResolutionResult {
  templateId: number;
  templateName: string;
  templateSku: string;
  slots: SlotResolutionResult[];
  totalPrice: number | null;
  hasStock: boolean;
  resolvedAt: string;
  errors: string[];
}

// ─── Quotes / Presupuestos ────────────────────────────────────────────────────

export type QuoteSessionStatus =
  | "open"
  | "following_up"
  | "closed_wc"
  | "closed_wpp"
  | "closed_other"
  | "lost";

export type QuoteItemType = "auto" | "fixed" | "text";

export interface QuoteSession {
  id: number;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  status: QuoteSessionStatus;
  closedQuoteId: number | null;
  closedNotes: string | null;
  wcOrderId: string | null;
  exchangeRateAtCreation: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quote {
  id: number;
  sessionId: number;
  title: string;
  sortOrder: number;
  resolvedTotal: number | null;
  resolvedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteItem {
  id: number;
  quoteId: number;
  sortOrder: number;
  itemName: string;
  quantity: number;
  isOptional: boolean;
  itemType: QuoteItemType;
  // Auto
  filterCategory: string | null;
  filterKeywords: string | null;
  filterMustKeywords: string | null;
  filterAttributes: string | null;
  filterMinPrice: number | null;
  filterMaxPrice: number | null;
  // Fixed
  fixedProductId: number | null;
  // Text
  textPrice: number | null;
  textSku: string | null;
  // Resolution cache
  resolvedProductId: number | null;
  resolvedProductName: string | null;
  resolvedProductSku: string | null;
  resolvedImageUrl: string | null;
  resolvedPrice: number | null;
  resolvedHasStock: boolean | null;
  resolvedAt: string | null;
  // Manual override
  manualPrice: number | null;
  manualPriceNote: string | null;
  createdAt: string;
}

export interface QuoteWithItems extends Quote {
  items: QuoteItem[];
}

export interface QuoteSessionWithQuotes extends QuoteSession {
  quotes: QuoteWithItems[];
}

export interface RefreshAllResult {
  refreshedAt: string;
  results: {
    templateId: number;
    templateSku: string;
    success: boolean;
    totalPrice?: number | null;
    hasStock?: boolean;
    error?: string;
  }[];
}
