interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-16 items-center justify-between px-6">
        {/* Page title */}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>

        {/* Right side: Exchange rate widget placeholder */}
        <div className="flex items-center gap-4">
          <div className="rounded-md border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground">
            Tipo de cambio: --
          </div>
        </div>
      </div>
    </header>
  );
}
