#!/bin/sh

trap "echo TRAPed signal" HUP INT QUIT TERM

/app/jet start all
result=$?

echo "[hit enter to quit]"
read

echo "Stopping..."

/app/jet stop all

echo "exited $result"

exit $result
