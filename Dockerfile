# ─────────────────────────────────────────────────────────────────────
#  WeatherNow – Dockerfile
#  Serves the static app via nginx.  Music files live in /app/music and
#  are mounted from the host so you can drop new tracks without rebuild.
# ─────────────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copy app source
COPY . /usr/share/nginx/html/

# Drop the default nginx config and use ours
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Music folder – expected to be volume-mounted at runtime
# (see docker-compose.yml).  Create an empty dir so the image works
# standalone too.
RUN mkdir -p /usr/share/nginx/html/music

EXPOSE 80
