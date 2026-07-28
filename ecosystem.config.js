// ecosystem.config.js
module.exports = {
    apps: [{
        name: 'suixinchat',
        script: './server.js',
        instances: 1,
        exec_mode: 'fork',
        watch: false,
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
            USE_SQLITE_SESSION: 'true'   // ✅ 强制启用
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        log_file: './logs/combined.log',
        time: true,
        max_memory_restart: '500M',
        kill_timeout: 10000,
        listen_timeout: 5000
    }]
};