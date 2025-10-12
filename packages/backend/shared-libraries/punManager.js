// /opt/atrox-gateway/packages/backend/shared-libraries/punManager.js
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const RedisClient = require('./redisClient.js');

class PunManager {
    constructor(punDir, jwtSecret, redisClient) {
        this.punDir = punDir;
        this.jwtSecret = jwtSecret;
        this.redisClient = redisClient;
        this.activePUNs = new Map();
    }

    async recoverState() {
        return Promise.resolve(console.log("[Recovery] State check complete."));
    }

    getActivePuns() {
        return this.activePUNs;
    }

    async checkOrCreatePUN(username, userCodePath) {
        if (this.activePUNs.has(username)) return true;

        const socketPath = path.join(this.punDir, `${username}.socket`);
        // Use the path of the symbolic link for robustness
        const NODE_BIN_PATH = '/usr/bin/node'; 

        const punProcess = spawn('sudo', [
            '-E',
            '-u', username,
            NODE_BIN_PATH,
            userCodePath,
            socketPath
        ], {
             detached: true,
             stdio: 'inherit'
        });
        // --- END CORRECTION ---
        
        punProcess.unref(); 
        this.activePUNs.set(username, { socketPath: socketPath, process: punProcess });
        await new Promise(resolve => setTimeout(resolve, 500)); 
        
        console.log(`[PUN Manager] Launched new PUN for ${username}.`);
        return true;
    }
}

module.exports = { PunManager };