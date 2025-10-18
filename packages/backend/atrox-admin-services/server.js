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

// Aplicar el middleware a todas las rutas bajo /admin
app.use('/admin', authenticateAdmin);

// Ruta de estado simple
app.get('/status', (req, res) => {
    const user = execSync('whoami').toString().trim();
    res.json({ message: 'Admin service active.', user: user, port: LISTEN_PORT });
});

// Helper function to run the manage_user script and capture output
function runManageUserScript(args, res) {
    let output = '';
    let errorOutput = '';
    const action = args[0]; // Guarda la acción (create, list, etc.)

    const child = spawn('sudo', [SCRIPT_PATH, ...args], { stdio: ['inherit', 'pipe', 'pipe'] });

    child.stdout.on('data', (data) => {
        output += data.toString();
    });
    child.stderr.on('data', (data) => {
        errorOutput += data.toString();
    });

    child.on('close', (code) => {
        if (code === 0) {
            let details;
            // --- LÓGICA DE PARSEO AÑADIDA ---
            if (action === 'list') {
                try {
                    // 1. Divide la salida en líneas, quitando líneas vacías
                    const lines = output.trim().split('\n').filter(line => line);
                    // 2. Mapea cada línea a un objeto JSON
                    details = lines.map(line => {
                        const [user, defaultAccount, adminLevel] = line.split('|');
                        return { user, defaultAccount, adminLevel };
                    });
                } catch (parseError) {
                    console.error("Error parsing sacctmgr output:", parseError);
                    details = "Error parsing user list."; // Devuelve un error si el parseo falla
                }
            } else {
                details = output.trim(); // Para otras acciones, devuelve el texto como antes
            }
            // --- FIN DE LA LÓGICA DE PARSEO ---

            return res.json({ success: true, message: `Operation '${action}' successful.`, details: details });
        } else {
            console.error(`ERROR: Script '${action}' failed with code ${code}. Output: ${errorOutput}`);
            return res.status(500).json({ success: false, message: `Error executing script '${action}'. Check server logs.`, error: errorOutput.trim() });
        }
    });

    child.on('error', (err) => {
        console.error(`ERROR: Failed to spawn script '${action}':`, err);
        return res.status(500).json({ success: false, message: `Failed to start script '${action}'.` });
    });
}

// --- ENDPOINTS CRUD ---

// CREATE
app.post('/admin/users', (req, res) => {
    const { username, password, account } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    // Llama al script con los argumentos correctos
    runManageUserScript(['create', username, password, account || 'default'], res);
});

// LIST (Read All)
app.get('/admin/users', (req, res) => {
    runManageUserScript(['list'], res);
});

// SHOW (Read One)
app.get('/admin/users/:username', (req, res) => {
    const { username } = req.params;
    runManageUserScript(['show', username], res);
});

// MODIFY (Update)
app.put('/admin/users/:username', (req, res) => {
    const { username } = req.params;
    const { attribute, value } = req.body;
    if (!attribute || !value) {
        return res.status(400).json({ success: false, message: 'Attribute and value are required for modification.' });
    }
    runManageUserScript(['modify', username, attribute, value], res);
});

// DELETE
app.delete('/admin/users/:username', (req, res) => {
    const { username } = req.params;
    runManageUserScript(['delete', username], res);
});


app.listen(LISTEN_PORT, () => {
    console.log(`🛡️ Admin service listening on port ${LISTEN_PORT}`);
});