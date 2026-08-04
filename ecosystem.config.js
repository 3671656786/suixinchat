// ecosystem.config.js
module.exports = {
    apps: [
        {
            name: 'suixinchat',
            script: './server.js',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            env: {
                NODE_ENV: 'production',
                PORT: 3000
            },
            error_file: './logs/err.log',
            out_file: './logs/out.log',
            log_file: './logs/combined.log',
            time: true,
            // 自动重启配置
            max_memory_restart: '500M',
            min_uptime: '10s',
            max_restarts: 10,
            restart_delay: 4000
        }
    ]
};