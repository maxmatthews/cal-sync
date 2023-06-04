module.exports = {
	apps: [
		{
			name: "cal-sync",
			script: "./script.js",

			instances: 1,
			exec_mode: "fork",
			cron_restart: "* 0/3 * * *",
			watch: false,
			autorestart: false,
			node_args: "--no-warnings=ExperimentalWarning"
		},
	],
};
