import { useEffect, useMemo, useState } from "react";
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

// Types for job items returned by the backend
// Expected API: GET /api/history?days=30&status_filter=completed
// Response: Array of objects with at least the following fields:
// {
//   id: string,
//   name: string,
//   status: 'completed'|'failed'|'cancelled'|string,
//   submit_time?: string,    // ISO timestamp
//   duration?: string,
//   cpus?: number,
//   memory?: string,
//   user?: string,
//   exit_code?: number,
//   output_size?: string,
//   error_msg?: string
// }

type JobItem = {
  id: string;
  name: string;
  status: string;
  submit_time?: string;
  start_time?: string;
  end_time?: string;
  duration?: string;
  cpus?: number;
  memory?: string;
  user?: string;
  exit_code?: number;
  output_size?: string;
  error_msg?: string;
};

const History = () => {
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState("week");
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // Compute summary metrics from fetched jobs
  const getEfficiencyMetrics = () => {
    const total = jobs.length || 0;
    const completed = jobs.filter(job => job.status === "completed").length;
    const failed = jobs.filter(job => job.status === "failed").length;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { completed, failed, total, successRate };
  };

  const metrics = useMemo(() => getEfficiencyMetrics(), [jobs]);

  // Helpers to parse and format durations from different possible formats
  const parseDurationToSeconds = (d?: string | null) => {
    if (!d) return 0;
    const s = d.toString().trim();
    // Format like '1h 43m 15s'
    const hmRegex = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;
    const m = hmRegex.exec(s);
    if (m && (m[1] || m[2] || m[3])) {
      const hh = parseInt(m[1] || '0', 10);
      const mm = parseInt(m[2] || '0', 10);
      const ss = parseInt(m[3] || '0', 10);
      return hh * 3600 + mm * 60 + ss;
    }

    // Format like '1-02:03:04' (days-HH:MM:SS) or 'HH:MM:SS' or 'MM:SS'
    if (s.includes('-')) {
      const [daysPart, timePart] = s.split('-');
      const days = parseInt(daysPart || '0', 10) || 0;
      const parts = timePart.split(':').map(p => parseInt(p || '0', 10));
      while (parts.length < 3) parts.unshift(0);
      const [hh, mm, ss] = parts;
      return days * 86400 + hh * 3600 + mm * 60 + ss;
    }

    const cols = s.split(':').map(p => parseInt(p || '0', 10));
    if (cols.length === 3) {
      const [hh, mm, ss] = cols;
      return hh * 3600 + mm * 60 + ss;
    }
    if (cols.length === 2) {
      const [mm, ss] = cols;
      return mm * 60 + ss;
    }

    // Fallback: try parse seconds
    const maybe = parseInt(s.replace(/[^0-9]/g, '' ) || '0', 10);
    return isNaN(maybe) ? 0 : maybe;
  };

  const formatSeconds = (secs: number) => {
    if (!secs || secs <= 0) return 'N/A';
    const days = Math.floor(secs / 86400);
    secs %= 86400;
    const hours = Math.floor(secs / 3600);
    secs %= 3600;
    const minutes = Math.floor(secs / 60);
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (parts.length === 0) parts.push(`${secs}s`);
    return parts.join(' ');
  };

  // Average duration (in seconds) over completed jobs with a duration
  const averageDurationSeconds = useMemo(() => {
    const completedJobs = jobs.filter(j => (j.status || '').toString().toLowerCase() === 'completed');
    const durations = completedJobs.map(j => parseDurationToSeconds(j.duration || j.submit_time || j.end_time || j.end_time)).filter(n => n > 0);
    if (durations.length === 0) return 0;
    const sum = durations.reduce((a, b) => a + b, 0);
    return Math.round(sum / durations.length);
  }, [jobs]);

  const averageDurationFormatted = useMemo(() => formatSeconds(averageDurationSeconds), [averageDurationSeconds]);

  // Map UI dateRange to days parameter for the API
  const dateRangeToDays = (range: string) => {
    switch (range) {
      case 'today': return 1;
      case 'week': return 7;
      case 'month': return 30;
      case 'quarter': return 90;
      case 'all': return 3650;
      default: return 30;
    }
  };

  // Fetch history from backend API when filters change
  useEffect(() => {
    let mounted = true;
    async function fetchHistory() {
      setLoading(true);
      setError(null);
      try {
        const days = dateRangeToDays(dateRange);
        const params = new URLSearchParams();
        params.set('days', String(days));
        if (filter && filter !== 'all') params.set('status_filter', filter);
        // Note: the backend template exposes GET /api/history
        const url = `/api/v1/jobs/history?${params.toString()}`;
        const resp = await fetch(url, { credentials: 'include' });
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`${resp.status} ${resp.statusText} - ${text}`);
        }
        const data = await resp.json();
        // Ensure array shape
        const arr: JobItem[] = Array.isArray(data) ? data : (data.data || []);
        if (mounted) setJobs(arr);
      } catch (err: any) {
        console.error('Failed to load history', err);
        if (mounted) setError(err.message || 'Unknown error');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchHistory();
    return () => { mounted = false; };
  }, [filter, dateRange]);

  // Apply client-side filters: status and free-text search
  const displayedJobs = useMemo(() => {
    const q = (searchTerm || '').toString().trim().toLowerCase();
    return jobs.filter((job) => {
      // Status filter
      if (filter && filter !== 'all') {
        const status = (job.status || '').toString().toLowerCase();
        if (!status.includes(filter)) return false;
      }

      // Search term: match id, name, user
      if (q.length > 0) {
        const hay = [job.id, job.name, job.user, job.duration, job.memory]
          .map(s => (s || '').toString().toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [jobs, filter, searchTerm]);

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
              <div className="text-2xl font-bold">{averageDurationFormatted}</div>
              <p className="text-xs text-muted-foreground">
                Basado en {jobs.filter(j => (j.status || '').toString().toLowerCase() === 'completed').length} trabajos completados
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
          {displayedJobs.map((job) => (
            <Card key={job.id} className="card-professional">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-3">
                      {job.name}
                      {getStatusBadge(job.status, job.exit_code)}
                    </CardTitle>
                    <CardDescription>
                      ID: {job.id} • Usuario: {job.user || 'N/A'}
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
                    <div>{job.submit_time || job.start_time || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duración:</span>
                    <div className="font-medium">{job.duration}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">CPUs:</span>
                    <div>{job.cpus ?? 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Memoria:</span>
                    <div>{job.memory ?? 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Salida:</span>
                    <div>{(job as any).outputSize || job.output_size || "N/A"}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Código:</span>
                    <div className={(job as any).exitCode === 0 || job.exit_code === 0 ? "text-success" : "text-destructive"}>
                      {(job as any).exitCode ?? job.exit_code ?? 'N/A'}
                    </div>
                  </div>
                </div>
                
                {job.status === "failed" && (job as any).errorMsg && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="font-medium">Error:</span>
                      {(job as any).errorMsg || job.error_msg}
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