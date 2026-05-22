import { Link, NavLink, Outlet, useLocation } from "react-router-dom"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard, Settings, MessagesSquare, Plug, Activity, Bell,
  FileText, Users, Menu, X, ChevronRight, ListChecks, ScrollText, LogOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { useState } from "react"
import { useAuth } from "@/lib/auth"

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/topics", label: "Topics", icon: ListChecks },
  { to: "/actors", label: "Actors", icon: Users },
  { to: "/connectors", label: "Connectors", icon: Plug },
  { to: "/ingestion", label: "Ingestion Jobs", icon: Activity },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/commander", label: "Commander AI", icon: MessagesSquare },
  { to: "/audit", label: "Audit Logs", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
]

export default function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()
  const { user, tenant, logout, loading } = useAuth()

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>
  if (!user) return null

  const breadcrumb =
    navItems.find((item) =>
      item.exact
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to) && item.to !== "/"
    ) ?? navItems[0]

  const initials = (user?.name ?? user?.email ?? "?").slice(0, 2).toUpperCase()

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 shrink-0 border-r border-sidebar-border",
          sidebarOpen ? "w-64" : "w-16"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 px-4 border-b border-sidebar-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary shrink-0">
            <span className="text-primary-foreground font-bold text-sm">CF</span>
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">CivicFalcon</p>
              {tenant && <p className="text-xs text-sidebar-foreground/60 truncate">{tenant.name}</p>}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-0.5 p-3 overflow-y-auto">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Sidebar footer */}
        {sidebarOpen && (
          <>
            <Separator className="bg-sidebar-border" />
            <div className="p-4">
              <p className="text-xs text-sidebar-foreground/50">CivicFalcon v0.1</p>
              <p className="text-xs text-sidebar-foreground/40">Public sentiment intelligence</p>
            </div>
          </>
        )}
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Top bar */}
        <header className="flex h-16 items-center gap-4 border-b border-border bg-background px-6 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
            {location.pathname !== "/" && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground font-medium">{breadcrumb.label}</span>
              </>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <ThemeToggle />

            <div className="flex items-center gap-2">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="hidden sm:block">
                <p className="text-xs font-medium leading-tight">{user?.name ?? user?.email}</p>
                <p className="text-[10px] text-muted-foreground uppercase">{user?.role}</p>
              </div>
            </div>

            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" onClick={() => logout()} title="Log out">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
