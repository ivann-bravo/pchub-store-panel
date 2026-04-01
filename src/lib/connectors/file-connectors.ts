/**
 * Registry of file-based supplier connectors.
 * Maps supplier.code → dedicated import page path.
 *
 * To add a new file-based supplier:
 * 1. Create src/lib/connectors/{code}.ts  with parse logic
 * 2. Create src/app/api/suppliers/{code}/import/route.ts
 * 3. Create src/app/suppliers/{code}/page.tsx
 * 4. Add an entry here.
 */
export const FILE_CONNECTOR_PAGES: Record<string, string> = {
  AIR: "/suppliers/air",
  INVID: "/suppliers/invid",
  ASHIR: "/suppliers/ashir",
  POLYTECH: "/suppliers/polytech",
  SENTEY: "/suppliers/sentey",
  LATAMLY: "/suppliers/latamly",
  HDC: "/suppliers/hdc",
};

/** Returns the dedicated import page for a supplier code, or null for generic. */
export function getImportPage(supplierCode: string): string | null {
  return FILE_CONNECTOR_PAGES[supplierCode.toUpperCase()] ?? null;
}
