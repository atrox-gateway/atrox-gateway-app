import { useState, useEffect } from 'react';
import parseApiResponse from '../lib/fetcher';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { UserPlus, Sun, Moon, ArrowLeft, Loader2, Check, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from 'next-themes';

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [justification, setJustification] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<null | boolean>(null);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!username || !email || !password || !confirmPassword) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Por favor completa todos los campos",
      });
      return;
    }

    if (!justification || justification.trim().length < 10) {
      toast({ variant: 'destructive', title: 'Justificación requerida', description: 'Por favor indica una justificación (mínimo 10 caracteres).' });
      return;
    }

    // Validar dominio de correo UDG
    const emailTrim = email.trim();
    const udgRegex = /^[^@\s]+@(?:alumnos|academicos)\.udg\.mx$/i;
    if (!udgRegex.test(emailTrim)) {
      toast({
        variant: "destructive",
        title: "Email inválido",
        description: "El correo debe ser @alumnos.udg.mx o @academicos.udg.mx",
      });
      return;
    }

    if (password !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Las contraseñas no coinciden",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "La contraseña debe tener al menos 6 caracteres",
      });
      return;
    }

    // final availability check before submit
    if (usernameAvailable === false) {
      toast({ variant: 'destructive', title: 'Usuario no disponible', description: 'El nombre de usuario ya está en uso o en espera.' });
      return;
    }

    setIsLoading(true);
    try {
      await register(username, email, password, justification.trim());
      toast({
        title: "Registro enviado",
        description: "Tu solicitud fue recibida y está pendiente de aprobación por un administrador.",
      });
      navigate('/login');
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error al registrarse",
        description: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Debounced username availability check
  useEffect(() => {
    setUsernameAvailable(null);
    if (!username || username.trim().length < 3) return; // skip short names

    const id = setTimeout(async () => {
      try {
        setUsernameChecking(true);
        const res = await fetch(`/api/v1/auth/check-username?username=${encodeURIComponent(username.trim())}`);
        if (!res.ok) {
          setUsernameAvailable(null);
          return;
        }
        const body = await parseApiResponse(res as any);
        setUsernameAvailable(Boolean(body.available));
      } catch (e) {
        setUsernameAvailable(null);
      } finally {
        setUsernameChecking(false);
      }
    }, 350);

    return () => clearTimeout(id);
  }, [username]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4">
      <div className="fixed top-4 right-6 z-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="h-8 w-8 p-0"
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Cambiar tema</span>
        </Button>
      </div>
      <div className="relative w-full max-w-md">
        <Button className="absolute left-3 top-3 z-20" variant="ghost" size="sm" asChild>
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <Card className="w-full max-w-md animate-fade-in-up">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-2">
            <img src="/placeholder.png" alt="Atrox" className="h-12 w-12 rounded" />
          </div>
          <div className="flex items-center gap-2">
            <UserPlus className="h-6 w-6 text-primary" />
            <CardTitle className="text-2xl font-bold">Crear Cuenta</CardTitle>
          </div>
          <CardDescription>
            Completa tus datos para registrarte en AtroxGetaway
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Usuario</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="username"
                  type="text"
                  placeholder="Elige un nombre de usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                />
                <div className="w-28 flex items-center justify-center">
                  {usernameChecking ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : usernameAvailable === true ? (
                    <div className="flex items-center gap-1 text-success">
                      <Check className="h-4 w-4" />
                      <span className="text-sm">Disponible</span>
                    </div>
                  ) : usernameAvailable === false ? (
                    <div className="flex items-center gap-1 text-destructive">
                      <X className="h-4 w-4" />
                      <span className="text-sm">No disponible</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">&nbsp;</span>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="justification">Justificación</Label>
              <Textarea
                id="justification"
                placeholder="¿Por qué necesitas acceso? Indica tu proyecto o motivo (mín. 10 caracteres)."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Contraseña</Label>
              <Input
                id="password"
                type="password"
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar Contraseña</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Repite tu contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Creando cuenta..." : "Registrarse"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              ¿Ya tienes cuenta?{' '}
              <Link to="/login" className="text-primary hover:underline font-medium">
                Inicia sesión aquí
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
      </div>
    </div>
  );
}
