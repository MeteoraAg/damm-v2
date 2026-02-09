# cpi-example-damm-v2

Anchor + TypeScript test project that initializes a Meteora DAMM v2 pool via CPI on **Solana devnet/mainnet**.

## Program

- Program name: `cpi_example_damm_v2`
- Program ID (devnet): `FEa6XcabmRuJtMpQSfKqvf1YKD2Y4V1ndt1YyR38gV6`
- Program ID (mainnet): your deployed program ID

## Prerequisites

- Node.js (LTS recommended)
- Yarn (this repo uses Yarn via Anchor)
- Rust toolchain (stable)
- Solana CLI
- Anchor CLI (recommended: `0.32.x` to match `@coral-xyz/anchor ^0.32.1`)

Required Rust dependencies for the CPI caller program:

- Add `anchor-spl` to your program `Cargo.toml` (use a version compatible with your `anchor-lang` version).
- Add `bytemuck` with the `derive` feature to your program `Cargo.toml`. Use the latest `bytemuck` version.

```bash
cargo add anchor-spl
cargo add bytemuck --features derive
```

Cargo.toml (example):

```toml
[dependencies]
# other dependencies...
anchor-spl = "0.32.1" # match your anchor-lang version
bytemuck = { version = "1.24.0", features = ["derive"] } # tested version
```

### Install JS dependencies

```bash
yarn install
```

## Devnet/Mainnet setup

This repo is configured to run against **devnet** by default. Mainnet is an advanced setup.

Note: the tests have only been validated on **devnet** so far.

1. Point Solana CLI to the desired cluster:

```bash
# Devnet (default)
solana config set --url https://api.devnet.solana.com

# Mainnet (advanced)
solana config set --url https://api.mainnet-beta.solana.com
```

2. Ensure you have a keypair and it’s funded:

```bash
solana config set --keypair ~/.config/solana/id.json

# Devnet only
solana airdrop 2

# Devnet or mainnet
solana balance
```

3. (Optional but explicit) Set Anchor env vars used by `AnchorProvider.env()`:

```bash
# Devnet (default)
export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com

# Mainnet (advanced). Note: Anchor calls mainnet `mainnet-beta`.
# export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com

export ANCHOR_WALLET=~/.config/solana/id.json
```

4. (Mainnet only) Ensure `Anchor.toml` is configured for mainnet:

- Set `[provider] cluster = "mainnet-beta"`
- Add a program mapping under `[programs.mainnet]` for your deployed program ID

## Build

```bash
anchor build
```

## Test the already-deployed program (devnet/mainnet)

This repository is set up to run tests against the configured cluster (devnet by default) and call the program that is already deployed there.

1. Install TypeScript dependencies:

```bash
yarn install
```

2. Build the program (generates `target/idl/*` and `target/types/*` used by tests):

```bash
anchor build
```

3. Run tests:

```bash
anchor test --skip-build --skip-deploy
```

## Run tests

Note: there is **no** `yarn test` script in `package.json`. Tests are run via Anchor’s `[scripts].test` defined in `Anchor.toml` (uses `ts-mocha`).

### Run the full test suite (recommended)

This runs the TypeScript tests against the configured cluster (devnet by default):

```bash
anchor test --skip-build --skip-deploy
```

### Run only the DAMM v2 test file

```bash
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/damm_v2.test.ts
```

## Deploy your own CPI program (to build your own caller)

If you want to create your own program that performs CPI into Meteora DAMM v2, the typical flow is:

1. Make sure you are on the desired cluster and funded:

```bash
# Devnet
solana config set --url https://api.devnet.solana.com
solana airdrop 2

# Mainnet (advanced)
solana config set --url https://api.mainnet-beta.solana.com
```

2. Ensure the program ID is consistent everywhere:

- `declare_id!("...")` in the Rust program
- `[programs.devnet]` or `[programs.mainnet]` in `Anchor.toml` (depending on cluster)

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

- **Insufficient SOL**: the test creates mints/ATAs and sends transactions. `solana airdrop 2` works on devnet only; on mainnet you must fund the wallet with real SOL.
- **Wrong cluster**: confirm `solana config get` and/or `ANCHOR_PROVIDER_URL` matches your selected cluster.
- **Meteora DAMM v2 dependencies**: the test calls `cpAmm.getAllConfigs()` and initializes a pool via CPI; this requires the relevant Meteora programs/configs to exist on your selected cluster.
