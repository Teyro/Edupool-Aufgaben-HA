ARG BUILD_FROM
FROM $BUILD_FROM

# Nur Node.js – das Add-on braucht keine weiteren Pakete
RUN apk add --no-cache nodejs

WORKDIR /app
COPY app/ /app/

CMD [ "node", "/app/server.mjs" ]
