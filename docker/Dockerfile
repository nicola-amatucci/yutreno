# Complete YuTreno test environment: web simulator, headless runs, external ETCS onboards and dynamics models
# (Python, Octave), bridges for the page and the compiled openETCS code.
#
#   docker build -f docker/Dockerfile -t yutreno-demo .
#   docker run --rm -p 8000:8000 -p 8766:8766 -p 8767:8767 yutreno-demo
#
# then http://localhost:8000 (simulator) and http://localhost:8000/results/ (outcomes of the demo).
# The build context is the repository root. See docker/README.md for the other modes.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------------------------
# Base: Node 22 plus Python, gcc and, if requested, Octave
FROM ${NODE_IMAGE} AS base
ARG WITH_OCTAVE=1
# Optional additional certificates (for example of a corporate proxy): .crt files in docker/certificates/
COPY docker/certificates/ /usr/local/share/ca-certificates/extra/
RUN set -eux; \
    apt-get update; \
    packages="ca-certificates python3 git gcc libc6-dev make tini"; \
    if [ "$WITH_OCTAVE" = "1" ]; then packages="$packages octave"; fi; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $packages; \
    update-ca-certificates; \
    rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

# ---------------------------------------------------------------------------------------------
# openETCS: downloads and compiles the generated code of the onboard computer (optional)
FROM base AS openetcs
ARG WITH_OPENETCS=1
COPY examples/openetcs/ /src/openetcs/
RUN set -eu; mkdir -p /opt/openetcs; \
    if [ "$WITH_OPENETCS" = "1" ]; then \
      sh /src/openetcs/build.sh /tmp/oe > /opt/openetcs/build.log 2>&1 || { tail -20 /opt/openetcs/build.log; exit 1; }; \
      cp /tmp/oe/test_evc /tmp/oe/libopenetcs_evc.a /opt/openetcs/; \
      mkdir -p /opt/openetcs/include; \
      cp /tmp/oe/srcAndBinary/GreenDemonstrator/src/OBU/Generated_Code/KCG_GreenField/*.h /opt/openetcs/include/; \
      cp -r /tmp/oe/srcAndBinary/GreenDemonstrator/src/OBU/Generated_Code/KCG-ERSA/libraries /opt/openetcs/include/; \
      cp -r /tmp/oe/srcAndBinary/GreenDemonstrator/MEN_demonstrator_stubs/Simulation /opt/openetcs/trackside-simulator; \
      rm -rf /tmp/oe; \
    else echo "openETCS not included (WITH_OPENETCS=0)" > /opt/openetcs/README.txt; fi

# ---------------------------------------------------------------------------------------------
# YuTreno: dependencies, build of the page and demo tools
FROM base AS yutreno
WORKDIR /yutreno
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run typecheck
COPY --from=openetcs /opt/openetcs /opt/openetcs
RUN chmod +x docker/start.sh docker/demo.sh
ENV DEMO=1 BRIDGE_ONBOARD="python3 examples/onboard/minimal_onboard.py" BRIDGE_DYNAMICS="python3 examples/python/yutreno_dynamics.py --stdio"
EXPOSE 8000 8766 8767
ENTRYPOINT ["tini", "--", "/yutreno/docker/start.sh"]
CMD ["all"]
