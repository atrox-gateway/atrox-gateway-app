import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Folder, 
  File, 
  Upload, 
  Download, 
  Search,
  MoreHorizontal,
  ArrowLeft,
  Grid,
  List,
  Loader2
} from "lucide-react";
import { Layout } from "../components/Layout"; // Corregido: Uso de ruta relativa
import { useAuth } from "../contexts/AuthContext"; // Corregido: Uso de ruta relativa

interface FileItem {
  id: string; 
  name: string;
  type: 'file' | 'folder';
  size: string; 
  modified: string;
  extension?: string;
  owner: string; 
  group: string; 
  permissions: string;
}

interface FileResponse {
    success: boolean;
    path: string;
    files: FileItem[];
}

const getFileTypeColor = (extension?: string) => {
    switch (extension) {
      case 'py': return 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400';
      case 'sh': return 'bg-green-500/10 text-green-600 dark:bg-green-500/20 dark:text-green-400';
      case 'csv': return 'bg-orange-500/10 text-orange-600 dark:bg-orange-500/20 dark:text-orange-400';
      default: return 'bg-muted text-muted-foreground';
    }
};

const getFileIcon = (type: string, extension?: string) => {
    if (type === 'folder') {
      return <Folder className="h-5 w-5 text-primary" />;
    }
    return <File className="h-5 w-5 text-muted-foreground" />;
};

const Files = () => {
  const { isAuthenticated, user } = useAuth();
  
  const username = user?.username || 'unknown';
  const USER_HOME_PATH = `/hpc_home/${username}`;
  const isAdmin = user?.role === 'admin';

  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [currentPath, setCurrentPath] = useState(USER_HOME_PATH);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFiles = useCallback(async (path: string) => {
    if (!isAuthenticated || !user) return;
    
    let validatedPath = path;

    // Lógica de restricción de Frontend
    if (!isAdmin && !path.startsWith(USER_HOME_PATH)) {
        validatedPath = USER_HOME_PATH;
    }

    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files?path=${encodeURIComponent(validatedPath)}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Error al cargar archivos (Status: ${response.status})`);
      }

      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
         throw new Error("Respuesta inesperada: No es formato JSON.");
      }

      const responseData: FileResponse = await response.json(); 
      
      if (responseData.success) {
          setFiles(responseData.files);
          setCurrentPath(responseData.path); 
      } else {
          throw new Error(`Fallo del API: ${responseData.path || 'Error desconocido.'}`);
      }
      
    } catch (err: any) {
      setError(err.message || "Fallo la conexión con el servidor.");
      setFiles([]);
      // Si hay un error, forzamos la ruta visible a la última válida o al home
      if (validatedPath !== currentPath) setCurrentPath(validatedPath);
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, user, isAdmin, USER_HOME_PATH]);

  useEffect(() => {
    if (isAuthenticated && user) {
        fetchFiles(currentPath);
    }
  }, [fetchFiles, isAuthenticated, user]);
  
  const handleNavigation = (name: string, type: 'file' | 'folder') => {
    if (type === 'folder') {
        let newPath = currentPath.endsWith('/') ? `${currentPath}${name}` : `${currentPath}/${name}`;
        fetchFiles(newPath);
    }
  };
  
  const handleGoBack = () => {
    const segments = currentPath.split('/').filter(s => s.length > 0);
    segments.pop();
    let parentPath = `/${segments.join('/')}`;
    
    // Si la ruta resultante está vacía o es solo /hpc_home, forzar al home del usuario
    if (parentPath === '' || (parentPath === '/hpc_home' && !isAdmin)) {
         parentPath = USER_HOME_PATH;
    }

    // Restricción final: si no es admin y retrocede fuera de su home, forzar al home
    if (!isAdmin && !parentPath.startsWith(USER_HOME_PATH)) {
         parentPath = USER_HOME_PATH;
    }

    fetchFiles(parentPath);
  }

  const filteredFiles = files.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center animate-fade-in-up">
          <div>
            <h1 className="text-3xl font-bold text-gradient">Gestión de Archivos</h1>
            <p className="text-muted-foreground mt-2">
              Administra scripts, datasets y resultados
            </p>
          </div>
          <Button className="btn-hero">
            <Upload className="w-4 h-4 mr-2" />
            Subir Archivos
          </Button>
        </div>

        ---
        
        <Card className="card-professional animate-fade-in-up delay-100">
          <CardContent className="p-4">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex items-center gap-2 flex-1">
                <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleGoBack} 
                    disabled={!isAdmin && currentPath === USER_HOME_PATH}
                > 
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground">Ruta:</span>
                <span className="font-mono text-sm bg-muted px-2 py-1 rounded truncate max-w-xs md:max-w-md">
                  {currentPath}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar archivos..."
                        className="pl-8 w-[150px] md:w-[250px]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button variant="outline" size="icon" onClick={() => setViewMode('list')} disabled={viewMode === 'list'}>
                    <List className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => setViewMode('grid')} disabled={viewMode === 'grid'}>
                    <Grid className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        ---

        <Card className="card-professional animate-fade-in-up delay-200">
          <CardHeader>
            <CardTitle>Contenido del Directorio</CardTitle>
            <CardDescription>
              {filteredFiles.length} elementos en {currentPath}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && <div className="text-red-500 font-medium p-4 border border-red-500 bg-red-500/10 rounded-lg">🚨 Error: {error}</div>}
            
            {isLoading && (
                <div className="flex justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}
            
            {!isLoading && filteredFiles.length === 0 && !error && (
                <div className="text-center text-muted-foreground p-8">
                    {searchTerm ? `No hay resultados para "${searchTerm}".` : 'Directorio vacío.'}
                </div>
            )}

            {!isLoading && filteredFiles.length > 0 && viewMode === 'list' && (
              <div className="space-y-2">
                <div className="hidden md:grid grid-cols-[1fr_100px_100px_120px_40px] gap-4 text-sm font-semibold text-muted-foreground border-b pb-2 px-3">
                    <span className="col-span-1">Nombre</span>
                    <span>Propietario</span>
                    <span>Tamaño</span>
                    <span>Modificado</span>
                    <span className="sr-only">Acciones</span>
                </div>
                {filteredFiles.map((item) => (
                  <div 
                    key={item.id} 
                    className="grid grid-cols-[1fr_100px_100px_120px_40px] md:grid-cols-[1fr_100px_100px_120px_40px] gap-4 items-center p-3 border border-border rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
                    onClick={() => handleNavigation(item.name, item.type)}
                  >
                    <div className="flex items-center space-x-3 truncate">
                        {getFileIcon(item.type, item.extension)}
                        <span className="font-medium truncate">{item.name}</span>
                        {item.extension && item.type === 'file' && (
                            <Badge className={`text-xs ${getFileTypeColor(item.extension)} hidden sm:inline`}>
                                .{item.extension}
                            </Badge>
                        )}
                    </div>

                    <span className="text-sm text-muted-foreground hidden md:inline">{item.owner}</span>
                    <span className="text-sm text-muted-foreground hidden md:inline">{item.size}</span>
                    <span className="text-sm text-muted-foreground hidden md:inline">{item.modified}</span>

                    <Button variant="ghost" size="icon" className="ml-auto">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            
            {!isLoading && filteredFiles.length > 0 && viewMode === 'grid' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                    <p className="text-muted-foreground col-span-full">Modo Grid pendiente de implementación.</p>
                </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
};

export default Files;
