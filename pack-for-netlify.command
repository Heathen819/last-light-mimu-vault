#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
"$ROOT/pack-for-netlify.sh"
open "$ROOT/Mimu Vault Deploy"
