#!/usr/bin/env bash
# Local chain with the Proof of Ant program preloaded.
set -euo pipefail
cd "$(dirname "$0")/.."
PROGRAM_ID=$(solana address -k target/deploy/proof_of_ant-keypair.json)
exec solana-test-validator --reset --quiet --ledger .ledger \
  --bpf-program "$PROGRAM_ID" target/deploy/proof_of_ant.so "$@"
