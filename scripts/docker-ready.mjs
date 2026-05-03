const lines = [
  "",
  "Build complete. Local stack is ready:",
  "  Admin:    http://localhost:3000",
  "  API:      http://localhost:3001",
  "  API docs: http://localhost:3001/health",
  "  Postgres: localhost:5432",
  "",
  "Useful commands:",
  "  npm run docker:logs",
  "  npm run docker:down",
  "",
];

for (const line of lines) {
  console.log(line);
}
