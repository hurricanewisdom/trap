module.exports = {
  apps: [
    {
      name: "trap",
      script: "dist/index.js",
      cwd: "/root/trap",
      node_args: "--env-file=.env",
      // 78 = missing/malformed token; restarting won't help until .env is fixed.
      stop_exit_codes: [78],
      max_restarts: 10,
      restart_delay: 5000,
      time: true,
    },
  ],
};
