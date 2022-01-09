FROM node:lts-alpine

ENV PATH="/app:${PATH}"

RUN apk update \
  && apk add procps \
  && apk add --no-cache --virtual build-dependencies \
  make \
  gcc \
  g++ \
  python3 \
  && npm install --silent --loglevel=error -g balanceofsatoshis

WORKDIR /app/

COPY . /app/

RUN npm config set loglevel error \
  && npm config set python $(which python3) \
  && npm install --ignore-scripts \
  && npm uninstall sqlite3 \
  && npm install --save sqlite3@4.2.0 \ 
  && npm cache clean --force

ENTRYPOINT [ "/app/docker/start.sh" ]
