import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Cpu, BarChart, Files, Clock, Users, Shield } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import heroImage from "@/assets/hero-leoatrox.jpg";
import iconJobs from "@/assets/icon-jobs.jpg";
import iconMonitoring from "@/assets/icon-monitoring.jpg";
import iconFiles from "@/assets/icon-files.jpg";

const Index = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-10"
          style={{ backgroundImage: `url(${heroImage})` }}
        />
        <div className="relative max-w-7xl mx-auto px-6 py-24">
          <div className="text-center">
            <div className="animate-fade-in-up">
              <h1 className="text-5xl md:text-7xl font-bold mb-6">
                <span className="text-gradient">AtroxGateway</span>
              </h1>
              <p className="text-xl md:text-2xl text-muted-foreground mb-4">
                Plataforma de Supercomputación LeoAtrox
              </p>
              <p className="text-lg text-muted-foreground mb-8 max-w-3xl mx-auto">
                Gestiona trabajos de alto rendimiento, monitorea recursos y optimiza 
                tu flujo de trabajo computacional con nuestra interfaz moderna e intuitiva.
              </p>
            </div>
            
            <div className="animate-fade-in-up delay-200 flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild className="btn-hero">
                <Link to="/login">
                  Iniciar Sesión
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="px-8 py-4">
                <Link to="/register">
                  Registrarse
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-24 bg-gradient-subtle">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16 animate-fade-in-up">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Capacidades de la Plataforma
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Todo lo que necesitas para gestionar trabajos de supercomputación 
              de manera eficiente y profesional.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card className="animate-scale-in delay-100">
              <CardHeader>
                <div className="w-16 h-16 mb-4 rounded-lg overflow-hidden">
                  <img src={iconJobs} alt="Gestión de Trabajos" className="w-full h-full object-cover" />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-primary" />
                  Gestión de Trabajos
                </CardTitle>
                <CardDescription>
                  Envía, monitorea y gestiona trabajos de Slurm con una interfaz intuitiva
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Configuración automática de recursos</li>
                  <li>• Cola de trabajos en tiempo real</li>
                  <li>• Cancelación y modificación de trabajos</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="animate-scale-in delay-200">
              <CardHeader>
                <div className="w-16 h-16 mb-4 rounded-lg overflow-hidden">
                  <img src={iconMonitoring} alt="Monitoreo" className="w-full h-full object-cover" />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <BarChart className="h-5 w-5 text-primary" />
                  Monitoreo Avanzado
                </CardTitle>
                <CardDescription>
                  Visualiza recursos del sistema y rendimiento en tiempo real
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Dashboard de recursos en vivo</li>
                  <li>• Métricas de utilización</li>
                  <li>• Alertas y notificaciones</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="animate-scale-in delay-300">
              <CardHeader>
                <div className="w-16 h-16 mb-4 rounded-lg overflow-hidden">
                  <img src={iconFiles} alt="Gestión de Archivos" className="w-full h-full object-cover" />
                </div>
                <CardTitle className="flex items-center gap-2">
                  <Files className="h-5 w-5 text-primary" />
                  Gestión de Archivos
                </CardTitle>
                <CardDescription>
                  Administra scripts, datasets y resultados de manera centralizada
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Explorador de archivos integrado</li>
                  <li>• Visualización de resultados</li>
                  <li>• Descarga y compartición segura</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="animate-scale-in delay-400">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Historial Completo
                </CardTitle>
                <CardDescription>
                  Seguimiento detallado de todos tus trabajos computacionales
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Historial de trabajos ejecutados</li>
                  <li>• Plantillas reutilizables</li>
                  <li>• Análisis de rendimiento</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="animate-scale-in delay-500">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Colaboración
                </CardTitle>
                <CardDescription>
                  Trabajo en equipo con permisos y roles personalizables
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Gestión de usuarios y equipos</li>
                  <li>• Permisos granulares</li>
                  <li>• Compartición de proyectos</li>
                </ul>
              </CardContent>
            </Card>

            <Card className="animate-scale-in delay-600">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  Seguridad
                </CardTitle>
                <CardDescription>
                  Acceso seguro y control de recursos institucional
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>• Autenticación robusta</li>
                  <li>• Auditoría de actividades</li>
                  <li>• Aislamiento de recursos</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="animate-fade-in-up">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">
              ¿Listo para optimizar tu flujo de trabajo?
            </h2>
            <p className="text-lg text-muted-foreground mb-8">
              Únete a los investigadores que ya utilizan AtroxGateway para 
              acelerar sus proyectos de computación de alto rendimiento.
            </p>
            <Button asChild className="btn-hero">
              <Link to="/login">
                Comenzar Ahora
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Index;
