# Image de production (build standalone de Next.js), prête pour Coolify.
#   docker build -t aqueduc-3d .
#   docker run -p 3000:3000 aqueduc-3d
# Jeton Origin Trial facultatif, lu à chaque requête : -e HIC_ORIGIN_TRIAL_TOKEN=...

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# fichiers statiques (vignettes de l'accueil et vidéo de la visite, public/territoire)
COPY --from=build --chown=app:app /app/public ./public
# résultats du banc (page /bench)
COPY --from=build --chown=app:app /app/bench/results ./bench/results
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/aqueduc/series >/dev/null || exit 1
CMD ["node", "server.js"]
