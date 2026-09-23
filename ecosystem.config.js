module.exports = {
  apps: [
    {
      name: "Wira_Server",
      script: "./Wira/index.js",
      cwd: "/root/home/WIRA",
      env: 
      {
        PORT: 5000,
        NODE_ENV: "production",
      },
    },
    {
      name: "Wira_Call_Server",
      script: "./Wira-Call/index.js",
      cwd: "/root/home/WIRA",
      env: 
      {
        PORT: 5001,
        NODE_ENV: "production",
      },
    },
    {
      name: "Wira_Call_Socket_Server",
      script: "./Wira-Call-Socket/index.js",
      cwd: "/root/home/WIRA",
      env: 
      {
        PORT: 5002,
        NODE_ENV: "production",
      },
    },
  ],
};