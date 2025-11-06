import { NavLink, useLocation } from "react-router-dom";
import {
  Computer,
  BarChart3,
  FileStack,
  Clock,
  Settings,
  Users,
  Home,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";

const mainItems = [
  { title: "Dashboard", url: "/dashboard", icon: BarChart3 },
  { title: "Archivos", url: "/files", icon: FileStack },
  { title: "Trabajos", url: "/jobs", icon: Computer },
  { title: "Historial", url: "/history", icon: Clock },
];

const adminItems = [
  { title: "Usuarios", url: "/admin/users", icon: Users },
  { title: "Configuración", url: "/admin/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isCollapsed = state === "collapsed";
  const { user } = useAuth();

  const isActive = (path: string) => currentPath === path;
  const getNavCls = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "!bg-primary !text-primary-foreground font-bold shadow-lg hover:!bg-primary hover:!text-primary-foreground transition-colors duration-150 ease-in-out"
      : "hover:bg-accent/50 text-foreground hover:text-foreground/80 transition-colors duration-150 ease-in-out";

  return (
    <Sidebar className={isCollapsed ? "w-16" : "w-64"} collapsible="icon">
      <SidebarHeader className="border-b border-border p-4">
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
          <div className={`${isCollapsed ? 'p-2' : 'p-2'} bg-primary rounded-lg`}>
            <img src="/placeholder.png" alt="Atrox Gateway Logo" className={`${isCollapsed ? 'h-5 w-5' : 'h-6 w-6'} text-primary-foreground`} />
          </div>
          {!isCollapsed && (
            <div>
              <h2 className="font-bold text-lg text-gradient">Atrox Gateway</h2>
              <p className="text-xs text-muted-foreground">Leo Atrox Platform</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Aplicaciones</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => {
                const active = isActive(item.url);
                const navClass = `${getNavCls({ isActive: active })} relative flex items-center gap-3 px-3 py-2 rounded-md`;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} className={navClass}>
                        {/* Left active indicator */}
                        {active && !isCollapsed && (
                          <span className="absolute left-0 top-0 h-full w-1 bg-primary rounded-r-md" />
                        )}
                        <item.icon className={`${isCollapsed ? 'h-5 w-5' : 'h-5 w-5'}`} />
                        {!isCollapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {user?.role === 'admin' && (
          <SidebarGroup>
            <SidebarGroupLabel>Administración</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink to={item.url} className={({ isActive }) => getNavCls({ isActive })}>
                        <item.icon className={`${isCollapsed ? 'h-5 w-5' : 'h-5 w-5'}`} />
                        {!isCollapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
