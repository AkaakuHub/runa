#!/bin/bash

set -euo pipefail

SUDACHI_DIR="sudachi"
VENV_DIR="$SUDACHI_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"
REQUIREMENTS=(sudachipy sudachidict_core)
PYTHON_VENV=""
PYTHON_MAJOR=0
PYTHON_MINOR=0
PYTHON_VERSION=""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

ensure_python() {
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    log_error "Python3 が見つかりません。PYTHON_BIN 変数でパスを指定してください。"
    exit 1
  fi
}

detect_python_version() {
  PYTHON_VERSION=$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  IFS='.' read -r PYTHON_MAJOR PYTHON_MINOR <<< "$PYTHON_VERSION"
  log_info "使用する Python: ${PYTHON_VERSION}"
}

handle_python_compat() {
  if (( PYTHON_MAJOR > 3 || (PYTHON_MAJOR == 3 && PYTHON_MINOR >= 14) )); then
    log_warn "Python ${PYTHON_VERSION} は SudachiPy が未対応です。可能なら PYTHON_BIN=python3.12 などを指定してください。"
    export PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1
    log_warn "互換モードとして PYO3_USE_ABI3_FORWARD_COMPATIBILITY=1 を設定しました。"
  fi
}

create_venv() {
  if [[ ! -d "$VENV_DIR" ]]; then
    log_info "仮想環境を作成します (${VENV_DIR})"
    mkdir -p "$SUDACHI_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  else
    log_info "既存の仮想環境を使用します"
  fi
}

activate_venv() {
  if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; then
    # Git Bash on Windows
    # shellcheck disable=SC1090
    source "$VENV_DIR/Scripts/activate"
    PYTHON_VENV="$VENV_DIR/Scripts/python.exe"
  else
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
    PYTHON_VENV="$VENV_DIR/bin/python3"
  fi
}

install_requirements() {
  log_info "SudachiPy と辞書をインストールします"
  pip install --upgrade pip >/dev/null
  pip install --upgrade "${REQUIREMENTS[@]}"
}

run_smoke_test() {
  log_info "動作確認を実行中..."
  "$PYTHON_VENV" - <<'PY'
from sudachipy import dictionary, tokenizer

tokenizer_obj = dictionary.Dictionary().create()
result = tokenizer_obj.tokenize("テストです", tokenizer.Tokenizer.SplitMode.C)
assert result, "tokenize result is empty"
print("SudachiPy ready (", len(result), "tokens )")
PY
}

main() {
  ensure_python
  detect_python_version
  handle_python_compat
  create_venv
  activate_venv
  install_requirements
  run_smoke_test
  log_info "セットアップが完了しました！"
  log_info "環境変数 SUDACHI_PYTHON_PATH を ${PYTHON_VENV} に設定すると Node.js から利用できます"
}

main "$@"
