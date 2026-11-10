#!/bin/sh
# Test campaign of the demo: the scenarios with the internal supervision, with the reference ETCS onboard and with an
# external onboard in Python; the external dynamics in Python and in Octave; external onboard and dynamics together;
# the interlocking trackside, in process and as an external program; the service trains; an external regulator in
# Python; the human driver model; the test of the openETCS onboard computer. At the end it writes an HTML report and
# ends with an error if a run fails that is not expected to (EXPECT: the scenarios expected to fail in a test).
cd /yutreno
R=${RESULTS:-/yutreno/dist/results}
rm -rf "$R"; mkdir -p "$R"
HL="npx tsx src/server/headless.ts"
start=$(date +%s)

JSON='console.log(JSON.stringify(process.argv[1]))'
run_test() {  # run_test <folder> <title> <description> <options...>; $EXPECT: scenarios expected to fail
  name=$1; title=$2; descr=$3; shift 3
  echo; echo "== $title"
  mkdir -p "$R/$name"
  printf '{"title":%s,"description":%s,"command":%s,"expected":%s}\n' \
    "$(node -e "$JSON" "$title")" \
    "$(node -e "$JSON" "$descr")" \
    "$(node -e 'console.log(JSON.stringify(process.argv.slice(1).join(" ")))' "npm run headless --" "$@")" \
    "$(node -e 'console.log(JSON.stringify(process.argv[1].split(" ").filter(Boolean)))' "${EXPECT:-}")" > "$R/$name/test.json"
  t0=$(date +%s)
  if $HL "$@" --output "$R/$name" 2>&1 | tee "$R/$name/console.txt"; then :; else echo "  (test ended with an error)"; fi
  echo "  duration $(( $(date +%s) - t0 )) s"
}

# the leaves and the degraded brake put the example controller in difficulty: their expected outcome is «failed»
EXPECT="leaves-ponte-sabato degraded-brake"
run_test 01-internal "Internal ETCS supervision, all scenarios" \
  "The historical reference: simplified supervision, example controller, multi-mass dynamics." \
  --scenario scenarios
run_test 02-reference "Reference ETCS onboard, all scenarios" \
  "Subset-026 balises and messages, onboard with the braking curves of §3.13. The expected outcomes are those of the internal supervision." \
  --scenario scenarios --onboard reference
# the minimal onboard ignores the confidence interval of its position: with the odometer reading 5 % less it passes
# its end of authority, which is what the scenario is there to show
EXPECT="leaves-ponte-sabato degraded-brake odometry-drift"
run_test 03-onboard-python "External ETCS onboard in Python, all scenarios" \
  "A minimal EVC written as a template, started by YuTreno and connected on stdin/stdout. It ignores the confidence interval of its position, so the odometry drift makes it pass its end of authority." \
  --scenario scenarios --onboard "exec:python3 examples/onboard/minimal_onboard.py"
EXPECT="leaves-ponte-sabato degraded-brake"
run_test 04-dynamics-python "External dynamics in Python, all scenarios" \
  "The point mass rewritten in Python outside the engine, coupled every 50 ms." \
  --scenario scenarios --dynamics "exec:python3 examples/python/yutreno_dynamics.py --stdio"
if command -v octave-cli >/dev/null 2>&1; then
  run_test 05-dynamics-octave "External dynamics in Octave, Valle Lauro" \
    "The same step function as the MATLAB version, run by GNU Octave." \
    --line valle-lauro --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"
fi
run_test 06-all-external "External onboard and dynamics together, Appennino" \
  "The train is driven by the example controller, protected by the Python onboard and moved by the Python dynamics: three programs coordinated by the engine." \
  --line appennino --onboard "exec:python3 examples/onboard/minimal_onboard.py" --dynamics "exec:python3 examples/python/yutreno_dynamics.py --stdio"
EXPECT=""
run_test 07-interlocking "Interlocking and RBC trackside, all trackside scenarios" \
  "Reference onboard with the EULYNX-style interlocking and the RBC that builds the authority from the routes." \
  --scenario scenarios/trackside

run_test 08-trackside-external "Interlocking and RBC trackside as an external program, all trackside scenarios" \
  "The same trackside started as a separate process on stdin/stdout: the runs must be those of the previous test." \
  --scenario scenarios/trackside --trackside "exec:npx tsx examples/trackside/trackside_stdio.ts"
run_test 09-services "Service trains, all service scenarios" \
  "Trains with a timetable in both directions, driven by the built-in driver around the controlled train: crossings, precedence, connections, a breakdown, a cancellation, a branch, the two real lines of Benevento as a network." \
  --scenario scenarios/services
run_test 10-regulator-python "External regulator in Python, breakdown at San Felice Scalo" \
  "A minimal traffic regulator started by YuTreno: it takes the priority away from the broken-down train and gives it back at the end." \
  --scenario scenarios/services/breakdown.json --regulator "exec:python3 examples/regulator/regulator_example.py"
for p in cautious medium aggressive; do
  run_test "11-driver-$p" "Human driver model, $p profile, Appennino" \
    "examples/driver_model.js in place of the automatic controller: a driver who brakes once the speed goes above the permitted one, after a response time drawn with a seed; the three profiles differ in margins and braking (docs/DRIVER_MODEL.md)." \
    --line appennino --controller examples/driver_model.js --controller-params "{\"profile\":\"$p\",\"seed\":1}"
done

if [ -x /opt/openetcs/test_evc ]; then
  echo; echo "== openETCS onboard computer: minimal test"
  mkdir -p "$R/12-openetcs"
  /opt/openetcs/test_evc | tee "$R/12-openetcs/console.txt"
fi

node docker/report.mjs "$R" "$(( $(date +%s) - start ))"; rc=$?
echo; echo "Report: $R/index.html"
exit $rc
