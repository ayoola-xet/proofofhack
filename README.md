# ProofOfHack

**Automated, Confidential Bug Bounties & Trustless Exploit Settlement for Web3 Security**

ProofOfHack is a confidential vulnerability submission and automated payout platform for protocol teams and security researchers. It allows protocol teams to escrow fixed bounty funds, receive end-to-end encrypted claim assessments, automatically verify vulnerability proofs, and trustlessly release payouts to whitehat researchers while securely delivering bug reports to protocols upon payout settlement.

---

## 🌟 Key Features

- 🔒 **Confidential Bug Submission**: End-to-end encrypted report transport & storage using libsodium wrappers (`libsodium-wrappers-sumo`). Reports remain withheld from protocols until payout conditions are satisfied.
- ⚡ **Automated Exploit Verification**: Automated verifier microservice evaluates submitted proof-of-exploit payloads against protocol invariant test suites without human bias or manual delay.
- 🏦 **Escrow Treasury & Automated Settlement**: Integrated with Privy server-managed wallets & treasury policies for USDC payout settlement on Arc testnet.
- 📊 **Real-time Subgraph Indexing**: Powered by The Graph for indexing ERC-4626 vault coverage, active bounty programs, protocol TVL, and claim status.
- 🛡️ **AI Vulnerability & Coverage Assistant**: AI-driven analysis for vault coverage, risk rating, and program creation.

---

## 🤝 Partner & Sponsor Integrations

ProofOfHack leverages industry-leading infrastructure from our hackathon sponsors:

### 1. The Graph
- **Usage**: Custom subgraph built in [`packages/erc4626-coverage-data`](packages/erc4626-coverage-data) indexing smart contract events, vault TVL coverage, active bounty programs, and payout history.
- **Evidence / Implementation**: 
  - Manifest & GraphQL Schema: [`packages/erc4626-coverage-data/subgraph.yaml`](packages/erc4626-coverage-data/subgraph.yaml)
  - Data Sources & Mapping: [`packages/erc4626-coverage-data/sources.json`](packages/erc4626-coverage-data/sources.json)

### 2. Arc / Circle (USDC)
- **Usage**: Native settlement currency for protocol bounty escrows and researcher payouts on Arc testnet using USDC.
- **Evidence / Implementation**:
  - Treasury & Funding Service: [`services/treasury/src/fund.ts`](services/treasury/src/fund.ts)
  - Payout Execution: [`packages/privy/src/treasury.ts`](packages/privy/src/treasury.ts)

### 3. Privy
- **Usage**: Server-managed treasury wallets, programmable key authorization policy engine (`provisionTreasury`), and seamless user authentication.
- **Evidence / Implementation**:
  - Provisioning & Policy Rules: [`services/treasury/src/provision.ts`](services/treasury/src/provision.ts)
  - Wallet Authorization & Signing: [`packages/privy/src/funding-authorization.ts`](packages/privy/src/funding-authorization.ts)

---

## 🏗 System Architecture & Workspace Structure

ProofOfHack is structured as a pnpm monorepo:

```
proofofhack/
├── apps/
│   └── web/                   # React 19 + Vite + Tailwind CSS dashboard
├── contracts/                 # Foundry smart contracts (BountyEscrow, VulnerableVault)
├── services/                  # Microservices
│   ├── api/                   # Fastify REST API server & contract routes
│   ├── verifier/              # Exploit verification engine
│   ├── worker/                # Background job queue processing (pg-boss)
│   ├── treasury/              # Privy & Arc payout settlement engine
│   ├── report-release/        # Decryption key release service
│   └── retention/             # Ciphertext retention & cleanup worker
├── packages/                  # Shared libraries
│   ├── database/              # Drizzle ORM schema & PostgreSQL migrations
│   ├── privy/                 # Privy server wallet & treasury client
│   ├── domain/                # Shared TypeScript types & domain models
│   ├── service-config/        # Service environment configurations
│   └── erc4626-coverage-data/ # The Graph subgraph definition & mappings
├── output/
│   └── demo-video/            # Demo video recording (proofofhack-demo.mp4)
└── infra/                     # Docker Compose & container configurations
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v24.16.0` (specified in `.nvmrc`)
- **pnpm**: `v10.32.1`
- **Foundry**: `v1.5.0` (for compiling & testing smart contracts)
- **Docker**: For local PostgreSQL database container

### Setup Instructions

1. **Clone the repository and install dependencies**:
   ```bash
   git clone https://github.com/ayoola-xet/proofofhack.git
   cd proofofhack
   pnpm install --frozen-lockfile
   ```

2. **Configure Environment Variables**:
   ```bash
   cp .env.example .env
   # Update .env with your Privy keys, database settings, and provider URLs
   ```

3. **Start Local Database**:
   ```bash
   docker compose --project-name proofofhack -f infra/compose.yaml up -d --wait
   ```

4. **Run Database Migrations & Setup Keys**:
   ```bash
   pnpm db:migrate
   pnpm setup:keys
   pnpm setup:finding-keys
   ```

5. **Start Development Cluster**:
   ```bash
   pnpm dev
   ```
   This will launch the Web App, API, Verifier, Worker, Treasury, and Report Release services concurrently.
   
6. **Open Dashboard**:
   Navigate to [`http://127.0.0.1:5173`](http://127.0.0.1:5173) in your browser.

---

## 🧪 Testing & Verification

Run the full suite of unit, integration, and smart contract tests:

```bash
# Run smart contract tests with Foundry
pnpm test:contracts

# Run unit tests
pnpm test:unit

# Run full integration test suite (requires Docker Postgres)
pnpm test:integration

# Type check across all packages and services
pnpm typecheck

# Lint codebase with Biome
pnpm lint

# Build web frontend and Graph packages
pnpm build
```

---

## 🎥 Demo & Media

- **Demo Video**: [`output/demo-video/proofofhack-demo.mp4`](output/demo-video/proofofhack-demo.mp4) (~3 min 50 sec walkthrough showing protocol setup, vulnerability submission, automated verification, and settlement).
- **Screenshots Gallery**: See [`project_screenshots.md`](project_screenshots.md) for UI walkthrough visuals.

---

## 📄 License

MIT License. Built for the ETHGlobal Hackathon.
