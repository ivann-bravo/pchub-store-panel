import * as XLSX from "xlsx";

export interface ParsedRow {
  [key: string]: string | number | null;
}

export interface ParseResult {
  headers: string[];
  rows: ParsedRow[];
  totalRows: number;
}

/**
 * Parse a CSV or XLSX file buffer into structured data
 */
export function parseFile(buffer: Buffer, filename: string): ParseResult {
  const isExcel = /\.xlsx?$/i.test(filename);

  if (isExcel) {
    return parseExcel(buffer);
  } else {
    return parseCSV(buffer);
  }
}

/**
 * Find the real header row in an XLSX sheet.
 * Some files have metadata rows before the actual column headers.
 * Heuristic: first row (within first 30) where all non-empty cells are strings
 * and there are at least 4 non-empty cells.
 */
function findHeaderRowIndex(data: unknown[][]): number {
  for (let i = 0; i < Math.min(30, data.length); i++) {
    const row = data[i] as unknown[];
    const nonEmpty = row.filter((c) => c != null && c !== "");
    if (
      nonEmpty.length >= 4 &&
      nonEmpty.every((c) => typeof c === "string")
    ) {
      return i;
    }
  }
  return 0;
}

function parseExcel(buffer: Buffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });

  if (data.length === 0) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  const headerRowIdx = findHeaderRowIndex(data);
  const rawHeaders = (data[headerRowIdx] as unknown[]).map((h) => String(h || "").trim());
  const headers = rawHeaders.map((h, idx) => h || `__col_${idx}__`);
  const rows: ParsedRow[] = [];

  for (let i = headerRowIdx + 1; i < data.length; i++) {
    const rowData = data[i] as unknown[];
    if (!rowData || rowData.length === 0) continue;
    // Skip repeated header rows
    if (String(rowData[0] || "").trim() === rawHeaders[0]) continue;

    const row: ParsedRow = {};
    headers.forEach((header, idx) => {
      const val = rowData[idx];
      row[header] = val != null && val !== "" ? String(val) : null;
    });
    rows.push(row);
  }

  return { headers, rows, totalRows: rows.length };
}

function parseCSV(buffer: Buffer): ParseResult {
  // Try UTF-8 first, then Latin-1
  let content = buffer.toString("utf-8");
  if (content.includes("�")) {
    content = buffer.toString("latin1");
  }

  // Strip BOM characters (UTF-8 BOM: EF BB BF, or its Latin-1 interpretation: ï»¿)
  content = content.replace(/^\uFEFF/, ''); // UTF-8 BOM
  content = content.replace(/^ï»¿/g, '');   // BOM read as Latin-1 (can appear multiple times)
  content = content.replace(/ï»¿/g, '');     // Remove any remaining BOM artifacts

  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) {
    return { headers: [], rows: [], totalRows: 0 };
  }

  // Detect delimiter
  const firstLine = lines[0];
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const delimiter =
    tabCount > semicolonCount && tabCount > commaCount
      ? "\t"
      : semicolonCount > commaCount
        ? ";"
        : ",";

  // Parse headers and give empty ones a numbered name
  const rawHeaders = parseLine(lines[0], delimiter).map((h) => h.trim());
  const headers = rawHeaders.map((h, idx) => h || `__col_${idx}__`);
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseLine(lines[i], delimiter);
    if (fields.length === 0) continue;

    const row: ParsedRow = {};
    headers.forEach((header, idx) => {
      row[header] = fields[idx]?.trim() || null;
    });
    rows.push(row);
  }

  return { headers, rows, totalRows: rows.length };
}

function parseLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Auto-detect column mapping from headers
 */
export function autoDetectColumns(headers: string[]): {
  code: string | null;
  description: string | null;
  price: string | null;
  stock: string | null;
} {
  const lower = headers.map((h) => h.toLowerCase());

  const codePatterns = ["codigo", "código", "cod", "code", "sku", "art", "articulo", "artículo", "id"];
  const descPatterns = ["descripcion", "descripción", "desc", "nombre", "name", "producto", "product", "detalle"];
  const pricePatterns = ["precio", "price", "costo", "cost", "valor", "importe", "monto"];
  const stockPatterns = ["stock", "cantidad", "qty", "quantity", "disponible", "disp"];

  function findMatch(patterns: string[]): string | null {
    for (const pattern of patterns) {
      const idx = lower.findIndex((h) => h.includes(pattern));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }

  return {
    code: findMatch(codePatterns),
    description: findMatch(descPatterns),
    price: findMatch(pricePatterns),
    stock: findMatch(stockPatterns),
  };
}
