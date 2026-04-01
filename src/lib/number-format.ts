/**
 * Parse a number string, auto-detecting Argentine (30.426,59) vs US (30,426.59 / 52.5) format.
 *
 * Rules:
 * - Has both dot AND comma → check which comes last (that's the decimal separator)
 *   - "30.426,59" → Argentine → 30426.59
 *   - "30,426.59" → US → 30426.59
 * - Has only comma → treat as decimal separator: "52,5" → 52.5
 * - Has only dot → check if it looks like thousands (e.g. "1.000") or decimal ("52.5")
 *   - Single dot with ≤2 digits after → decimal: "52.5" → 52.5, "3742.00" → 3742
 *   - Single dot with 3 digits after and digits before → thousands: "1.000" → 1000
 *   - Multiple dots → thousands separators: "1.000.000" → 1000000
 * - No dots or commas → integer: "525" → 525
 */
export function parseArgNumber(value: string | undefined | null): number | null {
  if (!value || value.trim() === "") return null;
  const cleaned = value.trim().replace(/"/g, "");
  if (cleaned === "") return null;

  const hasDot = cleaned.includes(".");
  const hasComma = cleaned.includes(",");

  let normalized: string;

  if (hasDot && hasComma) {
    const lastDot = cleaned.lastIndexOf(".");
    const lastComma = cleaned.lastIndexOf(",");
    if (lastComma > lastDot) {
      // Argentine format: 30.426,59 → dot is thousands, comma is decimal
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      // US format: 30,426.59 → comma is thousands, dot is decimal
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Only comma → decimal separator: "52,5" → "52.5"
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    const dotCount = (cleaned.match(/\./g) || []).length;
    if (dotCount > 1) {
      // Multiple dots = thousands separators: "1.000.000" → "1000000"
      normalized = cleaned.replace(/\./g, "");
    } else {
      // Single dot: check digits after dot
      const afterDot = cleaned.split(".")[1] || "";
      const beforeDot = cleaned.split(".")[0] || "";
      if (afterDot.length === 3 && beforeDot.length >= 1 && beforeDot.length <= 3) {
        // Likely thousands separator: "1.000" → 1000
        normalized = cleaned.replace(".", "");
      } else {
        // Decimal separator: "52.5", "3742.00", "0.21"
        normalized = cleaned;
      }
    }
  } else {
    normalized = cleaned;
  }

  const num = parseFloat(normalized);
  return isNaN(num) ? null : num;
}

/**
 * Format number to Argentine format for display
 */
export function formatArgNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "-";
  return value.toLocaleString("es-AR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format as ARS currency
 */
export function formatARS(value: number | null | undefined): string {
  if (value == null) return "-";
  return `$ ${formatArgNumber(value)}`;
}

/**
 * Round a price to the nearest integer ending in 9, rounding up.
 * e.g. 67873 → 67879 · 67870 → 67879 · 67880 → 67889 · 67879 → 67879
 * Used for client-facing prices in the catalog and WooCommerce export.
 */
export function roundToNine(price: number): number {
  const n = Math.ceil(price);
  return Math.ceil((n - 9) / 10) * 10 + 9;
}

/**
 * Format a client-facing price: round to 9, then display without cents.
 */
export function formatClientPrice(value: number | null | undefined): string {
  if (value == null) return "-";
  return `$ ${roundToNine(value).toLocaleString("es-AR")}`;
}
