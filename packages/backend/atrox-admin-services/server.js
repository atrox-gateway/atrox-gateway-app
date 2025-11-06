// /opt/atrox-gateway/packages/backend/atrox-admin-service/server.js

const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const sharedLibsPath = path.join(__dirname, '..', 'shared-libraries');
const { spawnWithTimeout } = require(path.join(sharedLibsPath, 'processUtils.js'));
const cryptoUtils = require(path.join(sharedLibsPath, 'cryptoUtils.js'));
const logger = require(path.join(sharedLibsPath, 'logger.js'));
const RedisClient = require(path.join(sharedLibsPath, 'redisClient.js'));

const app = express();
app.use(express.json());
app.use(cookieParser());

// Normalizar respuestas JSON
app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        try {
            const status = res.statusCode || 200;
            if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'success')) return originalJson(body);
            if (status >= 400) {
                const message = (body && (body.message || body.error)) || 'Error';
                const payload = { success: false, message };
                if (body && typeof body === 'object') payload.detail = body;
                return originalJson(payload);
            }
            return originalJson({ success: true, data: body, message: null });
        } catch (e) {
            return originalJson(body);
        }
    };
    next();
});

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3001;
const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'manage_user.sh');

// Middleware de autenticación de administrador (sin cambios)
function authenticateAdmin(req, res, next) {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success: false, message: 'Autenticación requerida: token ausente.', code: 'NO_TOKEN' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') return res.status(403).json({ success: false, message: 'Privilegios insuficientes: se requiere rol admin.', code: 'FORBIDDEN' });
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ success: false, message: 'Token inválido o expirado.', code: 'INVALID_TOKEN' });
    }
}

// Create an admin router and mount it under /api/v1/admin
const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);

// Ruta de estado simple
app.get('/status', async (req, res) => {
    try {
        const result = await spawnWithTimeout('whoami', [], { timeoutMs: 5000 });
        const user = (result.stdout || '').toString().trim();
        return res.json({ success: true, message: 'Servicio admin activo.', user, port: LISTEN_PORT });
    } catch (e) {
        logger.error('Error obteniendo whoami', e);
        return res.status(500).json({ success: false, message: 'No se pudo obtener estado.', code: 'STATUS_ERROR' });
    }
});

async function runManageUserScript(args) {
    const action = args[0];
    try {
        const { code, stdout, stderr } = await spawnWithTimeout('sudo', [SCRIPT_PATH, ...args], { timeoutMs: 30000 });
        return { code, stdout: stdout || '', stderr: stderr || '' };
    } catch (err) {
        logger.error('Error ejecutando manage_user.sh', { action, err: err.message });
        throw err;
    }
}

function parseManageOutput(action, output) {
    const lines = (output || '').trim().split('\n').filter(l => l);
    if (action === 'list') {
        const systemBlacklist = new Set(['root','vagrant','daemon','nobody','sync']);
        return lines.reduce((arr, line) => {
            const parts = line.split('|');
            if (parts.length < 3) return arr;
            const user = parts[0].trim();
            const defaultAccount = parts[1].trim();
            let adminLevelRaw = parts[2].trim();
            adminLevelRaw = adminLevelRaw.replace(/\+$/, '').trim();
            const adminLevel = adminLevelRaw === '' ? 'None' : adminLevelRaw;
            if (!user) return arr;
            if (systemBlacklist.has(user)) return arr;
            arr.push({ user, defaultAccount, adminLevel });
            return arr;
        }, []);
    }
    if (action === 'show') {
        return lines.reduce((obj, line) => {
            const [key, ...valueParts] = line.split('|');
            obj[key] = valueParts.join('|');
            return obj;
        }, {});
    }
    return (output || '').trim();
}

// Define admin routes relative to the mounted router
adminRouter.post('/users', async (req, res) => {
    const { username, password, account } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, message: 'username y password son requeridos.', code: 'BAD_REQUEST' });
    try {
        const { code, stdout, stderr } = await runManageUserScript(['create', username, password, account || 'default']);
        if (code !== 0) {
            if (code === 3) return res.status(409).json({ success: false, message: 'El usuario ya existe.', code: 'USER_EXISTS', error: stderr.trim() });
            return res.status(500).json({ success: false, message: 'Error al crear usuario.', code: 'SCRIPT_ERROR', error: stderr.trim() });
        }
        return res.json({ success: true, message: 'Usuario creado.', details: parseManageOutput('create', stdout) });
    } catch (err) {
        logger.error('create user failed', err);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

adminRouter.get('/users', async (req, res) => {
    try {
        const { code, stdout, stderr } = await runManageUserScript(['list']);
        if (code !== 0) return res.status(500).json({ success: false, message: 'Error listando usuarios.', code: 'SCRIPT_ERROR', error: stderr.trim() });
        const details = parseManageOutput('list', stdout);
        return res.json({ success: true, details });
    } catch (err) {
        logger.error('list users failed', err);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

// --- Pending registrations management ---
// GET /api/v1/admin/registrations -> lista de solicitudes pendientes
adminRouter.get('/registrations', async (req, res) => {
    try {
        const keys = await RedisClient.keys('pending:*');
        const items = [];
        for (const k of keys) {
            const raw = await RedisClient.get(k);
            if (!raw) continue;
            try {
                const parsed = JSON.parse(raw);
                // No devolvemos la contraseña al frontend del admin por seguridad
                items.push({ username: parsed.username, email: parsed.email, justification: parsed.justification || null, createdAt: parsed.createdAt });
            } catch (e) {
                console.warn('Malformed pending entry for', k);
            }
        }
        return res.json({ success: true, details: items });
    } catch (err) {
        logger.error('Error listando solicitudes pendientes', err);
        return res.status(500).json({ success: false, message: 'Error listando solicitudes pendientes', code: 'INTERNAL' });
    }
});

// POST /api/v1/admin/registrations/:username/approve -> aprueba una solicitud
adminRouter.post('/registrations/:username/approve', async (req, res) => {
    const { username } = req.params;
    try {
        const key = `pending:${username}`;
        const raw = await RedisClient.get(key);
        if (!raw) return res.status(404).json({ success: false, message: 'Solicitud no encontrada.', code: 'NOT_FOUND' });
        const parsed = JSON.parse(raw);
        if (!parsed.encryptedPassword) return res.status(400).json({ success: false, message: 'No hay contraseña cifrada disponible.', code: 'MALFORMED' });
        let password;
        try { password = cryptoUtils.decrypt(parsed.encryptedPassword); } catch (e) {
            logger.error('Failed to decrypt stored password', e);
            return res.status(500).json({ success: false, message: 'Error interno descifrando la contraseña.', code: 'DECRYPT_ERROR' });
        }

        try {
            const { code, stdout, stderr } = await runManageUserScript(['create', username, password, 'default']);
            if (code !== 0) {
                if (code === 3) return res.status(409).json({ success: false, message: 'El usuario ya existe.', code: 'USER_EXISTS', error: stderr.trim() });
                return res.status(500).json({ success: false, message: 'Error al crear usuario.', code: 'SCRIPT_ERROR', error: stderr.trim() });
            }
            setTimeout(async () => { try { await RedisClient.del(key); } catch (e) { logger.warn('No se pudo eliminar la key pending', key, e); } }, 1000);
            return res.json({ success: true, message: 'Solicitud aprobada y usuario creado.', details: parseManageOutput('create', stdout) });
        } catch (e) {
            logger.error('Error creando usuario desde approve', e);
            return res.status(500).json({ success: false, message: 'Error interno creando usuario.', code: 'INTERNAL' });
        }
    } catch (err) {
        logger.error('Error aprobando solicitud', err);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

// DELETE /api/v1/admin/registrations/:username -> denegar y eliminar la solicitud
adminRouter.delete('/registrations/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const key = `pending:${username}`;
        const raw = await RedisClient.get(key);
        if (!raw) return res.status(404).json({ success: false, message: 'Registration not found.' });
        await RedisClient.del(key);
        return res.json({ success: true, message: 'Registration denied and removed.' });
    } catch (err) {
        console.error('Error denying registration:', err);
        return res.status(500).json({ success: false, message: 'Error denying registration' });
    }
});

adminRouter.get('/users/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const { code, stdout, stderr } = await runManageUserScript(['show', username]);
        if (code !== 0) return res.status(404).json({ success: false, message: 'Usuario no encontrado.', code: 'NOT_FOUND', error: stderr.trim() });
        return res.json({ success: true, details: parseManageOutput('show', stdout) });
    } catch (e) {
        logger.error('show user failed', e);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

adminRouter.put('/users/:username', async (req, res) => {
    const { username } = req.params;
    const { attribute, value } = req.body;
    if (!attribute || !value) return res.status(400).json({ success: false, message: 'attribute y value son requeridos.', code: 'BAD_REQUEST' });
    try {
        const { code, stdout, stderr } = await runManageUserScript(['modify', username, attribute, value]);
        if (code !== 0) return res.status(500).json({ success: false, message: 'Error modificando usuario.', code: 'SCRIPT_ERROR', error: stderr.trim() });
        return res.json({ success: true, message: 'Usuario modificado.', details: parseManageOutput('modify', stdout) });
    } catch (e) {
        logger.error('modify user failed', e);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

adminRouter.delete('/users/:username', async (req, res) => {
    const { username } = req.params;
    try {
        const { code, stdout, stderr } = await runManageUserScript(['delete', username]);
        if (code !== 0) return res.status(500).json({ success: false, message: 'Error eliminando usuario.', code: 'SCRIPT_ERROR', error: stderr.trim() });
        return res.json({ success: true, message: 'Usuario eliminado.', details: parseManageOutput('delete', stdout) });
    } catch (e) {
        logger.error('delete user failed', e);
        return res.status(500).json({ success: false, message: 'Error interno.', code: 'INTERNAL' });
    }
});

// Mount the admin router at the new API prefix
app.use('/api/v1/admin', adminRouter);


// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled admin error', { err: (err && (err.stack || err.message)) || String(err) });
    if (!res.headersSent) return res.status(500).json({ success: false, message: 'Error interno', code: 'INTERNAL' });
    next(err);
});

app.listen(LISTEN_PORT, () => {
    logger.info({ msg: 'Admin service listening', port: LISTEN_PORT });
});