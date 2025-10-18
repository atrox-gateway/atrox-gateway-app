// /opt/atrox-gateway/packages/backend/atrox-user-pun/user-server.js

const express = require('express');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');

const app = express();
const socketPath = process.argv[2]; 
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';

const WWW_DATA_GID = 33;

app.use(cookieParser());

function cleanupAndExit() {
    if (fs.existsSync(socketPath)) {
        fs.unlinkSync(socketPath);
        console.log(`Socket ${socketPath} cleaned up.`);
    }
    process.exit(0);
}
process.on('SIGINT', cleanupAndExit);
process.on('SIGTERM', cleanupAndExit);

if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
}

const touchSocketMiddleware = (req, res, next) => {
    // Escucha el evento 'finish' que se dispara cuando la respuesta se ha enviado
    res.on('finish', () => {
        try {
            const now = new Date();
            fs.utimesSync(socketPath, now, now); 
        } catch (err) {
        }
    });
    next(); 
};
app.use(touchSocketMiddleware);


const authenticateToken = (req, res, next) => {
    const token = req.cookies.access_token;
    if (!token) {
        return res.status(401).send('Access Denied: No token provided.');
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).send('Access Forbidden: Invalid token.');
        }

        const processUser = os.userInfo().username;
        if (decoded.sub !== processUser) {
            console.error(`SECURITY ALERT: Process for user '${processUser}' received a token for user '${decoded.sub}'.`);
            return res.status(403).send('Access Forbidden: Token-process mismatch.');
        }

        req.user = decoded;
        next();
    });
};

app.use('/api', authenticateToken);

app.get('/api/whoami', (req, res) => {
    const userInfo = os.userInfo();
    res.json({ username: userInfo.username, uid: userInfo.uid });
});

app.get('/api/files', (req, res) => {
    console.log(`[PUN /api/files] Solicitud recibida. Query path: ${req.query.path}`); // Nuevo log
    const { username } = os.userInfo();
    const basePath = `/hpc_home/${username}`;
    const targetPath = path.resolve(basePath, req.query.path || '');

    console.log(`[PUN /api/files] Base path: ${basePath}, Target path: ${targetPath}`); // Nuevo log

    if (!targetPath.startsWith(basePath)) {
        console.error(`[PUN /api/files] Acceso denegado: ${targetPath} fuera de ${basePath}`); // Nuevo log
        return res.status(403).type('text/plain').send('Access denied: Path is outside of the user\'s home directory.');
    }
    
    fs.readdir(targetPath, { withFileTypes: true }, (err, files) => {
        if (err) {
            console.error(`[PUN /api/files] Error al leer directorio ${targetPath}:`, err); // Nuevo log
            if (err.code === 'ENOENT') {
                return res.status(404).type('text/plain').send('Directory not found.');
            }
            return res.status(500).type('text/plain').send('Error listing files.');
        }
        
        const fileList = files.map(file => {
            return `${file.isDirectory() ? 'd' : '-'} ${file.name}`;
        }).join('\n');

        console.log(`[PUN /api/files] Archivos listados exitosamente en ${targetPath}`); // Nuevo log
        res.type('text/plain').send(fileList);
    });
});

app.use((err, req, res, next) => {
    console.error('[PUN ERROR GLOBAL]:', err.stack);
    res.status(500).send('Internal Server Error');
});

app.listen(socketPath, () => {
    try {
        fs.chownSync(socketPath, process.getuid(), WWW_DATA_GID); 
        fs.chmodSync(socketPath, '660');
        console.log(`✅ PUN initiated and socket permissions set for Nginx: ${socketPath}`);
    } catch (e) {
        console.error("FATAL: Failed to change socket ownership/permissions:", e);
        cleanupAndExit(); 
    }
});