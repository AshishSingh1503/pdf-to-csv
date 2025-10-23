#!/bin/sh
# Replace PORT placeholder with actual port
envsubst '$PORT' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
# Start nginx
nginx -g 'daemon off;'