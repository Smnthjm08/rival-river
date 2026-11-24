#!/usr/bin/env bash
# Deploys or upgrades rival_river on devnet. Always rebuilds without
# `--features localnet` first: that build delegates to MagicSVM's validator,
# whose keypair is public. Extra arguments go to `solana program deploy`.
set -euo pipefail
cd "$(dirname "$0")/.."

RPC=${RPC:-https://rpc.magicblock.app/devnet}
PROGRAM_KEYPAIR=target/deploy/rival_river-keypair.json
SO=target/deploy/rival_river.so

anchor build

# Check the binary itself: the TEE validator's key must be in it, MagicSVM's
# must not. The compiler stores a constant key as eight 4-byte immediates,
# so look for those pieces rather than the 32 bytes in a row.
python3 - "$SO" <<'PY'
import sys
B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def pieces_in(so, s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    k = n.to_bytes(32, "big")
    return sum(k[i:i + 4] in so for i in range(0, 32, 4))
so = open(sys.argv[1], "rb").read()
tee = pieces_in(so, "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo")
local = pieces_in(so, "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev")
if tee < 8 or local == 8:
    sys.exit("refusing to deploy: this build doesn't pin the devnet TEE validator")
print("ok: build pins the devnet TEE validator")
PY

# Upload into a buffer whose keypair is kept on disk. A plain deploy restarts
# from zero when public devnet drops writes; rerunning write-buffer with the
# same keypair only writes what's missing.
BUFFER_KEYPAIR=target/deploy/deploy-buffer-keypair.json
[ -f "$BUFFER_KEYPAIR" ] || solana-keygen new --no-bip39-passphrase --silent -o "$BUFFER_KEYPAIR"
BUFFER=$(solana-keygen pubkey "$BUFFER_KEYPAIR")
for attempt in 1 2 3 4 5; do
  if solana program write-buffer "$SO" --buffer "$BUFFER_KEYPAIR" --url "$RPC" \
      --use-rpc --with-compute-unit-price 100000 --max-sign-attempts 50; then
    break
  fi
  if [ "$attempt" = 5 ]; then
    echo "Upload failed 5 times. Rerun this script to resume buffer $BUFFER."
    exit 1
  fi
done

# First deploy: room for the program to grow to twice its size on upgrades.
MAX_LEN=()
if ! solana program show "$(solana-keygen pubkey "$PROGRAM_KEYPAIR")" --url "$RPC" >/dev/null 2>&1; then
  MAX_LEN=(--max-len $(( $(wc -c < "$SO") * 2 )))
fi
solana program deploy --buffer "$BUFFER" --program-id "$PROGRAM_KEYPAIR" "${MAX_LEN[@]}" \
  --url "$RPC" --use-rpc --with-compute-unit-price 100000 "$@"
rm -f "$BUFFER_KEYPAIR"

echo "Deployed. Tests need the localnet build again: anchor build -- --features localnet"
