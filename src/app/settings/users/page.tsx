"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  UserPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
  ShieldCheck,
  ShieldOff,
  KeyRound,
  UserCheck,
  UserX,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface User {
  id: number;
  email: string;
  name: string;
  role: "SUPER_ADMIN" | "VIEWER";
  isActive: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

// ─── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso + "Z"));
}

// ─── Create user dialog ────────────────────────────────────────────────────────
interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: User) => void;
}

function CreateUserDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"SUPER_ADMIN" | "VIEWER">("VIEWER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setEmail("");
    setName("");
    setPassword("");
    setRole("VIEWER");
    setError("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password, role }),
      });
      const data = (await res.json()) as User & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Error al crear usuario.");
      } else {
        onCreated(data);
        reset();
        onClose();
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo usuario</DialogTitle>
          <DialogDescription>Completá los datos para crear un nuevo usuario.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-email">Email</Label>
            <Input
              id="new-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="usuario@ejemplo.com"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-name">Nombre</Label>
            <Input
              id="new-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre completo"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-password">Contraseña inicial</Label>
            <Input
              id="new-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-role">Rol</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "SUPER_ADMIN" | "VIEWER")}>
              <SelectTrigger id="new-role" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPER_ADMIN">Super Admin — acceso total</SelectItem>
                <SelectItem value="VIEWER">Viewer — solo lectura</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer" onClick={() => { reset(); onClose(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="cursor-pointer">
              {loading ? <span className="flex items-center gap-2"><Spinner />Creando…</span> : "Crear usuario"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit user dialog ──────────────────────────────────────────────────────────
interface EditDialogProps {
  user: User | null;
  currentUserId: string | undefined;
  onClose: () => void;
  onUpdated: (user: User) => void;
}

function EditUserDialog({ user, currentUserId, onClose, onUpdated }: EditDialogProps) {
  const [name, setName] = useState(user?.name ?? "");
  const [role, setRole] = useState<"SUPER_ADMIN" | "VIEWER">(user?.role ?? "VIEWER");
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSelf = String(user?.id) === currentUserId;

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role);
      setIsActive(user.isActive);
      setNewPassword("");
      setError("");
    }
  }, [user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword && newPassword.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    setLoading(true);
    setError("");

    const body: Record<string, unknown> = { name, role, isActive };
    if (newPassword) body.password = newPassword;

    try {
      const res = await fetch(`/api/admin/users/${user!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as User & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Error al actualizar usuario.");
      } else {
        onUpdated(data);
        onClose();
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar usuario</DialogTitle>
          <DialogDescription>{user?.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Nombre</Label>
            <Input
              id="edit-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-role">Rol</Label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as "SUPER_ADMIN" | "VIEWER")}
              disabled={isSelf}
            >
              <SelectTrigger id="edit-role" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPER_ADMIN">Super Admin — acceso total</SelectItem>
                <SelectItem value="VIEWER">Viewer — solo lectura</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground">No podés cambiar tu propio rol.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-active">Estado</Label>
            <Select
              value={isActive ? "active" : "inactive"}
              onValueChange={(v) => setIsActive(v === "active")}
              disabled={isSelf}
            >
              <SelectTrigger id="edit-active" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Activo</SelectItem>
                <SelectItem value="inactive">Inactivo</SelectItem>
              </SelectContent>
            </Select>
            {isSelf && <p className="text-xs text-muted-foreground">No podés desactivar tu propia cuenta.</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-password">
              Nueva contraseña{" "}
              <span className="text-muted-foreground font-normal">(opcional)</span>
            </Label>
            <Input
              id="edit-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Dejar en blanco para no cambiar"
              className="h-10"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="cursor-pointer">
              {loading ? <span className="flex items-center gap-2"><Spinner />Guardando…</span> : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete user dialog ────────────────────────────────────────────────────────
interface DeleteDialogProps {
  user: User | null;
  onClose: () => void;
  onDeleted: (id: number) => void;
}

function DeleteUserDialog({ user, onClose, onDeleted }: DeleteDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${user!.id}`, { method: "DELETE" });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Error al eliminar usuario.");
      } else {
        onDeleted(user!.id);
        onClose();
      }
    } catch {
      setError("Error de conexión.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar usuario</DialogTitle>
          <DialogDescription>
            Esta acción es permanente y no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm">
            ¿Estás seguro de que querés eliminar a{" "}
            <span className="font-semibold">{user?.name}</span>{" "}
            <span className="text-muted-foreground">({user?.email})</span>?
          </p>
          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" className="cursor-pointer" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            disabled={loading}
            onClick={handleDelete}
          >
            {loading ? <span className="flex items-center gap-2"><Spinner />Eliminando…</span> : "Eliminar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { data: session } = useSession();
  const currentUserId = (session?.user as { id?: string })?.id;

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = (await res.json()) as User[];
        setUsers(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleCreated(user: User) {
    setUsers((prev) => [...prev, user]);
  }

  function handleUpdated(user: User) {
    setUsers((prev) => prev.map((u) => (u.id === user.id ? user : u)));
  }

  function handleDeleted(id: number) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Usuarios</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Administrá los usuarios y sus permisos de acceso al panel
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="cursor-pointer">
          <UserPlus className="mr-2 h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usuarios del sistema</CardTitle>
          <CardDescription>
            {users.length} usuario{users.length !== 1 ? "s" : ""} registrado{users.length !== 1 ? "s" : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No hay usuarios registrados.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Último acceso</TableHead>
                  <TableHead className="w-[48px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const isSelf = String(user.id) === currentUserId;
                  return (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-sm">
                            {user.name}
                            {isSelf && (
                              <span className="ml-2 text-xs text-muted-foreground">(vos)</span>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={user.role === "SUPER_ADMIN" ? "default" : "secondary"} className="text-xs">
                          {user.role === "SUPER_ADMIN" ? "Super Admin" : "Viewer"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {user.isActive ? (
                            <>
                              <UserCheck className="h-3.5 w-3.5 text-green-500" />
                              <span className="text-xs text-green-600 dark:text-green-400">Activo</span>
                            </>
                          ) : (
                            <>
                              <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">Inactivo</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {user.totpEnabled ? (
                            <>
                              <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                              <span className="text-xs text-green-600 dark:text-green-400">Activo</span>
                            </>
                          ) : (
                            <>
                              <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">No</span>
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(user.lastLoginAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 cursor-pointer">
                              <MoreHorizontal className="h-4 w-4" />
                              <span className="sr-only">Acciones</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={() => setEditUser(user)}
                            >
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={() => setEditUser(user)}
                            >
                              <KeyRound className="mr-2 h-3.5 w-3.5" />
                              Cambiar contraseña
                            </DropdownMenuItem>
                            {!isSelf && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="cursor-pointer text-destructive focus:text-destructive"
                                  onClick={() => setDeleteUser(user)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Eliminar
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />
      <EditUserDialog
        user={editUser}
        currentUserId={currentUserId}
        onClose={() => setEditUser(null)}
        onUpdated={handleUpdated}
      />
      <DeleteUserDialog
        user={deleteUser}
        onClose={() => setDeleteUser(null)}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
