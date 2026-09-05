FROM alpine:3.21
RUN apk add --no-cache wireguard-tools wireguard-go iproute2 iptables
COPY docker/wireguard/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV WG_QUICK_USERSPACE_IMPLEMENTATION=wireguard-go
ENTRYPOINT ["/entrypoint.sh"]
