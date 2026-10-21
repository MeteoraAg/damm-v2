/**
 * Helpers for the external access-registry program, which owns the TokenBadge accounts
 * cp-amm accepts in `validate_mint`.
 *
 * `tests/fixtures/access_registry.so` and `access_registry.ts` are built from
 * https://github.com/MeteoraAg/access-registry with:
 *
 *   anchor build --ignore-keys -- --features local
 *
 * The `local` feature drops the hardcoded admin check so tests can create
 * operators. The IDL it emits is byte-identical to `idls/access_registry.json`,
 * which the Rust build consumes through `declare_program!`.
 */
import { AnchorProvider, BN, Program, Wallet } from "@anchor-lang/core";
import {
  clusterApiUrl,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import { LiteSVM, TransactionMetadata } from "litesvm";
import AccessRegistryIDL from "../../idls/access_registry.json";
import { AccessRegistry } from "../fixtures/access_registry";
import CpAmmIDL from "../../target/idl/cp_amm.json";
import { CP_AMM_PROGRAM_ID } from "./constants";
import { sendTransaction } from "./svm";

export const ACCESS_REGISTRY_PROGRAM_ID = new PublicKey(
  AccessRegistryIDL.address
);

// access-registry keeps its own permission set, unrelated to cp-amm's.
export enum AccessRegistryOperatorPermission {
  CreateTokenBadge = 0,
  CloseTokenBadge = 1,
}

export function createAccessRegistryProgram(): Program<AccessRegistry> {
  const wallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(
    new Connection(clusterApiUrl("devnet")),
    wallet,
    {}
  );
  return new Program<AccessRegistry>(
    AccessRegistryIDL as AccessRegistry,
    provider
  );
}

export function deriveAccessRegistryOperator(
  whitelistedAddress: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("operator"), whitelistedAddress.toBuffer()],
    ACCESS_REGISTRY_PROGRAM_ID
  )[0];
}

export function deriveAccessRegistryTokenBadge(
  tokenMint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("token_badge"), tokenMint.toBuffer()],
    ACCESS_REGISTRY_PROGRAM_ID
  )[0];
}

export async function createAccessRegistryOperator(
  svm: LiteSVM,
  admin: Keypair,
  whitelistedAddress: PublicKey,
  permissions: AccessRegistryOperatorPermission[]
): Promise<PublicKey> {
  const program = createAccessRegistryProgram();
  const operator = deriveAccessRegistryOperator(whitelistedAddress);
  const permission = new BN(permissions.reduce((acc, p) => acc | (1 << p), 0));

  const transaction = await program.methods
    .createOperatorAccount(permission)
    .accountsPartial({
      operator,
      whitelistedAddress,
      signer: admin.publicKey,
      payer: admin.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [admin]);
  expect(result).instanceOf(TransactionMetadata);
  return operator;
}

export async function createAccessRegistryTokenBadge(
  svm: LiteSVM,
  operator: Keypair,
  tokenMint: PublicKey,
  mintScore = 0
): Promise<PublicKey> {
  const program = createAccessRegistryProgram();
  const tokenBadge = deriveAccessRegistryTokenBadge(tokenMint);

  const transaction = await program.methods
    .createTokenBadge(mintScore)
    .accountsPartial({
      tokenBadge,
      tokenMint,
      operator: deriveAccessRegistryOperator(operator.publicKey),
      signer: operator.publicKey,
      payer: operator.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const result = sendTransaction(svm, transaction, [operator]);
  expect(result).instanceOf(TransactionMetadata);
  return tokenBadge;
}

/**
 * Writes a legacy cp-amm TokenBadge straight into the SVM, since `create_token_badge`
 * is deprecated. Layout: discriminator, token_mint, 128 bytes of padding.
 */
export function setLegacyTokenBadge(
  svm: LiteSVM,
  tokenBadge: PublicKey,
  tokenMint: PublicKey,
  owner: PublicKey = CP_AMM_PROGRAM_ID
) {
  const discriminator = CpAmmIDL.accounts.find(
    (a) => a.name === "TokenBadge"
  )!.discriminator;
  const data = Buffer.alloc(8 + 32 + 128);
  Buffer.from(discriminator).copy(data, 0);
  tokenMint.toBuffer().copy(data, 8);

  svm.setAccount(tokenBadge, {
    data,
    executable: false,
    lamports: Number(svm.minimumBalanceForRentExemption(BigInt(data.length))),
    owner,
  });
}
