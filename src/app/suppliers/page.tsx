"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Upload, Settings, Truck, RefreshCw, Loader2, List } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";
import type { SupplierWithStats } from "@/types";
import { getImportPage } from "@/lib/connectors/file-connectors";

export default function SuppliersPage() {
  const { data: session } = useSession();
  const isViewer = session?.user?.role === "VIEWER";
  const [suppliers, setSuppliers] = useState<SupplierWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchSuppliers = () => {
    fetch("/api/suppliers")
      .then((r) => r.json())
      .then((data) => {
        setSuppliers(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/auto-sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Error al sincronizar");
        return;
      }
      const results = data.results || [];
      const successCount = results.filter((r: { success: boolean }) => r.success).length;
      const totalItems = results
        .filter((r: { success: boolean }) => r.success)
        .reduce((sum: number, r: { items?: number }) => sum + (r.items || 0), 0);

      if (results.length === 0) {
        toast.info("No hay proveedores con API configurada");
      } else {
        toast.success(
          `${successCount}/${results.length} proveedores sincronizados (${totalItems.toLocaleString()} items)`
        );
      }

      // Refresh the list to show updated import dates
      fetchSuppliers();
    } catch {
      toast.error("Error al sincronizar proveedores");
    } finally {
      setSyncing(false);
    }
  };

  const apiCount = suppliers.filter((s) => s.connectorType === "api").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proveedores"
        breadcrumbs={[{ label: "Proveedores" }]}
        description="Gestioná los proveedores y sus importaciones de precios"
        actions={
          !isViewer && apiCount > 0 ? (
            <Button onClick={handleSyncAll} disabled={syncing}>
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {syncing ? "Sincronizando..." : `Sincronizar APIs (${apiCount})`}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Moneda</TableHead>
                <TableHead>Conexión</TableHead>
                <TableHead className="text-right">Productos</TableHead>
                <TableHead className="text-right">Con Precio</TableHead>
                <TableHead>Última Importación</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(9)].map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : suppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-0">
                    <EmptyState
                      icon={Truck}
                      title="No hay proveedores"
                      description="Agrega un nuevo proveedor para comenzar a importar precios."
                    />
                  </TableCell>
                </TableRow>
              ) : (
                suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-mono font-medium">{supplier.code}</TableCell>
                    <TableCell>{supplier.name}</TableCell>
                    <TableCell>
                      <Badge variant={supplier.currency === "USD" ? "default" : "secondary"}>
                        {supplier.currency}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={supplier.connectorType === "api" ? "info" : "outline"}>
                        {supplier.connectorType === "api" ? "API" : "Manual"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{supplier.productCount}</TableCell>
                    <TableCell className="text-right">{supplier.priceCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {supplier.lastImport
                        ? new Date(supplier.lastImport.endsWith("Z") ? supplier.lastImport : supplier.lastImport + "Z").toLocaleString("es-AR", {
                            timeZone: "America/Argentina/Buenos_Aires",
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "Nunca"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={supplier.isActive ? "success" : "secondary"}>
                        {supplier.isActive ? "Activo" : "Inactivo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <TooltipProvider>
                        <div className="flex gap-1 justify-end">
                          {!isViewer && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link href={getImportPage(supplier.code) ?? `/suppliers/${supplier.id}/import`}>
                                  <Button variant="outline" size="icon" className="h-7 w-7">
                                    <Upload className="h-3 w-3" />
                                  </Button>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>Importar catálogo</TooltipContent>
                            </Tooltip>
                          )}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Link href={`/suppliers/${supplier.id}/catalog`}>
                                <Button variant="outline" size="icon" className="h-7 w-7">
                                  <List className="h-3 w-3" />
                                </Button>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>Ver catálogo</TooltipContent>
                          </Tooltip>
                          {!isViewer && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Link href={`/suppliers/${supplier.id}`}>
                                  <Button variant="ghost" size="icon" className="h-7 w-7">
                                    <Settings className="h-3 w-3" />
                                  </Button>
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>Configuración</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
