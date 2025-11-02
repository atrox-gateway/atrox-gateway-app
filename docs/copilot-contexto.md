# Atrox Gateway — Contexto del Proyecto (Copilot)

Este documento resume la arquitectura, APIs, componentes y entorno de ejecución del proyecto Atrox Gateway, para acelerar el entendimiento y la contribución.

## Visión general

Atrox Gateway es una pasarela web para usuarios y administradores de un clúster Slurm. Consta de:
- Backend Node.js (Express) con dos servicios principales:
  - Portero (atrox-services) — autentica usuarios, gestiona PUNs por usuario, expone estadísticas y jobs.
  - Administración (atrox-admin-service) — operaciones de usuarios e integración con Slurm vía scripts.
- PUN (Per-User Node) — microservicio Express por usuario que corre sobre un socket Unix.
- Frontend en React + Vite + Tailwind, servido estáticamente por Nginx.
- Nginx como reverse proxy, con upstreams dinámicos para enrutar a cada PUN según la cookie de sesión.
- Redis para estado/colas simples (p.ej., altas de registro pendientes).
- Integración con Slurm (squeue, sacct, sinfo, scontrol) y scripts sudo para gestión de cuentas.

Entorno: corre en una VM (Vagrant) como "Gateway" y se integra con otras VMs/hosts: Login, Storage, Node1 y Node2 (nodos de cómputo bajo Slurm).

## Repositorio y paths clave

- Backend
  - `packages/backend/atrox-services/server.js` (Portero) — escucha en puerto 3000
  - `packages/backend/atrox-admin-services/server.js` (Admin) — escucha en puerto 3001
    - Nota: en `package.json` raíz el script apunta a `atrox-admin-service` (singular). Verificar/armonizar nombre de carpeta: "-service" vs "-services".
  - Shared libs: `packages/backend/shared-libraries/{punManager.js, redisClient.js}`
  - PUN: `packages/backend/atrox-user-pun/user-server.js` — escucha en socket Unix pasado como argv[2]
- Frontend
  - Código: `packages/frontend/src` (React + Vite + Tailwind)
  - Contexto de auth: `packages/frontend/src/contexts/AuthContext.tsx`
  - Build: `packages/frontend/dist` (servido por Nginx)
- Nginx
  - Site dev: `etc/nginx/sites-available/atrox-dev.conf` (habilitado en `sites-enabled/`)
  - Upstreams PUN generados: `/etc/nginx/puns-enabled/*.conf` y mapa `/etc/nginx/user_map.conf` (administrados por Portero)
- Scripts del sistema
  - `scripts/manage_user.sh` — gestión de usuarios/roles Slurm (requiere sudo)
  - `scripts/pun_killer.sh`, `scripts/update_nginx_config.sh`
- Systemd (ejemplo)
  - `etc/atrox.service`, `etc/atrox-admin.service`

## Servicios backend y responsabilidades

### Portero (atrox-services) — puerto 3000
- Monta routers en:
  - `/api/v1/auth/*` — registro, disponibilidad de usuario, login, logout
  - `/api/v1/dashboard/*` — estadísticas globales y por usuario
  - `/api/v1/jobs/*` — historial y utilidades de jobs
- Autenticación
  - Login con PAM (`authenticate-pam`) -> crea cookies:
    - `user_session`: username (no HTTP-only), usada por Nginx para mapear upstream del PUN
    - `access_token`: JWT HTTP-only con `{ sub: username, role: 'admin'|'user' }`
  - JWT firmado con `JWT_SECRET_KEY` (usar variable de entorno; valor por defecto inseguro para dev)
- Gestión de PUNs por usuario
  - Usa `PunManager` para crear/recuperar PUN por usuario; cada PUN es un proceso Express que escucha por UDS en `/var/run/atrox-puns/<user>.socket`.
  - Genera upstreams Nginx por usuario en `/etc/nginx/puns-enabled/` y actualiza el `map` de sesión en `/etc/nginx/user_map.conf`; recarga Nginx.
- Slurm y métricas
  - Comandos: `squeue`, `sacct`, `sinfo`, `scontrol` para obtener stats globales, historial y estado de nodos.
  - Endpoints admin-only retornan agregados detallados; usuarios no admin reciben vistas acotadas.
- Rutas destacadas
  - `POST /api/v1/auth/register` — crea solicitud de alta en Redis: `pending:<username>`
  - `GET  /api/v1/auth/check-username?username=` — disponibilidad
  - `POST /api/v1/auth/login` — PAM, crea PUN, genera cookies
  - `POST /api/v1/auth/logout` — valida JWT, detiene PUN, limpia Nginx y cookies
  - `GET  /api/v1/dashboard/stats` — admin: global + por nodo; user: proxy a PUN + resumen nodos
  - `GET  /api/v1/dashboard/nodes` — admin: detalles de nodos (scontrol + sinfo)
  - `GET  /api/v1/jobs/users` — admin: usuarios vistos por `sacct`
  - `GET  /api/v1/jobs/history` — admin: historial global/filtrado; user: proxy al PUN
  - Compat: `GET /api/history` -> redirige a `/api/v1/jobs/history`

### Administración (atrox-admin-service[s]) — puerto 3001
- Middleware `authenticateAdmin` basado en cookie `access_token` (JWT con `role: 'admin'`).
- Montado en `/api/v1/admin/*`:
  - `POST /users` — crear usuario (Slurm) via `manage_user.sh create`
  - `GET  /users` — listar usuarios (parsea salida para excluir system users)
  - `GET  /users/:username` — detalles
  - `PUT  /users/:username` — modificar atributo
  - `DELETE /users/:username` — borrar usuario
  - Flujo de altas pendientes (Redis):
    - `GET  /registrations` — lista solicitudes
    - `POST /registrations/:username/approve` — aprueba y crea usuario (usa password almacenada temporalmente)
    - `DELETE /registrations/:username` — deniega/elimina

### PUN por usuario (atrox-user-pun)
- Express escuchando en socket Unix (argv[2]); valida JWT y que `decoded.sub` == `os.userInfo().username`.
- Montado en `/api/v1/user/*`:
  - `GET  /whoami` — { username, role }
  - `GET  /files` — listado tipo `ls -l` simplificado bajo `/hpc-home/<user>` o ruta dada
  - `GET  /dashboard/stats` — stats por usuario (jobs + recursos simulados)
  - `GET  /history` — historial del usuario (vía `sacct`)
  - CRUD Archivos: `/files` (GET), `/file` (GET/POST/PUT/DELETE), `/upload` (POST múltiples), `/folder` (POST)
- Permisos del socket: GID 33 (www-data), chmod `660`.

## Frontend (React + Vite + Tailwind)
- Autenticación (`AuthContext.tsx`)
  - Login: `POST /api/v1/auth/login` con `credentials: 'include'`
  - Logout: `POST /api/v1/auth/logout`
  - Whoami: `GET /api/v1/user/whoami` (sólo si existen cookies `user_session`/`access_token` para evitar upstream vacío)
  - Registro: `POST /api/v1/auth/register` y `GET /api/v1/auth/check-username`
- Páginas principales: Dashboard, Files, History/Jobs, Login, Register, UserManagement.
- El SPA se sirve desde Nginx con fallback a `index.html` para rutas de cliente.

## Nginx (reverse proxy)
- Site: `etc/nginx/sites-available/atrox-dev.conf`
  - `/api/v1/auth/`, `/api/v1/dashboard/`, `/api/v1/jobs/` -> `user_service` (127.0.0.1:3000)
  - `/api/v1/admin/` -> `admin_service` (127.0.0.1:3001)
  - `/api/v1/user/` -> `http://$user_backend$request_uri` (map dinámico generado por Portero)
  - Frontend estático desde `/opt/atrox-gateway/packages/frontend/dist` con `try_files ... /index.html`
- El `map` de sesiones y `upstreams` de PUN se incluyen vía ficheros generados: `/etc/nginx/user_map.conf` y `/etc/nginx/puns-enabled/*.conf` (la `include` puede estar en `nginx.conf`).

## Autenticación y cookies
- `access_token` (JWT, HTTP-only) — autoridad para backend y PUN; contiene `sub` y `role` (expira ~1h)
- `user_session` (no HTTP-only) — username leído por Nginx para el mapeo `$user_backend`
- El frontend debe usar `credentials: 'include'` en fetch.

## Integración con Slurm
- Lecturas: `squeue`, `sacct`, `sinfo`, `scontrol`
- Gestión de cuentas: `scripts/manage_user.sh` con sudo
- VMs: Login, Storage, Node1, Node2 forman el clúster bajo Slurm; el Gateway consulta y/o actúa vía comandos y scripts.

## Topología de VMs (Vagrant)
- Gateway (esta app): Nginx + Node (3000/3001) + Redis + sockets PUN en `/var/run/atrox-puns`
- Login: autenticación PAM/usuarios del sistema
- Storage: exporta `/hpc-home` (p.ej., NFS)
- Node1/Node2: cómputo de Slurm

## Variables de entorno y rutas del sistema
- `JWT_SECRET_KEY` — secreto para firmar JWT (no usar el default en producción)
- Directorios usados por Portero:
  - PUN dir: `/var/run/atrox-puns`
  - Nginx: `/etc/nginx/puns-enabled`, `/etc/nginx/user_map.conf`
- GID Nginx (www-data): 33

## Puertos y endpoints rápidos
- 3000 (Portero): `/api/v1/auth/*`, `/api/v1/dashboard/*`, `/api/v1/jobs/*`
- 3001 (Admin): `/api/v1/admin/*`
- PUN por usuario: UDS (no TCP), expuesto por Nginx como `/api/v1/user/*`

## Requisitos del sistema
- Nginx con permisos para recarga (`nginx -t && nginx -s reload` vía sudo cuando aplique)
- Redis accesible por los servicios
- Slurm y herramientas de línea de comando instaladas en el Gateway (o accesibles)
- Sudoers para `manage_user.sh` y comandos relacionados

## Ejecución (resumen)
- Backend
  - Portero: `node packages/backend/atrox-services/server.js` (o script npm `start:portero`)
  - Admin: `node packages/backend/atrox-admin-services/server.js` (ajustar script raíz si es necesario)
- Frontend
  - Build Vite -> `packages/frontend/dist` (sirve Nginx)
- Nginx
  - Site `atrox-dev.conf` activo; includes para `puns-enabled/*.conf` y `user_map.conf` presentes en `nginx.conf`.

## Observaciones y recomendaciones
- Armonizar nombre de carpeta del admin: `atrox-admin-services/` vs `atrox-admin-service/` (scripts de `package.json`)
- Establecer `JWT_SECRET_KEY` en producción y considerar rotación/expiración configurable
- Revisar inclusión explícita en `nginx.conf` de:
  - `include /etc/nginx/puns-enabled/*.conf;`
  - `map $cookie_user_session $user_backend { ... }` o `include /etc/nginx/user_map.conf;`
- Endurecer cookies (`secure`, `sameSite`), ya parcialmente aplicado según `NODE_ENV`
- Evaluar limitar/quotas en endpoints de archivos y tamaños (actual límite ~200MB por payload base64)
- Añadir OpenAPI/Swagger para documentar servicios y pruebas de humo automáticas

## Mapa de APIs (cheat sheet)
- Auth
  - POST `/api/v1/auth/register`
  - GET  `/api/v1/auth/check-username?username=`
  - POST `/api/v1/auth/login`
  - POST `/api/v1/auth/logout`
- Admin
  - GET  `/api/v1/admin/users`
  - POST `/api/v1/admin/users`
  - GET  `/api/v1/admin/users/:username`
  - PUT  `/api/v1/admin/users/:username`
  - DELETE `/api/v1/admin/users/:username`
  - GET  `/api/v1/admin/registrations`
  - POST `/api/v1/admin/registrations/:username/approve`
  - DELETE `/api/v1/admin/registrations/:username`
- User (vía PUN)
  - GET  `/api/v1/user/whoami`
  - GET  `/api/v1/user/files`
  - GET  `/api/v1/user/dashboard/stats`
  - GET  `/api/v1/user/history`
  - Files CRUD: `GET/POST/PUT/DELETE /api/v1/user/file`, `POST /api/v1/user/upload`, `POST /api/v1/user/folder`
- Dashboard/Jobs (Portero)
  - GET `/api/v1/dashboard/stats`, GET `/api/v1/dashboard/nodes`
  - GET `/api/v1/jobs/users`, GET `/api/v1/jobs/history`

## Contactos/ayuda rápida para Copilot
- Autenticación: usa cookies; recuerda `credentials: 'include'` en fetch del frontend.
- PUN routing: depende de `user_session`; evita whoami cuando no haya cookies para no golpear upstream vacío.
- Slurm: los comandos pueden requerir sudo/permiso de lectura; maneja errores y tiempos de espera.
- Si agregas nuevas rutas, sigue el prefijo `/api/v1/{auth,admin,user,...}` y actualiza Nginx si aplica.
