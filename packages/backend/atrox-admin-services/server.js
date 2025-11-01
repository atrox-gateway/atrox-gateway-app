// /opt/atrox-gateway/packages/backend/atrox-admin-service/server.js

const express = require('express');
const { spawn, execSync } = require('child_process'); // Importar execSync también
const jwt = require('jsonwebtoken');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3001;
const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'manage_user.sh');
const sharedLibsPath = path.join(__dirname, '..', 'shared-libraries');
const RedisClient = require(path.join(sharedLibsPath, 'redisClient.js'));

// Middleware de autenticación de administrador (sin cambios)
function authenticateAdmin(req, res, next) {
    const token = req.cookies.access_token;
    if (!token) {
        return res.status(401).json({ message: 'Authentication required: Token missing.' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Insufficient privileges. Admin role required.' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
}

// Create an admin router and mount it under /api/v1/admin
const adminRouter = express.Router();
adminRouter.use(authenticateAdmin);

// Ruta de estado simple
app.get('/status', (req, res) => {
    const user = execSync('whoami').toString().trim();
    res.json({ message: 'Admin service active.', user: user, port: LISTEN_PORT });
});

function runManageUserScript(args, res) {
    let output = '';
    let errorOutput = '';
    const action = args[0];

    const child = spawn('sudo', [SCRIPT_PATH, ...args], { stdio: ['inherit', 'pipe', 'pipe'] });

    child.stdout.on('data', (data) => {
        output += data.toString();
    });
    child.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.error(`ERROR: Script '${action}' failed with code ${code}. Output: ${errorOutput}`);
            switch (code) {
                case 2: 
                    return res.status(404).json({ success: false, message: `User not found.`, error: errorOutput.trim() });
                case 3: 
                    return res.status(409).json({ success: false, message: `User already exists.`, error: errorOutput.trim() });
                default: 
                    return res.status(500).json({ success: false, message: `Error executing script '${action}'. Check server logs.`, error: errorOutput.trim() });
            }
        }

        let details;
        try {
            const lines = output.trim().split('\n').filter(line => line);

            if (action === 'list') {
                // Parse only well-formed lines and filter out system users
                const systemBlacklist = new Set(['root','vagrant','daemon','nobody','sync']);
                details = lines.reduce((arr, line) => {
                    // Expect exactly three pipe-separated fields: user|DefaultAccount|AdminLevel
                    const parts = line.split('|');
                    if (parts.length < 3) return arr; // skip malformed/header lines
                    const user = parts[0].trim();
                    const defaultAccount = parts[1].trim();
                    let adminLevelRaw = parts[2].trim();

                    // Normalize admin level: remove trailing '+' or truncated markers and use 'None' if empty
                    adminLevelRaw = adminLevelRaw.replace(/\+$/, '').trim();
                    const adminLevel = adminLevelRaw === '' ? 'None' : adminLevelRaw;

                    if (!user) return arr;
                    if (systemBlacklist.has(user)) return arr; // skip system accounts

                    arr.push({ user, defaultAccount, adminLevel });
                    return arr;
                }, []);
            } else if (action === 'show') {
                details = lines.reduce((obj, line) => {
                    const [key, ...valueParts] = line.split('|');
                    obj[key] = valueParts.join('|');
                    return obj;
                }, {});
            } else {
                details = output.trim();
            }
        } catch (parseError) {
            console.error("Error parsing script output:", parseError);
            return res.status(500).json({ success: false, message: "Error parsing script output.", error: parseError.message });
        }

        return res.json({ success: true, message: `Operation '${action}' successful.`, details: details });
    });

    child.on('error', (err) => {
        console.error(`ERROR: Failed to spawn script '${action}':`, err);
        return res.status(500).json({ success: false, message: `Failed to start script '${action}'.` });
    });
}

// Define admin routes relative to the mounted router
adminRouter.post('/users', (req, res) => {
    const { username, password, account } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    runManageUserScript(['create', username, password, account || 'default'], res);
});

adminRouter.get('/users', (req, res) => {
    runManageUserScript(['list'], res);
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
        console.error('Error listing registrations:', err);
        return res.status(500).json({ success: false, message: 'Error listing registrations' });
    }
});

// POST /api/v1/admin/registrations/:username/approve -> aprueba una solicitud
adminRouter.post('/registrations/:username/approve', async (req, res) => {
    const { username } = req.params;
    try {
        const key = `pending:${username}`;
        const raw = await RedisClient.get(key);
        if (!raw) return res.status(404).json({ success: false, message: 'Registration not found.' });
        const parsed = JSON.parse(raw);

        // Ejecutar el script de creación de usuario con la contraseña proporcionada
        runManageUserScript(['create', username, parsed.password, 'default'], {
            json: (obj) => res.json(obj),
            status: (s) => ({ json: (obj) => res.status(s).json(obj) })
        });

        // Nota: runManageUserScript usará el spawn y responderá cuando termine. Para evitar doble respuesta,
        // eliminamos la entrada al finalizar con un breve delay para que el spawn haya sido lanzado.
        setTimeout(async () => {
            try { await RedisClient.del(key); } catch (e) { console.warn('Failed to delete pending key', key, e); }
        }, 1000);

    } catch (err) {
        console.error('Error approving registration:', err);
        return res.status(500).json({ success: false, message: 'Error approving registration' });
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

adminRouter.get('/users/:username', (req, res) => {
    const { username } = req.params;
    runManageUserScript(['show', username], res);
});

adminRouter.put('/users/:username', (req, res) => {
    const { username } = req.params;
    const { attribute, value } = req.body;
    if (!attribute || !value) {
        return res.status(400).json({ success: false, message: 'Attribute and value are required for modification.' });
    }
    runManageUserScript(['modify', username, attribute, value], res);
});

adminRouter.delete('/users/:username', (req, res) => {
    const { username } = req.params;
    runManageUserScript(['delete', username], res);
});

// Mount the admin router at the new API prefix
app.use('/api/v1/admin', adminRouter);


app.listen(LISTEN_PORT, () => {
    console.log(`🛡️ Admin service listening on port ${LISTEN_PORT}`);
});