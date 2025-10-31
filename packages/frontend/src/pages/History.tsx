import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Clock, 
  Search, 
  Filter,
  Download,
  RotateCcw,
  TrendingUp,
  Calendar,
  CheckCircle,
  XCircle,
  AlertTriangle
} from "lucide-react";
import { Layout } from "@/components/Layout";

// Mock historical data
const mockHistory = [
  {
    id: "job_001",
    name: "Análisis RNA-Seq Dataset",
    status: "completed",
    submitTime: "2024-01-15 14:30:00",
    startTime: "2024-01-15 14:32:15",
    endTime: "2024-01-15 16:15:30",
    duration: "1h 43m 15s",
    cpus: 8,
    memory: "16GB",
    user: "Dr. García",
    exitCode: 0,
    outputSize: "234 MB"
  },
  {
    id: "job_002", 
    name: "Simulación Molecular v2.1",
    status: "completed",
    submitTime: "2024-01-14 09:15:00",
    startTime: "2024-01-14 09:17:45",
    endTime: "2024-01-14 14:22:10",
    duration: "5h 4m 25s",
    cpus: 16,
    memory: "32GB",
    user: "Ana López",
    exitCode: 0,
    outputSize: "1.2 GB"
  },
  {
    id: "job_003",
    name: "ML Training Deep Learning",
    status: "failed",
    submitTime: "2024-01-13 16:00:00",
    startTime: "2024-01-13 16:02:30",
    endTime: "2024-01-13 17:45:15",
    duration: "1h 42m 45s",
    cpus: 12,
    memory: "24GB",
    user: "Carlos Ruiz",
    exitCode: 1,
    errorMsg: "Out of memory error"
  },
  {
    id: "job_004",
    name: "Procesamiento Imágenes Batch",
    status: "completed",
    submitTime: "2024-01-12 11:30:00", 
    startTime: "2024-01-12 11:31:20",
    endTime: "2024-01-12 13:15:45",
    duration: "1h 44m 25s",
    cpus: 6,
    memory: "12GB",
    user: "María Silva",
    exitCode: 0,
    outputSize: "567 MB"
  }
];

const History = () => {
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState("week");

  const getStatusBadge = (status: string, exitCode?: number) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completado
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">
            <XCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Cancelado
          </Badge>
        );
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  const getEfficiencyMetrics = () => {
    const completed = mockHistory.filter(job => job.status === "completed").length;
    const failed = mockHistory.filter(job => job.status === "failed").length;
    const total = mockHistory.length;
    const successRate = Math.round((completed / total) * 100);
    
    return { completed, failed, total, successRate };
  };

  const metrics = getEfficiencyMetrics();

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="animate-fade-in-up">
          <h1 className="text-3xl font-bold text-gradient">Historial de Trabajos</h1>
          <p className="text-muted-foreground mt-2">
            Seguimiento completo de trabajos ejecutados y análisis de rendimiento
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 animate-fade-in-up delay-100">
          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Ejecutados</CardTitle>
              <Clock className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.total}</div>
              <p className="text-xs text-muted-foreground">
                Últimos 30 días
              </p>
            </CardContent>
          </Card>

          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completados</CardTitle>
              <CheckCircle className="h-4 w-4 text-success" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-success">{metrics.completed}</div>
              <p className="text-xs text-muted-foreground">
                Tasa de éxito: {metrics.successRate}%
              </p>
            </CardContent>
          </Card>

          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Con Errores</CardTitle>
              <XCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{metrics.failed}</div>
              <p className="text-xs text-muted-foreground">
                Requieren análisis
              </p>
            </CardContent>
          </Card>

          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Tiempo Promedio</CardTitle>
              <TrendingUp className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">2h 35m</div>
              <p className="text-xs text-muted-foreground">
                -15% vs mes anterior
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="card-professional animate-fade-in-up delay-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtros de Búsqueda
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar en historial..." 
                  className="pl-10"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="completed">Completados</SelectItem>
                  <SelectItem value="failed">Con Errores</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                </SelectContent>
              </Select>

              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-full md:w-48">
                  <SelectValue placeholder="Período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Hoy</SelectItem>
                  <SelectItem value="week">Esta Semana</SelectItem>
                  <SelectItem value="month">Este Mes</SelectItem>
                  <SelectItem value="quarter">3 Meses</SelectItem>
                  <SelectItem value="all">Todo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* History List */}
        <div className="space-y-4 animate-fade-in-up delay-300">
          {mockHistory.map((job) => (
            <Card key={job.id} className="card-professional">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      {job.name}
                      {getStatusBadge(job.status, job.exitCode)}
                    </CardTitle>
                    <CardDescription>
                      ID: {job.id} • Usuario: {job.user}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" title="Repetir trabajo">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="sm" title="Descargar resultados">
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Enviado:</span>
                    <div>{job.submitTime}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duración:</span>
                    <div className="font-medium">{job.duration}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">CPUs:</span>
                    <div>{job.cpus}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Memoria:</span>
                    <div>{job.memory}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Salida:</span>
                    <div>{job.outputSize || "N/A"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Código:</span>
                    <div className={job.exitCode === 0 ? "text-success" : "text-destructive"}>
                      {job.exitCode}
                    </div>
                  </div>
                </div>
                
                {job.status === "failed" && job.errorMsg && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">Error:</span>
                      {job.errorMsg}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Load more or pagination could go here */}
        <div className="text-center animate-fade-in-up delay-400">
          <Button variant="outline">
            Cargar Más Trabajos
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default History;