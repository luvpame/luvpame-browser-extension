#!/usr/bin/env bash
set -euo pipefail
cd /source
git config --global --add safe.directory /source
git config --global --add safe.directory /source/llama.cpp
python3 - <<'PY'
from zipfile import ZipFile
with ZipFile('dawn.zip') as archive:
    archive.extractall('emdawn')
PY

for variant in default compat; do
  options=(-DEMSCRIPTEN_SYSTEM_PROCESSOR=wasm32 -DGGML_WEBGPU=ON -DWLLAMA_TEST_BACKEND=OFF)
  if [ "$variant" = compat ]; then
    options+=(-DWLLAMA_COMPAT=ON -DLLAMA_WASM_MEM64=OFF -DGGML_WEBGPU_JSPI=OFF)
  else
    options+=(-DGGML_WEBGPU_JSPI=ON)
  fi
  emcmake cmake -S . -B "build-$variant" "${options[@]}" -DEMDAWNWEBGPU_DIR=/source/emdawn/emdawnwebgpu_pkg
  cmake --build "build-$variant" --target wllama --parallel 8
  test -f "build-$variant/llama.cpp/ggml/src/CMakeFiles/ggml-cpu.dir/ggml-cpu/arch/wasm/quants.c.o"
  mkdir -p output
  if [ "$variant" = compat ]; then
    name=wllama-compat
  else
    name=wllama
  fi
  cp "build-$variant/wllama.js" "output/$name.js"
  node scripts/add_wasm_names.js "build-$variant/wllama.wasm" "output/$name.wasm"
done
