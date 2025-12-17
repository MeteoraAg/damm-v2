# cpi-example-damm-v2

Anchor + TypeScript test project that initializes a Meteora DAMM v2 pool via CPI on **Solana devnet**.

## Program

- Program name: `cpi_example_damm_v2`
- Program ID (devnet): `FEa6XcabmRuJtMpQSfKqvf1YKD2Y4V1ndt1YyR38gV6`

## Prerequisites

- Node.js (LTS recommended)
- Yarn (this repo uses Yarn via Anchor)
- Rust toolchain (stable)
- Solana CLI
- Anchor CLI (recommended: `0.32.x` to match `@coral-xyz/anchor ^0.32.1`)

### Install JS dependencies

```bash
yarn install
```

## Devnet setup

This repo is configured to run against **devnet**.

1. Point Solana CLI to devnet:

```bash
solana config set --url https://api.devnet.solana.com
```

2. Ensure you have a keypair and it’s funded:

```bash
solana config set --keypair ~/.config/solana/id.json
solana airdrop 2
solana balance
```

3. (Optional but explicit) Set Anchor env vars used by `AnchorProvider.env()`:

```bash
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
export ANCHOR_WALLET=~/.config/solana/id.json
```

## Build

```bash
anchor build
```

## Test the already-deployed devnet program

This repository is set up to run tests against **devnet** and call the program that is already deployed there.

1. Install TypeScript dependencies:

```bash
yarn install
```

2. Build the program (generates `target/idl/*` and `target/types/*` used by tests):

```bash
anchor build
```

3. Run tests against devnet (recommended):

```bash
anchor test --skip-build --skip-deploy
```

## Run tests

Note: there is **no** `yarn test` script in `package.json`. Tests are run via Anchor’s `[scripts].test` defined in `Anchor.toml` (uses `ts-mocha`).

### Run the full test suite (recommended)

This runs the TypeScript tests against devnet:

```bash
anchor test --skip-build --skip-deploy
```

### Run only the DAMM v2 test file

```bash
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/damm_v2.test.ts
```

## Deploy your own CPI program (to build your own caller)

If you want to create your own program that performs CPI into Meteora DAMM v2, the typical flow is:

1. Make sure you are on devnet and funded:

```bash
solana config set --url https://api.devnet.solana.com
solana airdrop 2
```

2. Ensure the program ID is consistent everywhere:

- `declare_id!("...")` in the Rust program
- `[programs.devnet]` in `Anchor.toml`

If you change keys, run:

```bash
anchor keys sync
```

3. Build and deploy:

```bash
anchor build
anchor deploy
```

4. After deploying, update the Program ID shown in this README (and keep `Anchor.toml` in sync).

5. Re-run tests:

```bash
anchor test --skip-build --skip-deploy
```

## Troubleshooting

- **Insufficient SOL**: the test creates mints/ATAs and sends transactions; run `solana airdrop 2`.
- **Wrong cluster**: confirm `solana config get` and/or `ANCHOR_PROVIDER_URL` is devnet.
- **Meteora DAMM v2 dependencies**: the test calls `cpAmm.getAllConfigs()` and initializes a pool via CPI; this requires the relevant Meteora programs/configs to exist on devnet.
