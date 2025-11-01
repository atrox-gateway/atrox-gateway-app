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

// Obtener historial de trabajos usando sacct
async function getJobHistory(username = null, days = 30) {
    try {
        const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        // Usar salida 'pipe' para parseo más sencillo, sin cabecera (-n)
        // Campos: JobID|JobName|State|Submit|Start|End|Elapsed|AllocCPUS|ReqMem|ExitCode
        const fields = 'JobID,JobName,State,Submit,Start,End,Elapsed,AllocCPUS,ReqMem,ExitCode,User';
        const userFilter = username ? `-u ${username}` : '';
        const cmd = `sacct -P -n ${userFilter} -S ${since} -o ${fields}`;
        const out = await executeShellCommand(cmd, true);
        const lines = out.trim().split('\n').filter(l => l.length > 0);
        const jobs = lines.map(line => {
            const parts = line.split('|');
            // Ensure expected length
            const [rawJobId, jobName, state, submit, start, end, elapsed, allocCpus, reqMem, exitCode, user] = parts.concat(Array(11).fill(null));
            const jobId = rawJobId ? rawJobId.split('.')[0] : rawJobId; // strip step suffix
            return {
                id: jobId || rawJobId,
                name: jobName || null,
                status: state ? state.toLowerCase() : null,
                submit_time: submit || null,
                start_time: start || null,
                end_time: end || null,
                duration: elapsed || null,
                cpus: allocCpus ? parseInt(allocCpus, 10) : null,
                memory: reqMem || null,
                exit_code: exitCode ? (isNaN(parseInt(exitCode,10)) ? null : parseInt(exitCode,10)) : null,
                user: user || null
            };
        });
        // Deduplicate by id (keep first occurrence)
        const seen = new Set();
        const uniq = [];
        for (const j of jobs) {
            if (!j.id) continue;
            if (seen.has(j.id)) continue;
            seen.add(j.id);
            uniq.push(j);
        }
        return uniq;
    } catch (e) {
        console.error('getJobHistory error', e);
        throw e;
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

        // CPU usage: compute from /proc/stat sampling to get an instantaneous percent
        const readCpuStat = () => {
            const stat = fs.readFileSync('/proc/stat', 'utf8');
            const cpuLine = stat.split('\n').find(l => l.startsWith('cpu '));
            if (!cpuLine) return null;
            const parts = cpuLine.trim().split(/\s+/).slice(1).map(p => parseInt(p, 10) || 0);
            // fields: user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice
            const idle = (parts[3] || 0) + (parts[4] || 0);
            const total = parts.reduce((a, b) => a + b, 0);
            return { idle, total };
        };

        const a = readCpuStat();
        await new Promise(r => setTimeout(r, 200));
        const b = readCpuStat();
        let cpuUsage = 0;
        if (a && b) {
            const idleDelta = b.idle - a.idle;
            const totalDelta = b.total - a.total;
            cpuUsage = totalDelta > 0 ? Math.round((1 - idleDelta / totalDelta) * 100) : 0;
        }

        return { cpuUsage, memoryUsage, storageUsage };
    } catch (e) {
        console.error('getSystemResourceUsage error', e);
        return { cpuUsage:0, memoryUsage:0, storageUsage:0 };
    }
}

// Estadísticas globales: nodos Slurm
async function getSlurmNodeStats() {
    try {
        // Request per-node output from sinfo (-N) so we count nodes individually instead of aggregated partition lines
        // Use "%N %T" so we can robustly parse the node name and its state (state is the last token)
        const output = await executeShellCommand('sinfo -h -N -o "%N %T"');
            const lines = output.trim().split('\n').filter(l => l.length > 0);
            console.log('sinfo per-node output lines (count=' + lines.length + '):', lines.slice(0, 20)); // Log a sample for debugging

            let nodesActive = 0, nodesMaintenance = 0, nodesErrors = 0;
            lines.forEach(line => {
                // state is the last whitespace-separated token in the line (node names won't contain spaces)
                const parts = line.trim().split(/\s+/);
                const state = parts.length ? parts[parts.length - 1].toUpperCase() : '';

                // Define semantics:
                // - nodesActive: nodes that are currently allocated (or partially allocated/mixed)
                // - nodesMaintenance: nodes under maintenance
                // - nodesErrors: nodes in down/drained/error states
                // Note: IDLE should NOT be counted as active — it is available for allocation.
                if (['ALLOCATED', 'MIXED'].includes(state)) {
                    nodesActive++;
                } else if (['MAINT', 'MAINTENANCE'].includes(state)) {
                    nodesMaintenance++;
                } else if (['DRAINED', 'DOWN', 'ERROR', 'FAIL', 'UNKNOWN'].includes(state)) {
                    nodesErrors++;
                } else {
                    // everything else (e.g., IDLE, COMPLETED, etc.) is considered available / not active
                }
            });
            const nodesTotal = lines.length; // Total nodes from sinfo per-node output
            // Available nodes = total minus maintenance, error and currently active (allocated/mixed)
            const nodesAvailable = Math.max(0, nodesTotal - nodesMaintenance - nodesErrors - nodesActive);
        return { nodesActive, nodesMaintenance, nodesAvailable, nodesErrors, nodesTotal }; // Return nodesTotal for completeness
    } catch (e) {
        console.error('getSlurmNodeStats error', e);
        return { nodesActive:0, nodesMaintenance:0, nodesAvailable:0, nodesErrors:0, nodesTotal:0 };
    }
}

// Return a map of nodeName -> slurmState using sinfo per-node output
async function getSlurmNodeStateMap() {
    try {
        const output = await executeShellCommand('sinfo -h -N -o "%N %T"');
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        const map = {};
        lines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
                const state = parts[parts.length - 1].toUpperCase();
                const nodeName = parts.slice(0, parts.length - 1).join(' ');
                map[nodeName] = state;
            }
        });
        return map;
    } catch (e) {
        console.error('getSlurmNodeStateMap error', e);
        return {};
    }
}

// Estadísticas detalladas para nodos específicos (CPU/Mem asignado vs capacidad)
async function getComputeNodeStats(nodes = []) {
    try {
        const results = [];
        for (const node of nodes) {
            try {
                // scontrol show node <node> -o -> key=value tokens
                const out = await executeShellCommand(`scontrol show node ${node} -o`);
                const tok = out.trim().split(/\s+/);
                const data = {};
                tok.forEach(t => {
                    if (!t.includes('=')) return;
                    const [k, v] = t.split('=');
                    data[k] = v;
                });

                const cpuTot = parseInt(data.CPUTot || '0', 10);
                const cpuAlloc = parseInt(data.CPUAlloc || data.CPUAlloc || '0', 10);
                const cpuLoad = parseFloat(data.CPULoad || '0') || 0;
                const realMem = parseInt(data.RealMemory || '0', 10); // MB
                const allocMem = parseInt(data.AllocMem || '0', 10); // MB

                const cpuAssignedPct = cpuTot > 0 ? Math.round((cpuAlloc / cpuTot) * 100) : 0;
                const memAssignedPct = realMem > 0 ? Math.round((allocMem / realMem) * 100) : 0;

                results.push({
                    node,
                    cpuTot,
                    cpuAlloc,
                    cpuAssignedPct,
                    cpuLoad,
                    realMemMB: realMem,
                    allocMemMB: allocMem,
                    memAssignedPct
                });
            } catch (e) {
                console.error(`Error getting scontrol for node ${node}:`, e);
                results.push({ node, error: String(e) });
            }
        }
        return results;
    } catch (e) {
        console.error('getComputeNodeStats error', e);
        return nodes.map(n => ({ node: n, error: String(e) }));
    }
}

// Intento de obtener uso de disco para el nodo de storage buscando montajes NFS locales
async function getStorageUsageForNode(nodeName) {
    try {
        // Obtener todas las líneas de mount; usar '|| true' para evitar código de salida !=0
        const mountOut = await executeShellCommand('mount || true');
        const mountLines = mountOut.split('\n').map(l => l.trim()).filter(l => l.length > 0);

        // Intentar encontrar una línea que contenga el nombre del nodo
        let chosen = mountLines.find(l => l.includes(nodeName));
        if (!chosen) {
            // Si no encontramos por nombre, elegir el primer montaje NFS disponible (nfs o nfs4)
            chosen = mountLines.find(l => l.includes(' type nfs') || l.includes(' type nfs4'));
        }

        if (!chosen) return { error: 'No NFS mount found locally' };

        // Formato esperado: '<source> on <mountpoint> type nfs...'
        const onIndex = chosen.indexOf(' on ');
        if (onIndex === -1) return { error: 'Unexpected mount line format' };
        const source = chosen.substring(0, onIndex).trim();
        const afterOn = chosen.substring(onIndex + 4);
        const typeIndex = afterOn.indexOf(' type ');
        const mountpoint = typeIndex !== -1 ? afterOn.substring(0, typeIndex).trim() : afterOn.split(/	|\s+/)[0];

        // Ejecutar df de forma robusta
        const dfOut = await executeShellCommand(`df -P ${mountpoint}`);
        const dfLines = dfOut.trim().split('\n');
        if (dfLines.length < 2) return { error: 'df output unexpected' };
        const cols = dfLines[1].split(/\s+/);
        // cols: Filesystem, 1K-blocks, Used, Available, Use%, Mounted on
        const sizeKB = parseInt(cols[1] || '0', 10);
        const usedKB = parseInt(cols[2] || '0', 10);
        const availKB = parseInt(cols[3] || '0', 10);
        const usePercent = parseInt((cols[4] || '0').replace('%',''), 10) || 0;

        return { source, mountpoint, sizeKB, usedKB, availKB, usePercent };
    } catch (e) {
        return { error: String(e) };
    }
}


// Mount auth routes under /api/v1/auth
const authRouter = express.Router();

// Endpoint público para crear una solicitud de registro pendiente de aprobación
authRouter.post('/register', async (req, res) => {
    const { username, email, password, justification } = req.body || {};

    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email and password are required.' });
    }

    // Require a short justification so admins have context when approving
    if (!justification || justification.toString().trim().length < 10) {
        return res.status(400).json({ message: 'justification is required (min 10 characters).' });
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
    const payload = JSON.stringify({ username, email, password, justification: justification.toString().trim(), createdAt: new Date().toISOString() });
        await RedisClient.set(pendingKey, payload);

        return res.status(202).json({ message: 'Registration received and pending admin approval.' });

    } catch (error) {
        console.error('Error handling registration request:', error);
        return res.status(500).json({ message: 'Internal server error.' });
    }
});

// Endpoint público para checar disponibilidad de username (real-time friendly)
// GET /api/v1/auth/check-username?username=foo
authRouter.get('/check-username', async (req, res) => {
    const username = (req.query.username || '').toString().trim();
    if (!username) return res.status(400).json({ available: false, message: 'username query param required' });

    try {
        // 1 Check if user already exists in system via manage_user.sh 'show'
        const adminLevel = await getAdminLevelFromSlurm(username);
        if (adminLevel && adminLevel !== 'None') {
            return res.json({ available: false, message: 'User already exists on the system' });
        }

        // 2 Check pending registrations in Redis
        const pendingKey = `pending:${username}`;
        const existing = await RedisClient.get(pendingKey);
        if (existing) {
            return res.json({ available: false, message: 'Registration request is already pending for this username' });
        }

        // Otherwise available
        return res.json({ available: true, message: 'Username available' });
    } catch (err) {
        console.error('Error checking username availability for', username, err);
        return res.status(500).json({ available: false, message: 'Internal server error' });
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

            // Obtener estadísticas detalladas para los nodos de cómputo indicados
            // NOTE: usar explícitamente node-01 y node-02 para cómputo y node-storage para almacenamiento
            const nodesToQuery = ['node-01', 'node-02', 'node-storage'];
            let perNodeStats = [];
            try {
                perNodeStats = await getComputeNodeStats(nodesToQuery);
            } catch (e) {
                console.warn('Failed to get per-node compute stats:', e);
                perNodeStats = nodesToQuery.map(n => ({ node: n, error: String(e) }));
            }

            const computeNodes = perNodeStats.filter(p => p.node && (p.node === 'node-01' || p.node === 'node-02'));
            const storageNode = perNodeStats.find(p => p.node === 'node-storage') || null;

            const payload = Object.assign({}, jobStats, resourceUsage, globalNodeStats, {
                computeNodes,
                storageNode
            });
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
        
        // For non-admin users, we still want to include global node summaries (state per node)
        // but we must not expose privileged per-node compute details. Build a lightweight nodes list
        // from sinfo (name + state) and merge it into the proxied response.
        let nodesSummary = [];
        try {
            const stateMap = await getSlurmNodeStateMap();
            nodesSummary = Object.keys(stateMap).map(n => ({ name: n, state: stateMap[n] }));
        } catch (e) {
            console.warn('Could not build nodes summary for non-admin proxied response:', e);
            nodesSummary = [];
        }

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
                    // Merge a lightweight nodes summary for non-admin users if not present
                    if (!parsed.data) parsed.data = {};
                    if (!parsed.data.nodes || !Array.isArray(parsed.data.nodes) || parsed.data.nodes.length === 0) {
                        parsed.data.nodes = parsed.data.nodes || nodesSummary;
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

// Optional helper endpoint returning per-node details (admin-only)
dashboardRouter.get('/nodes', async (req, res) => {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ success:false, message: 'No session token' });
    let decoded = null;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (e) {
        console.warn('Invalid token in /dashboard/nodes request:', e.message);
        return res.status(401).json({ success:false, message: 'Invalid session token' });
    }

    try {
        if (!decoded || decoded.role !== 'admin') return res.status(403).json({ success:false, message: 'Forbidden: admin only' });

        const globalNodeStats = await getSlurmNodeStats();
        const nodesToQuery = ['node-01', 'node-02', 'node-storage'];
        let perNodeStats = [];
        try {
            perNodeStats = await getComputeNodeStats(nodesToQuery);
        } catch (e) {
            console.warn('Failed to get per-node compute stats for /nodes:', e);
            perNodeStats = nodesToQuery.map(n => ({ node: n, error: String(e) }));
        }

        const computeNodes = perNodeStats.filter(p => p.node && (p.node === 'node-01' || p.node === 'node-02'));
        const storageNode = perNodeStats.find(p => p.node === 'node-storage') || null;

        // Try to enrich per-node results with Slurm state from sinfo
        const stateMap = await getSlurmNodeStateMap();
        const enrich = (item) => {
            if (!item) return item;
            const name = item.node || item.nodeName || item.node || item.node;
            const st = stateMap[name];
            if (st) item.state = st;
            return item;
        };

        const enrichedCompute = computeNodes.map(enrich);
        const enrichedStorage = enrich(storageNode);

        const payload = Object.assign({}, globalNodeStats, { computeNodes: enrichedCompute, storageNode: enrichedStorage });
        return res.json({ success: true, data: payload });
    } catch (e) {
        console.error('Error in /api/v1/dashboard/nodes:', e);
        return res.status(500).json({ success:false, message: 'Internal server error' });
    }
});

app.use('/api/v1/dashboard', dashboardRouter);

const jobsRouter = express.Router();

// Return list of known users from sacct (admin-only)
jobsRouter.get('/users', authenticateToken, async (req, res) => {
    try {
        const decoded = req.user || null;
        if (!decoded || decoded.role !== 'admin') return res.status(403).json({ success: false, message: 'Forbidden' });
        const days = parseInt(req.query.days || '30', 10) || 30;
        const since = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        // Request User field from sacct; -P pipe format and -n no header
        const cmd = `sacct -P -n -S ${since} -o User`;
        const out = await executeShellCommand(cmd, true);
        const lines = out.trim().split('\n').filter(l => l && l.trim().length > 0);
        const users = lines.map(l => (l || '').toString().trim()).filter(u => !!u);
        const uniq = Array.from(new Set(users)).sort();
        return res.json(uniq);
    } catch (e) {
        console.error('/api/v1/jobs/users error', e);
        return res.status(500).json({ success: false, message: 'Failed to list users', detail: String(e) });
    }
});

// History endpoint: devuelve historial de trabajos del usuario (o global para admins)
jobsRouter.get('/history', authenticateToken, async (req, res) => {
    try {
        const days = parseInt(req.query.days || '30', 10) || 30;
        const statusFilter = (req.query.status_filter || '').toString().toLowerCase();
        const decoded = req.user || null; // authenticateToken sets req.user

        // If admin, allow local sacct query. If req.query.user provided, filter by that user,
        // otherwise return global history (all users).
        if (decoded && decoded.role === 'admin') {
            const targetUser = req.query.user ? req.query.user.toString() : null;
            const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '50', 10) || 50));
            const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
            const history = await getJobHistory(targetUser, days);
            let filtered = history;
            if (statusFilter && statusFilter !== 'all') {
                const want = statusFilter;
                filtered = history.filter(h => (h.status || '').toString().toLowerCase().includes(want));
            }
            // Ensure ordering by numeric job id descending (highest ID first)
            filtered = (filtered || []).slice().sort((a, b) => {
                const aId = parseInt(String(a?.id || '').replace(/\D/g, ''), 10) || 0;
                const bId = parseInt(String(b?.id || '').replace(/\D/g, ''), 10) || 0;
                return bId - aId;
            });
            // Apply pagination server-side for admin requests
            const sliced = filtered.slice(offset, offset + limit);
            return res.json(sliced);
        }

        // For non-admin users, proxy to their PUN (user-server) over UDS
        if (!decoded) return res.status(401).json({ success:false, message: 'No session' });
        const username = decoded.sub;
        const activePuns = punManager.getActivePuns();
        const punInfo = activePuns.get(username);
        if (!punInfo || !punInfo.socketPath) {
            return res.status(503).json({ success:false, message: 'User PUN not available' });
        }

        const limit = Math.max(1, Math.min(1000, parseInt(req.query.limit || '50', 10) || 50));
        const offset = Math.max(0, parseInt(req.query.offset || '0', 10) || 0);
        const options = {
            socketPath: punInfo.socketPath,
            path: `/api/v1/user/history?days=${days}${statusFilter ? `&status_filter=${encodeURIComponent(statusFilter)}` : ''}&limit=${limit}&offset=${offset}`,
            method: 'GET',
            headers: {
                'Cookie': `access_token=${req.cookies.access_token || ''}`
            },
            timeout: 5000
        };

        const udsReq = http.request(options, (udsRes) => {
            let body = '';
            udsRes.on('data', (chunk) => { body += chunk.toString(); });
            udsRes.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    return res.status(udsRes.statusCode || 200).json(parsed);
                } catch (e) {
                    console.error('Error parsing PUN history response:', e, 'raw:', body);
                    return res.status(502).json({ success:false, message: 'Invalid response from PUN' });
                }
            });
        });

        udsReq.on('error', (err) => {
            console.error('Error connecting to PUN socket for history:', err.message);
            return res.status(502).json({ success:false, message: 'Failed to reach PUN', detail: err.message });
        });

        udsReq.on('timeout', () => {
            udsReq.destroy();
            return res.status(504).json({ success:false, message: 'PUN request timed out' });
        });

        udsReq.end();
    } catch (e) {
        console.error('/api/v1/jobs/history error', e);
        return res.status(500).json({ success:false, message: 'Failed to retrieve history', detail: String(e) });
    }
});

app.use('/api/v1/jobs', jobsRouter);

// Compatibility route: keep previous frontend path `/api/history` working
app.get('/api/history', authenticateToken, (req, res) => {
    const qs = new URLSearchParams(req.query).toString();
    // Use 307 to preserve method semantics (GET)
    res.redirect(307, `/api/v1/jobs/history${qs ? `?${qs}` : ''}`);
});

app.listen(LISTEN_PORT, () => {
    console.log(`🚀 Portero service listening on port ${LISTEN_PORT}`);
});