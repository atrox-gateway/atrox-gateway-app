# Atrox Gateway — Guía completa para empaquetado (Boxes) y despliegue

Última actualización: 2025-11-08

Este README resume el proyecto Atrox Gateway (aplicación + Vagrant bake/boxes) y proporciona una guía paso a paso, comandos, variables de entorno y soluciones a problemas frecuentes para crear boxes reproducibles y offline que puedas llevar a una exposición o demo con conectividad limitada.

Está pensado para desarrolladores/operadores que:
- Quieren entender la arquitectura del proyecto.
- Necesitan crear y probar imágenes/boxes de Vagrant que funcionen sin Internet.
- Quieren ejecutar smoke tests y preparar la VM para packaging.

## Índice

- [Resumen del proyecto](#resumen-del-proyecto)
- [Estructura del repositorio y archivos clave](#estructura-del-repositorio-y-archivos-clave)
- [Arquitectura y componentes](#arquitectura-y-componentes)
- [Requisitos y variables de entorno](#requisitos-y-variables-de-entorno)
- [Receta completa: crear una box reproducible (offline-ready)](#receta-completa-crear-una-box-reproducible-offline-ready)
  - Preparar la VM base
  - Copiar artefactos y secretos
  - Instalar paquetes y dependencias Node
  - Configurar servicios y systemd
  - Validación / smoke tests
  - Limpiar y optimizar antes de exportar
  - Empaquetar la box
  - Probar la box desde cero
- [Guía rápida: comandos útiles](#guía-rápida-comandos-útiles)
- [Troubleshooting (problemas frecuentes)](#troubleshooting-problemas-frecuentes)
- [Buenas prácticas y recomendaciones de seguridad](#buenas-prácticas-y-recomendaciones-de-seguridad)
- [Archivos importantes y dónde buscarlos](#archivos-importantes-y-dónde-buscarlos)
- [Siguientes pasos y mejoras sugeridas](#siguientes-pasos-y-mejoras-sugeridas)
- [Licencia y contacto](#licencia-y-contacto)

## Resumen del proyecto

Atrox Gateway es una pasarela web para exponer interfaces de usuario y administración sobre un clúster Slurm. Incluye:
- Backend Node.js con servicios:
  - Portero (`atrox-services`) — autentica, crea/gestiona PUNs por usuario, genera upstreams para Nginx.
  - Admin (`atrox-admin-services`) — endpoints administrativos para crear/gestionar usuarios (usa scripts sudo).
  - PUN per-user (`atrox-user-pun`) — microservicio por usuario que se comunica vía socket Unix.
- Frontend React + Vite servido por Nginx.
- Nginx como reverse-proxy con mapping dinámico de usuarios a PUNs.
- Redis para colas/pendientes.
- Integración con Slurm (squeue, sacct, sinfo, scontrol) y scripts que ejecutan sudo.

El repo incluye además un conjunto de Vagrantfiles y scripts para preparar/armar máquinas virtuales y «boxes» (atraer, provisionar y empaquetar).

## Estructura del repositorio y archivos clave

Ubicaciones relevantes (paths relativos al workspace):

- `atrox-gateway/` — código de la app (backend + frontend + docs)
  - `packages/backend/atrox-services/` — Portero (3000)
  - `packages/backend/atrox-admin-services/` — Admin (3001)
  - `packages/backend/atrox-user-pun/` — PUN per-user
  - `packages/frontend/` — código React + Vite
  - `etc/` — plantillas/configs de systemd y Nginx que `install.sh` despliega
  - `install.sh` — despliegue en host destino (usa `/opt/atrox-gateway` por convención)
  - `scripts/` — utilidades (`manage_user.sh`, `pun_killer.sh`, `update_nginx_config.sh`, etc.)
  - `docs/` — `api-inventory.md`, `copilot-contexto.md` (resumen de la arquitectura y APIs)

- `atrox-gateway-vagrant-setup/` — infra para crear y reproducir VMs/boxes
  - `Atrox_Gateway_Build/Vagrantfile` — Vagrantfile que provisiona VMs desde `ubuntu/focal64` y ejecuta `bootstrap-*.sh` (usa `ATROX_PASSWORD`/`VAGRANT_PASSWORD` env var durante provisioning)
  - `Atrox_Gateway_Boxes/Vagrantfile` — Vagrantfile orientado a consumir boxes ya empaquetadas (synced_folder disabled, provisiones adicionales)
  - `Atrox_Gateway_Boxes/cleanup.sh` — script que limpia configs temporales, genera claves y propaga pubkey (usa ATROX_PASSWORD/ATROX_PASSWORD env var durante provisioning)
  - `Atrox_Gateway_Build/bootstrap-*.sh` — scripts para instalar paquetes básicos, crear user `atroxgateway`, copiar `munge.key`, configurar Nginx/Slurm y clonar repo

## Arquitectura y componentes

Resumen de responsabilidades:

- Nginx: sirve frontend estático y enruta `/api/v1/user/*` a PUNs (map dinámico), `/api/v1/admin/*` al admin service, `/api/v1/auth/*` y otros al portero.
- Portero (3000): autenticación (PAM), creación/gestión de PUNs, administración de upstreams Nginx, endpoints públicos y admin-lite.
- Admin (3001): endpoints para crear/gestionar usuarios (ejecuta `manage_user.sh` vía sudo).
- PUNs: servicios por usuario que exponen API `/api/v1/user/*` vía socket Unix.
- Scripts: `install.sh` se usa en provisioning para copiar units systemd, configurar usuarios, instalar deps y arrancar servicios.

Topología Vagrant (por defecto en los Vagrantfiles):
- `node-app` (gateway) — Nginx + Node services + Redis
- `node-login` — nodo de login / control (PAM, Slurm controller)
- `node-storage` — NFS server (exporta `/home` para simular `/hpc-home`)
- `node-01`, `node-02` — nodos de cómputo Slurm

## Requisitos y variables de entorno

Variables críticas usadas por los provisioning scripts:

- ATROX_PASSWORD / VAGRANT_PASSWORD (requerido) — contraseña temporal que se exporta en el host antes de `vagrant up` para permitir crear el usuario `atroxgateway` y propagar claves durante provisioning. No deje esto en el repo.
  - Ejemplo (host):

```bash
export ATROX_PASSWORD='MiPassTemporalSegura123'
vagrant up --provider=virtualbox
```

- JWT_SECRET_KEY — secreto usado por los servicios para firmar JWT. Defínalo en el entorno del servicio o en files systemd `EnvironmentFile` antes de iniciar los servicios en producción.

Requisitos del host/VM:
- VirtualBox + Vagrant (para packaging y pruebas locales)
- Recursos recomendados para `node-app`: 4 CPUs, 4 GB RAM
- Red privada configurada por Vagrant (IPs: 192.168.56.10-14 por convención)
- En las VMs: `nginx`, `redis-server`, `munge`, `slurm` (cliente/servidor según VM) y `sshpass` (para provisioning automatizado si se usa ese flujo).

## Receta completa: crear una box reproducible (offline-ready)

Esta es la secuencia recomendada y probada para crear una box "final" que no dependa de Internet en el demo.

Resumen de pasos principales:
1. Preparar VM base (Ubuntu LTS) y desactivar mounts del host que puedan sobreescribir `/opt/atrox-gateway`.
2. Copiar artefactos y secretos necesarios (munge.key, builds frontend, paquetes .deb si los necesitas offline).
3. Instalar paquetes del sistema (Node, Redis, Nginx, Munge, Slurm deps) y configurar servicios.
4. Instalar dependencias Node y generar build del frontend (incluir node_modules o asegurarse que no haga fetch online en runtime).
5. Configurar systemd y servicios (units en `/etc/systemd/system/`, `EnvironmentFile` con variables sensibles si aplica).
6. Validación / smoke tests (curl, nginx -t, redis-cli ping, iniciar PUNs, pruebas de login, endpoints admin).
7. Limpiar caches / logs y empaquetar la box (`vagrant package`).
8. Probar la box en un nuevo directorio para asegurarse de que funciona offline.

A continuación cada paso en detalle.

### 1) Preparar la VM base

- Levanta una VM con Ubuntu LTS (por ejemplo `ubuntu/focal64`) y dale recursos adecuados.
- Asegúrate de deshabilitar `synced_folder` que sobreescriba `/opt/atrox-gateway` antes de empaquetar. En `Atrox_Gateway_Boxes/Vagrantfile` ya se aplica `config.vm.synced_folder ".", "/vagrant", disabled: true`.
- Actualiza paquetes del sistema (solo durante preparación, preferiblemente con Internet):

```bash
sudo apt update && sudo apt upgrade -y
```

### 2) Copiar artefactos y secretos

- Munge: necesitas la misma `munge.key` en todas las VMs de Slurm. Copia `shared/munge.key` a `/etc/munge/munge.key` y ajusta permisos (400, propietario `munge:munge`).
- Frontend build: genera `packages/frontend/dist` localmente y copia su contenido a `/var/www/atrox-ui` en la VM (o incluye el tarball en la box).
- Node modules: si no vas a permitir descarga en el demo, instala `node_modules` y opcionalmente empaquétalos dentro del repo o en `/opt/atrox-gateway/node_modules`.
- Otros paquetes .deb: si tu infraestructura necesita paquetes externos, descargarlos y copiarlos a la VM antes de empaquetar.

### 3) Instalar paquetes del sistema

Instala y verifica:
- `nodejs` (recomendado: Node LTS 18+) y npm
- `nginx`
- `redis-server`
- `munge` (y habilitar servicio)
- `slurm` (cliente y server segun topología)
- `sshpass` (si usas ssh-copy-id durante provisioning)

Ejemplo de comandos (solo para la fase de build con internet):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs nginx redis-server munge slurm-client sshpass build-essential
```

Nota: para la box final intenta minimizar instalaciones en runtime; instala todo durante provisioning.

### 4) Instalar dependencias Node y build del frontend

- Ejecuta en `/opt/atrox-gateway`:

```bash
cd /opt/atrox-gateway
npm ci
cd packages/frontend
npm ci && npm run build
```

- Asegúrate que el `build` genera la carpeta `dist` y que Nginx apunta a ella.
- Si quieres evitar descargas en la demo, copia `node_modules` resultantes al sistema o incluye un snapshot.

### 5) Configurar services / systemd

- Copia los `*.service` a `/etc/systemd/system/` y define `EnvironmentFile=/etc/atrox/atrox.env` si necesitas variables (no incluyas secretos sin protección).
- Habilita y arranca servicios:

```bash
sudo systemctl daemon-reload
sudo systemctl enable atrox.service atrox-admin.service
sudo systemctl start redis-server
sudo systemctl start atrox.service
sudo systemctl start atrox-admin.service
```

- Nginx: `sudo nginx -t && sudo systemctl restart nginx`

### 6) Validación / smoke tests

- `nginx -t`
- `curl -I http://localhost/` (esperar 200)
- `redis-cli ping` (espera `PONG`)
- `systemctl status atrox.service` y revisar logs con `journalctl -u atrox.service -n 200 --no-pager`
- Autenticación y API:
  - `curl -v -X POST -c cookies.txt -d 'username=...' http://localhost/api/v1/auth/login`
  - `curl -v -b cookies.txt http://localhost/api/v1/user/whoami`
- Comprobar PUNs: verificar sockets en `/var/run/atrox-puns` y `include /etc/nginx/puns-enabled/*.conf` existe.

### 7) Limpiar y optimizar antes de empaquetar

- Limpiar apt caches y logs:

```bash
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
sudo journalctl --vacuum-time=1s || true
sudo rm -rf /var/log/*.log || true
```

- Opcionalmente reducir timestamps y filas grandes para controlar tamaño.

### 8) Empaquetar la box

- Apaga la VM y ejecuta en el host:

```bash
vagrant halt node-app
vagrant package --base <VM_NAME> --output atrox-node-app.box
vagrant box add atrox/atrox-node-app --force atrox-node-app.box
```

- Para `vagrant package` usa la VM exacta que preparaste y verificaste.

### 9) Probar la box desde cero

- Crea un directorio nuevo con un `Vagrantfile` que use `atrox/atrox-node-app` y realiza `vagrant up` sin Internet (o con conectividad limitada) y valida pasos de smoke tests anteriores.

## Guía rápida: comandos útiles

- Levantar todas las VMs definidas en el build:

```bash
export ATROX_PASSWORD='MiPassTemporal'
cd atrox-gateway-vagrant-setup/Atrox_Gateway_Build
vagrant up --provider=virtualbox
```

- Levantar una box ya empaquetada (consumir boxes):

```bash
cd atrox-gateway-vagrant-setup/Atrox_Gateway_Boxes
export VAGRANT_PASSWORD='MiPassTemporal'
vagrant up node-app --provider=virtualbox
```

- Empaquetar una VM en el host (después de validar):

```bash
vagrant halt node-app
vagrant package --output atrox-node-app.box
vagrant box add atrox/atrox-node-app --force atrox-node-app.box
```

- Probar HTTP localmente dentro de la VM:

```bash
vagrant ssh node-app -- -c "curl -I http://127.0.0.1/"
```

## Troubleshooting (problemas frecuentes y soluciones)

1) ssh-copy-id / `ssh` -> `Permission denied (publickey,password)` durante provisioning
- Causa frecuente: la VM destino no está todavía lista (timing) o `PasswordAuthentication` está deshabilitado en `sshd_config`. También puede ocurrir si la contraseña usada por `sshpass` no coincide con la contraseña del usuario destino.
- Soluciones:
  - Asegúrate de exportar `ATROX_PASSWORD` o `VAGRANT_PASSWORD` en el host antes de `vagrant up`.
  - Preferible: propagar la clave pública en el `bootstrap-*.sh` del nodo destino (hacerlo desde destino en lugar de hacerlo desde `node-app`) para evitar problemas de orden de arranque.
  - Añadir reintentos/wait en `cleanup.sh` antes de `ssh-copy-id`:

```sh
for i in 1 2 3 4 5; do
  sudo -u atroxgateway sshpass -p "${ATROX_PASSWORD}" ssh-copy-id -o StrictHostKeyChecking=no atroxgateway@node-login && break
  sleep 5
done
```

2) Host mounts sobrescriben `/opt/atrox-gateway` (al usar `vagrant up`) y tu app deja de funcionar
- Solución: deshabilitar `synced_folder` en el Vagrantfile de la box final; ya se hizo en `Atrox_Gateway_Boxes/Vagrantfile`.

3) `npm install` falla en la VM durante provisioning por falta de Internet
- Soluciones:
  - Pre-instala `node_modules` en la VM antes de empaquetarla.
  - O incorpora `node_modules` en la box (más tamaño, menos fragilidad).

4) Nginx no carga upstream dinámicos (PUNs)
- Verifica que:
  - `/etc/nginx/user_map.conf` existe y contiene entries del tipo `username upstream_name;`.
  - `/etc/nginx/puns-enabled/*.conf` existen y definen upstreams direccionables.
  - `nginx -t` es exitoso y `sudo systemctl restart nginx` no arroja errores.

5) Admin API retorna 500 al intentar crear usuarios
- Usualmente porque `manage_user.sh` provoca prompts o espera input (p. ej. contraseña interactiva). Asegura que `manage_user.sh` puede ejecutarse no-interactivamente (con `ssh -o BatchMode=yes` o con parámetros de password) o que el sudoers correspondiente permite ejecución sin prompt (`NOPASSWD`).

## Buenas prácticas y recomendaciones de seguridad

- No cometas contraseñas en scripts. Usa variables de entorno durante provisioning y borra/rotar los secretos después.
- En producción usa un vault (HashiCorp Vault, SOPS, Ansible Vault) para secretos y no `EnvironmentFile` con valores a texto plano sin control.
- Habilita `secure` y `sameSite` en las cookies y reduce la expiración de tokens JWT.
- Revisa `sudoers` y limita comandos permitidos en lugar de `NOPASSWD: ALL` en entornos reales.

## Archivos importantes y dónde buscarlos

- Código app: `atrox-gateway/packages/...`
- Scripts de provisioning: `atrox-gateway-vagrant-setup/Atrox_Gateway_Build/bootstrap-*.sh`
- Boxes Vagrantfiles (para empaquetado): `atrox-gateway-vagrant-setup/Atrox_Gateway_Boxes/Vagrantfile`
- `cleanup.sh` que corre en `node-app` durante provisioning: `atrox-gateway-vagrant-setup/Atrox_Gateway_Boxes/cleanup.sh`
- Deploy script principal: `atrox-gateway/install.sh`
- Docs: `atrox-gateway/docs/api-inventory.md`, `atrox-gateway/docs/copilot-contexto.md`

## Siguientes pasos y mejoras sugeridas

- Automatizar el build y packaging con un script `make build-box` o CI pipeline (ej.: GitHub Actions que genere artifacts y suba las boxes a un registry privado).
- Reemplazar `sshpass` + `ssh-copy-id` con una estrategia más robusta: (a) propagar la clave pública desde la VM destino en su bootstrap, o (b) usar `vagrant` provisioners con `insert_key` y `vagrant ssh` para copiar claves.
- Añadir tests de humo automatizados que se ejecuten en la VM antes de empaquetar (curl endpoints, comprobar sockets PUN, comprobar `systemctl` status).
- Considerar una imagen base personalizada (Packer) si planeas hacer muchas iteraciones y necesitas reproducibilidad más estricta.

## Licencia

Revision según la licencia que trae el repositorio (ver `LICENSE` en `/atrox-gateway`).

## Contacto

Para cualquier duda sobre este README, pasos de empaquetado o problemas de provisioning, abrir un issue en el repo o contactar al mantenedor principal del proyecto.

---
