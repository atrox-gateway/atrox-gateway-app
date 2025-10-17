// /opt/atrox-gateway/packages/backend/atrox-admin-service/server.js

const express = require('express');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = process.env.JWT_SECRET_KEY || 'insecure_default_secret';
const LISTEN_PORT = process.env.PORT || 3001;

function authenticateAdmin(req, res, next) {
    // --- LÍNEA CORREGIDA ---
    const token = req.cookies.access_token; // Leer la cookie correcta
    // --- FIN DE LA CORRECCIÓN ---

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

app.get('/status', (req, res) => {
    const { execSync } = require('child_process');
    const user = execSync('whoami').toString().trim();
    res.json({ message: 'Admin service active.', user: user, port: LISTEN_PORT });
});

app.post('/admin/create-user', authenticateAdmin, (req, res) => {
    const { newUsername, initialPassword } = req.body;

    if (!newUsername || !initialPassword) {
        return res.status(400).json({ message: 'Username and password are required.' });
    }

    const SCRIPT_PATH = path.join(__dirname, '..', '..', '..', 'scripts', 'manage_user.sh');
    
    const child = spawn('sudo', [SCRIPT_PATH, 'create', newUsername, initialPassword], { stdio: 'inherit' });

    child.on('close', (code) => {
        if (code === 0) {
            return res.json({ message: `User ${newUsername} created successfully.` });
        } else {
            console.error(`ERROR: User creation failed with code ${code}. Check /etc/sudoers.d/`);
            return res.status(500).json({ message: 'Error executing user creation script. Check server logs.' });
        }
    });
});

app.listen(LISTEN_PORT, () => {
    console.log(`🛡️ Admin service listening on port ${LISTEN_PORT}`);
});