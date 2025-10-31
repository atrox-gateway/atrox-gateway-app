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
  MoreHorizontal
} from "lucide-react";
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

const Dashboard = () => {
  const { user } = useAuth();
  
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
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-bold text-gradient">Dashboard de Control</h1>
          <p className="text-muted-foreground mt-2">
            Monitoreo en tiempo real de la supercomputadora LeoAtrox
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in-up delay-100">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Trabajos Totales</CardTitle>
              <Activity className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{mockStats.totalJobs}</div>
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
              <div className="text-2xl font-bold text-success">{mockStats.runningJobs}</div>
              <p className="text-xs text-muted-foreground">
                {mockStats.queuedJobs} en cola
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Usuarios Activos</CardTitle>
              <Users className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{mockStats.activeUsers}</div>
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
              <div className="text-2xl font-bold">{mockStats.completedToday}</div>
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
                  <span>{mockStats.cpuUsage}%</span>
                </div>
                <Progress value={mockStats.cpuUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Memoria RAM</span>
                  <span>{mockStats.memoryUsage}%</span>
                </div>
                <Progress value={mockStats.memoryUsage} className="h-2" />
              </div>
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>Almacenamiento</span>
                  <span>42%</span>
                </div>
                <Progress value={42} className="h-2" />
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
                  <div className="text-2xl font-bold text-success">24</div>
                  <div className="text-sm text-muted-foreground">Nodos Activos</div>
                </div>
                <div className="text-center p-4 bg-warning/10 rounded-lg">
                  <div className="text-2xl font-bold text-warning">3</div>
                  <div className="text-sm text-muted-foreground">En Mantenimiento</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold">8</div>
                  <div className="text-sm text-muted-foreground">Disponibles</div>
                </div>
                <div className="text-center p-4 bg-destructive/10 rounded-lg">
                  <div className="text-2xl font-bold text-destructive">1</div>
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