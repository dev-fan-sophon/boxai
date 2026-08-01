# The base image is not a free choice: the Sandbox SDK runs its control process inside the
# container, so the image must extend Cloudflare's. Keep this tag pinned to the
# @cloudflare/sandbox version in package.json — a mismatch fails at runtime, not at build time.
FROM docker.io/cloudflare/sandbox:0.12.4-python

# Fonts and CLI tools first: they change far less often than the Python pins below, so this layer
# stays cached across most rebuilds. Noto CJK is the bulk of the image and is non-negotiable —
# without it every Chinese and Japanese glyph renders as a tofu box.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-core \
        fonts-noto-cjk \
        p7zip-full \
        ripgrep \
        sqlite3 \
        unzip \
    && rm -rf /var/lib/apt/lists/*

# The base ships Python 3.11 at /usr/local/bin with no `pip` shim on PATH, only `pip3`.
# Going through `python3 -m pip` keeps this working if that ever changes.
COPY container/requirements.txt /tmp/requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

ENV MPLCONFIGDIR=/opt/boxai/mpl
COPY container/matplotlibrc /opt/boxai/mpl/matplotlibrc

# Build the matplotlib font cache now. Doing it here costs one second at image build; leaving it
# to runtime costs that second on every cold start, inside the user's wall-clock budget.
RUN python3 -c "import matplotlib.pyplot"

# The authoring skills are not in this image on purpose. The model writes the whole script in one
# shot with no filesystem access, so guidance only helps if it is in the prompt — it lives in
# service/document_skills/ and is embedded in the Go binary.
COPY container/run_build.py /opt/boxai/run_build.py
