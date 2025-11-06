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
  ,
  RefreshCw
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import JobOutputModal from '@/components/JobOutputModal';

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

type NormalizedStatus = {
  kind: 'completed'|'failed'|'cancelled'|'running'|'unknown';
  raw?: string;
  cancelReason?: string | null;
};

const normalizeJobStatus = (status: any): NormalizedStatus => {
  const raw = status == null ? '' : String(status);
  const s = raw.trim().toLowerCase();

  // try to extract cancel reason like 'cancelled by 1002' -> '1002'
  let cancelReason: string | null = null;
  const cancelMatch = raw.match(/cancel(?:led)?(?:\s+by\s+(.+))/i);
  if (cancelMatch && cancelMatch[1]) {
    cancelReason = cancelMatch[1].trim();
  }

  if (s.includes('complete')) return { kind: 'completed', raw, cancelReason };
  if (s.includes('fail')) return { kind: 'failed', raw, cancelReason };
  if (s.includes('cancel')) return { kind: 'cancelled', raw, cancelReason };
  if (s.includes('run')) return { kind: 'running', raw, cancelReason };

  return { kind: 'unknown', raw, cancelReason };
};

const History = () => {
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateRange, setDateRange] = useState("week");
  const [users, setUsers] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  // server-provided aggregated metrics (preferred)
  type Metrics = {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    successRate?: number;
    cancelledRate?: number;
    failedRate?: number;
    averageDurationSeconds?: number | null;
  };
  const [serverMetrics, setServerMetrics] = useState<Metrics | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedJobForOutput, setSelectedJobForOutput] = useState<JobItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageSize] = useState(5);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getStatusBadge = (status: string, exitCode?: number) => {
    const norm = normalizeJobStatus(status);
    switch (norm.kind) {
      case 'completed':
        return (
          <Badge className="bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400">
            <CheckCircle className="w-3 h-3 mr-1" />
            Completado
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">
            <XCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge className="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Cancelado
          </Badge>
        );
      case 'running':
        return (
          <Badge className="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
            <Clock className="w-3 h-3 mr-1" />
            Ejecutando
          </Badge>
        );
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  // Compute summary metrics from fetched jobs
  const getEfficiencyMetrics = () => {
    const total = jobs.length || 0;
    const completed = jobs.filter(job => normalizeJobStatus(job.status).kind === 'completed').length;
    const failed = jobs.filter(job => normalizeJobStatus(job.status).kind === 'failed').length;
    const cancelled = jobs.filter(job => normalizeJobStatus(job.status).kind === 'cancelled').length;
    const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const cancelledRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const failedRate = total > 0 ? Math.round((failed / total) * 100) : 0;
    return { completed, failed, cancelled, total, successRate, cancelledRate, failedRate };
  };

  // metrics: prefer server-provided aggregated metrics when available,
  // otherwise fall back to computing metrics from the currently-loaded jobs.
  const metrics = useMemo(() => {
    if (serverMetrics) {
      return {
        completed: serverMetrics.completed,
        failed: serverMetrics.failed,
        cancelled: serverMetrics.cancelled,
        total: serverMetrics.total,
        successRate: serverMetrics.successRate ?? (serverMetrics.total ? Math.round((serverMetrics.completed / serverMetrics.total) * 100) : 0),
        cancelledRate: serverMetrics.cancelledRate ?? (serverMetrics.total ? Math.round((serverMetrics.cancelled / serverMetrics.total) * 100) : 0),
        failedRate: serverMetrics.failedRate ?? (serverMetrics.total ? Math.round((serverMetrics.failed / serverMetrics.total) * 100) : 0),
      };
    }
    return getEfficiencyMetrics();
    // include serverMetrics and jobs so memo updates when either changes
  }, [serverMetrics, jobs]);

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

  // Robust helpers to extract date/user/output fields from varied backend shapes
  const parseDateValue = (s?: string | null) => {
    if (!s) return 0;
    const ts = Date.parse(s.toString());
    return isNaN(ts) ? 0 : ts;
  };

  const getJobUser = (job: any) => {
    return (
      job?.user ??
      job?.username ??
      job?.owner ??
      job?.submit_user ??
      job?.submitter ??
      job?.user_name ??
      job?.owner_name ??
      'No provisto'
    );
  };

  const getJobOutput = (job: any) => {
    return (
      job?.outputSize ??
      job?.output_size ??
      job?.output ??
      job?.results ??
      job?.output_size_bytes ??
      job?.outputSizeBytes ??
      job?.output_size_bytes ??
      '-'
    );
  };

  // Average duration (in seconds) over completed jobs with a duration
  const averageDurationSeconds = useMemo(() => {
    // Prefer server-provided aggregated average if available
    if (serverMetrics && typeof serverMetrics.averageDurationSeconds === 'number' && serverMetrics.averageDurationSeconds > 0) {
      return Math.round(serverMetrics.averageDurationSeconds);
    }

    const completedJobs = jobs.filter(j => normalizeJobStatus(j.status).kind === 'completed');
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

  // Helper to load one page (limit/offset). If append=true, append to existing jobs.
  const loadPage = async (off: number, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const days = dateRangeToDays(dateRange);
      const params = new URLSearchParams();
      params.set('days', String(days));
      params.set('limit', String(pageSize));
      params.set('offset', String(off));
      if (filter && filter !== 'all') params.set('status_filter', filter);
      if (selectedUser && selectedUser !== 'all') params.set('user', selectedUser);
      const url = `/api/v1/jobs/history?${params.toString()}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`${resp.status} ${resp.statusText} - ${text}`);
      }
      const data = await resp.json();
      const arr: JobItem[] = Array.isArray(data) ? data : (data.data || []);
      // Sort results server-side page may still need ordering
        // Sort by numeric job ID descending (newest by ID first)
        const sorted = (arr || []).slice().sort((a: any, b: any) => {
          const aId = parseInt(String(a?.id || '').replace(/\D/g, ''), 10) || 0;
          const bId = parseInt(String(b?.id || '').replace(/\D/g, ''), 10) || 0;
          return bId - aId;
        });
      if (append) {
        setJobs(prev => [...prev, ...sorted]);
      } else {
        setJobs(sorted);
      }
      // update offset & hasMore
      const received = sorted.length;
      setOffset(off + received);
      setHasMore(received === pageSize);
    } catch (err: any) {
      console.error('Failed to load history', err);
      setError(err.message || 'Unknown error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Helper to refresh jobs from the first page
  const fetchJobs = () => {
    // Reset state and load first page
    setJobs([]);
    setOffset(0);
    setHasMore(true);
    // refresh aggregated metrics as well (server-side)
    setServerMetrics(null);
    void loadMetrics();
    void loadPage(0, false);
  };

  // Load aggregated metrics from the backend (if supported).
  // This endpoint is optional on the backend; if it's not present we simply keep serverMetrics=null
  // and fall back to client-side computed metrics.
  const loadMetrics = async () => {
    try {
      const days = dateRangeToDays(dateRange);
      const params = new URLSearchParams();
      params.set('days', String(days));
      if (filter && filter !== 'all') params.set('status_filter', filter);
      if (selectedUser && selectedUser !== 'all') params.set('user', selectedUser);

      // Primary attempt: /api/v1/jobs/metrics
      const url = `/api/v1/jobs/metrics?${params.toString()}`;
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) {
        // backend might not expose a metrics endpoint; fallback to fetching the full history
        // and compute aggregates client-side (safer than showing only the current page)
        try {
          const histUrl = `/api/v1/jobs/history?${params.toString()}`;
          const r2 = await fetch(histUrl, { credentials: 'include' });
          if (!r2.ok) {
            setServerMetrics(null);
            return;
          }
          const d2 = await r2.json();
          const arr: any[] = Array.isArray(d2) ? d2 : (d2.data || []);
          // compute metrics from full array
          const total = arr.length;
          const completed = arr.filter(j => normalizeJobStatus(j?.status).kind === 'completed').length;
          const failed = arr.filter(j => normalizeJobStatus(j?.status).kind === 'failed').length;
          const cancelled = arr.filter(j => normalizeJobStatus(j?.status).kind === 'cancelled').length;
          // average duration seconds over completed jobs
          const durations = arr
            .filter(j => normalizeJobStatus(j?.status).kind === 'completed')
            .map(j => parseDurationToSeconds(j?.duration || j?.submit_time || j?.end_time))
            .filter(n => n > 0);
          const avg = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
          const mapped2: Metrics = {
            total,
            completed,
            failed,
            cancelled,
            successRate: total ? Math.round((completed / total) * 100) : 0,
            cancelledRate: total ? Math.round((cancelled / total) * 100) : 0,
            failedRate: total ? Math.round((failed / total) * 100) : 0,
            averageDurationSeconds: avg,
          };
          setServerMetrics(mapped2);
          return;
        } catch (e) {
          setServerMetrics(null);
          return;
        }
      }
      const data = await resp.json();
      // Map common field names into our Metrics shape
      const mapped: Metrics = {
        total: Number(data.total ?? data.count ?? data.total_jobs ?? 0),
        completed: Number(data.completed ?? data.success ?? data.completed_jobs ?? 0),
        failed: Number(data.failed ?? data.error_count ?? data.failed_jobs ?? 0),
        cancelled: Number(data.cancelled ?? data.cancelled_jobs ?? 0),
        successRate: data.successRate ?? data.success_rate ?? undefined,
        cancelledRate: data.cancelledRate ?? data.cancelled_rate ?? undefined,
        failedRate: data.failedRate ?? data.failed_rate ?? undefined,
        averageDurationSeconds: data.average_duration_seconds ?? data.avg_duration_seconds ?? data.average_duration ?? null,
      };
      setServerMetrics(mapped);
    } catch (err) {
      // ignore - keep fallback behavior
      console.debug('loadMetrics failed', err);
      setServerMetrics(null);
    }
  };

  // Reset + load first page when filters change
  useEffect(() => {
    setJobs([]);
    setOffset(0);
    setHasMore(true);
    // refresh aggregated metrics when filters change
    setServerMetrics(null);
    void loadMetrics();
    loadPage(0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, dateRange, selectedUser]);

  // Fetch users list for admin to populate combobox
  const auth = useAuth();
  useEffect(() => {
    let mounted = true;
    async function fetchUsers() {
      try {
        if (!auth || !auth.user || auth.user.role !== 'admin') return;
        const days = dateRangeToDays(dateRange);
        const resp = await fetch(`/api/v1/jobs/users?days=${days}`, { credentials: 'include' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (mounted && Array.isArray(data)) {
          setUsers(data);
        }
      } catch (e) {
        // ignore
      }
    }
    fetchUsers();
    return () => { mounted = false; };
  }, [auth, dateRange]);

  // Apply client-side filters: status and free-text search, then sort newest->oldest
  const displayedJobs = useMemo(() => {
    const q = (searchTerm || '').toString().trim().toLowerCase();
    const filtered = jobs.filter((job) => {
      // Status filter
      if (filter && filter !== 'all') {
        const status = (job.status || '').toString().toLowerCase();
        if (!status.includes(filter)) return false;
      }

      // Search term: match id, name, user and output
      if (q.length > 0) {
        const hay = [job.id, job.name, getJobUser(job), job.duration, job.memory, getJobOutput(job)]
          .map((s: any) => (s || '').toString().toLowerCase())
          .join(' ');
        if (!hay.includes(q)) return false;
      }

      return true;
    });

    // Ensure ordering newest -> oldest by execution timestamp (prefer start_time, then submit_time, then end_time)
      // Ensure ordering by numeric job ID descending (highest ID first)
      const sorted = filtered.slice().sort((a: any, b: any) => {
        const aId = parseInt(String(a?.id || '').replace(/\D/g, ''), 10) || 0;
        const bId = parseInt(String(b?.id || '').replace(/\D/g, ''), 10) || 0;
        return bId - aId;
      });
    return sorted;
  }, [jobs, filter, searchTerm]);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="animate-fade-in-up flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Historial de Trabajos</h1>
            <p className="text-muted-foreground mt-2">
              Seguimiento completo de trabajos ejecutados y análisis de rendimiento
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={fetchJobs} disabled={loading}>
              <RefreshCw className="h-4 w-4 mr-2" />
              {loading ? "Actualizando..." : "Actualizar"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6 animate-fade-in-up delay-100">
          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Ejecutados</CardTitle>
              <Clock className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{metrics.total}</div>
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
              <CardTitle className="text-sm font-medium">Cancelados</CardTitle>
              <CheckCircle className="h-4 w-4 text-warning" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-warning">{metrics.cancelled}</div>
              <p className="text-xs text-muted-foreground">Tasa de Cancelados: {metrics.cancelledRate}%</p>
            </CardContent>
          </Card>

          <Card className="card-professional">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Con Errores</CardTitle>
              <XCircle className="h-4 w-4 text-destructive" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{metrics.failed}</div>
              <p className="text-xs text-muted-foreground">Tasa de Errores: {metrics.failedRate}%</p>
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
                Basado en {metrics.completed} trabajos completados
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
              {/* Admin-only: filter by user */}
              {auth && auth.user && auth.user.role === 'admin' && (
                <Select value={selectedUser ?? 'all'} onValueChange={(v) => setSelectedUser(v === 'all' ? null : v)}>
                  <SelectTrigger className="w-full md:w-48">
                    <SelectValue placeholder="Usuario" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    {users.map(u => (
                      <SelectItem key={u} value={u}>{u}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
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
                      ID: {job.id} • Usuario: {getJobUser(job)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setSelectedJobForOutput(job); setModalOpen(true); }} title="Ver salida">
                      Salida
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
                    <div>{getJobOutput(job)}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Código:</span>
                    <div className={(job as any).exitCode === 0 || job.exit_code === 0 ? "text-success" : "text-destructive"}>
                      {(job as any).exitCode ?? job.exit_code ?? 'N/A'}
                    </div>
                  </div>
                </div>
                
                {normalizeJobStatus(job.status).kind === 'failed' && ((job as any).errorMsg || job.error_msg) && (
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

        {/* Load more button for pagination */}
        <div className="text-center animate-fade-in-up delay-400">
          <Button
            variant="outline"
            onClick={() => { if (!loadingMore && hasMore) loadPage(offset, true); }}
            disabled={loading || loadingMore || !hasMore}
            title={hasMore ? 'Cargar más trabajos' : 'No hay más trabajos'}
          >
            {loadingMore ? 'Cargando...' : (hasMore ? 'Cargar Más Trabajos' : 'No hay más')}
          </Button>
        </div>
      </div>
      {/* Modal para ver salida */}
      <JobOutputModal job={selectedJobForOutput} open={modalOpen} onOpenChange={(v) => { if (!v) setSelectedJobForOutput(null); setModalOpen(v); }} />
    </Layout>
  );
};

export default History;