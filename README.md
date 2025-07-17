# Deploy CLI

A robust Blue-Green deployment CLI tool with rollback and instant rollback support. Designed for zero-downtime deployments, easy rollbacks, and seamless integration into CI/CD pipelines.

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Deployment](#deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Deploy CLI** enables blue-green deployments for your applications, allowing you to switch traffic between two environments (blue and green) with minimal downtime. It supports instant rollback, health checks, and integrates with Docker Compose for container orchestration.

---

## Features

- Blue-Green deployment strategy
- Instant rollback support
- Health checks for services
- Docker Compose integration
- CLI commands for deployment and rollback
- TypeScript support
- Extensible and configurable

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+ recommended)
- [npm](https://www.npmjs.com/) or [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) (for container deployments)

### Install via npm

```sh
npm install -g deploy
```

Or clone and build locally:

```sh
git clone https://github.com/Himasnhu-AT/deploy.git
cd deploy
npm install
npm run build
npm link
```

---

## Usage

### CLI Command Reference

When you run `deploy` in your terminal, you'll see:

```
Usage: bluegreen [options] [command]

Blue‑Green deploy CLI with rollback

Options:
  -V, --version       output the version number
  -h, --help          display help for command

Commands:
  init [options]      Bootstrap .deployer settings and sample compose/Dockerfile
  deploy [options]    Build new colour, verify health, switch traffic
  rollback [options]  Rollback to previous healthy release
  cleanup [options]   Remove corrupted image backups and clean up old files
  status              Show current deployment status and history
  help [command]      display help for command
```

#### Example Usage

- **Show help**
  ```sh
  deploy --help
  ```

- **Initialize deployment settings**
  ```sh
  deploy init
  ```

- **Deploy new version**
  ```sh
  deploy deploy
  ```

- **Rollback to previous release**
  ```sh
  deploy rollback
  ```

- **Cleanup old backups**
  ```sh
  deploy cleanup
  ```

- **Show deployment status**
  ```sh
  deploy status
  ```

- **Build TypeScript**
  ```sh
  npm run build
  ```

- **Start CLI**
  ```sh
  npm start
  ```

### TypeScript

Modify `tsconfig.json` for custom TypeScript settings.

---

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

For issues and suggestions, use the [GitHub Issues](https://github.com/Himasnhu-AT/deploy/issues) page.

---

## License

MIT © Himanshu

---
