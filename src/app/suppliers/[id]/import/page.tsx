"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Upload, FileUp, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ColumnMapping {
  code: string | null;
  description: string | null;
  price: string | null;
  stock: string | null;
}

interface PreviewData {
  headers: string[];
  rows: Record<string, string>[];
  totalRows: number;
}

export default function ImportPage() {
  const params = useParams();
  const router = useRouter();
  const [supplierInfo, setSupplierInfo] = useState<{ code: string; name: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({
    code: null,
    description: null,
    price: null,
    stock: null,
  });
  const [savedMapping, setSavedMapping] = useState<ColumnMapping | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ totalRows: number; linkedCount: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    fetch(`/api/suppliers/${params.id}/import`)
      .then((r) => r.json())
      .then((data) => {
        setSupplierInfo(data.supplier);
        if (data.savedMapping) setSavedMapping(data.savedMapping);
      });
  }, [params.id]);

  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile);
    setResult(null);

    const isExcel = /\.xlsx?$/i.test(selectedFile.name);
    let headers: string[] = [];
    let rows: Record<string, string>[] = [];
    let totalRows = 0;

    if (isExcel) {
      // Parse XLSX with SheetJS
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });

      // Auto-detect header row: first row with >=4 non-empty string cells
      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(30, data.length); i++) {
        const row = data[i] as unknown[];
        const nonEmpty = row.filter((c) => c != null && c !== "");
        if (nonEmpty.length >= 4 && nonEmpty.every((c) => typeof c === "string")) {
          headerRowIdx = i;
          break;
        }
      }

      const rawHeaders = (data[headerRowIdx] as unknown[]).map((h) => String(h || "").trim());
      headers = rawHeaders.map((h, idx) => h || `__col_${idx}__`);
      totalRows = 0;

      for (let i = headerRowIdx + 1; i < data.length; i++) {
        const rowData = data[i] as unknown[];
        const firstCell = String(rowData[0] || "").trim();
        if (!firstCell || firstCell === rawHeaders[0]) continue; // skip empty or repeated header
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = rowData[idx] != null && rowData[idx] !== "" ? String(rowData[idx]) : "";
        });
        rows.push(row);
        totalRows++;
      }
      rows = rows.slice(0, 20); // preview only first 20
    } else {
      // CSV: read as text
      const text = await selectedFile.text();
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return;

      const delimiter = lines[0].includes(";") ? ";" : lines[0].includes("\t") ? "\t" : ",";
      const rawHeaders = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ""));
      headers = rawHeaders.map((h, idx) => h || `__col_${idx}__`);
      totalRows = lines.length - 1;

      for (let i = 1; i < Math.min(lines.length, 21); i++) {
        const fields = lines[i].split(delimiter).map((f) => f.trim().replace(/^"|"$/g, ""));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h] = fields[idx] || ""; });
        rows.push(row);
      }
    }

    setPreview({ headers, rows, totalRows });

    // Auto-detect or use saved mapping
    if (savedMapping) {
      // Validate saved mapping columns still exist
      const valid: ColumnMapping = {
        code: savedMapping.code && headers.includes(savedMapping.code) ? savedMapping.code : null,
        description: savedMapping.description && headers.includes(savedMapping.description) ? savedMapping.description : null,
        price: savedMapping.price && headers.includes(savedMapping.price) ? savedMapping.price : null,
        stock: savedMapping.stock && headers.includes(savedMapping.stock) ? savedMapping.stock : null,
      };
      setMapping(valid);
    } else {
      // Auto-detect
      const lower = headers.map((h) => h.toLowerCase());
      setMapping({
        code: headers[lower.findIndex((h) => h.includes("codigo") || h.includes("código") || h.includes("cod") || h.includes("sku"))] || null,
        description: headers[lower.findIndex((h) => h.includes("descripcion") || h.includes("descripción") || h.includes("nombre") || h.includes("desc"))] || null,
        price: headers[lower.findIndex((h) => h.includes("precio") || h.includes("price") || h.includes("costo"))] || null,
        stock: headers[lower.findIndex((h) => h.includes("stock") || h.includes("cantidad") || h.includes("disp"))] || null,
      });
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFile(droppedFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedMapping]);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));

      const res = await fetch(`/api/suppliers/${params.id}/import`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setResult(data);
        toast.success(`Importación completada: ${data.linkedCount} de ${data.totalRows} vinculados`);
      } else {
        toast.error(data.error || "Error en la importación");
      }
    } catch {
      toast.error("Error de conexión");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <h1 className="text-2xl font-bold">
          Importar Catálogo - {supplierInfo?.name || "..."}
        </h1>
      </div>

      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle>1. Seleccionar Archivo</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
                : "border-muted-foreground/25"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <FileUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg mb-2">
              Arrastrá un archivo CSV o XLSX aquí
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              o hacé click para seleccionar
            </p>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              id="file-upload"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <label htmlFor="file-upload">
              <Button variant="outline" asChild>
                <span>Seleccionar archivo</span>
              </Button>
            </label>
            {file && (
              <p className="mt-4 text-sm">
                <Badge variant="secondary">{file.name}</Badge> ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Column Mapping */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>2. Mapeo de Columnas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              {(["code", "description", "price", "stock"] as const).map((field) => (
                <div key={field}>
                  <Label className="capitalize">
                    {field === "code"
                      ? "Código"
                      : field === "description"
                        ? "Descripción"
                        : field === "price"
                          ? "Precio"
                          : "Stock"}
                  </Label>
                  <Select
                    value={mapping[field] || "none"}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, [field]: v === "none" ? null : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin mapear" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin mapear</SelectItem>
                      {preview.headers.map((h) => (
                        <SelectItem key={h} value={h}>
                          {h.startsWith("__col_") ? `[Columna ${parseInt(h.replace("__col_", "").replace("__", "")) + 1}]` : h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview Table */}
            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    {preview.headers.map((h) => (
                      <TableHead key={h} className="whitespace-nowrap text-xs">
                        {h}
                        {Object.values(mapping).includes(h) && (
                          <Badge variant="default" className="ml-1 text-[10px]">
                            {Object.entries(mapping).find(([, v]) => v === h)?.[0]}
                          </Badge>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                      {preview.headers.map((h) => (
                        <TableCell key={h} className="text-xs max-w-[200px] truncate">
                          {row[h] || ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Mostrando 20 de {preview.totalRows.toLocaleString()} filas
            </p>
          </CardContent>
        </Card>
      )}

      {/* Import Action */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Importar</CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="text-center py-4">
                <Check className="h-12 w-12 mx-auto mb-4 text-green-600" />
                <p className="text-lg font-medium">Importación completada</p>
                <p className="text-muted-foreground">
                  {result.linkedCount} de {result.totalRows} items vinculados automáticamente
                </p>
                <div className="flex gap-2 mt-4 justify-center">
                  <Button
                    variant="outline"
                    onClick={() => router.push(`/suppliers/${params.id}/catalog`)}
                  >
                    Ver Catálogo Importado
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      setResult(null);
                    }}
                  >
                    Importar Otro
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm">
                    Se importarán <strong>{preview.totalRows.toLocaleString()}</strong> filas.
                    Los productos ya vinculados se actualizarán automáticamente.
                  </p>
                </div>
                <Button onClick={handleImport} disabled={importing}>
                  {importing ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importando...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" /> Importar
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
