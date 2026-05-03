const lines = [
  "",
  "Build complete. Local stack is ready:",
  "  Admin:    http://localhost:3000",
  "  API:      http://localhost:3001",
  "  API docs: http://localhost:3001/health",
  "  Postgres: localhost:5433",
  "",
  "Useful commands:",
  "  npm run logs",
  "  npm run stop",
  "",
];

for (const line of lines) {
  console.log(line);
}
