#!/usr/bin/env node
import { Command } from "commander";
import fs from "fs-extra";
import path from "node:path";
import { execSync, ExecSyncOptions } from "node:child_process";
import chalk from "chalk";
import readline from "node:readline/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";

//-------------------------------------------------------------
// Helpers
//-------------------------------------------------------------

function log(...msg: any[]) {
  /* eslint-disable no-console */
  console.log(chalk.gray("[bluegreen]"), ...msg);
}

function fatal(message: string, code = 1): never {
  console.error(chalk.red(message));
  process.exit(code);
}

function exec(cmd: string, opts: ExecSyncOptions & { quiet?: boolean } = {}) {
  log(`$ ${cmd}`);
  try {
    const result = execSync(cmd, {
      stdio: opts.quiet ? "pipe" : "inherit",
      encoding: "utf8",
      ...opts,
    });
    // If stdio is 'inherit', result is null
    return result == null ? "" : result.toString().trim();
  } catch (e: any) {
    if (!opts.quiet) {
      console.error(chalk.red("✗ Command failed: " + cmd));
      if (e.stdout) process.stdout.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
    }
    throw e;
  }
}

async function prompt(question: string, def = ""): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ans =
    (await rl.question(`${question}${def ? ` (${def})` : ""}: `)) || def;
  rl.close();
  return ans;
}

//-------------------------------------------------------------
// Constants & paths
//-------------------------------------------------------------

const PROJECT_ROOT = process.cwd();
const DEPLOYER_DIR = path.join(PROJECT_ROOT, ".deployer");
const CONFIG_PATH = path.join(DEPLOYER_DIR, "config.json");
const IMAGES_DIR = path.join(DEPLOYER_DIR, "images");

//-------------------------------------------------------------
// Types & runtime validation
//-------------------------------------------------------------

type Colour = "blue" | "green";

interface DeployerConfig {
  /** currently live colour */
  colour: Colour;
  /** previous deployments */
  history: Array<{
    tag: string; // e.g. blue‑a1b2c3
    colour: Colour;
    commit: string;
    savedImage?: string; // local tar path
  }>;
  health: {
    baseURL: string; // without trailing slash e.g. http://localhost
    port: number;
    path: string; // with leading /
    intervalMs?: number; // default 2_000
    maxAttempts?: number; // default 15
  };
}

function defaultConfig(): DeployerConfig {
  return {
    colour: "blue",
    history: [],
    health: {
      baseURL: "http://localhost",
      port: 4000,
      path: "/health",
    },
  };
}

function readConfig(): DeployerConfig {
  if (!fs.existsSync(CONFIG_PATH)) return defaultConfig();
  const raw = fs.readJsonSync(CONFIG_PATH, { throws: false });
  return { ...defaultConfig(), ...raw };
}

function writeConfig(cfg: DeployerConfig) {
  fs.ensureDirSync(DEPLOYER_DIR);
  fs.writeJsonSync(CONFIG_PATH, cfg, { spaces: 2 });
}

//-------------------------------------------------------------
// Docker helpers
//-------------------------------------------------------------

function dockerCmd(): string {
  // support docker compose v2 plugin and standalone binary
  try {
    exec("docker compose version", { quiet: true });
    return "docker compose";
  } catch {
    try {
      exec("docker-compose --version", { quiet: true });
      return "docker-compose";
    } catch {
      fatal("Docker Compose not found – please install Docker.");
    }
  }
}

function compose(file: string, cmd: string) {
  const base = dockerCmd();
  return exec(`${base} -f ${file} ${cmd}`);
}

function getImageName(colour: Colour): string {
  // Docker Compose creates images with project name prefix
  const projectName = path.basename(PROJECT_ROOT);
  return `${projectName}-${colour}`;
}

function gitShortSha() {
  try {
    return exec("git rev-parse --short HEAD", { quiet: true });
  } catch {
    // not a git repo – fallback to timestamp
    return Date.now().toString();
  }
}

function nextColour(c: Colour): Colour {
  return c === "blue" ? "green" : "blue";
}

function imageTag(colour: Colour) {
  return `${colour}-${gitShortSha()}`;
}

async function waitForHealthy(
  container: string,
  health: DeployerConfig["health"],
): Promise<void> {
  const attempts = health.maxAttempts ?? 15;
  const interval = health.intervalMs ?? 2_000;
  for (let i = 1; i <= attempts; i++) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const status = exec(
        `docker inspect -f '{{.State.Health.Status}}' ${container}`,
        { quiet: true },
      );
      if (status === "healthy") return;
      log(`${container} status: ${status} (${i}/${attempts})`);
    } catch {
      log(`Waiting for container ${container}... (${i}/${attempts})`);
    }
  }
  fatal(
    `Container ${container} failed health checks after ${attempts} attempts`,
  );
}

//-------------------------------------------------------------
// CLI
//-------------------------------------------------------------

const program = new Command("bluegreen").description(
  "Blue‑Green deploy CLI with rollback",
);

//-------------------------------------------------------------
// init
//-------------------------------------------------------------
program
  .command("init")
  .description("Bootstrap .deployer settings and sample compose/Dockerfile")
  .option("--force", "overwrite existing files")
  .action(async (opts) => {
    fs.ensureDirSync(DEPLOYER_DIR);
    fs.ensureDirSync(IMAGES_DIR);

    // 1. Dockerfile
    const dockerfile = path.join(PROJECT_ROOT, "Dockerfile");
    if (!fs.existsSync(dockerfile) || opts.force) {
      fs.writeFileSync(
        dockerfile,
        `FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
EXPOSE 4000
CMD [\"node\", \"dist/main.js\"]`,
      );
      log(chalk.green("✓ Dockerfile ready"));
    }

    // 2. docker-compose.deployer.yaml
    const composeFile = path.join(PROJECT_ROOT, "docker-compose.deployer.yaml");
    const defaultComposeYaml = `version: "3.8"

services:
  blue:
    container_name: blue
    profiles: [blue]
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    expose:
      - "4000:4000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 20s
      timeout: 5s
      retries: 3
      start_period: 5s
    networks:
      - deploynet

  green:
    container_name: green
    profiles: [green]
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    expose:
      - "4000:4000"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4000/health"]
      interval: 20s
      timeout: 5s
      retries: 3
      start_period: 5s
    networks:
      - deploynet

  app:
    image: nginx:1.27-alpine
    container_name: app
    profiles: [blue, green]
    ports:
      - "80:80"
    volumes:
      - ./.deployer/default.conf:/etc/nginx/conf.d/default.conf:ro
      - ./.deployer/active_backend.conf:/etc/nginx/conf.d/active_backend.conf:ro
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
    networks:
      - deploynet

networks:
  deploynet:
    driver: bridge
`;

    if (!fs.existsSync(composeFile) || opts.force) {
      fs.writeFileSync(composeFile, defaultComposeYaml);
      log(chalk.green("✓ compose file ready"));
    }

    // 3. nginx default
    const defaultConf = path.join(DEPLOYER_DIR, "default.conf");
    const defaultConfContent = `server {
    listen 80;
    server_name _;

    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log;

    location / {
        proxy_pass http://app_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
`;
    if (!fs.existsSync(defaultConf) || opts.force) {
      fs.writeFileSync(defaultConf, defaultConfContent);
      log(chalk.green("✓ nginx default.conf ready"));
    }

    // 4. nginx active_backend.conf (initialize with default backend)
    const activeBackendConf = path.join(DEPLOYER_DIR, "active_backend.conf");
    if (!fs.existsSync(activeBackendConf) || opts.force) {
      // Default to blue backend on init
      fs.writeFileSync(
        activeBackendConf,
        "upstream app_backend { server blue:4000; }\n",
      );
      log(chalk.green("✓ nginx active_backend.conf ready"));
    }

    // 4. interactive health config
    let cfg = readConfig();
    if (!cfg.health) cfg.health = defaultConfig().health;

    cfg.health.baseURL = await prompt("Health base URL", cfg.health.baseURL);
    cfg.health.port = parseInt(
      await prompt("Port", String(cfg.health.port)),
      10,
    );
    cfg.health.path = await prompt("Path", cfg.health.path);

    writeConfig(cfg);
    console.log(chalk.green.bold("Project initialised"));
  });

//-------------------------------------------------------------
// deploy
//-------------------------------------------------------------
program
  .command("deploy")
  .description("Build new colour, verify health, switch traffic")
  .option("--skip-build", "Reuse existing image")
  .option("--dry-run", "Print actions without executing")
  .action(async (opts) => {
    const cfg = readConfig();
    const composeFile = path.join(PROJECT_ROOT, "docker-compose.deployer.yaml");
    if (!fs.existsSync(composeFile))
      fatal("Compose file missing – run bluegreen init");

    const current = cfg.colour;
    const next = nextColour(current);
    const tag = imageTag(next);

    const run = (cmd: string) => {
      if (opts.dryRun) return console.log(chalk.yellow("(dry)") + " " + cmd);
      return compose(composeFile, cmd);
    };

    if (!opts.skipBuild) {
      run(`build ${next}`);
    }

    run(`up -d --force-recreate app ${next}`);
    await waitForHealthy(next, cfg.health);

    // switch nginx
    fs.writeFileSync(
      path.join(DEPLOYER_DIR, "active_backend.conf"),
      `upstream app_backend { server ${next}:4000; }\n`,
    );
    run(`exec app nginx -s reload`);

    // save old image for rollback
    const tarPath = path.join(IMAGES_DIR, `${current}-${Date.now()}.tar.gz`);
    if (!opts.skipBuild && !opts.dryRun) {
      const imageName = getImageName(current);
      try {
        exec(`docker save ${imageName} | gzip > ${tarPath}`);
        cfg.history.push({
          colour: current,
          tag: `${current}-${gitShortSha()}`,
          commit: gitShortSha(),
          savedImage: tarPath,
        });
        log(chalk.green(`✓ Saved ${imageName} to ${tarPath}`));
      } catch (error) {
        log(
          chalk.yellow(
            `⚠ Failed to save image ${imageName}, continuing without backup`,
          ),
        );
      }
    }

    // stop old
    run(`stop ${current}`);

    cfg.colour = next;
    writeConfig(cfg);
    console.log(chalk.green.bold(`✓ deployed → ${next}`));
  });

//-------------------------------------------------------------
// rollback
//-------------------------------------------------------------
program
  .command("rollback")
  .description("Rollback to previous healthy release")
  .option("--dry-run", "Show actions without executing")
  .action(async (opts) => {
    const cfg = readConfig();
    if (cfg.history.length === 0) fatal("No history to rollback to");
    const last = cfg.history[cfg.history.length - 1];
    const current = cfg.colour;

    const composeFile = path.join(PROJECT_ROOT, "docker-compose.deployer.yaml");
    const run = (cmd: string) => {
      if (opts.dryRun) return console.log(chalk.yellow("(dry)") + " " + cmd);
      return compose(composeFile, cmd);
    };

    if (last.savedImage && fs.existsSync(last.savedImage) && !opts.dryRun) {
      try {
        log(`Loading image from ${last.savedImage}`);
        exec(`gunzip -c ${last.savedImage} | docker load`);
        log(chalk.green(`✓ Loaded image from ${last.savedImage}`));
      } catch (error) {
        log(chalk.yellow(`⚠ Failed to load saved image, will try to rebuild`));
        // If loading fails, try to rebuild the image
        run(`build ${last.colour}`);
      }
    } else if (!opts.dryRun) {
      // No saved image, rebuild
      log(`No saved image found, rebuilding ${last.colour}`);
      run(`build ${last.colour}`);
    }

    run(`up -d --force-recreate app ${last.colour}`);
    await waitForHealthy(last.colour, cfg.health);

    // switch nginx
    fs.writeFileSync(
      path.join(DEPLOYER_DIR, "active_backend.conf"),
      `upstream app_backend { server ${last.colour}:4000; }\n`,
    );
    run(`exec app nginx -s reload`);

    run(`stop ${current}`);

    cfg.colour = last.colour;
    cfg.history.pop();
    writeConfig(cfg);
    console.log(chalk.yellow("Rollback complete → " + last.colour));
  });

//-------------------------------------------------------------
// cleanup
//-------------------------------------------------------------
program
  .command("cleanup")
  .description("Remove corrupted image backups and clean up old files")
  .option("--dry-run", "Show actions without executing")
  .action(async (opts) => {
    const cfg = readConfig();

    const run = (cmd: string) => {
      if (opts.dryRun) return console.log(chalk.yellow("(dry)") + " " + cmd);
      return exec(cmd);
    };

    if (!fs.existsSync(IMAGES_DIR)) {
      log("No images directory found");
      return;
    }

    const files = fs.readdirSync(IMAGES_DIR);
    let removedCount = 0;

    for (const file of files) {
      const filePath = path.join(IMAGES_DIR, file);
      if (!file.endsWith(".tar.gz")) continue;

      try {
        // Test if the gzipped tar file is valid
        if (!opts.dryRun) {
          exec(`gunzip -t ${filePath}`, { quiet: true });
          exec(`gunzip -c ${filePath} | tar -t > /dev/null`, { quiet: true });
        }
        log(chalk.green(`✓ ${file} is valid`));
      } catch {
        log(chalk.yellow(`✗ ${file} is corrupted, removing`));
        if (!opts.dryRun) {
          fs.removeSync(filePath);
        }
        removedCount++;
      }
    }

    // Clean up history entries that reference removed files
    if (!opts.dryRun && removedCount > 0) {
      cfg.history = cfg.history.filter((entry) => {
        if (entry.savedImage && !fs.existsSync(entry.savedImage)) {
          log(
            chalk.yellow(
              `Removing history entry for missing image: ${entry.savedImage}`,
            ),
          );
          return false;
        }
        return true;
      });
      writeConfig(cfg);
    }

    console.log(
      chalk.green(
        `✓ Cleanup complete. Removed ${removedCount} corrupted files`,
      ),
    );
  });

//-------------------------------------------------------------
// status
//-------------------------------------------------------------
program
  .command("status")
  .description("Show current deployment status and history")
  .action(async () => {
    const cfg = readConfig();
    const composeFile = path.join(PROJECT_ROOT, "docker-compose.deployer.yaml");

    console.log(chalk.blue.bold("=== Deployment Status ==="));
    console.log(`Current active colour: ${chalk.green(cfg.colour)}`);
    console.log(`Config file: ${CONFIG_PATH}`);
    console.log(`Compose file: ${composeFile}`);

    // Check if compose file exists
    if (!fs.existsSync(composeFile)) {
      console.log(chalk.red("✗ Compose file missing - run 'bluegreen init'"));
      return;
    }

    // Check Docker images
    console.log(chalk.blue("\n=== Docker Images ==="));
    try {
      const images = exec(
        "docker images --format 'table {{.Repository}}\t{{.Tag}}\t{{.Size}}'",
        { quiet: true },
      );
      const lines = images.split("\n");
      const projectName = path.basename(PROJECT_ROOT);

      for (const line of lines) {
        if (
          line.includes(`${projectName}-blue`) ||
          line.includes(`${projectName}-green`)
        ) {
          console.log(line);
        }
      }
    } catch {
      console.log(chalk.yellow("⚠ Could not list Docker images"));
    }

    // Check running containers
    console.log(chalk.blue("\n=== Running Containers ==="));
    try {
      const containers = exec(
        "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
        { quiet: true },
      );
      const lines = containers.split("\n");

      for (const line of lines) {
        if (
          line.includes("blue") ||
          line.includes("green") ||
          line.includes("app")
        ) {
          console.log(line);
        }
      }
    } catch {
      console.log(chalk.yellow("⚠ Could not list running containers"));
    }

    // Show history
    console.log(chalk.blue("\n=== Deployment History ==="));
    if (cfg.history.length === 0) {
      console.log("No deployment history");
    } else {
      console.log(`${cfg.history.length} previous deployments:`);
      cfg.history.slice(-5).forEach((entry, i) => {
        const status =
          entry.savedImage && fs.existsSync(entry.savedImage)
            ? chalk.green("✓")
            : chalk.red("✗");
        console.log(
          `  ${status} ${entry.colour} (${entry.commit}) - ${entry.tag}`,
        );
        if (entry.savedImage) {
          console.log(`    Image: ${entry.savedImage}`);
        }
      });
    }

    // Show health config
    console.log(chalk.blue("\n=== Health Check Config ==="));
    console.log(
      `URL: ${cfg.health.baseURL}:${cfg.health.port}${cfg.health.path}`,
    );
    console.log(`Interval: ${cfg.health.intervalMs ?? 2000}ms`);
    console.log(`Max attempts: ${cfg.health.maxAttempts ?? 15}`);

    // Check nginx config
    console.log(chalk.blue("\n=== Nginx Config ==="));
    const activeBackendConf = path.join(DEPLOYER_DIR, "active_backend.conf");
    if (fs.existsSync(activeBackendConf)) {
      const content = fs.readFileSync(activeBackendConf, "utf8");
      console.log(content.trim());
    } else {
      console.log(chalk.red("✗ active_backend.conf not found"));
    }
  });

//-------------------------------------------------------------
// parse
//-------------------------------------------------------------
program.version("0.0.1").parse();
