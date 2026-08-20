# CI build image for AgentSami (Electron).
# Produces the Windows NSIS installer via electron-builder + Wine, without
# needing Node/Electron/Wine installed on the host running CI.
#
# Build:  docker build -t agentsami-builder .
# Run:    docker run --rm -v "$(pwd)/dist:/project/dist" agentsami-builder
#
# The image only ever sees source code needed to build the app — .env and
# creds/ are excluded via .dockerignore and are never baked into the image
# or the packaged output (see package.json "build.files").

FROM electronuserland/builder:wine

WORKDIR /project

# Install dependencies first so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

CMD ["npm", "run", "build:win"]
