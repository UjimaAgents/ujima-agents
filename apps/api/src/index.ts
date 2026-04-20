import chalk from "chalk";
import { createServer } from "./server.ts";

const STARTUP_SPLASH = `
   █  █   █ █ █▀▄▀█ █▀█
   █  █   █ █ █ ▀ █ █▀█
   ▀▀▀  ▀▀▀ ▀ ▀   ▀ ▀ ▀
   A G E N T S
`;

async function main() {
  console.log(chalk.blue(STARTUP_SPLASH));
  console.log(chalk.gray(`   Starting API Server...`));

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);
  const host = process.env.UJIMA_HOST ?? "0.0.0.0";
  const server = await createServer();

  try {
    await server.listen({ port, host });
    
    console.log(chalk.green(`\n   🚀 System Ready`));
    console.log(chalk.gray(`   Listening on: `) + chalk.cyan.underline(`http://${host}:${port}`));
    console.log(chalk.gray(`   Health Check: `) + chalk.dim(`http://${host}:${port}/health\n`));
  } catch (error) {
    server.log.error(error);
    process.exit(1);
  }
}

main();

