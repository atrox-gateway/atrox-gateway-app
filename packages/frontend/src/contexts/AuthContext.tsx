import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

// --- INTERFACES ---
interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
}

interface AuthContextType {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, email: string, password: string, justification?: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean; // Estado de carga para evitar redirección en el refresh
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWhoamiWithRetry(retries = 5, baseDelay = 500): Promise<any> {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await fetch('/api/v1/user/whoami', { credentials: 'include' });
      if (!res.ok) {
        // Para errores de servidor 5xx intentamos de nuevo
        if (res.status >= 500 && res.status < 600) {
          throw new Error(`Server error ${res.status}`);
        }
        // Errores 4xx no son reintentos; devolveremos el error inmediatamente
        const bodyText = await res.text().catch(() => '');
        throw new Error(`Whoami failed ${res.status}: ${bodyText}`);
      }
      return await res.json();
    } catch (err: any) {
      attempt++;
      if (attempt > retries) {
        // Excedimos reintentos, volver a lanzar
        throw err;
      }
      // Backoff exponencial con jitter (pequeño random)
      const delay = Math.min(3000, baseDelay * Math.pow(2, attempt - 1));
      const jitter = Math.floor(Math.random() * 200);
      await sleep(delay + jitter);
    }
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Se inicia en true para bloquear la renderización

  // Lógica de verificación de sesión al cargar la página
  useEffect(() => {
    const checkSession = async () => {
      try {
        const response = await fetch('/api/v1/user/whoami', { credentials: 'include' });
        
        if (response.ok) {
          const userInfo = await response.json();

          const userObject: User = { 
            id: uuidv4(), 
            username: userInfo.username, 
            email: userInfo.email || `${userInfo.username}@alumnos.udg.mx`,
            role: userInfo.role
          };
          setUser(userObject);
        }
      } catch (error) {
        console.warn("Session check failed, proceeding without user:", error);
      } finally {
        setIsLoading(false); 
      }
    };
    
    checkSession();
  }, []);

  // now accepts an optional justification string provided by the user
  const register = async (username: string, email: string, password: string, justification?: string): Promise<boolean> => {
    const response = await fetch('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, justification })
    });

    if (!response.ok) {
      let data = { message: 'Registration failed.' };
      try { data = await response.json(); } catch (e) {}
      throw new Error(data.message || `Registration failed (${response.status})`);
    }

    // 202 Accepted -> pending approval
    const data = await response.json();
    return true;
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include' // Obligatorio para enviar/recibir cookies
    });

    if (!response.ok) {
      // Manejo de errores para respuestas 400/401/500
      let errorData = { message: 'Error de autenticación.' };
      try {
        errorData = await response.json();
      } catch (e) {
        // Manejar el caso de que el cuerpo esté vacío o no sea JSON
      }
      throw new Error(errorData.message || `Error desconocido (${response.status})`);
    }

    const userInfo = await fetchWhoamiWithRetry(5, 500);

    const userObject: User = { 
        id: uuidv4(),
        username: userInfo.username, 
        email: userInfo.email || `${username}@alumnos.udg.mx`,
        role: userInfo.role
    };
    
    setUser(userObject);
    return true;
  };

  // Función de logout (Usa la API del Portero)
  const logout = async () => {
      try {
          // Llama al backend para matar el proceso PUN y borrar las cookies HTTP-Only
      await fetch('/api/v1/auth/logout', {
              method: 'POST',
              credentials: 'include' 
          });
      } catch (error) {
          console.error("Error al notificar al servidor el logout, pero se procederá con la limpieza local:", error);
      }

      // Limpieza del estado local (obligatorio para React)
      setUser(null);
  };

  // --- COMPROBACIÓN CRÍTICA PARA EL RENDERIZADO ---
  if (isLoading) {
    // Bloquea la aplicación aquí y muestra un spinner
    return <div>Cargando sesión...</div>;
  }

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      register, 
      logout, 
      isAuthenticated: !!user, 
      isLoading
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// Hook para usar el contexto (sin cambios)
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}