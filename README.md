# Atrox Gateway — Aplicación (Backend + Frontend)

Última actualización: 2025-11-08

Este README explica la estructura, cómo ejecutar y desplegar la aplicación Atrox Gateway (backend, frontend, PUNs), variables de entorno importantes, y problemas habituales durante el desarrollo o la provisión en VMs.

Índice
- Descripción
- Estructura del código
- Servicios y puertos
- Cómo ejecutar en desarrollo
- Despliegue en una VM (resumen / `install.sh`)
- Variables de entorno importantes
- Sistema de PUNs y Nginx
- Scripts útiles y mantenimiento
- Troubleshooting 

Descripción
-----------
Atrox Gateway es una pasarela para exponer interfaces web (usuarios/admin) y para gestionar PUNs (Per-User Node) que actúan como backends por usuario a través de sockets Unix. Provee integración con Slurm, Redis y Nginx como reverse-proxy.

Estructura del código
---------------------
- `packages/backend/` — código de los servicios backend
	- `atrox-services/` — Portero (auth, gestión PUNs, endpoints principales). Usa puerto 3000 por convención.
	- `atrox-admin-services/` — Endpoints administrativos (creación/gestión de usuarios). Puerto 3001 por convención.
	- `atrox-user-pun/` — Código del servicio PUN por usuario (escucha UDS).
	- `shared-libraries/` — utilidades compartidas (punManager, redisClient, logger, cryptoUtils).
- `packages/frontend/` — React + Vite + Tailwind. El artifact estático (`dist`) se sirve con Nginx.
- `scripts/` — herramientas y helpers: `manage_user.sh`, `pun_killer.sh`, `update_nginx_config.sh`, `manage_user.sh`.
- `etc/` — plantillas de configuración (systemd units, nginx confs).
- `install.sh` — script de despliegue que copia units, instala dependencias Node y configura servicios (usar durante provision).
- `docs/` — documentación y mapping de APIs.

Servicios y puertos
-------------------
- Portero (atrox-services): 127.0.0.1:3000
- Admin (atrox-admin-services): 127.0.0.1:3001
- Redis: puerto por defecto (6379) local
- Nginx: 80 (sirve frontend y enruta a los backends)
- PUNs: sockets Unix en `/var/run/atrox-puns/*` (no abiertos en TCP)

Cómo ejecutar en desarrollo
---------------------------
Se asume Node.js 18+ instalado.

1) Instalar dependencias en la raíz (monorepo) o en cada paquete según corresponda:

```bash
# desde la raíz del repo
cd atrox-gateway
npm install
# o, si se usa pnpm/yarn en sub-paquetes ejecutarlos en packages/*
```

2) Ejecutar servicios en desarrollo (cada uno en su terminal) o usar nodemon:

```bash
# Portero (dev)
node packages/backend/atrox-services/server.js
# Admin
node packages/backend/atrox-admin-services/server.js
# PUN (ejemplo de usuario):
node packages/backend/atrox-user-pun/user-server.js --socket /tmp/atrox-user-test.sock
```

3) Frontend (dev):

```bash
cd packages/frontend
npm install
npm run dev  # Vite dev server
```

Nota: en desarrollo Nginx no es obligatorio; pero la lógica de routing y de cookie `user_session` solo se prueba a través de Nginx. Para pruebas rápidas puedes usar un proxy local o configurar Nginx para servir la app y proxear a los puertos 3000/3001.

Despliegue en una VM (resumen / `install.sh`)
--------------------------------------------
El script `install.sh` en la raíz del repo está pensado para ejecutarse en `/opt/atrox-gateway` dentro de la VM `node-app` y realiza:
- Instalar Node.js (via nodesource), nginx, redis, configuración de usuarios y permisos.
- Copia de `etc/*.service` a `/etc/systemd/system` y configuración de Nginx.
- `npm install` y `npm run build` para el frontend.
- Habilita y arranca servicios (nginx, redis, atrox.service, atrox-admin.service).

Ejemplo (en la VM ya provisionada):

```bash
sudo mkdir -p /opt/atrox-gateway
# copiar repo a /opt/atrox-gateway (p. ej., git clone o rsync)
cd /opt/atrox-gateway
sudo ./install.sh
```

Variables de entorno importantes
--------------------------------
- `JWT_SECRET_KEY` — secreto para firmar JWT. No uses valores por defecto en producción.
- `REDIS_URL` — URL de Redis si no es local.
- `NODE_ENV` — 'production' o 'development' afecta flags como secure cookies.
- `ATROX_PASSWORD` / `VAGRANT_PASSWORD` — usado solo durante provisioning para crear la cuenta `atroxgateway` y propagar claves; NO almacenar en el repo.

Sistema de PUNs y Nginx
-----------------------
- Cada PUN es un proceso Express que escucha en un UDS (`/var/run/atrox-puns/<username>.socket`).
- El Portero administra upstreams generando archivos en `/etc/nginx/puns-enabled/` y actualizando `/etc/nginx/user_map.conf`.
- El `map $cookie_user_session $user_backend` en `nginx.conf` (o site conf) usa `user_map.conf` para redirigir solicitudes `/api/v1/user/*` al upstream correcto.

Scripts útiles y mantenimiento
-----------------------------
- `scripts/manage_user.sh` — wrappers para crear/editar/eliminar usuarios con Slurm; revisa que sea idempotente y no solicite entrada interactiva.
- `scripts/pun_killer.sh` — limpia procesos/phans si un PUN queda colgado.
- `scripts/update_nginx_config.sh` — actualiza includes y recarga nginx.

Troubleshooting (resumen)
-------------------------
- `nginx -t` para validar configuración.
- `sudo systemctl status atrox.service` y `journalctl -u atrox.service -n 200 --no-pager` para ver logs.
- Fallos en `manage_user.sh` que bloquean admin API: comprobar sudoers y que `manage_user.sh` pueda ejecutarse sin prompts (no-interactive). Añadir `-n` o parámetros que permitan modo batch o usar `chpasswd` para establecer contraseñas sin prompt.
- `ssh-copy-id` fallando: comprobar `PasswordAuthentication yes` en `sshd_config`, que las máquinas destino estén arriba y que la contraseña usada por `sshpass`/provisioner sea la correcta.

Notas para desarrolladores
--------------------------
- Revisa la consistencia de nombres: `atrox-admin-service` vs `atrox-admin-services` en scripts o `package.json`.
- Considera usar `EnvironmentFile` para inyectar secretos a systemd y un Vault para producción.
- Si trabajás con boxes offline: asegúrate de que `node_modules` y `packages/frontend/dist` estén presentes en la VM antes de empaquetarla.

Lecturas recomendadas
---------------------
- `docs/api-inventory.md` — mapping y rutas.
- `docs/copilot-contexto.md` — visión general del proyecto.

---
