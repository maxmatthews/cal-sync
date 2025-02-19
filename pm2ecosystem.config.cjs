module.exports = {
	apps: [
		{
			name: "cal-sync",
			script: "./script.js",
			interpreter: "/home/odroid/.nvm/versions/node/v22.13.1/bin/node",

			instances: 1,
			exec_mode: "fork",
			cron_restart: "25 3,6,9,12,15,18,21 * * *",
			watch: false,
			autorestart: false,
			node_args: "--no-warnings=ExperimentalWarning"
		},
	],
};
