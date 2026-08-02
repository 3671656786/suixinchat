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
            time: true
        },
            error_file: './logs/qqbot-err.log',
            out_file: './logs/qqbot-out.log',
            time: true
        }
    ]
};