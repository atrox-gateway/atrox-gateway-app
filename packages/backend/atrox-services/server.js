// /opt/atrox-gateway/packages/backend/atrox-services/server.js

const express = require('express');
const { exec, spawn } = require('child_process'); // Importar spawn
const pam = require('authenticate-pam');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const sharedLibsPath = path.join(__dirname, '..', 'shared-libraries');

const { PunManager } = require(path.join(sharedLibsPath, 'punManager.js'));
const RedisClient = require(path.join(sharedLibsPath, 'redisClient.js'));

const punDir = '/var/run/atrox-puns'; 
const NGINX_PUNS_ENABLED_DIR = '/etc/nginx/puns-enabled';
const NGINX_USER_MAP_PATH = '/etc/nginx/user_map.conf';

const app = express();
// Aumentar límite para permitir uploads en base64 (hasta ~250MB total en payload)
app.use(express.json({ limit: '250mb' }));
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3000;
const MANAGE_USER_SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'manage_user.sh');

const punManager = new PunManager(punDir, JWT_SECRET, RedisClient);
punManager.recoverState().then(() => {
    console.log('✅ Recuperación de estado completada. Portero listo para aceptar logins.');
});

const http = require('http');

const authenticateToken = (req, res, next) => {
    const token = req.cookies.access_token;
    if (!token) {
        // Si no hay token, no podemos saber quién es para hacer logout.
        // Podríamos simplemente limpiar cookies genéricas o devolver error.
        return res.status(401).json({ message: 'No session token found.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            // Si el token es inválido, la sesión ya no es válida. Limpiamos cookies y listo.
            console.warn('Logout attempt with invalid token:', err.message);
            res.clearCookie('user_session', { path: '/' });
            res.clearCookie('access_token', { httpOnly: true, path: '/' });
            return res.status(401).json({ message: 'Invalid token, cookies cleared.' });
        }
        // Si el token es válido, adjuntamos la info del usuario y continuamos al logout
        req.user = decoded; 
        next();
    });
};

// --- NUEVA FUNCIÓN AUXILIAR ---
// Llama al script manage_user.sh para obtener el nivel de admin de un usuario
function getAdminLevelFromSlurm(username) {
    return new Promise((resolve, reject) => {
        const child = spawn('sudo', [MANAGE_USER_SCRIPT_PATH, 'show', username]);
        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });
        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`Script 'show' for '${username}' failed with code ${code}: ${errorOutput}`);
                // Si el script falla (ej. usuario no encontrado), asumimos que no es admin.
                return resolve('None'); 
            }
            try {
                const adminLine = output.split('\n').find(line => line.startsWith('adminLevel|'));
                const adminLevel = adminLine ? adminLine.split('|')[1] : 'None';
                resolve(adminLevel);
            } catch (e) {
                console.error(`Error parsing script output for '${username}':`, e);
                reject(new Error('Failed to parse user role.'));
            }
        });

        child.on('error', (err) => {
            console.error(`Failed to spawn manage_user.sh for '${username}':`, err);
            reject(err);
        });
    });
}

// Ejecuta un comando de shell y devuelve su salida como una promesa
function executeShellCommand(command, useSudo = false) {
    return new Promise((resolve, reject) => {
        const fullCommand = useSudo ? `sudo ${command}` : command;
        exec(fullCommand, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error ejecutando comando: ${fullCommand}\nStderr: ${stderr}`);
                return reject(new Error(`Comando fallido: ${fullCommand}`));
            }
            resolve(stdout);
        });
    });
}

// Estadísticas globales: trabajos
async function getSlurmJobStats(username = null) {
    try {
        const output = await executeShellCommand('squeue -h -o "%T %u"');
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        let totalJobs = lines.length;
        let runningJobs = 0;
        let queuedJobs = 0;
        let completedToday = 0;
        const activeUsers = new Set();

        lines.forEach(line => {
            const [state, user] = line.split(' ');
            activeUsers.add(user);
            if (state === 'RUNNING') runningJobs++;
            else if (['PENDING','CONFIGURING','REQUEUED'].includes(state)) queuedJobs++;
        });

        // Obtener trabajos completados hoy usando sacct (para todos los usuarios)
        const today = new Date().toISOString().split('T')[0]; // Formato YYYY-MM-DD
        // El comando sacct ahora no filtra por usuario para 'completedToday'
        const sacctCommand = `sacct -S ${today} -o State --noheader | grep -c COMPLETED`;

        const completedOutput = await executeShellCommand(sacctCommand, true); // Ejecutar sacct con sudo
        completedToday = parseInt(completedOutput.trim()) || 0;

        return { totalJobs, runningJobs, queuedJobs, completedToday, activeUsers: activeUsers.size };
    } catch (e) {
        console.error('getSlurmJobStats error', e);
        return { totalJobs:0, runningJobs:0, queuedJobs:0, completedToday:0, activeUsers:0 };
    }
}

// Estadísticas globales: recursos del sistema
async function getSystemResourceUsage() {
    try {
        const memOutput = await executeShellCommand('free -m');
        const memLines = memOutput.split('\n');
        const memParts = memLines[1].split(/\s+/);
        const memTotal = parseInt(memParts[1]);
        const memUsed = parseInt(memParts[2]);
        const memoryUsage = memTotal > 0 ? Math.floor((memUsed / memTotal) * 100) : 0;

        const storageOutput = await executeShellCommand('df -h /');
        const storageLine = storageOutput.split('\n')[1];
        const storageUsage = parseInt(storageLine.split(/\s+/)[4].replace('%',''));

        // CPU usage: placeholder (could parse /proc/stat or use mpstat)
        const cpuUsage = Math.floor(Math.random() * 100);

        return { cpuUsage, memoryUsage, storageUsage };
    } catch (e) {
        console.error('getSystemResourceUsage error', e);
        return { cpuUsage:0, memoryUsage:0, storageUsage:0 };
    }
}

// Estadísticas globales: nodos Slurm
async function getSlurmNodeStats() {
    try {
        const output = await executeShellCommand('sinfo -h -o "%T"');
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        console.log('sinfo output lines:', lines); // Log the output for debugging

        let nodesActive=0, nodesMaintenance=0, nodesErrors=0;
        lines.forEach(state => {
            const normalizedState = state.trim().toUpperCase(); // Normalize state for robust comparison
            if (['ALLOCATED', 'IDLE', 'MIXED', 'OK'].includes(normalizedState)) { // Added 'OK' as a potential active state
                nodesActive++;
            } else if (['MAINT', 'MAINTENANCE'].includes(normalizedState)) { // Added 'MAINTENANCE'
                nodesMaintenance++;
            } else if (['DRAINED', 'DOWN', 'ERROR', 'FAIL'].includes(normalizedState)) { // Added 'ERROR', 'FAIL'
                nodesErrors++;
            } else {
                console.warn('Unrecognized Slurm node state:', state); // Log unrecognized states
            }
        });
        const nodesTotal = lines.length; // Total nodes from sinfo output
        const nodesAvailable = Math.max(0, nodesTotal - nodesMaintenance - nodesErrors); // Calculate available nodes based on total
        return { nodesActive, nodesMaintenance, nodesAvailable, nodesErrors, nodesTotal }; // Return nodesTotal for completeness
    } catch (e) {
        console.error('getSlurmNodeStats error', e);
        return { nodesActive:0, nodesMaintenance:0, nodesAvailable:0, nodesErrors:0, nodesTotal:0 };
    }
}


// Mount auth routes under /api/v1/auth
const authRouter = express.Router();

// Endpoint público para crear una solicitud de registro pendiente de aprobación
authRouter.post('/register', async (req, res) => {
    const { username, email, password } = req.body || {};

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email and password are required.' });
    }

    try {
        // Si ya existe una cuenta del sistema (mostrar/consultar), rechazamos
        const adminLevel = await getAdminLevelFromSlurm(username);
        if (adminLevel && adminLevel !== 'None') {
            return res.status(409).json({ message: 'User already exists on the system.' });
        }

        // Verificar si ya hay una solicitud pendiente en Redis
        const pendingKey = `pending:${username}`;
        const existing = await RedisClient.get(pendingKey);
        if (existing) {
            return res.status(409).json({ message: 'A registration request for this username is already pending.' });
        }

        // Guardar la solicitud en Redis. Nota: almacenamos la contraseña temporalmente para poder crear el usuario
        // cuando el admin lo apruebe. En producción sería recomendable cifrarla o usar otro flujo seguro.
        const payload = JSON.stringify({ username, email, password, createdAt: new Date().toISOString() });
        await RedisClient.set(pendingKey, payload);

        return res.status(202).json({ message: 'Registration received and pending admin approval.' });

    } catch (error) {
        console.error('Error handling registration request:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

authRouter.post('/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (!username || !password) {
        return res.status(400).json({ message: 'username and password are required.' });
    }

    // Comprobar si existe una solicitud de registro pendiente para este usuario
    try {
        const pending = await RedisClient.get(`pending:${username}`);
        if (pending) {
            return res.status(403).json({ message: 'Registration pending approval.' });
        }
    } catch (err) {
        console.warn('Could not check pending registration for', username, err);
    }

    pam.authenticate(username, password, async (err) => {
        if (err) {
            console.error(`PAM authentication failed for user '${username}':`, err);
            return res.status(401).json({ message: 'Authentication failed.' });
        }
        console.log(`PAM authentication succeeded for user '${username}'.`);

        const userCodePath = path.join(__dirname, '..', 'atrox-user-pun', 'user-server.js');
        const socketPath = path.join(punDir, `${username}.socket`);
        
        try {
            // --- LÓGICA DE ROL DINÁMICA ---
            const adminLevel = await getAdminLevelFromSlurm(username);
            let role = 'user'; // Rol por defecto
            try {
                const normalized = (adminLevel || '').toString().trim().toLowerCase();
                if (username === 'atroxgateway' || normalized.includes('admin')) {
                    role = 'admin';
                    console.log(`User '${username}' granted ADMIN role (adminLevel='${adminLevel}').`);
                } else {
                    console.log(`User '${username}' granted USER role (adminLevel='${adminLevel}').`);
                }
            } catch (e) {
                console.warn('Could not normalize adminLevel, defaulting to user:', adminLevel, e);
            }
            // --- FIN DE LA LÓGICA ---

            console.log(`Attempting to check or create PUN for user '${username}'...`);
            await punManager.checkOrCreatePUN(username, userCodePath);
            console.log(`PUN check/creation completed for user '${username}'. Socket path: ${socketPath}`);

            const nginxUpstreamConfig = `upstream ${username}_pun_backend { server unix:${socketPath}; }`;

            const activePuns = punManager.getActivePuns(); 
            let mapFileContent = '';
            for (const user of activePuns.keys()) {
                mapFileContent += `${user} "${user}_pun_backend";\n`;
            }

            const tempUpstreamPath = `/tmp/${username}.conf`;
            const tempMapPath = '/tmp/user_map.conf';
            fs.writeFileSync(tempUpstreamPath, nginxUpstreamConfig);
            fs.writeFileSync(tempMapPath, mapFileContent);
            console.log(`NGINX config files written for '${username}'.`);

            const bashCommands = `
            mv ${tempUpstreamPath} ${NGINX_PUNS_ENABLED_DIR}/${username}.conf &&
            mv ${tempMapPath} ${NGINX_USER_MAP_PATH} &&
            nginx -t
            nginx -s reload`;

            const command = `sudo /bin/bash -c "${bashCommands}"`;
            console.log(`Executing NGINX reload command for '${username}'.`);

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('CRITICAL NGINX RELOAD FAIL:', stderr);
                } else {
                    console.log(`✅ NGINX reconfigurado exitosamente para ${username}.`);
                }
            });

            const token = jwt.sign({ sub: username, role: role }, JWT_SECRET, { expiresIn: '1h' });
            res.cookie('user_session', username, { path: '/', maxAge: 3600000, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            res.cookie('access_token', token, { httpOnly: true, path: '/', maxAge: 3600000, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
            return res.json({ message: 'Login successful.', role: role });

        } catch (error) {
            console.error("Error during session setup:", error);
            return res.status(500).json({ message: 'Internal error during session setup.' });
        }
    }, { serviceName: 'login' });
});

authRouter.post('/logout', authenticateToken, async (req, res) => {
    // El middleware 'authenticateToken' ya verificó el JWT
    const username = req.user.sub; // Obtenemos el username del token verificado

    console.log(`Logout request received for verified user '${username}'.`);

    try {
        const stopped = await punManager.stopPUN(username);

        if (!stopped) {
            console.warn(`Logout: PUN for ${username} was not found in PunManager.`);
        }

        const nginxPunConfPath = path.join(NGINX_PUNS_ENABLED_DIR, `${username}.conf`);

        const activePuns = punManager.getActivePuns();
        let mapFileContent = '';
         if (activePuns && typeof activePuns.keys === 'function') {
            for (const user of activePuns.keys()) {
                // Corregido: Asegúrate de que la sintaxis sea correcta
                mapFileContent += `"${user}" "${user}_pun_backend";\n`;
            }
        } else {
            console.error("Error: activePuns no es iterable o getActivePuns no devolvió un Map.");
        }


        const tempMapPath = '/tmp/user_map.conf';
        fs.writeFileSync(tempMapPath, mapFileContent);

        const bashCommands = `
            rm -f ${nginxPunConfPath} &&
            mv ${tempMapPath} ${NGINX_USER_MAP_PATH} &&
            nginx -t &&
            nginx -s reload
        `;
        const command = `sudo /bin/bash -c "${bashCommands}"`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error cleaning up NGINX config for ${username}:`, stderr);
            } else {
                console.log(`✅ NGINX configuration cleaned up for ${username}.`);
            }
        });

        res.clearCookie('user_session', { path: '/' });
        res.clearCookie('access_token', { httpOnly: true, path: '/' });

        return res.json({ message: 'Logout successful.' });

    } catch (error) {
        console.error(`Error during logout for ${username}:`, error);
        res.clearCookie('user_session', { path: '/' });
        res.clearCookie('access_token', { httpOnly: true, path: '/' });
        return res.status(500).json({ message: 'Internal error during logout.' });
    }
});

// mount auth router
app.use('/api/v1/auth', authRouter);

// Dashboard router: sirve estadísticas globales para admins y proxifica a PUNs para usuarios
const dashboardRouter = express.Router();

dashboardRouter.get('/stats', async (req, res) => {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success:false, message: 'No session token' });

    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        console.warn('Invalid token in /dashboard/stats request:', e.message);
        return res.status(401).json({ success:false, message: 'Invalid session token' });
    }

    try {
        // Siempre obtener las estadísticas de nodos globales
        const globalNodeStats = await getSlurmNodeStats();

        if (decoded && decoded.role === 'admin') {
            // Servir estadísticas globales (incluyendo las de nodos)
            const adminUsername = decoded.sub; // Obtener el nombre de usuario del token
            const [jobStats, resourceUsage] = await Promise.all([
                getSlurmJobStats(adminUsername), // Pasar el nombre de usuario del admin
                getSystemResourceUsage()
            ]);

            const payload = Object.assign({}, jobStats, resourceUsage, globalNodeStats); // Incluir globalNodeStats
            return res.json({ success: true, data: payload });
        }

        // No es admin => proxificar a PUN del usuario
        const username = decoded.sub;
        if (!username) return res.status(400).json({ success:false, message: 'Invalid token: missing username' });

        const activePuns = punManager.getActivePuns();
        const punInfo = activePuns.get(username);
        if (!punInfo || !punInfo.socketPath) {
            return res.status(503).json({ success:false, message: 'User PUN not available' });
        }

        const options = {
            socketPath: punInfo.socketPath,
            path: '/api/v1/user/dashboard/stats',
            method: 'GET',
            headers: {
                'Cookie': `access_token=${token}`
            },
            timeout: 5000
        };

        const udsReq = http.request(options, (udsRes) => {
            let body = '';
            udsRes.on('data', (chunk) => { body += chunk.toString(); });
            udsRes.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    if (parsed.success && parsed.data) {
                        // Fusionar las estadísticas de nodos globales con la respuesta del PUN
                        parsed.data = Object.assign({}, parsed.data, globalNodeStats);
                    }
                    return res.status(udsRes.statusCode || 200).json(parsed);
                } catch (e) {
                    console.error('Error parsing PUN response:', e, 'raw:', body);
                    return res.status(502).json({ success:false, message: 'Invalid response from PUN' });
                }
            });
        });

        udsReq.on('error', (err) => {
            console.error('Error connecting to PUN socket:', err.message);
            return res.status(502).json({ success:false, message: 'Failed to reach PUN', detail: err.message });
        });

        udsReq.on('timeout', () => {
            udsReq.destroy();
            return res.status(504).json({ success:false, message: 'PUN request timed out' });
        });

        udsReq.end();

    } catch (e) {
        console.error('Error in /api/v1/dashboard/stats:', e);
        return res.status(500).json({ success:false, message: 'Internal server error' });
    }
});

app.use('/api/v1/dashboard', dashboardRouter);

app.listen(LISTEN_PORT, () => {
    console.log(`🚀 Portero service listening on port ${LISTEN_PORT}`);
});