import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Play, 
  Pause, 
  Square, 
  Upload, 
  Settings, 
  Search,
  Filter,
  Plus,
  RefreshCw
} from "lucide-react";
import { Layout } from "@/components/Layout";

// Mock data
const mockJobs = [
  { 
    id: "job_001", 
    name: "Análisis RNA-Seq Dataset", 
    status: "running", 
    progress: 75, 
    submitTime: "2024-01-15 14:30",
    startTime: "2024-01-15 14:32",
    estimatedEnd: "2024-01-15 16:45",
    cpus: 8,
    memory: "16GB",
    user: "Dr. García"
  },
  { 
    id: "job_002", 
    name: "Simulación Molecular Dinámica", 
    status: "queued", 
    progress: 0, 
    submitTime: "2024-01-15 15:15",
    startTime: "-",
    estimatedEnd: "-",
    cpus: 16,
    memory: "32GB",
    user: "Ana López"
  },
  // More mock jobs...
];

const Jobs = () => {
  const [filter, setFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400"><Play className="w-3 h-3 mr-1" />Ejecutando</Badge>;
      case "queued":
        return <Badge className="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"><Pause className="w-3 h-3 mr-1" />En Cola</Badge>;
      case "completed":
        return <Badge className="bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400">Completado</Badge>;
      case "failed":
        return <Badge className="bg-red-500/10 text-red-600 dark:bg-red-500/20 dark:text-red-400">Error</Badge>;
      default:
        return <Badge variant="outline">Desconocido</Badge>;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Gestión de Trabajos</h1>
            <p className="text-muted-foreground mt-2">
              Administra y monitorea trabajos en LeoAtrox
            </p>
          </div>
          <Button className="btn-hero">
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Trabajo
          </Button>
        </div>

        <Tabs defaultValue="list" className="animate-fade-in-up delay-100">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="list">Lista de Trabajos</TabsTrigger>
            <TabsTrigger value="submit">Enviar Trabajo</TabsTrigger>
            <TabsTrigger value="templates">Plantillas</TabsTrigger>
          </TabsList>

          <TabsContent value="list" className="space-y-6">
            {/* Filters */}
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Filter className="h-5 w-5" />
                  Filtros y Búsqueda
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Buscar trabajos..." 
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
                      <SelectItem value="running">Ejecutando</SelectItem>
                      <SelectItem value="queued">En Cola</SelectItem>
                      <SelectItem value="completed">Completados</SelectItem>
                      <SelectItem value="failed">Con Errores</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Actualizar
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Jobs List */}
            <div className="space-y-4">
              {mockJobs.map((job) => (
                <Card key={job.id} className="card-professional">
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <div>
                        <CardTitle className="flex items-center gap-3">
                          {job.name}
                          {getStatusBadge(job.status)}
                        </CardTitle>
                        <CardDescription>
                          ID: {job.id} • Usuario: {job.user}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm">
                          <Settings className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="sm">
                          <Square className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Enviado:</span>
                        <div>{job.submitTime}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Inicio:</span>
                        <div>{job.startTime}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">CPUs:</span>
                        <div>{job.cpus}</div>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Memoria:</span>
                        <div>{job.memory}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="submit" className="space-y-6">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Enviar Nuevo Trabajo
                </CardTitle>
                <CardDescription>
                  Configure los parámetros y recursos para su trabajo computacional
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="jobName">Nombre del Trabajo</Label>
                      <Input 
                        id="jobName" 
                        placeholder="Ej: Análisis RNA-Seq Dataset"
                        className="mt-1"
                      />
                    </div>
                    
                    <div>
                      <Label htmlFor="script">Script Principal</Label>
                      <div className="mt-1 border-2 border-dashed border-border rounded-lg p-6 text-center">
                        <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                        <p className="text-sm text-muted-foreground">
                          Arrastra tu script aquí o haz clic para seleccionar
                        </p>
                        <Button variant="outline" className="mt-2">
                          Seleccionar Archivo
                        </Button>
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="description">Descripción</Label>
                      <Textarea 
                        id="description"
                        placeholder="Descripción opcional del trabajo..."
                        className="mt-1"
                        rows={3}
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="cpus">CPUs</Label>
                        <Select>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 CPU</SelectItem>
                            <SelectItem value="2">2 CPUs</SelectItem>
                            <SelectItem value="4">4 CPUs</SelectItem>
                            <SelectItem value="8">8 CPUs</SelectItem>
                            <SelectItem value="16">16 CPUs</SelectItem>
                            <SelectItem value="32">32 CPUs</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      
                      <div>
                        <Label htmlFor="memory">Memoria RAM</Label>
                        <Select>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="4">4 GB</SelectItem>
                            <SelectItem value="8">8 GB</SelectItem>
                            <SelectItem value="16">16 GB</SelectItem>
                            <SelectItem value="32">32 GB</SelectItem>
                            <SelectItem value="64">64 GB</SelectItem>
                            <SelectItem value="128">128 GB</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="walltime">Tiempo Máximo</Label>
                        <Input 
                          id="walltime"
                          placeholder="HH:MM:SS"
                          className="mt-1"
                        />
                      </div>
                      
                      <div>
                        <Label htmlFor="partition">Partición</Label>
                        <Select>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Seleccionar" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="general">general</SelectItem>
                            <SelectItem value="gpu">gpu</SelectItem>
                            <SelectItem value="highmem">highmem</SelectItem>
                            <SelectItem value="debug">debug</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="p-4 bg-muted/50 rounded-lg">
                      <h4 className="font-medium mb-2">Configuración Recomendada</h4>
                      <p className="text-sm text-muted-foreground">
                        Basado en el análisis de su script, recomendamos:
                        8 CPUs, 16GB RAM, partición general
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-4">
                  <Button variant="outline">
                    Guardar como Plantilla
                  </Button>
                  <Button className="btn-hero">
                    <Play className="w-4 h-4 mr-2" />
                    Enviar Trabajo
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="templates">
            <Card className="card-professional">
              <CardHeader>
                <CardTitle>Plantillas de Trabajos</CardTitle>
                <CardDescription>
                  Configuraciones predefinidas para trabajos frecuentes
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <p className="text-muted-foreground">
                    Las plantillas te permitirán reutilizar configuraciones comunes.
                  </p>
                  <Button className="mt-4">
                    Crear Primera Plantilla
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
};

export default Jobs;