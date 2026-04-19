import { createServer } from "./server.ts";

async function main() {
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.UJIMA_HOST ?? "127.0.0.1";
  const server = await createServer();

  try {
    await server.listen({ port, host });
    server.log.info(`Server listening on http://${host}:${port}`);
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

main();

