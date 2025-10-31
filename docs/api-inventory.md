# API Inventory and Mapping

This document lists current API routes (as discovered in the codebase) and the target mapping to the new convention /api/v1/{auth,user,admin}.

## Summary
- Auth endpoints (was: `/login`, `/logout`) -> `/api/v1/auth/*`
- User PUN endpoints (was: `/api/*` in PUN service) -> `/api/v1/user/*`
- Admin endpoints (was: `/admin/*` in admin service) -> `/api/v1/admin/*`

---

## Backend: atrox-services (portero)
File: `packages/backend/atrox-services/server.js`

Current routes:
- POST /login
- POST /logout

Mapped routes:
- POST /api/v1/auth/login
- POST /api/v1/auth/logout

Notes: keep cookie-based auth, return same responses. Auth router mounted at `/api/v1/auth`.

---

## Backend: atrox-admin-services
File: `packages/backend/atrox-admin-services/server.js`

Current routes (examples):
- POST /admin/users
- GET  /admin/users
- GET  /admin/users/:username
- PUT  /admin/users/:username
- DELETE /admin/users/:username

Mapped routes:
- POST /api/v1/admin/users
- GET  /api/v1/admin/users
- GET  /api/v1/admin/users/:username
- PUT  /api/v1/admin/users/:username
- DELETE /api/v1/admin/users/:username

Notes: Admin middleware (authenticateAdmin) mounted at `/api/v1/admin`.

---

## Backend: atrox-user-pun (PUN per-user service)
File: `packages/backend/atrox-user-pun/user-server.js`

Current routes:
- GET /api/whoami
- GET /api/files

Mapped routes:
- GET /api/v1/user/whoami
- GET /api/v1/user/files

Notes: These services are mounted per-user (socket) and nginx uses `map $cookie_user_session $user_backend` to pick the upstream; mapping keeps that behavior but under `/api/v1/user`.

---

## Frontend changes
Files updated:
- `packages/frontend/src/contexts/AuthContext.tsx`
  - `/login` -> `/api/v1/auth/login`
  - `/logout` -> `/api/v1/auth/logout`
  - `/api/whoami` -> `/api/v1/user/whoami`

- `packages/frontend/src/pages/UserManagement.tsx`
  - `/admin/users` -> `/api/v1/admin/users`
  - `/admin/users/:username` -> `/api/v1/admin/users/:username`

Notes: SPA routes remain `/admin/users` for navigation — only API calls changed. Frontend must keep `credentials: 'include'` for cookie auth.

---

## Nginx
File: `etc/nginx/sites-available/atrox-dev.conf`

Changes made:
- Removed direct proxying of `/admin/` to admin_service.
- Added proxy blocks for:
  - `/api/v1/auth/` -> `user_service` (port 3000)
  - `/api/v1/admin/` -> `admin_service` (port 3001)
  - `/api/v1/user/`  -> dynamic `$user_backend` upstream (PUNs)
- SPA `location /` still serves `index.html` as fallback, so client routes like `/admin/users` will be served by the SPA.

---

## Next Steps
- Run smoke tests: verify SPA loads at `/admin/users` (HTML), and APIs respond at their new paths.
- Update any external integrations that relied on old routes or provide redirects for a transition period.
- Add OpenAPI / Swagger docs for each service (recommended).

