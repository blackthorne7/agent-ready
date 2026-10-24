# Build natively on the host arch (fast), run on Unikraft's x86_64. The build stage is glibc (slim):
# Next.js compiles ~4x faster there than on Alpine/musl, and its output is plain JS that runs on the
# Alpine node below (sharp is the only native module, and images are unoptimized, so it never loads).
FROM --platform=$BUILDPLATFORM node:22-slim AS build
WORKDIR /usr/src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-alpine AS runtime

FROM scratch

# Node binary and the musl/C++ runtime it links against
COPY --from=runtime /usr/local/bin/node /usr/bin/node
COPY --from=runtime /lib/ld-musl-x86_64.so.1 /lib/ld-musl-x86_64.so.1
COPY --from=runtime /usr/lib/libgcc_s.so.1 /usr/lib/libgcc_s.so.1
COPY --from=runtime /usr/lib/libstdc++.so.6 /usr/lib/libstdc++.so.6
COPY --from=runtime /etc/os-release /etc/os-release
COPY --from=runtime /etc/ssl/certs /etc/ssl/certs

# Next.js standalone server
COPY --from=build /usr/src/.next/standalone /usr/src/
COPY --from=build /usr/src/.next/static /usr/src/.next/static
COPY --from=build /usr/src/public /usr/src/public
