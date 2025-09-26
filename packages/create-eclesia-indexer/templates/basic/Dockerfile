# syntax=docker/dockerfile:1

FROM node:20-alpine AS builder

# Use production node environment by default.
# ENV NODE_ENV production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /usr/src/app

# Copy the rest of the source files into the image.
COPY . .

# Download dependencies as a separate step to take advantage of Docker's caching.
# Leverage a cache mount to /root/.npm to speed up subsequent builds.
# Leverage a bind mounts to package.json and package-lock.json to avoid having to copy them into
# into this layer.
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=cache,id=pnpm,target=/pnpm/store \
    CI=1 npm install -g pnpm typescript && \
    CI=1 pnpm install && \
    pnpm build


# Final image
FROM node:20-alpine

ENV LOG_LEVEL debug
ENV CHAIN_PREFIX atone
ENV QUEUE_SIZE 200
ENV CHAIN_START_HEIGHT 1

# USER node

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app/package.json /usr/src/app/package.json


COPY --from=builder /usr/src/app/node_modules /usr/src/app/node_modules
COPY --from=builder /usr/src/app/dist /usr/src/app/dist

ENTRYPOINT ["node", "dist/index.js" ]
