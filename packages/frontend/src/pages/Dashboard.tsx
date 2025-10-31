import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  TrendingUp, 
  Users, 
  Server, 
  Clock, 
  CheckCircle, 
  XCircle, 
  Pause,
  Play,
  MoreHorizontal,
  Loader2
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import { AdminPanel } from "@/components/AdminPanel";

// Mock data - en producción vendría del backend
const mockStats = {
  totalJobs: 247,
  runningJobs: 12,
  queuedJobs: 8,
  completedToday: 15,
  cpuUsage: 78,
  memoryUsage: 65,
  activeUsers: 23
};

const mockRecentJobs = [
  { id: "job_001", name: "Análisis RNA-Seq", status: "running", progress: 75, user: "Dr. García", time: "2h 15m" },
  { id: "job_002", name: "Simulación Molecular", status: "queued", progress: 0, user: "Ana López", time: "En cola" },
  { id: "job_003", name: "ML Training Model", status: "completed", progress: 100, user: "Carlos Ruiz", time: "Completado" },
  { id: "job_004", name: "Procesamiento Imágenes", status: "failed", progress: 45, user: "María Silva", time: "Error" },
  { id: "job_005", name: "Análisis Estadístico", status: "running", progress: 30, user: "Dr. Martínez", time: "45m" },
];

interface DashboardStats {
  totalJobs: number;
  runningJobs: number;
  queuedJobs: number;
  completedToday: number;
  cpuUsage: number;
  memoryUsage: number;
  storageUsage?: number;
  activeUsers: number;
  nodesActive: number;
  nodesMaintenance: number;
  nodesAvailable: number;
  nodesErrors: number;
}

interface DashboardResponse {
  success: boolean;
  data?: DashboardStats;
  message?: string;
}

const Dashboard = () => {
  const { user } = useAuth();
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0); // Nuevo estado para forzar re-render de datos

  const fetchDashboardData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/v1/dashboard/stats', { credentials: 'same-origin' });
      if (!res.ok) {
        const text = await res.text();
        // Truncar y limpiar HTML si es necesario
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? clean.slice(0, 300) : `HTTP ${res.status}`);
      }

      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const text = await res.text();
        const clean = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        throw new Error(clean ? `Server returned non-JSON response: ${clean.slice(0,300)}` : 'Server returned non-JSON response');
      }

      let body: DashboardResponse;
      try {
        body = await res.json();
      } catch (e) {
        const text = await res.text();
        throw new Error(`Failed to parse JSON response from server: ${text.slice(0,300)}`);
      }
      if (!body.success) throw new Error(body.message || 'Error fetching dashboard data');
      if (!body.data) throw new Error('No data in dashboard response');
      setDashboardStats(body.data);
      setDataVersion(prev => prev + 1); // Incrementar la versión para forzar la animación
    } catch (err: any) {
      setError(err.message || 'Error connecting to server');
      setDashboardStats(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Only fetch after we know user context (helps with role-based responses)
    if (user) {
      fetchDashboardData(); // Initial fetch

      const intervalId = setInterval(() => {
        fetchDashboardData();
      }, 5000); // Fetch every 5 seconds

      return () => clearInterval(intervalId); // Cleanup on unmount or dependency change
    }
  }, [user, fetchDashboardData]);
  
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-primary text-primary-foreground"><Play className="w-3 h-3 mr-1" />Ejecutando</Badge>;
      case "queued":
        return <Badge variant="secondary"><Pause className="w-3 h-3 mr-1" />En Cola</Badge>;
      case "completed":
        return <Badge className="bg-success text-success-foreground"><CheckCircle className="w-3 h-3 mr-1" />Completado</Badge>;
      case "failed":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="animate-fade-in-up flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient flex items-center gap-2">
              <img src="/placeholder.png" alt="Dashboard Icon" className="h-8 w-8" />
              Dashboard de Control
            </h1>
            <p className="text-muted-foreground mt-2">
              Monitoreo en tiempo real de la supercomputadora LeoAtrox
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={fetchDashboardData} disabled={isLoading} variant="outline">
              {isLoading ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Actualizando...</span>
              ) : (
                'Actualizar'
              )}
            </Button>
          </div>
        </div>

        {/* Loading / Error */}
        {isLoading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="text-red-500 font-medium p-4 border border-red-500 bg-red-500/10 rounded-lg">🚨 Error: {error}</div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in-up delay-100">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trabajos Totales</CardTitle>
              <Activity className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div key={dataVersion} className="text-2xl font-bold animate-data-fade-in">{dashboardStats ? dashboardStats.totalJobs : mockStats.totalJobs}</div>
              <p className="text-xs text-muted-foreground">
                +12% desde el mes pasado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">En Ejecución</CardTitle>
              <TrendingUp className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
                  <div key={dataVersion + 1} className="text-2xl font-bold text-success animate-data-fade-in">{dashboardStats ? dashboardStats.runningJobs : mockStats.runningJobs}</div>
                  <p className="text-xs text-muted-foreground">
                    {dashboardStats ? dashboardStats.queuedJobs : mockStats.queuedJobs} en cola
                  </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Usuarios Activos</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
                  <div key={dataVersion + 2} className="text-2xl font-bold animate-data-fade-in">{dashboardStats ? dashboardStats.activeUsers : mockStats.activeUsers}</div>
              <p className="text-xs text-muted-foreground">
                En las últimas 24h
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completados Hoy</CardTitle>
              <CheckCircle className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
                  <div key={dataVersion + 3} className="text-2xl font-bold animate-data-fade-in">{dashboardStats ? dashboardStats.completedToday : mockStats.completedToday}</div>
              <p className="text-xs text-muted-foreground">
                Tasa de éxito: 94%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Resource Usage */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up delay-200">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-primary" />
                Uso de Recursos del Sistema
              </CardTitle>
              <CardDescription>
                Monitoreo en tiempo real de CPU, memoria y almacenamiento
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>CPU</span>
                  <span key={dataVersion + 4} className="animate-data-fade-in">{dashboardStats ? `${dashboardStats.cpuUsage}%` : `${mockStats.cpuUsage}%`}</span>
                </div>
                <Progress value={dashboardStats ? dashboardStats.cpuUsage : mockStats.cpuUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Memoria RAM</span>
                  <span key={dataVersion + 5} className="animate-data-fade-in">{dashboardStats ? `${dashboardStats.memoryUsage}%` : `${mockStats.memoryUsage}%`}</span>
                </div>
                <Progress value={dashboardStats ? dashboardStats.memoryUsage : mockStats.memoryUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Almacenamiento</span>
                  <span key={dataVersion + 6} className="animate-data-fade-in">{dashboardStats && typeof dashboardStats.storageUsage === 'number' ? `${dashboardStats.storageUsage}%` : '—'}</span>
                </div>
                <Progress value={dashboardStats && typeof dashboardStats.storageUsage === 'number' ? dashboardStats.storageUsage : 0} className="h-2" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Estado de Nodos</CardTitle>
              <CardDescription>
                Disponibilidad y estado de los nodos del cluster
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-success/10 rounded-lg">
                  <div key={dataVersion + 7} className="text-2xl font-bold text-success animate-data-fade-in">{dashboardStats ? dashboardStats.nodesActive : '—'}</div>
                  <div className="text-sm text-muted-foreground">Nodos Activos</div>
                </div>
                <div className="text-center p-4 bg-warning/10 rounded-lg">
                  <div key={dataVersion + 8} className="text-2xl font-bold text-warning animate-data-fade-in">{dashboardStats ? dashboardStats.nodesMaintenance : '—'}</div>
                  <div className="text-sm text-muted-foreground">En Mantenimiento</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div key={dataVersion + 9} className="text-2xl font-bold animate-data-fade-in">{dashboardStats ? dashboardStats.nodesAvailable : '—'}</div>
                  <div className="text-sm text-muted-foreground">Disponibles</div>
                </div>
                <div className="text-center p-4 bg-destructive/10 rounded-lg">
                  <div key={dataVersion + 10} className="text-2xl font-bold text-destructive animate-data-fade-in">{dashboardStats ? dashboardStats.nodesErrors : '—'}</div>
                  <div className="text-sm text-muted-foreground">Con Errores</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs */}
        <Card className="animate-fade-in-up delay-300">
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Trabajos Recientes
                </CardTitle>
                <CardDescription>
                  Últimos trabajos enviados al sistema
                </CardDescription>
              </div>
              <Button variant="outline" size="sm">
                Ver Todos
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockRecentJobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h4 className="font-medium">{job.name}</h4>
                      {getStatusBadge(job.status)}
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>Usuario: {job.user}</span>
                      <span>Tiempo: {job.time}</span>
                      <span>ID: {job.id}</span>
                    </div>
                    {job.status === "running" && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span>Progreso</span>
                          <span>{job.progress}%</span>
                        </div>
                        <Progress value={job.progress} className="h-1" />
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="sm">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Panel de Administración - Solo visible para admins */}
      {user?.role === 'admin' && (
        <div className="mb-8">
          <AdminPanel />
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;