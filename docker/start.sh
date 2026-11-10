#!/bin/sh
# Entry point of the YuTreno demo container.
#   all        (default) runs the demo, then starts the web simulator and the bridges to the external programs
#   services   only web simulator and bridges, without demo
#   demo       only the test campaign; results in /yutreno/dist/results (or $RESULTS)
#   verify     all the checks of the repository (npm run verify)
#   openetcs   runs the minimal test of the openETCS onboard computer
#   shell      a shell in the container
#   other      run as is, for example: npx tsx src/server/headless.ts --help
# The Italian commands of version 0.x (tutto, servizi, verifica) are still accepted.
set -e
cd /yutreno
WEB_PORT=${WEB_PORT:-${WEB_PORTA:-8000}}
BRIDGE_DYNAMICS=${BRIDGE_DYNAMICS:-${PONTE_DINAMICA:-python3 examples/python/yutreno_dynamics.py --stdio}}
BRIDGE_ONBOARD=${BRIDGE_ONBOARD:-${PONTE_BORDO:-python3 examples/onboard/minimal_onboard.py}}

services() {
  echo "== Bridge for the external dynamics: ws://localhost:8766 → $BRIDGE_DYNAMICS"
  npx tsx src/server/bridge.ts --host 0.0.0.0 --port 8766 --exec "$BRIDGE_DYNAMICS" &
  echo "== Bridge for the external ETCS onboard: ws://localhost:8767 → $BRIDGE_ONBOARD"
  npx tsx src/server/bridge.ts --host 0.0.0.0 --port 8767 --exec "$BRIDGE_ONBOARD" &
  if [ ! -f dist/results/index.html ]; then
    mkdir -p dist/results
    echo '<!doctype html><meta charset="utf-8"><title>YuTreno demo</title><p>The demo was not run (DEMO=0). Start the container with DEMO=1 or with the <code>demo</code> command.</p><p><a href="../yutreno.html">Open the simulator</a></p>' > dist/results/index.html
  fi
  echo "== Simulator: http://localhost:$WEB_PORT/  ·  demo outcomes: http://localhost:$WEB_PORT/results/"
  exec python3 -m http.server "$WEB_PORT" --bind 0.0.0.0 --directory dist
}

case "${1:-all}" in
  all|tutto)
    if [ "$DEMO" = "1" ]; then docker/demo.sh || echo "The demo ended with errors: see above. Starting the services anyway."; fi
    services ;;
  services|servizi) services ;;
  demo) exec docker/demo.sh ;;
  verify|verifica) exec npm run verify ;;
  openetcs)
    if [ -x /opt/openetcs/test_evc ]; then exec /opt/openetcs/test_evc; else cat /opt/openetcs/README.txt; exit 1; fi ;;
  shell) exec bash 2>/dev/null || exec sh ;;
  *) exec "$@" ;;
esac
