FROM node:lts-alpine

RUN apk update \
  && apk add procps \
  && apk add --virtual build-dependencies \
  make \
  gcc \
  g++ \
  python3 \
  && npm install -g balanceofsatoshis

WORKDIR /app/

COPY . /app/

RUN npm install --python=$(which python3)

ENTRYPOINT [ "/app/jet" ]
