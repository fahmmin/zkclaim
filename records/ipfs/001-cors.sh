#!/bin/sh
# Kubo runs /container-init.d/*.sh on every start, before the daemon. Lets the zkClaim UI
# (Vite on :5173) call the RPC API from the browser; Kubo answers 403 to any other origin.
set -e
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:5173", "http://127.0.0.1:5173"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["POST"]'
