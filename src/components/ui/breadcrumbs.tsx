import * as React from "react"
import Link from "next/link"
import { ChevronRight, Home } from "lucide-react"
import { cn } from "@/lib/utils"

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[]
  showHome?: boolean
}

function Breadcrumbs({
  items,
  showHome = true,
  className,
  ...props
}: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex items-center text-sm text-muted-foreground", className)}
      {...props}
    >
      <ol className="flex items-center gap-1.5">
        {showHome && (
          <>
            <li>
              <Link
                href="/"
                className="flex items-center hover:text-foreground transition-colors"
              >
                <Home className="h-4 w-4" />
              </Link>
            </li>
            {items.length > 0 && (
              <li>
                <ChevronRight className="h-4 w-4" />
              </li>
            )}
          </>
        )}
        {items.map((item, index) => (
          <React.Fragment key={index}>
            <li>
              {item.href ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors"
                >
                  {item.label}
                </Link>
              ) : (
                <span className="text-foreground font-medium">{item.label}</span>
              )}
            </li>
            {index < items.length - 1 && (
              <li>
                <ChevronRight className="h-4 w-4" />
              </li>
            )}
          </React.Fragment>
        ))}
      </ol>
    </nav>
  )
}

export { Breadcrumbs }
