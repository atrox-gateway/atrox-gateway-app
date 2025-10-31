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
  register: (username: string, email: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean; // Estado de carga para evitar redirección en el refresh
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// --- FUNCIÓN DE UTILIDAD ---
// Función para generar un UUID v4 compatible con la mayoría de navegadores (soluciona el error crypto.randomUUID)
const uuidv4 = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// --- EL PROVEEDOR ---
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true); // Se inicia en true para bloquear la renderización

  // Lógica de verificación de sesión al cargar la página
  useEffect(() => {
    const checkSession = async () => {
      try {
        // La llamada a /api/whoami verifica si el navegador tiene cookies válidas.
        const response = await fetch('/api/whoami', { credentials: 'include' });
        
        if (response.ok) {
          const userInfo = await response.json();

          // El backend confirmó la identidad, establecemos el usuario en el estado
          const userObject: User = { 
            id: uuidv4(), // Usar el UUID generado
            username: userInfo.username, 
            email: userInfo.email || `${userInfo.username}@alumnos.udg.mx`,
            role: userInfo.role
          };
          setUser(userObject);
        }
      } catch (error) {
        // Cualquier error (401, 500, red) significa que no hay sesión válida.
        console.warn("Session check failed, proceeding without user:", error);
      } finally {
        setIsLoading(false); // La verificación terminó, se puede renderizar la aplicación
      }
    };

    // --- CORRECCIÓN CRÍTICA ---
    // Limpiamos la antigua lógica de localStorage que era insegura.
    localStorage.removeItem('currentUser'); // Limpieza de cualquier estado de sesión inseguro.
    // --- FIN CORRECCIÓN ---
    
    checkSession();
  }, []);

  // Función de registro (Mantener la simulación de localStorage o reemplazar con API)
  const register = async (username: string, email: string, password: string): Promise<boolean> => {
    throw new Error('La función de registro debe implementarse en el servidor.');
  };

  // Función de login (Usa la API del Portero)
  const login = async (username: string, password: string): Promise<boolean> => {
    // 1. Llamada a la API del Portero (Node.js)
    const response = await fetch('/login', {
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

    // 2. Obtener información de usuario verificada desde el PUN
    const userInfoResponse = await fetch('/api/whoami', {
      credentials: 'include'
    });
    const userInfo = await userInfoResponse.json();

    // 3. Crear el objeto de usuario y actualizar el estado
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
          await fetch('/logout', {
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